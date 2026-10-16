import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigCommand } from "@opencode/schema/config/command"
import { ConfigMarkdown } from "@opencode/core/config/markdown"
import { CommandForgeTool } from "@opencode/core/tool/plugin/command-forge"

// The loader's own steps: frontmatter plus body, decoded as a command.
const load = (text: string) => {
  const markdown = ConfigMarkdown.parse(text)
  return Schema.decodeUnknownSync(ConfigCommand.Info)({ ...markdown.data, template: markdown.content.trim() })
}

describe("command forge", () => {
  test("every kind's example is a command file the loader accepts as written", () => {
    expect(CommandForgeTool.kinds.length).toBeGreaterThanOrEqual(8)
    for (const kind of CommandForgeTool.kinds) {
      const command = load(CommandForgeTool.render(kind.example))
      expect(command.description).toBe(kind.example.description)
      expect(command.template).toBe(kind.example.template.trim())
      expect(command.agent).toBe(kind.example.agent)
      expect(command.subagent).toBe(kind.example.subagent)
    }
  })

  test("the kinds cover arguments, shell context, agents, models and subagents", () => {
    const examples = CommandForgeTool.kinds.map((kind) => kind.example)
    expect(examples.some((item) => item.template.includes("$1"))).toBe(true)
    expect(examples.some((item) => item.template.includes("$ARGUMENTS"))).toBe(true)
    expect(examples.some((item) => item.template.includes("!`"))).toBe(true)
    expect(examples.some((item) => item.subagent)).toBe(true)
    expect(examples.some((item) => item.agent && !item.subagent)).toBe(true)
    expect(examples.some((item) => item.model)).toBe(true)
  })

  test("descriptions and templates with quotes and colons survive the frontmatter", () => {
    const command = load(
      CommandForgeTool.render({ name: "x", description: 'say "hi": loudly [name]', template: "Say: $1" }),
    )
    expect(command.description).toBe('say "hi": loudly [name]')
    expect(command.template).toBe("Say: $1")
  })

  test("shell context must only read: writes are reported, reads and null redirects pass", () => {
    expect(CommandForgeTool.writingShell("!`git diff --staged` !`git log -5 2>/dev/null` !`ls > /dev/null`")).toEqual([])
    expect(CommandForgeTool.writingShell("!`git push` and !`rm -rf dist` and !`echo x > file.txt`")).toEqual([
      "git push",
      "rm -rf dist",
      "echo x > file.txt",
    ])
    for (const kind of CommandForgeTool.kinds) expect(CommandForgeTool.writingShell(kind.example.template)).toEqual([])
  })
})
