export * as HubVisibility from "./visibility.js"

import type { Entry } from "./types.js"

// What the operator installs from the Registry is there for the model: there is no
// separate on/off switch. A team role narrows it with its `registry` list in the
// team editor; `allowed` is that list, undefined meaning every installed program.

export function hinted(tool: string, allowed?: readonly string[]): boolean {
  return allowed === undefined || allowed.includes(tool)
}

export function discoverable(entry: Entry, allowed?: readonly string[]): boolean {
  return (entry.requires ?? []).every((tool) => hinted(tool, allowed))
}
