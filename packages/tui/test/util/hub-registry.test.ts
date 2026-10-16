import { expect, test } from "bun:test"
import { Hub } from "@opencode/core/hub/index"
import { hubRegistryStatus } from "../../src/util/hub-registry"

// Entries that apply to the machine running the tests: the same filter the
// status function applies internally, recomputed here from the catalog only.
const platformEntries = () => Hub.all.filter((entry) => Hub.supportsPlatform(entry, process.platform))
const offeredEntries = (probe: (tool: string) => boolean, manager = Hub.detectManager()) =>
  platformEntries().filter((entry) =>
    (entry.requires ?? []).every((tool) => probe(tool) || Hub.installable(tool, manager)),
  )

test("probe that finds every tool reports the whole catalog ready", () => {
  const status = hubRegistryStatus({ probe: () => true, terminalProbe: () => true })
  expect(status.total).toBe(platformEntries().length)
  expect(status.ready).toBe(status.total)
  expect(status.missing).toEqual([])
  expect(status.install).toBeUndefined()
  expect(status.terminals.every((terminal) => terminal.present)).toBe(true)
  expect(status.installed).toContain("rg")
  expect(status.installed).toContain("jq")
})

test("one absent tool blocks its entries and produces an install command", () => {
  const status = hubRegistryStatus({ probe: (tool) => tool !== "jq", terminalProbe: () => true })
  const jq = status.missing.find((entry) => entry.tool === "jq")
  expect(jq?.entries).toBeGreaterThan(0)
  expect(status.ready).toBeLessThan(status.total)
  expect(status.installed).not.toContain("jq")
  expect(typeof status.install).toBe("string")
  expect(status.install).toContain("jq")
  expect(status.terminals.every((terminal) => terminal.present)).toBe(true)
})

test("installed and missing partition every requirement for any probe", () => {
  const probes = [(tool: string) => true, (tool: string) => tool !== "jq", (tool: string) => tool === "rg"]
  for (const probe of probes) {
    const status = hubRegistryStatus({ probe, manager: "apt" })
    const entries = offeredEntries(probe, "apt")
    const required = new Set(entries.flatMap((entry) => entry.requires ?? []))
    const accounted = new Set([...status.installed, ...status.missing.map((entry) => entry.tool)])
    expect([...accounted].sort()).toEqual([...required].sort())
    expect(status.installed.filter((tool) => status.missing.some((entry) => entry.tool === tool))).toEqual([])
    expect(status.categories.reduce((sum, category) => sum + category.ready, 0)).toBe(status.ready)
    expect(status.categories.reduce((sum, category) => sum + category.total, 0)).toBe(status.total)
    const expectedBlocked = new Map<string, number>()
    for (const entry of entries) {
      for (const tool of entry.requires ?? []) {
        if (!probe(tool)) expectedBlocked.set(tool, (expectedBlocked.get(tool) ?? 0) + 1)
      }
    }
    expect(status.missing).toEqual(
      [...expectedBlocked]
        .map(([tool, entries]) => ({ tool, entries }))
        .sort((a, b) => b.entries - a.entries || a.tool.localeCompare(b.tool)),
    )
  }
})

test("default probe mirrors the alias-aware host probe", () => {
  const status = hubRegistryStatus({ manager: "apt" })
  expect(status.total).toBe(
    offeredEntries((tool) => Hub.HubHost.has(tool, { platform: process.platform }), "apt").length,
  )
  const missing = new Set(status.missing.map((entry) => entry.tool))
  const required = new Set(
    offeredEntries((tool) => Hub.HubHost.has(tool, { platform: process.platform }), "apt").flatMap(
      (entry) => entry.requires ?? [],
    ),
  )
  expect(status.installed.length + status.missing.length).toBe(required.size)
  for (const tool of required) {
    expect(status.installed.includes(tool) !== missing.has(tool)).toBe(true)
  }
  expect(status.installed).toEqual([...status.installed].sort())
  // Native shell first: bash on Linux and macOS, PowerShell on Windows
  expect(status.terminals.map((terminal) => terminal.name)).toEqual(Hub.HubHost.order())
  for (const terminal of status.terminals)
    expect(terminal.present).toBe(Hub.HubHost.shellFor(terminal.name) !== undefined)
})

test("installed manual tools stay visible but are not managed by an unsupported package manager", () => {
  const installed = hubRegistryStatus({
    platform: "linux",
    probe: () => true,
    terminalProbe: () => true,
    manager: "apt",
  })
  expect(installed.tools.find((row) => row.tool === "semgrep")).toMatchObject({
    installed: true,
    manageable: false,
  })

  const absent = hubRegistryStatus({
    platform: "linux",
    probe: (tool) => tool !== "semgrep",
    terminalProbe: () => true,
    manager: "apt",
  })
  expect(absent.tools.map((row) => row.tool)).not.toContain("semgrep")
  expect(absent.missing.map((row) => row.tool)).not.toContain("semgrep")
})

