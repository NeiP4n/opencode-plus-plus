import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { EffectFlock } from "@opencode/util/effect-flock"
import { OPENCODE_ARTIFACT, OPENCODE_CHANNEL, OPENCODE_LOCAL, OPENCODE_VERSION } from "../version"
import { Context, Duration, Effect, FileSystem, Layer, Option, Ref, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { parse, type ParseError } from "jsonc-parser"
import path from "node:path"
import { RetainedImage } from "./retained-image"
import { SourceRelease } from "./source-release"
import { action, parseReleaseVersion, type Policy } from "./updater-action"
import { conciseDetail, errorDetail } from "./updater-error"

export const methods = ["curl", "npm", "pnpm", "bun", "yarn", "vp", "brew"] as const

export type Method = (typeof methods)[number]
export type RunResult = { readonly type: "available" | "installed"; readonly version: string }
export type CheckResult = RunResult | { readonly type: "unavailable"; readonly message: string }

export class UpgradeError extends Error {
  readonly title: string
  readonly detail: string
  readonly command?: string
  readonly retry: string

  constructor(
    input: {
      readonly title: string
      readonly detail: string
      readonly command?: string
      readonly retry: string
    },
    options?: ErrorOptions,
  ) {
    super(input.detail, options)
    this.name = "UpgradeError"
    this.title = input.title
    this.detail = input.detail
    this.command = input.command
    this.retry = input.retry
  }
}

const decodeVpPackages = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Struct({ name: Schema.String }))),
)

const installNames: Record<Method, string> = {
  curl: "The Opencode++ installer",
  npm: "npm",
  pnpm: "pnpm",
  bun: "Bun",
  yarn: "Yarn",
  vp: "Vite+",
  brew: "Homebrew",
}

function resultDetail(result: { code: number; stdout: string; stderr: string }) {
  return (
    conciseDetail(result.stderr) ??
    conciseDetail(result.stdout) ??
    `The command exited with code ${result.code} without any error output.`
  )
}

export interface Interface {
  readonly run: (onInstall?: (version: string) => void) => Effect.Effect<RunResult | undefined>
  readonly check: () => Effect.Effect<CheckResult | undefined, Error>
  readonly apply: (version: string) => Effect.Effect<SourceRelease.Kept | undefined, Error>
  readonly method: () => Effect.Effect<Method | undefined>
  readonly latest: (method?: Method) => Effect.Effect<string, Error>
  readonly upgrade: (method: Method, version: string) => Effect.Effect<void, Error>
  readonly removal: (
    method: Method,
  ) => { readonly command: ReadonlyArray<string>; readonly run: Effect.Effect<void, Error> } | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/cli/Updater") {}

export function decodePolicy(text: string): Policy | undefined {
  const errors: ParseError[] = []
  const input: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof input !== "object" || input === null) return
  if ("update" in input) {
    const value = input.update
    if (value === "disable" || value === "notify" || value === "auto") return value
    return
  }
  if (!("autoupdate" in input)) return
  if (input.autoupdate === false) return "disable"
  if (input.autoupdate === "notify") return "notify"
  if (input.autoupdate === true) return "auto"
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const appProcess = yield* AppProcess.Service
  const flock = yield* EffectFlock.Service
  const installedVersion = yield* Ref.make(OPENCODE_VERSION)
  const channel = OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")
  const executable = yield* fs.realPath(process.execPath).pipe(Effect.orElseSucceed(() => process.execPath))
  const installedPackage = yield* Effect.gen(function* () {
    const directory = path.dirname(path.dirname(executable))
    const manifest: { name: string; bin?: Record<string, string> } = yield* fs
      .readFileString(path.join(directory, "package.json"))
      .pipe(Effect.flatMap((text) => Effect.try(() => JSON.parse(text))))
    if (!/^@opencode(?:-ai)?\/cli(?:-node)?$/.test(manifest.name)) return
    if (Object.values(manifest.bin ?? {}).some((bin) => path.resolve(directory, bin) === executable))
      return manifest.name
  }).pipe(Effect.orElseSucceed(() => undefined))
  const installedFormula = ["opencode", "opencode-beta", "opencode-v2"].find((name) =>
    executable.includes(`${path.sep}Cellar${path.sep}${name}${path.sep}`),
  )

