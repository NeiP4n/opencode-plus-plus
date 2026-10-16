export * as Ecosystem from "./ecosystem.js"

import path from "path"
import type { Entry } from "@opencode/schema/config"
import { ConfigCompatibility } from "@opencode/schema/config/compatibility"

export type ID = ConfigCompatibility.Ecosystem

export interface Info {
  readonly id: ID
  readonly label: string
  /** Folder name looked up in the project and every ancestor up to the discovery boundary. */
  readonly directory: string
  /** Home-level folders, which count as global config. */
  readonly global: (home: string, env: NodeJS.ProcessEnv) => readonly string[]
  /** Files outside the folder that also mark a project as using this ecosystem. */
  readonly markers: readonly string[]
}

/**
 * Every ecosystem OpenCode can detect, in default merge priority: when two of them define the same name,
 * the earlier one wins. `.agents` leads because it is the vendor-neutral convention.
 */
export const all: readonly Info[] = [
  {
    id: "agents",
    label: "Agents",
    directory: ".agents",
    global: (home) => [path.join(home, ".agents")],
    markers: [],
  },
  {
    id: "claude",
    label: "Claude Code",
    directory: ".claude",
    global: (home) => [path.join(home, ".claude")],
    markers: ["CLAUDE.md", "CLAUDE.local.md", ".mcp.json"],
  },
  {
    id: "codex",
    label: "Codex",
    directory: ".codex",
    global: (home, env) => [env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, ".codex")],
    markers: ["AGENTS.override.md"],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    directory: ".gemini",
    global: (home) => [path.join(home, ".gemini")],
    markers: ["GEMINI.md"],
  },
  {
    id: "cursor",
    label: "Cursor",
    directory: ".cursor",
    global: (home) => [path.join(home, ".cursor")],
    markers: [".cursorrules"],
  },
]

export const ids: readonly ID[] = all.map((item) => item.id)
export const directories: readonly string[] = all.map((item) => item.directory)

export function get(id: ID): Info {
  return all.find((item) => item.id === id)!
}

export function byDirectory(name: string): Info | undefined {
  return all.find((item) => item.directory === name)
}

export type ByID<T> = { readonly [K in ID]: T }

/** Builds a value for every ecosystem. */
export function record<T>(make: (id: ID) => T): ByID<T> {
  return {
    agents: make("agents"),
    claude: make("claude"),
    codex: make("codex"),
    gemini: make("gemini"),
    cursor: make("cursor"),
  }
}

export function empty<T = string>(): ByID<readonly T[]> {
  return record(() => [])
}

/** Compatibility settings merged across config documents, lowest priority first. */
export function settings(entries: readonly Entry[]): ConfigCompatibility.Info {
  let ecosystems: Partial<Record<ID, boolean>> = {}
  let order: readonly ID[] | undefined
  let enabled: boolean | undefined
  for (const entry of entries) {
    if (entry.type !== "document" || !entry.info.compatibility) continue
    ecosystems = { ...ecosystems, ...entry.info.compatibility.ecosystems }
    order = entry.info.compatibility.order ?? order
    enabled = entry.info.compatibility.enabled ?? enabled
  }
  return { ecosystems, ...(order ? { order } : {}), ...(enabled === undefined ? {} : { enabled }) }
}

/** Full merge priority, highest first: the configured order, then the remaining ecosystems in default order. */
export function order(configured: readonly ID[] = []): readonly ID[] {
  return [...new Set([...configured, ...ids])]
}

/**
 * Whether an ecosystem is read. A per-project choice outranks config, and anything nobody turned off is on,
 * so every ecosystem found in a project merges by default.
 */
export function enabled(id: ID, configured: ConfigCompatibility.Info, project?: Partial<Record<ID, boolean>>): boolean {
  // The master switch only changes the default: an explicit choice for the ecosystem still wins.
  return project?.[id] ?? configured.ecosystems?.[id] ?? configured.enabled !== false
}
