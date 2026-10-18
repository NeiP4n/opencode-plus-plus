import { describe, expect, test } from "bun:test"
import { prepare, zenRequiredToolNames } from "@opencode/core/provider-request-compatibility"

const tool = (name: string) => ({
  name,
  description: name,
  inputSchema: { type: "object", properties: {} },
})

describe("provider request compatibility", () => {
  test("leaves non-OpenCode providers untouched", () => {
    const tools = [tool("read")]
    expect(prepare({ providerID: "anthropic", tools, toolChoice: "auto" })).toEqual({
      tools,
      toolChoice: "auto",
    })
  })

  test("adds Zen compatibility schemas without changing real tools", () => {
    const tools = [tool("write")]
    const result = prepare({ providerID: "opencode", tools, toolChoice: undefined })
    expect(result.tools.map((item) => item.name)).toEqual(["write", ...zenRequiredToolNames])
    expect(result.toolChoice).toBeUndefined()
  })

  test("preserves an existing required tool definition", () => {
    const read = tool("read")
    const result = prepare({ providerID: "opencode", tools: [read] })
    expect(result.tools.find((item) => item.name === "read")).toBe(read)
    expect(result.tools.map((item) => item.name).filter((name) => name === "read")).toHaveLength(1)
  })

  test("stateless compatibility never enables tool execution", () => {
    const result = prepare({ providerID: "opencode", stateless: true, toolChoice: "auto" })
    expect(result.toolChoice).toBe("none")
    expect(result.tools.map((item) => item.name)).toEqual(zenRequiredToolNames)
  })
})
