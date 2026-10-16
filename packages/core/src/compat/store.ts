export * as CompatStore from "./store.js"

/**
 * Per-project choices about other agent tools' folders, kept outside every repository so a checkout can
 * neither pick its own ecosystems nor trust itself. Keys are resolved project roots.
 *
 * - `ecosystems`: the user's on/off choice for this project; it outranks config.
 * - `trusted`: ecosystems whose project folders may run code or loosen permissions (hooks, stdio MCP servers,
 *   `allow` rules, environment). Passive content such as instructions and skills needs no trust, and
 *   home-level folders are always trusted.
 */

import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { ConfigCompatibility } from "@opencode/schema/config/compatibility"
import type { Ecosystem } from "./ecosystem.js"

export const FILE = "compatibility.json"

export const Project = Schema.Struct({
  ecosystems: Schema.optionalKey(ConfigCompatibility.Choices),
  trusted: Schema.optionalKey(Schema.Array(ConfigCompatibility.Ecosystem)),
})
export interface Project extends Schema.Schema.Type<typeof Project> {}

export const Store = Schema.Struct({
  projects: Schema.Record(Schema.String, Project),
})
export interface Store extends Schema.Schema.Type<typeof Store> {}

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Store))

export function file(state: string) {
  return path.join(state, FILE)
}

/** Reads the store; a missing or damaged file reads as empty so it can never block startup. */
export const read = Effect.fn("CompatStore.read")(function* (filepath: string) {
  const fs = yield* FSUtil.Service
  const text = yield* fs.readFileStringSafe(filepath).pipe(Effect.orElseSucceed(() => undefined))
  if (text === undefined) return { projects: {} } satisfies Store
  const parsed = decode(text)
  if (parsed._tag === "Some") return parsed.value
  yield* Effect.logWarning("ignoring unreadable compatibility store", { path: filepath })
  return { projects: {} } satisfies Store
})

export const project = Effect.fn("CompatStore.project")(function* (filepath: string, root: string) {
  const fs = yield* FSUtil.Service
  const store = yield* read(filepath)
  const record: Project = store.projects[yield* fs.resolve(root)] ?? {}
  return record
})

/** Rewrites one project's record atomically; an empty record is dropped. */
export const update = Effect.fn("CompatStore.update")(function* (
  filepath: string,
  root: string,
  change: (current: Project) => Project,
) {
  const fs = yield* FSUtil.Service
  const key = yield* fs.resolve(root)
  const store = yield* read(filepath)
  const next = change(store.projects[key] ?? {})
  const projects = { ...store.projects }
  if (Object.values(next.ecosystems ?? {}).every((value) => value === undefined) && (next.trusted ?? []).length === 0)
    delete projects[key]
  else projects[key] = next
  const temporary = `${filepath}.${process.pid}.tmp`
  yield* fs.writeWithDirs(temporary, `${JSON.stringify({ projects }, null, 2)}\n`)
  yield* fs.rename(temporary, filepath)
  return next
})

export const choose = (filepath: string, root: string, id: Ecosystem.ID, enabled: boolean | undefined) =>
  update(filepath, root, (current) => {
    const ecosystems: Record<string, boolean | undefined> = { ...current.ecosystems }
    if (enabled === undefined) delete ecosystems[id]
    else ecosystems[id] = enabled
    return { ...current, ecosystems }
  })

export const trust = (filepath: string, root: string, id: Ecosystem.ID, trusted: boolean) =>
  update(filepath, root, (current) => {
    const rest = (current.trusted ?? []).filter((item) => item !== id)
    return { ...current, trusted: trusted ? [...rest, id] : rest }
  })

/** Whether an ecosystem's project folders may run code or loosen permissions in this project. */
export function trusted(record: Project, id: Ecosystem.ID) {
  return record.trusted?.includes(id) ?? false
}
