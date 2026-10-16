import { Hub } from "@opencode/core/hub/index"

// One row of the Registry panel: a binary the catalog depends on, how many
// platform entries it gates and whether it is on PATH.
export type RegistryTool = {
  tool: string
  entries: number
  installed: boolean
  // Only true when the selected package manager can install/remove this binary.
  manageable: boolean
}

export type RegistryStatus = {
  // Catalog entries of the current platform that run with everything installed
  ready: number
  total: number
  // Unique `requires` that resolve on PATH, sorted for stable output
  installed: string[]
  // Absent tools with the number of entries each one blocks
  missing: { tool: string; entries: number }[]
  // Terminals hub commands can run in; `manual` says how to install one the manager cannot.
  terminals: { name: Hub.Backend; present: boolean; installable: boolean; manual?: string }[]
  categories: { name: string; ready: number; total: number }[]
  tools: RegistryTool[]
  install?: string
}

export type RegistryOptions = {
  probe?: (tool: string) => boolean
  terminalProbe?: (backend: Hub.Backend) => boolean
  platform?: NodeJS.Platform
  // Package manager that installs missing tools; detected from PATH by default.
  manager?: Hub.Manager
}

export function hubRegistryStatus(options?: RegistryOptions): RegistryStatus {
  const platform = options?.platform ?? process.platform
  // Alias-aware: fd counts when Debian installed it as fdfind, pwsh when only
  // Windows PowerShell 5.1 is there, and fresh winget/scoop installs count
  // before the process PATH learns about them.
  const probe = options?.probe ?? ((tool: string) => Hub.HubHost.has(tool, { platform }))
  // A terminal is present when its backend has a shell to run in: on Windows
  // bash means Git Bash, never the WSL launcher in System32.
  const terminal =
    options?.terminalProbe ?? ((backend: Hub.Backend) => Hub.HubHost.shellFor(backend, { platform }) !== undefined)
  const manager = options?.manager ?? Hub.detectManager(platform)
  const supported = Hub.all.filter((entry) => Hub.supportsPlatform(entry, platform))
  // Probe each distinct tool once: `which` walks PATH on every call
  const present = new Set(
    Array.from(new Set(supported.flatMap((entry) => entry.requires ?? []))).filter((tool) => probe(tool)),
  )
  // An entry whose missing tool this machine's manager cannot provide (apt-cache
  // on Arch) can never become ready, so it is not offered at all.
  const entries = supported.filter((entry) =>
    (entry.requires ?? []).every((tool) => present.has(tool) || Hub.installable(tool, manager)),
  )
  const tools = Array.from(new Set(entries.flatMap((entry) => entry.requires ?? []))).sort()
  const missing = blockedEntries(entries, present)
  const plan =
    missing.length > 0
      ? Hub.planFor(
          missing.map((entry) => entry.tool),
          platform,
        )
      : undefined
  return {
    ready: entries.filter((entry) => (entry.requires ?? []).every((tool) => present.has(tool))).length,
    total: entries.length,
    installed: tools.filter((tool) => present.has(tool)),
    missing,
    terminals: Hub.HubHost.order(platform).map((name) => ({
      name,
      present: terminal(name),
      installable: name !== "bash" && Hub.installable(name, manager) && manager !== undefined,
      manual: Hub.manualInstall(name, manager),
    })),
    categories: categoryCounts(entries, present),
    tools: toolRows(entries, present, manager),
    install: plan?.command,
  }
}

// Rows for the panel, most actionable first: absent tools ahead of installed
// ones, and within each group the tool that unblocks more entries comes first.
// Rows only move when the machine changes, so the list stays predictable.
function toolRows(
  entries: readonly Hub.Entry[],
  present: ReadonlySet<string>,
  manager: Hub.Manager | undefined,
): RegistryTool[] {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    for (const tool of entry.requires ?? []) counts.set(tool, (counts.get(tool) ?? 0) + 1)
  }
  return Array.from(counts, ([tool, count]) => ({
    tool,
    entries: count,
    installed: present.has(tool),
    manageable: manager !== undefined && Hub.installable(tool, manager),
  })).sort((a, b) => Number(a.installed) - Number(b.installed) || b.entries - a.entries || a.tool.localeCompare(b.tool))
}

// Absent tool with the number of platform entries it keeps from running.
function blockedEntries(
  entries: readonly Hub.Entry[],
  present: ReadonlySet<string>,
): { tool: string; entries: number }[] {
  const blocked = new Map<string, number>()
  for (const entry of entries) {
    for (const tool of entry.requires ?? []) {
      if (present.has(tool)) continue
      blocked.set(tool, (blocked.get(tool) ?? 0) + 1)
    }
  }
  return Array.from(blocked, ([tool, entries]) => ({ tool, entries })).sort(
    (a, b) => b.entries - a.entries || a.tool.localeCompare(b.tool),
  )
}

// Ready/total per catalog category so the panel can show its own fraction.
function categoryCounts(entries: readonly Hub.Entry[], present: ReadonlySet<string>) {
  const counts = new Map<string, { ready: number; total: number }>()
  for (const entry of entries) {
    const bucket = counts.get(entry.category) ?? { ready: 0, total: 0 }
    bucket.total += 1
    if ((entry.requires ?? []).every((tool) => present.has(tool))) bucket.ready += 1
    counts.set(entry.category, bucket)
  }
  return Array.from(counts, ([name, bucket]) => ({ name, ready: bucket.ready, total: bucket.total })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}
