import path from "path"
import { describe, expect, test } from "bun:test"
import { CompatTools } from "@opencode/core/compat/tools"

const directory = path.resolve("compat-tools-project")
const context = { directory, settings: path.join(directory, ".claude"), home: path.resolve("compat-tools-home") }
const rules = (rule: string, effect: "allow" | "deny" | "ask" = "allow") => {
  const parsed = CompatTools.parseRule("claude", rule, effect, context)
  if (parsed.type !== "rules") throw new Error(parsed.reason)
  return parsed.rules
}

describe("CompatTools.resolve", () => {
  test("maps tool names to OpenCode tools and their permission actions", () => {
    expect(CompatTools.resolve("claude", "Bash")).toMatchObject({ tool: "shell", action: "shell" })
    expect(CompatTools.resolve("claude", "Write")).toMatchObject({ tool: "write", action: "edit" })
    expect(CompatTools.resolve("claude", "Task")).toMatchObject({ tool: "subagent", action: "subagent" })
    expect(CompatTools.resolve("gemini", "run_shell_command")).toMatchObject({ tool: "shell" })
    expect(CompatTools.resolve("codex", "apply_patch")).toMatchObject({ action: "edit" })
  })

  test("returns nothing for tools without a counterpart", () => {
    expect(CompatTools.resolve("claude", "TodoWrite")).toBeUndefined()
    expect(CompatTools.resolve("cursor", "Bash")).toBeUndefined()
  })

  test("maps MCP names to OpenCode MCP tool names", () => {
    expect(CompatTools.resolve("claude", "mcp__github__create_issue")).toEqual({
      type: "mcp",
      server: "github",
      tool: "create_issue",
      action: "github_create_issue",
    })
    expect(CompatTools.resolve("claude", "mcp__my.server")).toMatchObject({ action: "my_server_*" })
  })
})

describe("CompatTools.parseRule", () => {
  test("a bare tool name covers every resource", () => {
    expect(rules("Bash", "deny")).toEqual([{ action: "shell", resource: "*", effect: "deny" }])
  })

  test("shell rules keep the command pattern, legacy :* becomes optional arguments", () => {
    expect(rules("Bash(npm run *)")).toEqual([{ action: "shell", resource: "npm run *", effect: "allow" }])
    expect(rules("Bash(npm run test:*)")).toEqual([{ action: "shell", resource: "npm run test *", effect: "allow" }])
  })

  test("path rules become resources relative to the session directory", () => {
    expect(rules("Read(./src/**)")).toEqual([{ action: "read", resource: "src/*", effect: "allow" }])
    expect(rules("Edit(docs/*.md)")).toEqual([{ action: "edit", resource: "docs/*.md", effect: "allow" }])
    expect(rules("Read(/config.json)")).toEqual([{ action: "read", resource: ".claude/config.json", effect: "allow" }])
    expect(rules("Read(**/.env)", "deny")).toEqual([
      { action: "read", resource: "*/.env", effect: "deny" },
      { action: "read", resource: ".env", effect: "deny" },
    ])
  })

  test("paths outside the session directory stay absolute", () => {
    const [rule] = rules("Read(~/.ssh/**)", "deny")
    expect(rule.resource).toBe(path.join(context.home, ".ssh", "*").replaceAll("\\", "/"))
  })

  test("domain rules match the host with any scheme", () => {
    expect(rules("WebFetch(domain:example.com)").map((rule) => rule.resource)).toEqual([
      "*://example.com",
      "*://example.com/*",
    ])
  })

  test("MCP rules cover the tool or the whole server", () => {
    expect(rules("mcp__github")).toEqual([{ action: "github_*", resource: "*", effect: "allow" }])
  })

  test("reports what it cannot translate instead of guessing", () => {
    expect(CompatTools.parseRule("claude", "TodoWrite", "allow", context).type).toBe("unsupported")
    expect(CompatTools.parseRule("claude", "Bash(unclosed", "allow", context).type).toBe("unsupported")
    expect(CompatTools.parseRule("claude", "mcp__github(x)", "allow", context).type).toBe("unsupported")
  })
})
