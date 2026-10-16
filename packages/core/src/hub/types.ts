export * as Hub from "./types.js"

// Backends that can execute a rendered catalog command. Which one runs is
// decided per machine by hub/host.ts: bash leads on Linux and macOS, PowerShell
// on Windows (where bash means Git Bash), nu only when installed.
export type Backend = "bash" | "nu" | "pwsh"

export type Platform = "linux" | "darwin" | "win32"

export type Category =
  | "search"
  | "files"
  | "text"
  | "json"
  | "data"
  | "git"
  | "github"
  | "docker"
  | "systemd"
  | "process"
  | "network"
  | "system"
  | "security"
  | "windows"
  | "mobile"
  | "build"

// One ready-made fast command. Templates are keyed by backend and may declare
// `{placeholder}` slots filled from user args at run time.
export type Entry = {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: Category
  // Executables that must resolve on PATH before the entry may run. Omitted
  // means shell builtins / coreutils assumed present on every platform.
  readonly requires?: readonly string[]
  // Destructive or system-changing entries: never offered a saved "always
  // allow" permission and always flagged in listings.
  readonly danger?: boolean
  // Platforms this entry applies to; omitted means all.
  readonly platforms?: readonly Platform[]
  readonly templates: {
    readonly bash?: string
    readonly nu?: string
    readonly pwsh?: string
  }
}

// Placeholder slot syntax shared by the parser and the renderer. A `?` suffix
// marks the slot optional: `{service?}` renders as "" when no arg is given. A
// `*` suffix is an optional word list: `{flags*}` splits its value on
// whitespace and passes each word as its own argument. A plain `{path}` is
// required and fails the run when missing.
export const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*[?*]?)\}/g

// Placeholder names declared by a template, in order of appearance, with
// their `?`/`*` suffix kept.
export function placeholders(template: string): string[] {
  const found = template.match(PLACEHOLDER)
  if (!found) return []
  return Array.from(new Set(found.map((raw) => raw.slice(1, -1))))
}

// Slot name without its suffix: the key callers pass in `args`.
export function slotKey(slot: string): string {
  return slot.replace(/[?*]$/, "")
}

export function optionalSlot(slot: string): boolean {
  return slot.endsWith("?") || slot.endsWith("*")
}
