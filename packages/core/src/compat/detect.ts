export * as CompatDetect from "./detect.js"

/**
 * Finds which other agent tools a project uses, so the user can pick among them. A project may carry several
 * at once (.claude, .codex, .gemini, ...); every one found is reported, whether it is on or off.
 */

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import type { ConfigCompatibility } from "@opencode/schema/config/compatibility"
import { Ecosystem } from "./ecosystem.js"
import { CompatStore } from "./store.js"

export type Folder = ConfigCompatibility.Folder
export type Found = ConfigCompatibility.Found

/** The project root used as the store key: the nearest checkout holding .git or .hg, else the directory itself. */
export const projectRoot = Effect.fn("CompatDetect.projectRoot")(function* (directory: string) {
  const fs = yield* FSUtil.Service
  const start = yield* fs.resolve(directory)
  const found = yield* fs
    .up({ targets: [".git", ".hg"], start, mode: "first" })
    .pipe(Effect.orElseSucceed(() => [] as string[]))
  return found[0] ? path.dirname(found[0]) : start
})

/** Directories from `directory` up to and including `root`, nearest first; just `directory` when outside `root`. */
function ancestors(directory: string, root: string) {
  if (!FSUtil.contains(root, directory)) return [directory]
  const result = [directory]
  let current = directory
  while (current !== root) {
    current = path.dirname(current)
    result.push(current)
  }
  return result
}

export const detect = Effect.fn("CompatDetect.detect")(function* (input: {
  readonly directory: string
  /** Project root the choices are stored under; found from `directory` when absent. */
  readonly root?: string
  readonly home: string
  readonly state: string
  readonly settings?: ConfigCompatibility.Info
  readonly env?: NodeJS.ProcessEnv
  /** What each adapter loaded, from the last config load. */
  readonly adapters?: Partial<
    Record<
      Ecosystem.ID,
      { readonly loaded: ConfigCompatibility.Loaded; readonly skipped: readonly ConfigCompatibility.Skipped[] }
    >
  >
}) {
  const fs = yield* FSUtil.Service
  const directory = yield* fs.resolve(input.directory)
  const root = input.root ? yield* fs.resolve(input.root) : yield* projectRoot(directory)
  const record = yield* CompatStore.project(CompatStore.file(input.state), root)
  const levels = ancestors(directory, root)
  const settings = input.settings ?? {}

  return yield* Effect.forEach(Ecosystem.all, (item) =>
    Effect.gen(function* () {
      const global = yield* Effect.filter(item.global(input.home, input.env ?? process.env), fs.isDir)
      const local = yield* Effect.filter(
        levels.map((level) => path.join(level, item.directory)),
        fs.isDir,
      )
      const markers = yield* Effect.filter(
        levels.flatMap((level) => item.markers.map((marker) => path.join(level, marker))),
        fs.isFile,
      )
      const decidedBy: Found["decidedBy"] =
        record.ecosystems?.[item.id] !== undefined
          ? "project"
          : settings.ecosystems?.[item.id] !== undefined
            ? "config"
            : "default"
      return {
        id: item.id,
        label: item.label,
        enabled: Ecosystem.enabled(item.id, settings, record.ecosystems),
        decidedBy,
        trusted: CompatStore.trusted(record, item.id),
        folders: [
          ...global.map((folder) => ({ path: folder, scope: "global" as const })),
          ...local.map((folder) => ({ path: folder, scope: "project" as const })),
        ],
        markers,
        ...(input.adapters?.[item.id]
          ? { loaded: input.adapters[item.id]!.loaded, skipped: input.adapters[item.id]!.skipped }
          : {}),
      } satisfies Found
    }),
  ).pipe(
    Effect.map(
      (found): ConfigCompatibility.Report => ({
        root,
        order: Ecosystem.order(settings.order).filter((id) => found.some((item) => item.id === id && item.enabled)),
        ecosystems: found,
      }),
    ),
  )
})

/** Whether anything of the ecosystem exists for this directory. */
export function present(found: Found) {
  return found.folders.length > 0 || found.markers.length > 0
}
