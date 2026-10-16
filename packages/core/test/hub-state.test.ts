import { describe, expect, test } from "bun:test"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "path"
import { Hub } from "@opencode/core/hub/index"
import { tmpdir } from "./fixture/tmpdir"

describe("Hub state", () => {
  test("missing file defaults to version 1 without a terminal choice", async () => {
    await using tmp = await tmpdir()
    expect(await Hub.read({ directory: tmp.path })).toEqual({ version: 1 })
  })

  test("the terminal choice reads back and leaves only the state file behind", async () => {
    await using tmp = await tmpdir()
    await Hub.setTerminal("pwsh", { directory: tmp.path })
    expect((await Hub.read({ directory: tmp.path })).terminal).toBe("pwsh")
    await Hub.setTerminal("bash", { directory: tmp.path })
    expect((await Hub.read({ directory: tmp.path })).terminal).toBe("bash")
    // temp+rename: nothing but the state file is left behind
    expect(await readdir(tmp.path)).toEqual(["hub.json"])
    expect(JSON.parse(await readFile(path.join(tmp.path, "hub.json"), "utf8"))).toEqual({ version: 1, terminal: "bash" })
  })

  test("an old file with on/off switches still reads, and the switches are dropped on write", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "hub.json")
    await writeFile(file, JSON.stringify({ version: 1, enabled: { rg: false }, terminal: "nu" }))
    expect((await Hub.read({ directory: tmp.path })).terminal).toBe("nu")
    await Hub.setTerminal("pwsh", { directory: tmp.path })
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, terminal: "pwsh" })
  })

  test("corrupt JSON falls back to the default instead of throwing", async () => {
    await using tmp = await tmpdir()
    await writeFile(path.join(tmp.path, "hub.json"), "{ not json ]")
    expect(await Hub.read({ directory: tmp.path })).toEqual({ version: 1 })
  })

  test("foreign shape and stale version fall back to the default", async () => {
    await using tmp = await tmpdir()
    await writeFile(path.join(tmp.path, "hub.json"), JSON.stringify({ version: 2, terminal: "cmd" }))
    expect(await Hub.read({ directory: tmp.path })).toEqual({ version: 1 })
  })

  test("parallel terminal choices are serialized and the last one wins", async () => {
    await using tmp = await tmpdir()
    const options = { directory: tmp.path }
    await Promise.all([Hub.setTerminal("bash", options), Hub.setTerminal("pwsh", options), Hub.setTerminal("nu", options)])
    expect(await Hub.read(options)).toEqual({ version: 1, terminal: "nu" })
  })
})
