export * as ShellTool from "./shell.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Tool } from "@opencode/schema/tool"
import { rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Deferred, Effect, Option, Schema, Scope } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode/util/process"
import { Config } from "../../config.js"
import { Environment } from "../../environment/index.js"
import { Job } from "../../job.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { NonNegativeInt } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { Shell } from "../../shell.js"
import { ShellParse } from "../../shell/parse.js"
import { ShellSelect } from "../../shell/select.js"
import { ShellResult } from "../../shell/result.js"
import { rewrite as hubRewrite } from "../../hub/match.js"
import { HubHost } from "../../hub/host.js"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000

const BACKGROUND_INSTRUCTION =
  "You will be notified automatically when the command finishes. The notification will include the command's output. Unless the user explicitly asks otherwise, DO NOT poll for completion, even if you need the final result to continue. Repeatedly sleeping and reading or searching the output file is polling, not useful work. You may read the current output if it lets you do useful work now, but do not repeatedly check it while waiting for the command to finish. Keep working on anything that does not depend on the result. If you have nothing else to do, end your response; you will be resumed automatically when the command finishes."
const OS =
  process.platform === "darwin"
    ? "macOS"
    : process.platform === "win32"
      ? "Windows"
      : process.platform === "linux"
        ? "Linux"
        : process.platform
