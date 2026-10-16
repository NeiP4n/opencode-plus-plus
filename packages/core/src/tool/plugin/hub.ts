export * as HubTool from "./hub.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Tool } from "@opencode/schema/tool"
import { Deferred, Effect, Option, Schema, Scope } from "effect"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { Job } from "../../job.js"
import { Permission } from "../../permission.js"
import { Shell } from "../../shell.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellResult } from "../../shell/result.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { Config } from "../../config.js"
import { Hub } from "../../hub/index.js"
import { HubHost } from "../../hub/host.js"
import { Orchestra } from "../../orchestra.js"

export const name = "hub"
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000

const description = (tools: string[]) =>
  [
    "Run a ready-made fast command from the Universal Tool Hub instead of hand-writing shell.",
    "Prefer this tool over shell when a catalog entry covers the task: hub commands use fast modern CLIs (rg, fd, jq, yq, mlr) and pick the best available backend.",
    "Call with list or query to discover entries, id plus args to run one. An entry id names a recipe such as search.content, not a program; args is an object from the entry's placeholder names to values, e.g. {\"pattern\": \"TODO\"}.",
    "With install plus id prints the package-manager command for missing tools. Use shell as fallback when no entry fits.",
    `Entries are filtered to this machine (${process.platform}); the hub picks the shell itself (${HubHost.order().join(" > ")}) and quotes args for it, so pass raw values without shell quoting.`,
    tools.length > 0
      ? `Programs the entries can use here (not entry ids): ${tools.join(", ")}.`
      : "No optional hub tools detected yet.",
  ].join(" ")

export const Input = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  // Models often pass counts and flags as JSON numbers or booleans ({"limit": 5});
  // every value fills a text template, so accept them and render them as text.
  args: Schema.optionalKey(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))),
  backend: Schema.optionalKey(Schema.Literals(["bash", "nu", "pwsh"])),
  list: Schema.optionalKey(Schema.Boolean),
  query: Schema.optionalKey(Schema.String),
  category: Schema.optionalKey(Schema.String),
  install: Schema.optionalKey(Schema.Boolean),
  workdir: Schema.optionalKey(Schema.String),
})

const EntryInfo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  category: Schema.String,
  danger: Schema.Boolean,
  missing: Schema.Array(Schema.String),
  template: Schema.String,
  placeholders: Schema.Array(Schema.String),
})

const Output = Schema.Struct({
  output: Schema.String,
  status: Schema.optionalKey(Schema.Literals(["completed", "running", "planned"])),
  exit: Schema.optionalKey(Schema.Number),
  hubID: Schema.optionalKey(Schema.String),
  backend: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  shellID: Schema.optionalKey(Schema.String),
  truncated: Schema.optionalKey(Schema.Boolean),
  entries: Schema.optionalKey(Schema.Array(EntryInfo)),
})

type Output = typeof Output.Type

// PATH probe for the description, refreshed at most every few seconds: the
// context hook fires on every model step and each probe walks PATH ~30 times.
let probed: { at: number; tools: string[] } | undefined
const availableTools = () => {
  const now = Date.now()
  if (!probed || now - probed.at > 5_000) probed = { at: now, tools: Hub.available() }
  return probed.tools
}

const failure = (message: string, error?: unknown) => new ToolFailure({ message, error })

const entryInfo = (entry: Hub.Entry) => {
  // The template this platform would try first; the run path still resolves
  // the backend against the shells actually installed.
  const key = HubHost.order().find((backend) => entry.templates[backend] !== undefined)
  const template = key !== undefined ? (entry.templates[key] ?? "") : (entry.templates.bash ?? "")
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    category: entry.category,
    danger: entry.danger === true,
    missing: Hub.supportsPlatform(entry) ? Hub.missingTools(entry) : [],
    template,
    placeholders: Hub.placeholders(template),
  }
}