  const readPolicy = Effect.fnUntraced(function* () {
    const values = yield* Effect.forEach(["config.json", "opencode.json", "opencode.jsonc"], (name) =>
      fs.readFileString(path.join(global.config, name)).pipe(
        Effect.map(decodePolicy),
        Effect.orElseSucceed(() => undefined),
      ),
    )
    return values.findLast((value) => value !== undefined) ?? "notify"
  })

  const exec = Effect.fnUntraced(function* (command: string[], timeout: Duration.Input = "10 seconds") {
    return yield* appProcess
      .run(ChildProcess.make(command[0], command.slice(1)), {
        timeout,
        maxOutputBytes: 100_000,
        maxErrorBytes: 100_000,
      })
      .pipe(
        Effect.map((result) => ({
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        })),
      )
  })

  const curlBinary = path.resolve(
    global.home,
    ".opencode",
    "bin",
    process.platform === "win32" ? "opencode.exe" : "opencode",
  )

  const installerBash = Effect.fnUntraced(function* () {
    if (process.platform !== "win32") return "bash"
    if (process.env.OPENCODE_GIT_BASH_PATH) return process.env.OPENCODE_GIT_BASH_PATH
    const git = yield* exec(["git", "--exec-path"]).pipe(Effect.orElseSucceed(() => undefined))
    const bash = git?.code === 0 ? path.resolve(git.stdout.trim(), "..", "..", "..", "bin", "bash.exe") : undefined
    if (bash && (yield* fs.exists(bash).pipe(Effect.orElseSucceed(() => false)))) return bash
    return yield* Effect.fail(
      new UpgradeError({
        title: "Git Bash is required to update Opencode++",
        detail: "The Opencode++ installer runs with Git Bash on Windows, and it was not found.",
        retry: "Install Git for Windows or set OPENCODE_GIT_BASH_PATH, then run opencode upgrade again.",
      }),
    )
  })

  const method = Effect.fnUntraced(function* () {
    if (path.resolve(process.execPath) === curlBinary) return "curl"
    if (installedFormula) return "brew"
    if (!installedPackage) return
    const checks: ReadonlyArray<{ method: Method; command: string[] }> = [
      { method: "npm", command: ["npm", "list", "-g", "--depth=0", installedPackage] },
      { method: "pnpm", command: ["pnpm", "list", "-g", "--depth=0", installedPackage] },
      { method: "bun", command: ["bun", "pm", "ls", "-g"] },
      { method: "yarn", command: ["yarn", "global", "list"] },
      { method: "vp", command: ["vp", "list", "-g", "--json", installedPackage] },
    ]
    const results = yield* Effect.forEach(
      checks,
      (check) =>
        exec(check.command).pipe(
          Effect.orElseSucceed(() => ({ code: 1, stdout: "", stderr: "" })),
          Effect.map((result) => ({ check, result })),
        ),
      { concurrency: "unbounded" },
    )
    return results.find((result) => {
      if (result.check.method !== "vp") return result.result.stdout.includes(installedPackage)
      return Option.exists(decodeVpPackages(result.result.stdout), (packages) =>
        packages.some((item) => item.name === installedPackage),
      )
    })?.check.method
  })

  const removal = (method: Method) => {
    if (method === "curl" || method === "brew" || !installedPackage) return undefined
    const commands = {
      npm: ["npm", "uninstall", "--global", installedPackage],
      pnpm: ["pnpm", "remove", "--global", installedPackage],
      bun: ["bun", "remove", "--global", installedPackage],
      yarn: ["yarn", "global", "remove", installedPackage],
      vp: ["vp", "uninstall", "-g", installedPackage],
    }
    const command = commands[method]
    return {
      command,
      run: retaining(
        method,
        exec(command, "5 minutes").pipe(
          Effect.flatMap((result) => (result.code === 0 ? Effect.void : Effect.fail(new Error(resultDetail(result))))),
        ),
        global.tmp,
      ),
    }
  }

