export * as ConfigDiscovery from "./discovery.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "../location.js"
import { AbsolutePath } from "../schema.js"
import { Ecosystem } from "../compat/ecosystem.js"
import type { Options } from "../config.js"

export const names = ["opencode.json", "opencode.jsonc"]

/** Eligible sources in priority order, including paths that may appear later. */
export interface Sources {
  readonly global?: AbsolutePath
  readonly explicit?: AbsolutePath
  readonly direct: readonly AbsolutePath[]
  readonly project: readonly { readonly path: AbsolutePath; readonly present: boolean }[]
  /** Each ecosystem's folders, global first, then project folders from farthest to nearest. */
  readonly ecosystems: Ecosystem.ByID<readonly AbsolutePath[]>
}

export const discover = Effect.fn("ConfigDiscovery.discover")(function* (options?: Options) {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const location = yield* Location.Service
  const globalDirectory = AbsolutePath.make(global.config)
  const globalEcosystems = Ecosystem.record((id) =>
    Ecosystem.get(id)
      .global(global.home, process.env)
      .map((root) => AbsolutePath.make(root)),
  )
  const globalRoots = yield* Effect.forEach([globalDirectory, ...Object.values(globalEcosystems).flat()], (item) =>
    fs.resolve(item),
  )
  const resolvedLocation = yield* fs.resolve(location.directory)
  const resolvedProject = yield* fs.resolve(location.project.directory)
  const resolvedHome = yield* fs.resolve(global.home)
  const isWithin = (root: string, candidate: string) => {
    const relative = path.relative(root, candidate)
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  }
  const upward =
    resolvedLocation === globalRoots[0] || options?.project === false
      ? []
      : yield* fs.up({ targets: ["."], start: location.directory }).pipe(Effect.orDie)
  // The explicit global config may itself live inside a project checkout
  // (for example, an OPENCODE_CONFIG_DIR pinned to that checkout). In that
  // case it also defines the traversal boundary, otherwise preserve ancestor
  // config discovery across the VCS project boundary.
  // A pinned project-local OpenCode config is a traversal boundary only when
  // the config root is actually the checkout's .opencode directory. Test/runtime
  // fixtures may place their isolated global config in a child named "global".
  const globalInsideProject = path.basename(globalRoots[0]) === ".opencode" && isWithin(resolvedProject, globalRoots[0])
  const locationInsideHome = isWithin(resolvedHome, resolvedLocation)
  const directories = yield* Effect.gen(function* () {
    const result: typeof upward = []
    for (const directory of upward) {
      const resolved = yield* fs.resolve(directory)
      if (globalInsideProject) {
        if (isWithin(resolvedProject, resolved)) result.push(directory)
        continue
      }
      if (locationInsideHome) {
        if (isWithin(resolvedHome, resolved) && (options?.global !== false || resolved !== resolvedHome)) {
          result.push(directory)
        }
        continue
      }
      result.push(directory)
    }
    return result
  })
  const discovered = yield* Effect.forEach(directories, (directory) =>
    Effect.gen(function* () {
      // Resolve the parent too: missing children must honor symlinked global roots.
      const parent = yield* fs.resolve(directory)
      return yield* Effect.forEach([...Ecosystem.directories, ".opencode", ...names.toReversed()], (name) =>
        fs
          .resolve(path.join(parent, name))
          .pipe(Effect.map((resolved) => ({ item: AbsolutePath.make(path.join(directory, name)), resolved }))),
      )
    }),
  ).pipe(
    Effect.map((items) => items.flat()),
    Effect.orDie,
  )

  const globalEnabled = options?.global !== false
  const globalFiles = yield* Effect.forEach(names, (name) => fs.resolve(path.join(globalDirectory, name)))
  // Global sources must not re-enter through the project walk.
  const visible = discovered
    .filter(({ resolved }) =>
      globalEnabled
        ? !globalRoots.includes(resolved) && !globalFiles.includes(resolved)
        : !globalRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep)),
    )
    .map(({ item }) => item)

  return {
    global: globalEnabled ? globalDirectory : undefined,
    explicit: options?.file ? AbsolutePath.make(path.resolve(options.file)) : undefined,
    direct: visible
      .filter((item) => ![...Ecosystem.directories, ".opencode"].includes(path.basename(item)))
      .toReversed(),
    project: yield* Effect.forEach(
      visible.filter((item) => path.basename(item) === ".opencode").toReversed(),
      (directory) => fs.isDir(directory).pipe(Effect.map((present) => ({ path: directory, present }))),
    ),
    ecosystems: Ecosystem.record((id) => [
      ...new Set([
        ...(globalEnabled ? globalEcosystems[id] : []),
        ...visible.filter((entry) => path.basename(entry) === Ecosystem.get(id).directory).toReversed(),
      ]),
    ]),
  } satisfies Sources
})