// A guessed id (often a program name like fd or git) gets the entries that fit it, with
// their placeholders, so the next call can run one instead of listing first.
export const unknownEntry = (id: string) => {
  const words = id.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  // Ids that start with the guess first, then entries whose command runs it as a program, then text matches.
  const rank = (entry: Hub.Entry) => {
    if (words.some((word) => entry.id.startsWith(`${word}.`))) return 0
    const programs = Object.values(entry.templates).join(" ")
    if (words.some((word) => new RegExp(`(^|[\\s|;(])${word}\\b`).test(programs))) return 1
    if (words.some((word) => matches(entry, word))) return 2
    return undefined
  }
  const close = Hub.all
    .filter((entry) => Hub.supportsPlatform(entry))
    .flatMap((entry) => {
      const score = rank(entry)
      return score === undefined ? [] : [{ entry, score }]
    })
    .toSorted((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((item) => entryInfo(item.entry))
    .map((entry) => `- ${entry.id}${entry.placeholders.length ? ` args {${entry.placeholders.join(", ")}}` : ""}: ${entry.title}`)
  return [
    `Unknown hub command: ${id}. An id names a hub entry, not a program.`,
    close.length > 0 ? `Entries that may fit:\n${close.join("\n")}` : "Use list or query to find an entry, or shell for anything else.",
  ].join("\n")
}

const matches = (entry: Hub.Entry, query: string, category?: string) => {
  if (category && entry.category !== category) return false
  if (!query) return true
  const needle = query.toLowerCase()
  return (
    entry.id.includes(needle) ||
    entry.title.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle)
  )
}

export const Plugin = {
  id: "opencode.tool.hub",
  effect: Effect.fn("HubTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
    const environment = yield* Environment.Service
    const access = yield* FileAccess.Service
    const shell = yield* Shell.Service
    const permission = yield* Permission.Service
    const config = yield* Config.Service
    // A team role may be limited to some hub categories and to some installed Registry programs.
    // The team service is absent where no projects run (tests, embedded hosts), and then all stays open.
    const team = yield* Effect.serviceOption(Orchestra.Service)
    const roleFor = Effect.fnUntraced(function* (agent: string | undefined) {
      if (Option.isNone(team) || !agent) return undefined
      return (yield* team.value.roles()).find((role) => role.agent === agent)
    })

    const toolResult = (output: Output) => ({
      output,
      content: output.output ? [{ type: "text" as const, text: output.output }] : [],
      metadata: {
        ...(output.status !== undefined ? { status: output.status } : {}),
        ...(output.hubID !== undefined ? { hubID: output.hubID } : {}),
        ...(output.backend !== undefined ? { backend: output.backend } : {}),
        ...(output.command !== undefined ? { command: output.command } : {}),
        ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
      },
    })
    const backgroundResult = (shellID: string, file: string): Output => ({
      output: `Command moved to the background (shell ID: ${shellID}).\nOutput is streaming to: ${file}`,
      shellID,
      truncated: false,
      status: "running",
    })

    const notifyWhenDone = Effect.fn("HubTool.notifyWhenDone")(
      function* (
        sessionID: SessionSchema.ID,
        id: string,
        shellID: string,
        command: string,
        settled: Deferred.Deferred<Output>,
      ) {
        const info = (yield* jobs.wait({ id })).info
        if (!info || info.status === "running") return
        const output = info.status === "completed" ? yield* Deferred.await(settled) : undefined
        const text = output ? output.output : info.status === "error" ? (info.error ?? "Command failed") : "Cancelled"
        yield* sessions.synthetic({
          ...(info.notificationID ? { id: info.notificationID } : {}),
          sessionID,
          description: command,
          ...ShellResult.notification({
            jobID: id,
            shellID,
            command,
            state: info.status,
            text,
            output: output
              ? { output: output.output, truncated: output.truncated ?? false, exit: output.exit }
              : undefined,
          }),
        })
        if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
      },
      Effect.forkIn(scope, { startImmediately: true }),
    )

    const prepare = Effect.fn("HubTool.prepare")(function* (invocation: ShellCreateBefore, context: Tool.Context) {
      const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
      const target = yield* access.resolve({ path: invocation.cwd, kind: "directory" })
      invocation.cwd = target.absolute
      const timeout = invocation.timeout
      const portable = Config.latest(yield* config.entries(), "experimental")?.portable_shell_scanner === true
      const parsed = yield* ShellParse.scan(invocation.command, invocation.shell, target.absolute, { portable })
      const directories = yield* Effect.forEach(parsed.directories, (directory) =>
        access.resolve({ path: FileAccess.resolvePath(target.absolute, directory), kind: "directory" }),
      )
      yield* access.authorizeExternal([target, ...directories], context)
      if (parsed.commands.length > 0)
        yield* permission.assert({
          action: name,
          resources: parsed.commands.map((command) => command.resource),
          save: parsed.commands.map((command) => command.save),
          sessionID: context.sessionID,
          agent: context.agent,
          source,
        })
      const workdir = yield* Environment.typeFollowing(environment.files, target.absolute).pipe(
        Effect.catchTag("Environment.NotFound", () =>
          Effect.fail(new Error(`Working directory does not exist: ${target.absolute}`)),
        ),
      )
      if (workdir !== "directory")
        return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.absolute}`))
      return timeout
    })
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description(availableTools()),
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.install === true) {
                if (!input.id) return yield* failure("Pass an entry id to get its install command")
                const found = Hub.get(input.id)
                if (!found) return yield* failure(`Unknown hub command: ${input.id}`)
                const lacking = Hub.missingTools(found)
                if (lacking.length === 0)
                  return {
                    output: `All tools for ${input.id} are already installed.`,
                    status: "completed" as const,
                    hubID: input.id,
                  }
                const plan = Hub.planFor(lacking)
                if (!plan)
                  return {
                    output: `No package manager with these packages detected on ${process.platform}. Install manually: ${lacking.join(", ")}.`,
                    status: "planned" as const,
                    hubID: input.id,
                  }
                const manual = plan.unsupported.length > 0 ? ` Install manually: ${plan.unsupported.join(", ")}.` : ""
                return {
                  output: `Install with: ${plan.command}${manual}`,
                  status: "planned" as const,
                  hubID: input.id,
                  command: plan.command,
                }
              }
              const role = yield* roleFor(context.agent)
              const allowed = role?.hub
              const programs = role?.registry
              if (input.list === true || (input.query !== undefined && input.id === undefined)) {
                const state = yield* Effect.tryPromise(() => Hub.read()).pipe(
                  Effect.orElseSucceed(() => ({ version: 1 as const, enabled: {} }) as Hub.State),
                )
                // Entries for another OS (windows.* on Linux) only fail when run, so they are not offered.
                const listing = Hub.all.filter(
                  (entry) =>
                    Hub.supportsPlatform(entry) &&
                    matches(entry, input.query ?? "", input.category) &&
                    Hub.discoverable(state, entry, programs) &&
                    (allowed === undefined || allowed.includes(entry.category)),
                )
                return {
                  output: listing
                    .map(
                      (entry) =>
                        `${entry.id} [${entry.category}]${entry.danger === true ? " DANGER" : ""} - ${entry.title}`,
                    )
                    .join("\n"),
                  status: "completed" as const,
                  entries: listing.map(entryInfo),
                }
              }
              if (!input.id) return yield* failure("Pass an entry id, or use list/query to discover one")
              const entry = Hub.get(input.id)
              if (!entry) return yield* failure(unknownEntry(input.id))
              if (allowed !== undefined && !allowed.includes(entry.category))
                return yield* failure(
                  `${entry.id} is in the ${entry.category} category, which this role may not run. Allowed categories: ${allowed.join(", ") || "none"}.`,
                )
              const forbidden = (entry.requires ?? []).filter((tool) => programs !== undefined && !programs.includes(tool))
              if (forbidden.length > 0)
                return yield* failure(
                  `${entry.id} needs ${forbidden.join(", ")}, which this role may not use. Its Registry programs: ${programs?.join(", ") || "none"}.`,
                )
              // The operator's terminal choice wins over the model's: models ask for bash from
              // habit, and running it there undoes the operator picking nu or pwsh.
              const preferred = (yield* Effect.promise(() => Hub.read())).terminal ?? input.backend
              let rendered: Hub.Rendered
              try {
                rendered = Hub.prepare(
                  entry,
                  Object.fromEntries(Object.entries(input.args ?? {}).map(([key, value]) => [key, String(value)])),
                  { backend: preferred },
                )
              } catch (error) {
                if (error instanceof Hub.MissingToolError) {
                  const plan = Hub.planFor(error.missing)
                  const hint = plan
                    ? ` Install with: ${plan.command}.`
                    : " No package manager detected; use shell as fallback."
                  return yield* failure(`Missing tools for ${input.id}: ${error.missing.join(", ")}.${hint}`)
                }
                if (error instanceof Hub.MissingArgumentError)
                  return yield* failure(`Missing arguments for ${input.id}: ${error.missing.join(", ")}`)
                if (error instanceof Hub.NoBackendError || error instanceof Hub.InvalidArgumentError)
                  return yield* failure(`${error.message}. Use shell as fallback.`)
                if (error instanceof Error) return yield* failure(error.message)
                throw error
              }
              const timeout = DEFAULT_TIMEOUT_MS
              const info = yield* shell.create(
                {
                  command: HubHost.executable(rendered.command, rendered.backend),
                  cwd: input.workdir,
                  timeout,
                  // The backend's own shell: a bash template must not land in
                  // PowerShell, nor a nu template in bash.
                  shell: rendered.shell,
                  metadata: { sessionID: context.sessionID },
                },
                (invocation) =>
                  Effect.gen(function* () {
                    invocation.env.AGENT = "1"
                    invocation.env.OPENCODE = "1"
                    invocation.env.AI_AGENT ||= "opencode"
                    invocation.env.OPENCODE_SESSION_ID = context.sessionID
                    // Tools installed by winget/scoop/cargo after startup are not on
                    // the inherited PATH yet; the hub found them, so the shell must too.
                    const searchPath = HubHost.spawnPath(invocation.env)
                    invocation.env[searchPath.key] = searchPath.value
                    yield* prepare(invocation, context)
                  }),
              )
              yield* context.progress({ shellID: info.id })
              const settled = yield* Deferred.make<Output>()
              const run = Effect.gen(function* () {
                const result = yield* shell.result(info)
                if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
                const out = ShellResult.output(result)
                return {
                  ...out,
                  status: "completed" as const,
                  hubID: entry.id,
                  backend: rendered.backend,
                  command: rendered.command,
                }
              }).pipe(
                Effect.tap((output) => Deferred.succeed(settled, output)),
                Effect.map((output) => output.output),
                Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)),
              )
              const job = yield* jobs.start({
                id: info.id,
                type: name,
                title: rendered.command,
                metadata: { sessionID: context.sessionID, shellID: info.id },
                recovery: { kind: "shell", sessionID: context.sessionID, shellID: info.id, command: info.command },
                run,
              })
              const result = yield* jobs
                .block({ id: job.id, sessionID: context.sessionID })
                .pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)))
              if (result?.type === "backgrounded") {
                yield* shell.timeout(info.id, 0)
                yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                return backgroundResult(info.id, info.file)
              }
              if (result?.info.status === "error")
                return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
              if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))
              return yield* Deferred.await(settled)
            }).pipe(
              Effect.map(toolResult),
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to run hub command: ${input.id ?? "?"}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        // Re-probed per hook: a tool installed from the Registry panel shows
        // up without restarting the server.
        tool.description = description(availableTools())
        const role = yield* roleFor(event.agent)
        if (role?.hub !== undefined)
          tool.description += ` This role may run only these hub categories: ${role.hub.join(", ") || "none"}.`
        if (role?.registry !== undefined)
          tool.description += ` This role may use only these Registry programs: ${role.registry.join(", ") || "none"}.`
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
