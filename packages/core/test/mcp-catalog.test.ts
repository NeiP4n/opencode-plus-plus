import { describe, expect, test } from "bun:test"
import { all, forPlatform } from "../src/mcp/catalog"

describe("MCP registry catalog", () => {
  test("includes the REA Anything launcher", () => {
    const rea = all.find((entry) => entry.id === "rea-anything")

    expect(rea).toMatchObject({
      id: "rea-anything",
      name: "REA — Reverse Engineer Anything",
      runtime: "npx",
      config: {
        type: "local",
        command: ["npx", "-y", "rea-agents@latest", "mcp"],
      },
    })
    expect(rea?.description).toContain("reverse-engineer")
  })

  test("REA is available on Linux, macOS, and Windows", () => {
    expect(forPlatform("win32").some((entry) => entry.id === "rea-anything")).toBe(true)
    expect(forPlatform("linux").some((entry) => entry.id === "rea-anything")).toBe(true)
    expect(forPlatform("darwin").some((entry) => entry.id === "rea-anything")).toBe(true)
  })
})