  const release = Effect.fnUntraced(function* (method?: Method) {
    const distribution = method === "brew" ? "homebrew" : "npm"
    const core = method === "brew" && installedFormula === "opencode"
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(
          core
            ? "https://formulae.brew.sh/api/formula/opencode.json"
            : `https://opencode.ai/update/api/${encodeURIComponent(channel)}/${encodeURIComponent(OPENCODE_ARTIFACT)}/${distribution}?current=${encodeURIComponent(OPENCODE_VERSION)}`,
          { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) },
        ),
      catch: (cause) =>
        new UpgradeError(
          {
            title: "Could not check for Opencode++ updates",
            detail: errorDetail(cause),
            retry: "Check your network, then run opencode upgrade again.",
          },
          { cause },
        ),
    })
    if (!response.ok)
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not check for Opencode++ updates",
          detail: `The update service returned HTTP ${response.status}.`,
          retry: "Try again in a few minutes.",
        }),
      )
    const data: { version?: string; metadata?: { package?: string }; versions?: { stable?: string } } =
      yield* Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new UpgradeError(
            {
              title: "Could not read the Opencode++ update information",
              detail: errorDetail(cause),
              retry: "Try again in a few minutes.",
            },
            { cause },
          ),
      })
    const version = core ? data.versions?.stable : data.version
    const packageName = core ? "opencode" : data.metadata?.package
    if (!version || !packageName)
      return yield* Effect.fail(
        new UpgradeError({
          title: "Could not read the Opencode++ update information",
          detail: "The update service returned incomplete release information.",
          retry: "Try again in a few minutes.",
        }),
      )
    return { package: packageName, version }
  })

  const latest = (selected?: Method) =>
    (selected ? Effect.succeed(selected) : method()).pipe(
      Effect.flatMap(release),
      Effect.map((data) => data.version),
    )

  const temporaryDirectory = (prefix: string) =>
    Effect.acquireRelease(fs.makeTempDirectory({ directory: global.cache, prefix }), (directory) =>
      fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore),
    )

  const retaining = <A, E, R>(method: Method, effect: Effect.Effect<A, E, R>, directory = global.cache) => {
    if (process.platform !== "win32" || method === "brew") return effect
    const owned = method === "curl" ? path.resolve(process.execPath) === curlBinary : installedPackage !== undefined
    if (!owned) return effect
    return Effect.scoped(RetainedImage.retain(directory, "upgrade").pipe(Effect.andThen(effect))).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
    )
  }

  const runUpgrade = (input: {
    readonly method: Method
    readonly command: string[]
    readonly displayCommand?: string[]
    readonly title?: string
    readonly retry?: string
  }) => {
    const failure = (detail: string, cause?: unknown) =>
      new UpgradeError(
        {
          title: input.title ?? `${installNames[input.method]} could not install OpenCode`,
          detail,
          command: (input.displayCommand ?? input.command).join(" "),
          retry: input.retry ?? "Fix the issue above, then run opencode upgrade again.",
        },
        cause === undefined ? undefined : { cause },
      )
    return exec(input.command, "5 minutes").pipe(
      Effect.flatMap((result) =>
        result.code === 0 ? Effect.succeed(result) : Effect.fail(failure(resultDetail(result))),
      ),
      Effect.mapError((cause) =>
        cause instanceof UpgradeError
          ? cause
          : failure(
              cause instanceof AppProcess.AppProcessError && cause.stderr === undefined && cause.cause === undefined
                ? `Failed to update with ${input.method}`
                : errorDetail(cause),
              cause,
            ),
      ),
    )
  }

  const upgrade = Effect.fnUntraced(function* (method: Method, input: string) {
    if (!parseReleaseVersion(input)) return yield* Effect.fail(new Error(`Invalid version: ${input}`))
    const version = input.trim().replace(/^v/, "")
    const packageName =
      method === "brew" && installedFormula === "opencode" ? "opencode" : (yield* release(method)).package
    const target = `${packageName}@${version}`
    if (installedPackage && packageName !== installedPackage && (method === "pnpm" || method === "yarn")) {
      return yield* Effect.fail(new Error(`Reinstall ${target} with ${method} to migrate from ${installedPackage}.`))
    }
    const commands: Record<Exclude<Method, "bun" | "curl" | "brew">, string[]> = {
      npm: [
        "npm",
        "install",
        "--global",
        ...((OPENCODE_ARTIFACT === "cli" && !installedPackage?.endsWith("/cli-node")) ||
        (installedPackage && packageName !== installedPackage)
          ? ["--force"]
          : []),
        target,
      ],
      pnpm: ["pnpm", "add", "--global", `--allow-build=${packageName}`, target],
      yarn: ["yarn", "global", "add", target],
      vp:
        installedPackage && packageName !== installedPackage
          ? ["vp", "install", "-g", "--force", target]
          : ["vp", "update", "-g", target],
    }
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* flock.acquire("cli-upgrade", undefined, { timeoutMs: Duration.toMillis("15 minutes") })
        if (method === "bun") {
          yield* fs.makeDirectory(global.cache, { recursive: true })
          const cache = yield* temporaryDirectory("update-")
          return yield* retaining(
            method,
            runUpgrade({
              method,
              command: ["bun", "install", "--global", "--trust", "--cache-dir", cache, target],
              displayCommand: ["bun", "install", "--global", "--trust", target],
            }),
          )
        }
        if (method === "curl") {
          const bash = yield* installerBash()
          yield* fs.makeDirectory(global.cache, { recursive: true })
          const directory = yield* temporaryDirectory("update-")
          const installer = path.join(directory, "install")
          yield* runUpgrade({
            method,
            command: ["curl", "-fsSL", "-o", installer, "https://opencode.ai/v2/install"],
            displayCommand: ["curl", "-fsSL", "https://opencode.ai/v2/install"],
            title: "Could not download the Opencode++ installer",
            retry: "Check your network, then run opencode upgrade again.",
          })
          return yield* retaining(
            method,
            runUpgrade({
              method,
              command: [bash, installer, "--version", version, "--no-modify-path"],
              displayCommand: ["opencode", "upgrade", version, "--method", "curl"],
              title: "The Opencode++ installer failed",
            }),
          )
        }
        if (method === "brew") return yield* runUpgrade({ method, command: ["brew", "upgrade", packageName] })
        return yield* retaining(method, runUpgrade({ method, command: commands[method] }))
      }),
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof UpgradeError
          ? cause
          : new UpgradeError(
              {
                title: "Could not prepare the Opencode++ upgrade",
                detail: errorDetail(cause),
                retry: "Fix the issue above, then run opencode upgrade again.",
              },
              { cause },
            ),
      ),
      Effect.asVoid,
    )
  })

  const inspect = Effect.fnUntraced(function* () {
    if (OPENCODE_LOCAL) {
      // Source installs use Opencode++ release tags or the development branch, never the public
      // opencode.ai update service. A release checkout checks release/* first; a lan-rooms
      // checkout then falls through to its own branch tracking.
      const release = yield* sourceRelease()
      if (release?.available) return { policy: "notify" as const, version: release.available }

      const branch = yield* developmentBranch()
      if (branch?.type === "available") return { policy: "notify" as const, version: branch.version }
      if (branch?.type === "unavailable") {
        yield* Effect.logWarning("Opencode++ update check unavailable", { message: branch.message })
      }
      return undefined
    }

    if (["1", "true"].includes(process.env.OPENCODE_DISABLE_AUTOUPDATE?.toLowerCase() ?? "")) {
      yield* Effect.logInfo("update check skipped", {
        reason: "disabled",
        version: OPENCODE_VERSION,
        channel: OPENCODE_CHANNEL,
      })
      return undefined
    }
    const policy = yield* readPolicy()
    if (policy === "disable") {
      yield* Effect.logInfo("update check skipped", { reason: "policy-disabled" })
      return undefined
    }

    const current = yield* Ref.get(installedVersion)
    const version = yield* latest()
    yield* Effect.logInfo("update check", {
      current,
      latest: version,
    })
    const next = action(current, version, policy)
    if (next === "none") {
      yield* Effect.logInfo("update check done", { action: "up-to-date" })
      return undefined
    }
    yield* Effect.logInfo("Opencode++ update available", { current, latest: version, action: next })
    return { policy, version }
  })

  const install = Effect.fnUntraced(function* (version: string) {
    const detected = yield* method()
    if (!detected) {
      yield* Effect.logWarning("update skipped: installation method not found")
      return false
    }
    const current = yield* Ref.get(installedVersion)
    yield* upgrade(detected, version)
    yield* Ref.set(installedVersion, version)
    yield* Effect.logInfo("updated OpenCode", { from: current, to: version, method: detected })
    return true
  })

  const apply = Effect.fn("cli.updater.apply")(function* (version: string) {
    if (OPENCODE_LOCAL)
      return yield* Effect.tryPromise({
        try: async () => {
          if (parseReleaseVersion(version)) return SourceRelease.apply(version)
          if (await SourceRelease.detached()) return SourceRelease.follow()
          await SourceRelease.pull()
          return undefined
        },
        catch: (cause) =>
          new UpgradeError(
            {
              title: "Could not update Opencode++",
              detail: errorDetail(cause),
              retry: "Check the internet connection, then try the update again.",
            },
            { cause },
          ),
      })
    if (!(yield* install(version))) return yield* Effect.fail(new Error("Installation method not found"))
    return undefined
  })

  const check = Effect.fn("cli.updater.check")(function* () {
    const release = OPENCODE_LOCAL ? yield* sourceRelease() : undefined
    if (release) return release.available ? { type: "available" as const, version: release.available } : undefined
    if (OPENCODE_LOCAL) return yield* developmentBranch()
    const version = yield* latest()
    if (!parseReleaseVersion(version)) return yield* Effect.fail(new Error(`Invalid version: ${version}`))
    const current = yield* Ref.get(installedVersion)
    if (action(current, version, "auto") === "none") {
      return action(OPENCODE_VERSION, current, "auto") === "none"
        ? undefined
        : { type: "installed" as const, version: current }
    }
    return { type: "available" as const, version }
  })

  const run = Effect.fn("cli.updater.run")(
    function* (onInstall: (version: string) => void = () => {}) {
      const result = yield* inspect()
      if (!result) return undefined
      if (result.policy === "notify") return { type: "available" as const, version: result.version }
      onInstall(result.version)
      if (!(yield* install(result.version))) return yield* Effect.fail(new Error("Installation method not found"))
      return { type: "installed" as const, version: result.version }
    },
    Effect.catch((error) => Effect.logWarning("update check failed", { error }).pipe(Effect.as(undefined))),
  )

  const sourceCheck = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({
      try: operation,
      catch: (cause) =>
        new UpgradeError(
          {
            title: "Could not check for Opencode++ updates",
            detail: errorDetail(cause),
            retry: "Check that Git is installed and this checkout's remote or upstream is reachable, then try again.",
          },
          { cause },
        ),
    })

  const developmentBranch = Effect.fnUntraced(function* () {
    const status = yield* sourceCheck(() => SourceRelease.branch())
    if (!status) return yield* installedBranch()
    if (status.type === "behind") return { type: "available" as const, version: `${status.name} +${status.behind}` }
    if (status.type === "current") return undefined
    return {
      type: "unavailable" as const,
      message:
        status.type === "diverged"
          ? "This branch and its copy on GitHub both have new commits. Merge them by hand with git pull."
          : "This branch has no copy on GitHub to update from.",
    }
  })

  const installedBranch = Effect.fnUntraced(function* () {
    const newest = yield* Effect.tryPromise(() => SourceRelease.latest()).pipe(Effect.orElseSucceed(() => undefined))
    if (newest) return { type: "available" as const, version: newest }
    const status = yield* sourceCheck(() => SourceRelease.install())
    if (status.type === "behind") return { type: "available" as const, version: `${status.branch} +${status.behind}` }
    if (status.type === "current") return undefined
    return {
      type: "unavailable" as const,
      message: "This install has commits that are not on GitHub. Run the installer again to replace them.",
    }
  })

  const sourceRelease = Effect.fnUntraced(function* () {
    const pinned = yield* sourceCheck(() => SourceRelease.current())
    if (!pinned) return undefined
    const newest = yield* Effect.tryPromise(() => SourceRelease.latest()).pipe(Effect.orElseSucceed(() => undefined))
    return { current: pinned, available: newest && Bun.semver.order(newest, pinned) > 0 ? newest : undefined }
  })

  return Service.of({ run, check, apply, method, latest, upgrade, removal })
})

export const layer = Layer.effect(Service, make)

export * as Updater from "./updater"
export { action, type Action, type Policy } from "./updater-action"
