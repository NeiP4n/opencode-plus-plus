import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { ClaudeModel } from "@opencode/core/compat/claude/model"
import { ClaudeCommands } from "@opencode/core/compat/claude/commands"
import { ClaudeAgents } from "@opencode/core/compat/claude/agents"
import { ClaudeMcp } from "@opencode/core/compat/claude/mcp"
import { ClaudeSettings } from "@opencode/core/compat/claude/settings"
import { ClaudeInstructions } from "@opencode/core/compat/claude/instructions"
import { ClaudeAdapter } from "@opencode/core/compat/claude/index"
import type { ClaudeContext } from "@opencode/core/compat/claude/context"
import { tmpdir } from "../fixture/tmpdir"

const project = path.resolve("claude-project")
const context = (input: Partial<ClaudeContext.Context> = {}): ClaudeContext.Context => ({
  scope: "project",
  trusted: false,
  root: path.join(project, ".claude"),
  project,
  directory: project,
  home: path.resolve("claude-home"),
  env: {},
  ...input,
})
const run = <A, E>(effect: Effect.Effect<A, E, FSUtil.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(AppNodeBuilder.build(FSUtil.node))))

describe("ClaudeModel", () => {
  test("aliases follow the newest plain model in the bundled catalog", () => {
    const sonnet = ClaudeModel.resolve("sonnet")
    expect(sonnet.type).toBe("model")
    expect(sonnet.type === "model" && sonnet.model).toMatch(/^anthropic\/claude-sonnet-\d+(-\d+)?$/)
    expect(ClaudeModel.latest().opus).toMatch(/^claude-opus-\d+(-\d+)?$/)
  })

  test("full ids, inherit and unknown values", () => {
    expect(ClaudeModel.resolve("claude-haiku-4-5")).toEqual({ type: "model", model: "anthropic/claude-haiku-4-5" })
    expect(ClaudeModel.resolve("inherit")).toEqual({ type: "inherit" })
    expect(ClaudeModel.resolve(undefined)).toEqual({ type: "inherit" })
    expect(ClaudeModel.resolve("gpt-9").type).toBe("unsupported")
  })
})

describe("ClaudeCommands", () => {
  const commands = path.join(project, ".claude", "commands")
  const file = {
    path: path.join(commands, "git", "commit.md"),
    content:
      "---\ndescription: Commit staged work\nargument-hint: [message]\nmodel: haiku\nallowed-tools: Bash(git *)\n---\nStatus: !`git status`\nMessage: $ARGUMENTS\n",
  }

  test("keeps the template and names the command by its path", () => {
    const converted = ClaudeCommands.convert(file, commands, context({ trusted: true }))
    expect(converted.name).toBe("git/commit")
    expect(converted.command?.template).toBe("Status: !`git status`\nMessage: $ARGUMENTS")
    expect(converted.command?.description).toBe("Commit staged work [message]")
    expect(converted.command?.model).toMatch(/^anthropic\/claude-haiku/)
    expect(converted.skipped.map((item) => item.reason)).toEqual([
      "allowed-tools has no per-command equivalent yet; normal permissions apply",
    ])
  })

  test("an untrusted project command never runs its shell interpolation", () => {
    const converted = ClaudeCommands.convert(file, commands, context())
    expect(converted.command?.template).not.toContain("!`")
    expect(converted.skipped.some((item) => item.reason.includes("needs trust"))).toBe(true)
    // Home commands are the user's own.
    const home = ClaudeCommands.convert(file, commands, context({ scope: "global" }))
    expect(home.command?.template).toContain("!`git status`")
  })
})

describe("ClaudeAgents", () => {
  test("a tools list becomes an allowlist and colors become hex", () => {
    const converted = ClaudeAgents.convert({
      path: path.join(project, ".claude", "agents", "reviewer.md"),
      content:
        "---\nname: code-reviewer\ndescription: Reviews diffs\ntools: Read, Grep, TodoWrite\ncolor: blue\nmodel: inherit\n---\nYou review code.\n",
    })
    expect(converted.id).toBe("code-reviewer")
    expect(converted.agent).toEqual({
      system: "You review code.",
      mode: "subagent",
      description: "Reviews diffs",
      color: "#0090ff",
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "grep", resource: "*", effect: "allow" },
      ],
    })
    expect(converted.skipped.map((item) => item.reason)).toEqual(['tool "TodoWrite" has no OpenCode counterpart'])
  })
})

