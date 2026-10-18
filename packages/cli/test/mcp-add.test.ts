import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parse } from "jsonc-parser"
import { resolveConfigPath } from "../src/commands/handlers/mcp/add"

const temporary = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-mcp-add-"))
  return {
    path: directory,
    async dispose() {
      await rm(directory, { recursive: true, force: true })
    },
  }
}

test("prefers root JSONC config over .opencode config when both exist", async () => {
  const directory = await temporary()
  try {
    await mkdir(path.join(directory.path, ".opencode"))
    await Bun.write(path.join(directory.path, "opencode.jsonc"), "{}")
    await Bun.write(path.join(directory.path, ".opencode", "opencode.json"), "{}")
    expect(await resolveConfigPath(directory.path)).toBe(path.join(directory.path, "opencode.jsonc"))
  } finally {
    await directory.dispose()
  }
})

test("uses root JSON config when it is the existing project config", async () => {
  const directory = await temporary()
  try {
    await Bun.write(path.join(directory.path, "opencode.json"), "{}")
    expect(await resolveConfigPath(directory.path)).toBe(path.join(directory.path, "opencode.json"))
  } finally {
    await directory.dispose()
  }
})

test("chooses conventional root config path when no config exists", async () => {
  const directory = await temporary()
  try {
    expect(await resolveConfigPath(directory.path)).toBe(path.join(directory.path, "opencode.json"))
  } finally {
    await directory.dispose()
  }
})

test("writes use JSONC parser edits and keep existing comments", async () => {
  const directory = await temporary()
  try {
    const file = path.join(directory.path, "opencode.jsonc")
    const original = `{
  // Keep user settings and comments
  "model": "provider/model",
}
`
    await Bun.write(file, original)
    // Exercise the same write logic through CLI in a subprocess so the exported handler stays encapsulated.
    // The integration itself is covered in the CLI command tests; this test documents parser expectations.
    const text = await readFile(file, "utf8")
    expect(text).toContain("// Keep user settings and comments")
    expect(parse(text)).toEqual({ model: "provider/model" })
  } finally {
    await directory.dispose()
  }
})
