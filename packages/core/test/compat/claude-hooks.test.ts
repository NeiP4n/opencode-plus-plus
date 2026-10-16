import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AppProcess } from "@opencode/util/process"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ShellSelect } from "@opencode/core/shell/select"
import { ClaudeHookConfig } from "@opencode/core/compat/claude/hooks/config"
import { ClaudeHookRun } from "@opencode/core/compat/claude/hooks/run"
import { ClaudeHookTools } from "@opencode/core/compat/claude/hooks/tools"
import type { ClaudeContext } from "@opencode/core/compat/claude/context"
import { tmpdir } from "../fixture/tmpdir"

const layer = AppNodeBuilder.build(LayerNode.group([AppProcess.node, ShellSelect.node]))
const runHook = (hook: ClaudeHookConfig.Hook, payload: Record<string, unknown>, projectDir: string) =>
  Effect.runPromise(ClaudeHookRun.run(hook, payload, { projectDir, env: process.env }).pipe(Effect.provide(layer)))

const context = (trusted: boolean): ClaudeContext.Context => ({
  scope: "project",
  trusted,
  root: path.resolve(".claude"),
  project: path.resolve("."),
  directory: path.resolve("."),
  home: path.resolve("home"),
  env: {},
})

// A hook script that echoes what it received and then behaves as the mode says.
const SCRIPT = `
const input = JSON.parse(await Bun.stdin.text())
const mode = process.argv[2]
await Bun.write(process.argv[3], JSON.stringify({ input, dir: process.env.CLAUDE_PROJECT_DIR }))
if (mode === "block") { console.error("dangerous command"); process.exit(2) }
if (mode === "fail") { console.error("broken"); process.exit(1) }
if (mode === "json") console.log(JSON.stringify({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "no", additionalContext: "ctx" }, extra: 1 }))
if (mode === "text") console.log("plain context")
if (mode === "sleep") await Bun.sleep(5000)
`

const slash = (value: string) => value.replaceAll("\\", "/")

describe("ClaudeHookConfig", () => {
  const settings = {
    PreToolUse: [{ matcher: "Bash|Edit", hooks: [{ type: "command", command: "check", timeout: 5 }] }],
    Stop: [
      {
        hooks: [
          { type: "command", command: "stop" },
          { type: "prompt", prompt: "judge" },
        ],
      },
    ],
    TeammateIdle: [{ hooks: [{ type: "command", command: "x" }] }],
  }

  test("flattens command hooks and reports what it cannot run", () => {
    const parsed = ClaudeHookConfig.parse(settings, "settings.json", context(true))
    expect(parsed.hooks).toEqual([
      {
        event: "PreToolUse",
        matcher: "Bash|Edit",
        command: "check",
        timeout: 5,
        scope: "project",
        source: "settings.json",
      },
      { event: "Stop", command: "stop", scope: "project", source: "settings.json" },
    ])
    expect(parsed.skipped.map((item) => item.reason)).toEqual([
      "Stop hook of type prompt is not supported; only command hooks run",
      "hook event TeammateIdle has no OpenCode counterpart",
    ])
  })

  test("project hooks need trust", () => {
    const parsed = ClaudeHookConfig.parse(settings, "settings.json", context(false))
    expect(parsed.hooks).toEqual([])
    expect(parsed.skipped.filter((item) => item.reason.includes("needs trust"))).toHaveLength(2)
  })

  test("matchers are whole-subject regexes", () => {
    const hook = { event: "PreToolUse", matcher: "Bash|Edit", command: "x", scope: "project", source: "s" } as const
    expect(ClaudeHookConfig.matches(hook, "Bash")).toBe(true)
    expect(ClaudeHookConfig.matches(hook, "BashOutput")).toBe(false)
    expect(ClaudeHookConfig.matches({ ...hook, matcher: "mcp__github__.*" }, "mcp__github__create_issue")).toBe(true)
    expect(ClaudeHookConfig.matches({ ...hook, matcher: undefined }, undefined)).toBe(true)
  })
})

describe("ClaudeHookTools", () => {
  test("translates names and inputs both ways", () => {
    expect(ClaudeHookTools.name("shell")).toBe("Bash")
    expect(ClaudeHookTools.name("github_issue", { namespace: "github", name: "issue" })).toBe("mcp__github__issue")
    expect(ClaudeHookTools.toClaude("edit", { path: "a.ts", oldString: "x", newString: "y" })).toEqual({
      file_path: "a.ts",
      old_string: "x",
      new_string: "y",
    })
    expect(ClaudeHookTools.fromClaude("edit", { file_path: "b.ts", new_string: "z" })).toEqual({
      path: "b.ts",
      newString: "z",
    })
    expect(ClaudeHookTools.toClaude("shell", { command: "ls" })).toEqual({ command: "ls" })
  })
})

describe("ClaudeHookRun", () => {
  test("runs hooks through bash whatever the user's shell, never WSL's", () => {
    const shell = ClaudeHookRun.bash()
    expect(shell).toBeDefined()
    expect(path.basename(shell!).toLowerCase()).toMatch(/^bash(\.exe)?$/)
    expect(shell!.toLowerCase()).not.toContain(`${path.sep}system32${path.sep}`)
  })

  const scenario = async (mode: string, timeout?: number) => {
    const tmp = await tmpdir()
    const script = path.join(tmp.path, "hook.ts")
    const seen = path.join(tmp.path, "seen.json")
    await fs.writeFile(script, SCRIPT)
    const hook: ClaudeHookConfig.Hook = {
      event: "PreToolUse",
      command: `bun "${slash(script)}" ${mode} "${slash(seen)}"`,
      scope: "global",
      source: "settings.json",
      ...(timeout ? { timeout } : {}),
    }
    const outcome = await runHook(hook, { hook_event_name: "PreToolUse", tool_name: "Bash" }, tmp.path)
    return { tmp, outcome, seen }
  }

  test("passes the event on stdin and the project in CLAUDE_PROJECT_DIR", async () => {
    const { tmp, outcome, seen } = await scenario("text")
    await using _ = tmp
    expect(outcome).toEqual({ type: "success", stdout: "plain context" })
    const received = JSON.parse(await fs.readFile(seen, "utf8"))
    expect(received.input).toEqual({ hook_event_name: "PreToolUse", tool_name: "Bash" })
    expect(slash(received.dir)).toBe(slash(tmp.path))
  })

  test("reads a JSON decision and ignores unknown fields", async () => {
    const { tmp, outcome } = await scenario("json")
    await using _ = tmp
    expect(outcome.type === "success" && outcome.output?.hookSpecificOutput).toEqual({
      permissionDecision: "deny",
      permissionDecisionReason: "no",
      additionalContext: "ctx",
    })
  })

  test("exit 2 blocks with stderr, other exits are errors", async () => {
    const blocked = await scenario("block")
    await using _a = blocked.tmp
    expect(blocked.outcome).toEqual({ type: "block", reason: "dangerous command" })
    const failed = await scenario("fail")
    await using _b = failed.tmp
    expect(failed.outcome.type).toBe("error")
  })

  test("a hook past its timeout is an error, not a hang", async () => {
    const { tmp, outcome } = await scenario("sleep", 1)
    await using _ = tmp
    expect(outcome.type).toBe("error")
  }, 15_000)
})