describe("ClaudeMcp", () => {
  const servers = {
    files: { command: "npx", args: ["-y", "server", "${ROOT:-/srv}"], env: { TOKEN: "${TOKEN}" } },
    remote: { type: "http", url: "https://mcp.example.com/${PATH_PART}", headers: { Authorization: "Bearer ${KEY}" } },
    off: { command: "x" },
  }

  test("converts stdio and http servers and expands variables", () => {
    const result = ClaudeMcp.servers(
      servers,
      "s",
      context({ trusted: true, env: { TOKEN: "t", PATH_PART: "v1", KEY: "k" } }),
      {
        disabled: ["off"],
      },
    )
    expect(result.servers).toEqual({
      files: { type: "local", command: ["npx", "-y", "server", "/srv"], environment: { TOKEN: "t" } },
      remote: { type: "remote", url: "https://mcp.example.com/v1", headers: { Authorization: "Bearer k" } },
    })
    expect(result.skipped.map((item) => item.reason)).toEqual(["MCP server off is disabled in Claude settings"])
  })

  test("project servers need trust", () => {
    const result = ClaudeMcp.servers(servers, "s", context())
    expect(result.servers).toEqual({})
    expect(result.skipped).toHaveLength(3)
  })
})

describe("ClaudeSettings", () => {
  const text = JSON.stringify({
    model: "opus",
    permissions: {
      allow: ["Bash(npm run *)"],
      ask: ["Bash(git push *)"],
      deny: ["Read(./.env)"],
      additionalDirectories: ["../shared"],
      defaultMode: "bypassPermissions",
    },
    env: { A: "1" },
    disabledMcpjsonServers: ["x"],
  })

  test("orders rules so deny wins and keeps loosening rules for trusted projects", () => {
    const result = ClaudeSettings.parse(text, "settings.json", context({ trusted: true }))
    expect(result.permissions).toEqual([
      { action: "shell", resource: "npm run *", effect: "allow" },
      {
        action: "external_directory",
        resource: `${path.resolve(project, "../shared").replaceAll("\\", "/")}/*`,
        effect: "allow",
      },
      { action: "shell", resource: "git push *", effect: "ask" },
      { action: "read", resource: ".env", effect: "deny" },
    ])
    expect(result.model).toMatch(/^anthropic\/claude-opus/)
    expect(result.disabledMcpServers).toEqual(["x"])
    expect(result.skipped.map((item) => item.reason)).toEqual([
      "defaultMode bypassPermissions is never carried over",
      "env has no OpenCode equivalent yet",
    ])
  })

  test("an untrusted project keeps only the rules that tighten", () => {
    const result = ClaudeSettings.parse(text, "settings.json", context())
    expect(result.permissions.map((rule) => rule.effect)).toEqual(["ask", "deny"])
    expect(result.skipped[0].reason).toContain("needs trust")
  })
})

