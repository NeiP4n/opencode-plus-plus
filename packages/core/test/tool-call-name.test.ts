import { describe, expect, test } from "bun:test"
import { ToolCallName } from "@opencode/core/tool/call-name"

const available = new Map(
  ["shell", "read", "edit", "write", "grep", "glob", "webfetch", "subagent", "skill_catalog"].map(
    (name) => [name, name] as const,
  ),
)

describe("ToolCallName.resolve", () => {
  test("keeps an advertised name", () => {
    expect(ToolCallName.resolve("read", available)).toBe("read")
  })

  test("maps names other harnesses taught the model", () => {
    expect(ToolCallName.resolve("Bash", available)).toBe("shell")
    expect(ToolCallName.resolve("read_file", available)).toBe("read")
    expect(ToolCallName.resolve("str_replace_editor", available)).toBe("edit")
    expect(ToolCallName.resolve("WebFetch", available)).toBe("webfetch")
    expect(ToolCallName.resolve("Task", available)).toBe("subagent")
  })

  test("ignores case, separators and call wrappers", () => {
    expect(ToolCallName.resolve("Read", available)).toBe("read")
    expect(ToolCallName.resolve("skillCatalog", available)).toBe("skill_catalog")
    expect(ToolCallName.resolve("functions.read", available)).toBe("read")
    expect(ToolCallName.resolve("default_api:grep", available)).toBe("grep")
  })

  test("follows an alias to a tool a plugin advertised under another name", () => {
    expect(ToolCallName.resolve("Bash", new Map([["run", "shell"]]))).toBe("run")
  })

  test("never targets a tool that is not advertised", () => {
    expect(ToolCallName.resolve("apply_patch", available)).toBeUndefined()
    expect(ToolCallName.resolve("Bash", new Map([["read", "read"]]))).toBeUndefined()
  })

  test("refuses an ambiguous spelling", () => {
    expect(
      ToolCallName.resolve(
        "ReadFile",
        new Map([
          ["read_file", "a"],
          ["readFile", "b"],
        ]),
      ),
    ).toBeUndefined()
  })
})

describe("ToolCallName.unknown", () => {
  test("suggests the nearest names and lists the available ones", () => {
    expect(ToolCallName.unknown("gerp", ["grep", "glob", "read"])).toBe(
      'No tool named "gerp" is currently available. Did you mean "grep"? Available tools: glob, grep, read.',
    )
  })

  test("keeps a huge tool list out of the message", () => {
    const many = Array.from({ length: 80 }, (_, index) => `tool_${index}`)
    expect(ToolCallName.unknown("zzzzzz", many)).toBe(
      'No tool named "zzzzzz" is currently available. Please use a tool from the available tool list.',
    )
  })
})
