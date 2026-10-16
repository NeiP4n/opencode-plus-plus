import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Queue, Stream } from "effect"
import { AppProcess } from "@opencode/util/process"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Tool } from "@opencode/schema/tool"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { ShellSelect } from "@opencode/core/shell/select"
import { ClaudeHooksPlugin } from "@opencode/core/compat/claude/hooks/plugin"
import type { ClaudeHookConfig } from "@opencode/core/compat/claude/hooks/config"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { host } from "../plugin/host"
import { tmpdir } from "../fixture/tmpdir"

const slash = (value: string) => value.replaceAll("\\", "/")

// Prints whatever JSON the test put in the file named by argv[2]; exits with argv[3] when given.
const SCRIPT = `
const text = await Bun.file(process.argv[2]).text()
if (process.argv[3]) { console.error(text); process.exit(Number(process.argv[3])) }
console.log(text)
`

type Callback = (event: any) => Effect.Effect<void, unknown>

async function setup(
  hooks: (script: (reply: unknown, exit?: number) => Promise<string>) => Promise<ClaudeHookConfig.Hook[]>,
) {
  const tmp = await tmpdir()
  const script = path.join(tmp.path, "hook.ts")
  await fs.writeFile(script, SCRIPT)
  let count = 0
  const reply = async (value: unknown, exit?: number) => {
    const file = path.join(tmp.path, `reply-${count++}.txt`)
    await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value))
    return `bun "${slash(script)}" "${slash(file)}"${exit === undefined ? "" : ` ${exit}`}`
  }
  const list = await hooks(reply)
  const callbacks = new Map<string, Callback>()
  const capture = (domain: string) => (name: string, callback: Callback) =>
    Effect.sync(() => {
      callbacks.set(`${domain}.${name}`, callback)
      return { dispose: Effect.void }
    })
  const synthetic: { text: string; resume?: boolean }[] = []
  const interrupted: string[] = []
  const events = Effect.runSync(Queue.unbounded<any>())
  const base = host()
  const ctx = host({
    location: new Location.Info({
      directory: AbsolutePath.make(tmp.path),
      project: {
        id: Project.ID.global,
        directory: AbsolutePath.make(tmp.path),
        canonical: AbsolutePath.make(tmp.path),
      },
    }),
    tool: { ...base.tool, list: () => Effect.succeed([]), hook: capture("tool") as never },
    permission: { ...base.permission, hook: capture("permission") as never },
    event: { subscribe: () => Stream.fromQueue(events) } as never,
    session: {
      hook: capture("session") as never,
      context: () => Effect.succeed([]),
      get: () => Effect.succeed({ parentID: undefined } as never),
      synthetic: (input: { text: string; resume?: boolean }) =>
        Effect.sync(() => {
          synthetic.push({ text: input.text, resume: input.resume })
          return {} as never
        }),
      interrupt: (input: { sessionID: string }) =>
        Effect.sync(() => {
          interrupted.push(input.sessionID)
          return { interrupted: true }
        }),
    } as never,
  })
  const layer = Layer.mergeAll(
    Config.testLayer([], { hooks: list }),
    AppNodeBuilder.build(LayerNode.group([AppProcess.node, ShellSelect.node, FSUtil.node])),
    Layer.succeed(Global.Service, Global.Service.of({ ...Global.make(), state: path.join(tmp.path, "state") })),
  )
  const activate = ClaudeHooksPlugin.Plugin.effect(ctx).pipe(Effect.provide(layer))
  const call = (key: string, event: unknown) => {
    const callback = callbacks.get(key)
    if (!callback) throw new Error(`no ${key} hook`)
    return Effect.runPromise(Effect.result(callback(event)))
  }
  return { tmp, activate, call, synthetic, interrupted, events }
}

const hook = (event: ClaudeHookConfig.Event, command: string, matcher?: string): ClaudeHookConfig.Hook => ({
  event,
  command,
  scope: "global",
  source: "settings.json",
  ...(matcher ? { matcher } : {}),
})

const toolEvent = (tool: string, input: unknown) => ({
  tool,
  input,
  sessionID: "ses_1",
  agent: "build",
  messageID: "msg_1",
  id: "call_1",
})