const description = (shell?: string) =>
  [
    "Execute a shell command and return its output.",
    ...(shell ? [`Commands run on ${OS} using ${shell}.`] : []),
    ...(shell === "nu"
      ? [
          "Write Nushell syntax, not POSIX. Use `;` or `and` instead of `&&`; `$env.NAME` instead of `$NAME`; `^command | save --force path` instead of `> file`; and `^command | complete` instead of `2>&1` or `2>/dev/null`.",
          "Nushell examples: `mkdir path` (no `-p` flag), use `print` with a quoted string instead of `echo ---`, and prefix external utilities such as `^rg`, `^git`, `^head`, and `^sed` when their native flags are needed.",
          "For temporary paths, use `$nu.temp-path` with `path join`; do not assume `/tmp` or `/dev/null` exists on Windows.",
          "A command that is not valid Nushell is rejected before it runs. Use the parser diagnostic and the syntax examples above to rewrite it; never retry the same invalid command unchanged.",
        ]
      : []),
    ...(shell === "pwsh" || shell === "powershell"
      ? [
          "Use PowerShell syntax, not Bash redirection or heredocs. For stdout/stderr and exit status use native PowerShell streams and $LASTEXITCODE for external programs.",
          "Prefer cross-platform paths from the environment or Join-Path; avoid hard-coded /tmp and /dev/null paths.",
        ]
      : []),
    "Quote file paths containing spaces or special characters.",
    "Prefer dedicated tools over shell commands when possible.",
    "When output is large, the full result is saved to a file and a truncated preview is returned.",
    "Rely on automatic truncation unless filtering the output is more useful.",
    "Commands accept an optional timeout, background commands have no timeout by default.",
    "Background commands return immediately, and you will be notified when they complete.",
  ].join(" ")

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.optionalKey(Schema.String).annotate({
    description:
      "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
  }),
  timeout: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to ${DEFAULT_TIMEOUT_MS} for foreground commands. Background commands have no timeout by default.`,
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
  }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.optionalKey(Schema.Number),
  signal: Schema.optionalKey(Schema.String),
  shellID: Schema.optionalKey(Schema.String),
  // Which shell ran the command (bash, zsh, pwsh…): the operator sees it on the tool block.
  shell: Schema.optionalKey(Schema.String),
  truncated: Schema.Boolean,
  timeout: Schema.optionalKey(Schema.Boolean),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  status: Schema.optionalKey(Schema.Literals(["completed", "running"])),
})

type Output = typeof Output.Type

const resultMessages = (output: Output) => {
  const notice = output.status === "running" ? BACKGROUND_INSTRUCTION : ShellResult.notice(output)
  return [...(output.output ? [output.output] : []), ...(notice ? [notice] : [])]
}

const toolResult = (output: Output) => {
  return {
    output,
    content: resultMessages(output).map((text) => ({ type: "text" as const, text })),
    metadata: {
      status: output.status,
      ...ShellResult.metadata(output),
      ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
      ...(output.shell !== undefined ? { shell: output.shell } : {}),
    },
  }
}

const backgroundResult = (shellID: string, file: string, shell: string) => ({
  output: `Command moved to the background (shell ID: ${shellID}).\nOutput is streaming to: ${file}`,
  shellID,
  shell,
  truncated: false,
  status: "running" as const,
})

export const Plugin = {
  id: "opencode.tool.shell",
  effect: Effect.fn("ShellTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
    const environment = yield* Environment.Service
    const access = yield* FileAccess.Service
    const shell = yield* Shell.Service
    const shellSelect = yield* ShellSelect.Service
    const compatibleShell = shellSelect.resolve({ priority: "compat" })
    const permission = yield* Permission.Service
    const config = yield* Config.Service
    const processes = yield* AppProcess.Service

    const prepare = Effect.fn("ShellTool.prepare")(function* (invocation: ShellCreateBefore, context: Tool.Context) {
      // Hub fast path: a recognized hand-written shape is transparently
      // upgraded to the fast tool when it gives the same answer and the tool
      // is on the PATH the user's own shell sees (under its local name, e.g.
      // fdfind on Debian). Everything else passes through untouched, and the
      // swapped string still goes through the permission scan below.
      const hit = hubRewrite(invocation.command, (tool: string) => HubHost.locate(tool, { extras: false })?.name)
      if (hit) invocation.command = hit.command
      const source = {
        type: "tool" as const,
        messageID: context.messageID,
        id: context.id,
      }
      const target = yield* access.resolve({ path: invocation.cwd, kind: "directory" })
      invocation.cwd = target.absolute
      const timeout = invocation.timeout
      const portable =
        Config.latest(yield* config.entries(), "experimental")?.portable_shell_scanner ??
        (ctx.app.channel === "local" || ctx.app.channel === "dev")
      const parsed = yield* ShellParse.scan(invocation.command, invocation.shell, target.absolute, { portable })
      const directories = yield* Effect.forEach(parsed.directories, (directory) =>
        access.resolve({
          path: FileAccess.resolvePath(target.absolute, directory),
          kind: "directory",
        }),
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
      // Approval can outlive the directory, so validate immediately before spawning.
      const workdir = yield* Environment.typeFollowing(environment.files, target.absolute).pipe(
        Effect.catchTag("Environment.NotFound", () =>
          Effect.fail(new Error(`Working directory does not exist: ${target.absolute}`)),
        ),
      )
      if (workdir !== "directory")
        return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.absolute}`))
      return timeout
    })

    const notifyWhenDone = Effect.fn("ShellTool.notifyWhenDone")(
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
        const text = output
          ? resultMessages(output).join("\n\n")
          : info.status === "error"
            ? (info.error ?? "Command failed")
            : "Cancelled"
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
            output,
          }),
        })
        if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
      },
      Effect.forkIn(scope, { startImmediately: true }),
    )

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description(),
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const timeout = input.background === true ? (input.timeout ?? 0) : (input.timeout ?? DEFAULT_TIMEOUT_MS)
              let finalTimeout = timeout
              const shellPath = yield* compatibleShell
              const invalid = yield* nushellError(processes, shellPath, input.command)
              if (invalid)
                return yield* new ToolFailure({
                  message: `Not valid Nushell: ${invalid}.${nushellHints(input.command)} The configured shell is nu; rewrite the command in Nushell syntax before retrying.`,
                })
              const used = ShellSelect.name(shellPath)
              const info = yield* shell.create(
                {
                  command: input.command,
                  cwd: input.workdir,
                  timeout,
                  shell: shellPath,
                  metadata: { sessionID: context.sessionID },
                },
                (invocation) =>
                  Effect.gen(function* () {
                    invocation.env.AGENT = "1"
                    invocation.env.OPENCODE = "1"
                    invocation.env.AI_AGENT ||= "opencode"
                    invocation.env.OPENCODE_SESSION_ID = context.sessionID
                    finalTimeout = yield* prepare(invocation, context)
                  }),
              )
              yield* context.progress({ shellID: info.id, shell: used })

              const settled = yield* Deferred.make<Output>()
              const run = Effect.gen(function* () {
                const result = yield* shell.result(info)
                if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
                const output = ShellResult.output(result)
                const commandHints = used === "nu" && output.exit !== undefined && output.exit !== 0 ? nushellHints(input.command) : ""
                const ran = output.timeout
                  ? `${output.output}\n\nCommand exceeded timeout of ${finalTimeout} ms. Retry with a larger timeout if the command is expected to take longer.`
                  : `${output.output}${commandHints ? `\n\n${commandHints.trim()}` : ""}`
                return {
                  ...output,
                  output: ran,
                  status: "completed" as const,
                  shell: used,
                }
              }).pipe(
                Effect.tap((output) => Deferred.succeed(settled, output)),
                Effect.map((output) => resultMessages(output).join("\n\n")),
                Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)),
              )
              const job = yield* jobs.start({
                // CodeMode children share a tool-call ID, but each shell must own its job.
                id: info.id,
                type: name,
                title: info.command,
                metadata: { sessionID: context.sessionID, shellID: info.id },
                recovery: {
                  kind: "shell",
                  sessionID: context.sessionID,
                  shellID: info.id,
                  command: info.command,
                },
                run,
              })

              if (input.background === true) {
                yield* jobs.background(job.id)
                yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                return backgroundResult(info.id, info.file, used)
              }

              const result = yield* jobs
                .block({ id: job.id, sessionID: context.sessionID })
                .pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)))
              if (result?.type === "backgrounded") {
                yield* shell.timeout(info.id, 0)
                yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                return backgroundResult(info.id, info.file, used)
              }
              if (result?.info.status === "error")
                return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
              if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))

              return yield* Deferred.await(settled)
            }).pipe(
              Effect.map(toolResult),
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to execute command: ${input.command}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        tool.description = description(ShellSelect.name(yield* compatibleShell))
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}

