export * as HubPrompt from "./prompt.js"

import type { Entry } from "./types.js"
import type { State } from "./state.js"
import { all } from "./catalog/index.js"
import { supportsPlatform } from "./resolve.js"
import { hinted } from "./visibility.js"

// The block must stay cheap per prompt build: hard caps on both lines and
// characters, and overflow drops the tail tools with an explicit marker rather
// than silently cutting — the model has to know inventory was shortened.
const MAX_LINES = 40
const MAX_CHARS = 2000
const MAX_TOOL_CHARS = 400
const MAX_ENTRIES_PER_TOOL = 3

const HEADER =
  "These installed hub tools are available in this session; details and other recipes come through the hub tool. When asked what you can do, name them too."

export type Hints = {
  readonly state: State
  readonly availability: readonly string[]
  // Backends resolvable right now; rendered as a single line inside the block.
  readonly terminals?: readonly string[]
}

// Pure inventory for the system prompt: only tools the operator switched on
// AND that exist on PATH. No I/O — availability and state come from the caller
// so the prompt path stays synchronous and testable without mocks.
export function renderHubHints(hints: Hints): string {
  const available = new Set(hints.availability)
  const required = entriesByTool()
  // Ignore stale settings and executable backends such as nu/pwsh: only catalog
  // dependencies that actually unlock recipes belong in the model's tool list.
  const eligible = [...required.keys()]
    .filter((tool) => hinted(hints.state, tool) && available.has(tool))
    .sort()
  // With nothing installed the prompt stays byte-identical to
  // what it was before this feature existed.
  if (eligible.length === 0) return ""

  const lines = [HEADER]
  if (hints.terminals?.length) lines.push(`Terminals: ${hints.terminals.join(", ")}`)
  for (const tool of eligible) lines.push(toolLine(tool, required.get(tool) ?? []))
  const dropped = fit(lines, hints.terminals?.length ? 2 : 1)
  if (dropped > 0) lines.push(`… ${dropped} more tools — details through the hub tool`)
  return lines.join("\n")
}

// Tool → catalog entries that require it, rebuilt per render from the static
// catalog (cheap: ~130 entries, and the catalog is an in-memory bundle).
function entriesByTool(): Map<string, Entry[]> {
  const map = new Map<string, Entry[]>()
  // Only entries this OS can run: a Windows template in the hints on Linux sends the model to a dead end.
  for (const entry of all.filter((item) => supportsPlatform(item))) {
    for (const tool of entry.requires ?? []) map.set(tool, [...(map.get(tool) ?? []), entry])
  }
  return map
}

// One tool per line: what it is for and up to three ready templates, capped so
// a verbose tool cannot eat the whole block budget.
function toolLine(tool: string, entries: readonly Entry[]): string {
  const picks = entries.slice(0, MAX_ENTRIES_PER_TOOL)
  const purposes = picks.map((entry) => entry.description).join("; ")
  const templates = picks
    .map((entry) => entry.templates.bash ?? entry.templates.nu ?? entry.templates.pwsh)
    .filter((template): template is string => template !== undefined)
    .map((template) => `\`${template}\``)
    .join("; ")
  const body = purposes.length > 0 ? `${tool} — ${purposes}` : tool
  const full = templates.length > 0 ? `${body} | templates: ${templates}` : body
  const clipped = full.length > MAX_TOOL_CHARS ? `${full.slice(0, MAX_TOOL_CHARS - 1)}…` : full
  return `- ${clipped}`
}

// Drops trailing tool lines until the block fits both caps; header and
// terminals lines are pinned at the front. Returns how many tools were dropped
// so the caller can append the overflow marker (reserved as one extra line).
function fit(lines: string[], pinned: number): number {
  let dropped = 0
  const marker = (count: number) => `… ${count} more tools — details through the hub tool`
  while (
    lines.length + 1 > MAX_LINES ||
    lines.join("\n").length + (dropped > 0 ? marker(dropped).length + 1 : 0) > MAX_CHARS
  ) {
    if (lines.length <= pinned) break
    lines.pop()
    dropped++
  }
  return dropped
}