describe("ClaudeHooksPlugin", () => {
  test("PreToolUse denies, rewrites input, and lifts an ask for its own call only", async () => {
    const env = await setup(async (reply) => [
      hook("PreToolUse", await reply("", 2), "Bash"),
      hook(
        "PreToolUse",
        await reply({ hookSpecificOutput: { permissionDecision: "allow", updatedInput: { file_path: "safe.ts" } } }),
        "Edit|Write",
      ),
    ])
    await using _ = env.tmp
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* env.activate
          const denied = yield* Effect.promise(() =>
            env.call("tool.execute.before", toolEvent("shell", { command: "rm -rf /" })),
          )
          expect(denied._tag).toBe("Failure")
          expect(denied._tag === "Failure" && denied.failure instanceof Tool.Error).toBe(true)

          const edit = toolEvent("edit", { path: "danger.ts", oldString: "a", newString: "b" })
          expect((yield* Effect.promise(() => env.call("tool.execute.before", edit)))._tag).toBe("Success")
          expect(edit.input).toEqual({ path: "safe.ts", oldString: "a", newString: "b" })

          const asked = { source: { type: "tool", id: "call_1" }, effect: "ask" }
          yield* Effect.promise(() => env.call("permission.evaluate", asked))
          expect(asked.effect).toBe("allow")
          const denyRule = { source: { type: "tool", id: "call_1" }, effect: "deny" }
          yield* Effect.promise(() => env.call("permission.evaluate", denyRule))
          expect(denyRule.effect).toBe("deny")
          const other = { source: { type: "tool", id: "call_2" }, effect: "ask" }
          yield* Effect.promise(() => env.call("permission.evaluate", other))
          expect(other.effect).toBe("ask")
        }),
      ),
    )
  }, 30_000)

  test("PostToolUse feedback reaches the model through the tool result", async () => {
    const env = await setup(async (reply) => [
      hook("PostToolUse", await reply({ hookSpecificOutput: { additionalContext: "lint: 2 warnings" } })),
    ])
    await using _ = env.tmp
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* env.activate
          const event = { ...toolEvent("write", { path: "a.ts" }), status: "completed", result: { content: "written" } }
          yield* Effect.promise(() => env.call("tool.execute.after", event))
          expect(event.result.content).toBe("written\n\nPostToolUse hook feedback:\nlint: 2 warnings")
        }),
      ),
    )
  }, 30_000)

  test("UserPromptSubmit rejects with a typed error or adds context", async () => {
    const env = await setup(async (reply) => [hook("UserPromptSubmit", await reply("secrets are not allowed", 2))])
    await using _ = env.tmp
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* env.activate
          const result = yield* Effect.promise(() =>
            env.call("session.prompt", { sessionID: "ses_1", prompt: { text: "my key is ..." } }),
          )
          expect(result._tag === "Failure" && result.failure).toMatchObject({
            _tag: "PromptInput.Rejected",
            reason: "secrets are not allowed",
          })
        }),
      ),
    )

    const context = await setup(async (reply) => [hook("UserPromptSubmit", await reply("branch: main"))])
    await using _c = context.tmp
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* context.activate
          const event = { sessionID: "ses_1", prompt: { text: "status?" } }
          yield* Effect.promise(() => context.call("session.prompt", event))
          expect(event.prompt.text).toBe(
            "status?\n\n<user-prompt-submit-hook>\nbranch: main\n</user-prompt-submit-hook>",
          )
        }),
      ),
    )
  }, 30_000)

  test("a blocking Stop hook continues the session, with a ceiling", async () => {
    const env = await setup(async (reply) => [
      hook("Stop", await reply({ decision: "block", reason: "tests still fail" })),
    ])
    await using _ = env.tmp
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* env.activate
          for (let index = 0; index < 10; index++)
            yield* Queue.offer(env.events, { type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
          for (let attempt = 0; attempt < 200 && env.synthetic.length < 8; attempt++) yield* Effect.sleep("50 millis")
          yield* Effect.sleep("500 millis")
          expect(env.synthetic).toHaveLength(8)
          expect(env.synthetic[0]).toEqual({ text: "tests still fail", resume: true })
        }),
      ),
    )
  }, 60_000)

  test("SessionStart adds context without starting the model", async () => {
    const env = await setup(async (reply) => [hook("SessionStart", await reply("recent commits: ..."), "startup")])
    await using _ = env.tmp
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* env.activate
          yield* Queue.offer(env.events, { type: "session.created", data: { sessionID: "ses_1" } })
          for (let attempt = 0; attempt < 200 && env.synthetic.length === 0; attempt++) yield* Effect.sleep("50 millis")
          expect(env.synthetic).toEqual([{ text: "recent commits: ...", resume: false }])
        }),
      ),
    )
  }, 30_000)
})