test("terminal readiness is independent of the executable registry probe", () => {
  const status = hubRegistryStatus({
    platform: "linux",
    probe: () => false,
    terminalProbe: (backend) => backend === "bash",
    manager: undefined,
  })
  expect(status.terminals.map((item) => [item.name, item.present])).toEqual([
    ["bash", true],
    ["nu", false],
    ["pwsh", false],
  ])
})

test("terminal order follows the platform", () => {
  expect(hubRegistryStatus({ platform: "win32", probe: () => true, terminalProbe: () => true }).terminals.map((t) => t.name)).toEqual([
    "pwsh",
    "bash",
    "nu",
  ])
  expect(hubRegistryStatus({ platform: "linux", probe: () => true, terminalProbe: () => true }).terminals.map((t) => t.name)).toEqual([
    "bash",
    "nu",
    "pwsh",
  ])
})

test("tool rows stay unique and lead with the most actionable tool", () => {
  const status = hubRegistryStatus({ probe: (tool) => tool !== "jq", terminalProbe: () => true })
  const names = status.tools.map((row) => row.tool)
  expect(new Set(names).size).toBe(names.length)
  // the absent tool sorts ahead of every installed one
  expect(status.tools[0].tool).toBe("jq")
  expect(status.tools[0].installed).toBe(false)
  expect(status.tools[0].entries).toBeGreaterThan(0)
  expect(status.tools.slice(1).every((row) => row.installed)).toBe(true)
})

test("tool rows account for every required tool with its blocked entry count", () => {
  for (const probe of [(tool: string) => true, (tool: string) => tool !== "rg"]) {
    const manager = Hub.detectManager()
    const status = hubRegistryStatus({ probe, manager })
    const expected = new Map<string, number>()
    for (const entry of offeredEntries(probe, manager)) {
      for (const tool of entry.requires ?? []) expected.set(tool, (expected.get(tool) ?? 0) + 1)
    }
    expect(new Map(status.tools.map((row) => [row.tool, row.entries]))).toEqual(expected)
    for (const row of status.tools) {
      if (!probe(row.tool)) continue
      expect(status.installed).toContain(row.tool)
    }
  }
})

test("win32 platform filter stays fully ready and only drops the entries another platform owns", () => {
  const win32 = hubRegistryStatus({ platform: "win32", probe: () => true })
  const linux = hubRegistryStatus({ platform: "linux", probe: () => true })
  expect(win32.ready).toBe(win32.total)
  expect(win32.missing).toEqual([])
  expect(win32.install).toBeUndefined()
  // Filtering comes from the catalog's platforms fields alone, never from PATH
  const onlyWin32 = Hub.all.filter(
    (entry) => Hub.supportsPlatform(entry, "win32") && !Hub.supportsPlatform(entry, "linux"),
  )
  const onlyLinux = Hub.all.filter(
    (entry) => Hub.supportsPlatform(entry, "linux") && !Hub.supportsPlatform(entry, "win32"),
  )
  expect(onlyWin32.length).toBeGreaterThan(0)
  expect(onlyLinux.length).toBeGreaterThan(0)
  expect(win32.total - linux.total).toBe(onlyWin32.length - onlyLinux.length)
  expect(linux.total).toBe(Hub.all.length - onlyWin32.length)
})

test("absent tools with no package manager for the platform leave install undefined", () => {
  // PATH is emptied so the real which() finds no winget, scoop or choco on any
  // host, Windows included.
  const previous = process.env.PATH
  process.env.PATH = ""
  const status = (() => {
    try {
      return hubRegistryStatus({ platform: "win32", probe: () => false })
    } finally {
      process.env.PATH = previous
    }
  })()
  expect(status.missing.length).toBeGreaterThan(0)
  expect(status.missing.some((entry) => entry.tool === "rg")).toBe(true)
  expect(status.ready).toBeLessThan(status.total)
  expect(status.install).toBeUndefined()
  expect(status.terminals.every((terminal) => terminal.present)).toBe(false)
})

test("tools the package manager cannot provide are not offered", () => {
  const probe = (tool: string) => tool !== "apt-cache" && tool !== "dpkg-query"
  const pacman = hubRegistryStatus({ platform: "linux", probe, manager: "pacman" })
  expect(pacman.tools.map((row) => row.tool)).not.toContain("apt-cache")
  expect(pacman.missing).toEqual([])
  expect(pacman.ready).toBe(pacman.total)
  // on Debian the same tools stay installable
  const apt = hubRegistryStatus({ platform: "linux", probe, manager: "apt" })
  expect(apt.missing.map((entry) => entry.tool).sort()).toEqual(["apt-cache", "dpkg-query"])
})