describe("ClaudeInstructions", () => {
  test("finds imports outside code", () => {
    expect(
      ClaudeInstructions.imports(
        "See @docs/guide.md and @AGENTS.md.\n`@skip.md`\n```\n@fenced.md\n```\nmail a@b.com @team",
      ),
    ).toEqual(["docs/guide.md", "AGENTS.md"])
  })

  test("expands imports, skips files other sources load, and fences untrusted imports to the project", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "repo")
    const outside = path.join(tmp.path, "secret.md")
    await fs.mkdir(path.join(root, "docs"), { recursive: true })
    await fs.writeFile(path.join(root, "AGENTS.md"), "shared rules")
    await fs.writeFile(path.join(root, "docs", "guide.md"), "guide body")
    await fs.writeFile(outside, "secret")
    await fs.writeFile(path.join(root, "CLAUDE.md"), `Project notes @docs/guide.md @AGENTS.md @${outside}`)
    await fs.writeFile(path.join(root, "ONLY.md"), "@AGENTS.md")
    const ctx = context({ project: root, directory: root, root: path.join(root, ".claude") })
    const skip = new Set([await fs.realpath(path.join(root, "AGENTS.md"))])

    const loaded = await run(ClaudeInstructions.load(path.join(root, "CLAUDE.md"), ctx, skip))
    expect(loaded.file?.content).toContain("guide body")
    expect(loaded.file?.content).not.toContain("shared rules")
    expect(loaded.file?.content).not.toContain("secret\n")
    expect(loaded.skipped.map((item) => item.reason)[0]).toContain("outside the project")

    const trusted = await run(ClaudeInstructions.load(path.join(root, "CLAUDE.md"), { ...ctx, trusted: true }, skip))
    expect(trusted.file?.content).toContain(`Imported from ${outside}:\n\nsecret`)

    const only = await run(ClaudeInstructions.load(path.join(root, "ONLY.md"), ctx, skip))
    expect(only.file).toBeUndefined()
  })
})

describe("ClaudeAdapter", () => {
  test("builds a home and a project document and gates the project on trust", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const repo = path.join(tmp.path, "repo")
    const homeClaude = path.join(home, ".claude")
    const repoClaude = path.join(repo, ".claude")
    await Promise.all([
      fs.mkdir(path.join(homeClaude, "commands"), { recursive: true }),
      fs.mkdir(path.join(repoClaude, "commands"), { recursive: true }),
      fs.mkdir(path.join(repoClaude, "agents"), { recursive: true }),
    ])
    await fs.writeFile(path.join(homeClaude, "commands", "hello.md"), "Say hello")
    await fs.writeFile(path.join(homeClaude, "CLAUDE.md"), "home memory")
    await fs.writeFile(path.join(repoClaude, "commands", "hello.md"), "Say hi from the repo")
    await fs.writeFile(path.join(repoClaude, "agents", "helper.md"), "---\ndescription: Helps\n---\nHelp.")
    await fs.writeFile(
      path.join(repoClaude, "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm *)"] } }),
    )
    await fs.writeFile(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { tool: { command: "tool" } } }))
    await fs.writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { mine: { url: "https://m.example" } } }),
    )
    await fs.writeFile(path.join(repo, "CLAUDE.md"), "repo memory")

    const input = {
      roots: [homeClaude, repoClaude],
      global: [homeClaude],
      project: repo,
      directory: repo,
      home,
      trusted: false,
      env: {},
      includeGlobal: true,
      includeProject: true,
      loadedInstructions: [],
    }
    const untrusted = await run(ClaudeAdapter.load(input))
    expect(untrusted.documents.global).toEqual({
      commands: { hello: { template: "Say hello" } },
      mcp: { servers: { mine: { type: "remote", url: "https://m.example" } } },
    })
    expect(untrusted.documents.project).toEqual({
      commands: { hello: { template: "Say hi from the repo" } },
      agents: { helper: { system: "Help.", mode: "subagent", description: "Helps" } },
      permissions: [{ action: "shell", resource: "rm *", effect: "deny" }],
    })
    expect(untrusted.instructions.map((file) => file.content)).toEqual(["home memory", "repo memory"])
    expect(untrusted.loaded).toEqual({ instructions: 2, commands: 2, agents: 1, mcp: 1, rules: 1, hooks: 0 })
    expect(
      untrusted.skipped.map((item) => item.reason).filter((reason) => reason.includes("needs trust")),
    ).toHaveLength(2)

    const trusted = await run(ClaudeAdapter.load({ ...input, trusted: true }))
    expect(trusted.documents.project?.mcp).toEqual({ servers: { tool: { type: "local", command: ["tool"] } } })
    expect(trusted.documents.project?.permissions).toEqual([
      { action: "shell", resource: "ls", effect: "allow" },
      { action: "shell", resource: "rm *", effect: "deny" },
    ])
  })
})
