import { describe, expect, test } from "bun:test"
import { all, forPlatform } from "../src/mcp/catalog"

describe("useful MCP registry entries", () => {
  test("contains the curated developer tool set", () => {
    const ids = new Set(all.map((entry) => entry.id))

    for (const id of [
      "context7",
      "rea-anything",
      "playwright",
      "chrome-devtools",
      "filesystem",
      "git",
      "github",
      "deepwiki",
      "fetch",
      "memory",
      "sequential-thinking",
      "brave-search",
      "sentry",
      "time",
      "mcp-docs",
    ]) {
      expect(ids.has(id)).toBe(true)
    }
  })

  test("Windows-only entries stay hidden on non-Windows platforms", () => {
    expect(forPlatform("win32").some((entry) => entry.id === "windows")).toBe(true)
    expect(forPlatform("linux").some((entry) => entry.id === "windows")).toBe(false)
    expect(forPlatform("darwin").some((entry) => entry.id === "windows")).toBe(false)
  })
})