// Translate common POSIX mistakes into concrete alternatives without mutating the command.
// Commands still run in the selected shell under the existing permission checks.
const nushellHints = (command: string) => {
  const hints: string[] = []
  if (/\bmkdir\s+-p\b/.test(command)) hints.push("Nushell mkdir creates parent directories; remove the POSIX -p flag.")
  if (command.includes("2>&1") || /2>\s*\/dev\/null/.test(command))
    hints.push("POSIX stderr redirection is unsupported; use `^command | complete` to inspect stdout, stderr, and exit_code.")
  if (/(^|\s)>>?\s*(?![=])\S+/.test(command))
    hints.push("Use `^command | save --force path` (or `save --append path`) instead of POSIX output redirection.")
  if (/\becho\s+---(?:\s|$)/.test(command))
    hints.push("Use print with a quoted string; an unquoted leading dash is parsed as a flag.")
  if (/\b(?:rg|git|head|sed|grep|cat)\b/.test(command))
    hints.push("Prefix external utilities with ^ when their native flags are needed, for example ^rg, ^git, ^head, and ^sed.")
  if (process.platform === "win32" && /\/tmp\/|\/dev\/null/.test(command))
    hints.push("This is Windows: replace Unix-only paths with a path built from $nu.temp-path and path join.")
  return hints.length ? ` Suggested fixes: ${Array.from(new Set(hints)).join(" ")}` : ""
}

// Models write POSIX shell from habit. Nushell parses a whole command before running any of
// it, so a command it rejects is turned back with the parser's reason before anything runs.
// It never falls back to another shell: the operator chose nu, and on Windows the bash a
// fallback finds is often missing or broken. Any failure to check keeps the command in nu.
const nushellError = (processes: AppProcess.Interface, shell: string, command: string) =>
  Effect.gen(function* () {
    if (ShellSelect.name(shell) !== "nu") return undefined
    // nu reads the source to check from a file; spawned stdin is not one it can open.
    const file = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const target = path.join(os.tmpdir(), `opencode-nu-check-${crypto.randomUUID()}.nu`)
        await writeFile(target, command)
        return target
      }),
      (target) => Effect.promise(() => rm(target, { force: true })),
    )
    const result = yield* processes.run(
      ChildProcess.make(shell, ["--no-config-file", "--ide-check", "5", file], { extendEnv: true, stdin: "ignore" }),
      { timeout: "5 seconds" },
    )
    return result.stdout
      .toString("utf8")
      .split("\n")
      .flatMap((line) => Option.toArray(decodeDiagnostic(line)))
      .find((diagnostic) => diagnostic.severity === "Error")?.message
  }).pipe(Effect.scoped, Effect.orElseSucceed(() => undefined))

const decodeDiagnostic = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ severity: Schema.String, message: Schema.String })),
)

