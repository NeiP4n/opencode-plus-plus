export * as HubCatalog from "./index.js"

import type { Entry } from "../types.js"
import { entries as search } from "./search.js"
import { entries as files } from "./files.js"
import { entries as text } from "./text.js"
import { entries as json } from "./json.js"
import { entries as data } from "./data.js"
import { entries as git } from "./git.js"
import { entries as github } from "./github.js"
import { entries as docker } from "./docker.js"
import { entries as systemd } from "./systemd.js"
import { entries as process } from "./process.js"
import { entries as network } from "./network.js"
import { entries as system } from "./system.js"
import { entries as security } from "./security.js"
import { entries as windows } from "./windows.js"
import { entries as mobile } from "./mobile.js"
import { entries as build } from "./build.js"

// Single flat list; ids are unique and asserted once at module load so a
// duplicate id fails fast instead of shadowing an entry at lookup time.
export const all: readonly Entry[] = [
  ...search,
  ...files,
  ...text,
  ...json,
  ...data,
  ...git,
  ...github,
  ...docker,
  ...systemd,
  ...process,
  ...network,
  ...system,
  ...security,
  ...windows,
  ...mobile,
  ...build,
]

const byId = new Map(all.map((entry) => [entry.id, entry]))
if (byId.size !== all.length) {
  const seen = new Set<string>()
  const duplicate = all.find((entry) => (seen.has(entry.id) ? true : (seen.add(entry.id), false)))
  throw new Error(`Hub catalog contains a duplicate id: ${duplicate?.id}`)
}

export function get(id: string): Entry | undefined {
  return byId.get(id)
}

export function categories(): string[] {
  return Array.from(new Set(all.map((entry) => entry.category))).sort()
}
