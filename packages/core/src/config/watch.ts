export * as ConfigWatch from "./watch.js"

import path from "path"
import { FSUtil } from "@opencode/util/fs-util"
import type { Watcher } from "../filesystem/watcher.js"
import type { ConfigDiscovery } from "./discovery.js"

/**
 * `extra` carries ecosystem paths watched one by one: their folders hold churning state (`~/.claude` keeps
 * logs and todos), so only the files and existing subfolders that feed config are watched.
 */
export function plan(
  sources: ConfigDiscovery.Sources,
  extra: { readonly files: readonly string[]; readonly directories: readonly string[] } = {
    files: [],
    directories: [],
  },
) {
  const directories = [
    ...(sources.global ? [sources.global] : []),
    ...sources.project.filter((root) => root.present).map((root) => root.path),
    ...extra.directories,
  ]
  const files = [
    ...extra.files,
    ...sources.direct,
    ...sources.project.map((root) => root.path),
    ...Object.values(sources.ecosystems).flat(),
    ...(sources.explicit ? [sources.explicit] : []),
  ]
  // Keep a parent watch for each root so deletion/recreation is observable.
  const parents = Map.groupBy(
    files.filter((file) => !directories.some((directory) => file !== directory && FSUtil.contains(directory, file))),
    (file) => path.dirname(file),
  )
  return new Map(
    [
      ...directories.map((path) => ({
        path,
        type: "directory" as const,
        ignore: ["node_modules", ".git", "**/{node_modules,.git}/**"],
      })),
      ...Array.from(parents, ([parent, files]) => ({
        path: parent,
        type: "entries" as const,
        names: [...new Set(files.map((file) => path.basename(file)))].toSorted(),
      })),
    ].map((target) => [JSON.stringify(target), target satisfies Watcher.WatchInput]),
  )
}
