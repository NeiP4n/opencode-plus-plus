export * as ClaudeHookRun from "./run.js"

/**
 * Runs one Claude command hook the way Claude Code does: through bash (Git Bash on Windows), in the
 * project root, with the event as JSON on stdin. Exit 0 may print a JSON decision; exit 2 blocks with
 * stderr as the reason; any other exit is a non-blocking error.
 */

import { existsSync } from "fs"
import path from "path"
import { Effect, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode/util/process"
import { ShellSelect } from "../../../shell/select.js"
import { which } from "../../../util/which.js"
import type { ClaudeHookConfig } from "./config.js"

export const DEFAULT_TIMEOUT_SECONDS = 60

/** The JSON a hook may print on stdout; every field is optional and unknown fields are ignored. */
export const Output = Schema.Struct({
  continue: Schema.optional(Schema.Boolean),
  stopReason: Schema.optional(Schema.String),
  suppressOutput: Schema.optional(Schema.Boolean),
  systemMessage: Schema.optional(Schema.String),
  decision: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  hookSpecificOutput: Schema.optional(
    Schema.Struct({
      hookEventName: Schema.optional(Schema.String),
      permissionDecision: Schema.optional(Schema.Literals(["allow", "deny", "ask"])),
      permissionDecisionReason: Schema.optional(Schema.String),
      updatedInput: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      additionalContext: Schema.optional(Schema.String),
    }),
  ),
})
export interface Output extends Schema.Schema.Type<typeof Output> {}

const decodeOutput = Schema.decodeUnknownOption(Schema.fromJsonString(Output), { onExcessProperty: "ignore" })

export type Outcome =
  /** Exit 0. `output` is set when stdout was a JSON decision; otherwise `stdout` is plain text. */
  | { readonly type: "success"; readonly stdout: string; readonly output?: Output }
  /** Exit 2: a blocking error whose stderr is the reason. */
  | { readonly type: "block"; readonly reason: string }
  /** Any other exit, a timeout, or a failure to start: logged and otherwise ignored. */
  | { readonly type: "error"; readonly message: string }

export interface Environment {
  readonly projectDir: string
  readonly env: NodeJS.ProcessEnv
}

export const run = Effect.fn("ClaudeHookRun.run")(function* (
  hook: ClaudeHookConfig.Hook,
  payload: Record<string, unknown>,
  environment: Environment,
) {
  const processes = yield* AppProcess.Service
  // Hook commands are written for bash (`"$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh`), whatever shell the user prefers.
  const shell = bash()
  if (!shell)
    return {
      type: "error",
      message: `${hook.command}: Claude hooks need bash; install Git for Windows or put bash on PATH`,
    } satisfies Outcome as Outcome
  const result = yield* processes
    .run(
      ChildProcess.make(shell, ShellSelect.args(shell, hook.command), {
        cwd: environment.projectDir,
        env: { ...environment.env, CLAUDE_PROJECT_DIR: environment.projectDir, CLAUDE_CODE_COMPAT: "opencode" },
        extendEnv: false,
      }),
      {
        stdin: JSON.stringify(payload),
        timeout: `${hook.timeout ?? DEFAULT_TIMEOUT_SECONDS} seconds`,
        maxOutputBytes: 1024 * 1024,
        maxErrorBytes: 64 * 1024,
      },
    )
    .pipe(Effect.result)
  if (result._tag === "Failure")
    return { type: "error", message: `${hook.command}: ${result.failure.message}` } satisfies Outcome as Outcome
  const stdout = result.success.stdout.toString("utf8").trim()
  const stderr = result.success.stderr.toString("utf8").trim()
  if (result.success.exitCode === 2)
    return { type: "block", reason: stderr || `blocked by hook ${hook.command}` } satisfies Outcome as Outcome
  if (result.success.exitCode !== 0)
    return {
      type: "error",
      message: `${hook.command} exited with ${result.success.exitCode}${stderr ? `: ${stderr}` : ""}`,
    } satisfies Outcome as Outcome
  const output = stdout.startsWith("{") ? decodeOutput(stdout) : undefined
  return {
    type: "success",
    stdout,
    ...(output?._tag === "Some" ? { output: output.value } : {}),
  } satisfies Outcome as Outcome
})

let bashCache: { value: string | undefined } | undefined

/**
 * bash for hooks. On Windows that is Git Bash: next to `git` (`Git/cmd/git.exe` and `Git/mingw64/bin/git.exe`
 * both sit under the Git root) or on PATH, never the System32 one, which is WSL and sees other paths.
 */
export function bash() {
  if (bashCache) return bashCache.value
  const value = process.platform === "win32" ? windowsBash() : (which("bash") ?? undefined)
  bashCache = { value }
  return value
}

function windowsBash() {
  const known = ShellSelect.gitbash()
  if (known) return known
  const git = which("git")
  if (git) {
    let directory = path.dirname(git)
    for (let level = 0; level < 4; level++) {
      const candidate = path.join(directory, "bin", "bash.exe")
      if (existsSync(candidate)) return candidate
      directory = path.dirname(directory)
    }
  }
  const found = which("bash")
  if (found && !found.toLowerCase().includes(`${path.sep}system32${path.sep}`)) return found
  return undefined
}
