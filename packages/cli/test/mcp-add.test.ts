import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import { writeConfig } from "../src/commands/handlers/mcp/add"

async function temporary() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-mcp-add-"))
  return {
    path: directory,
    async dispose() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}

test("MCP config writes preserve existing JSONC comments and settings", async () => {
  const directory = await temporary()
  try {
    const file = path.join(directory.path, "opencode.jsonc")
    const original = `{
  // Keep user settings and comments
  "model": "provider/model",
}
`
    await Bun.write(file, original)
    await writeConfig(file, "example", { type: "local", command: ["node", "server.js"] })

    const updated = await readFile(file, "utf8")
    expect(updated).toContain("// Keep user settings and comments")
    expect(parse(updated)).toEqual({
      model: "provider/model",
      mcp: { servers: { example: { type: "local", command: ["node", "server.js"] } } },
    })
  } finally {
    await directory.dispose()
  }
})

test("MCP config writes reject malformed JSON without replacing the file", async () => {
  const directory = await temporary()
  try {
    const file = path.join(directory.path, "opencode.json")
    const original = "{ definitely not JSON"
    await Bun.write(file, original)
    await expect(writeConfig(file, "example", { type: "local", command: ["node"] })).rejects.toThrow(
      "Invalid OpenCode configuration",
    )
    expect(await readFile(file, "utf8")).toBe(original)
  } finally {
    await directory.dispose()
  }
})

test("MCP config writes reject invalid mcp.servers shapes", async () => {
  const directory = await temporary()
  try {
    const file = path.join(directory.path, "opencode.json")
    await Bun.write(file, JSON.stringify({ mcp: { servers: [] } }))
    await expect(writeConfig(file, "example", { type: "local", command: ["node"] })).rejects.toThrow(
      '"mcp.servers" must be an object',
    )
  } finally {
    await directory.dispose()
  }
})

test("MCP config writes create missing parent directories", async () => {
  const directory = await temporary()
  try {
    const file = path.join(directory.path, ".opencode", "opencode.json")
    await writeConfig(file, "example", { type: "remote", url: "https://example.test/mcp" })
    expect(parse(await readFile(file, "utf8"))).toEqual({
      mcp: { servers: { example: { type: "remote", url: "https://example.test/mcp" } } },
    })
  } finally {
    await directory.dispose()
  }
})
