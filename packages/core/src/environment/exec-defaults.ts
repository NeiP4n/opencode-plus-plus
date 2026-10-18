import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Failed, NotFound, WrongKind, type FileInfo, type FilesImpl, type FileType } from "./files.js"

/**
 * Portable filesystem operations for execution environments without a native file API.
 * Node's filesystem APIs work on Windows and Unix alike; spawning sh/GNU utilities here
 * made MCP-related file operations fail on Windows installations without a Unix shell.
 */
export const execDefaults = (_spawner: ChildProcessSpawner["Service"]): FilesImpl => ({
  stat: (value) =>
    attempt(value, () => fs.lstat(value), true).pipe(
      Effect.map((info): FileInfo => ({ type: fileType(info), size: info.size, mtimeMs: info.mtimeMs })),
    ),
  read: (value, range) =>
    Effect.gen(function* () {
      const info = yield* attempt(value, () => fs.stat(value), true).pipe(
        Effect.map((stats): FileInfo => ({ type: fileType(stats), size: stats.size, mtimeMs: stats.mtimeMs })),
      )
      if (info.type !== "file") return yield* new WrongKind({ path: value, actual: info.type })
      const bytes = yield* attempt(value, async () => {
        if (range === undefined) return new Uint8Array(await fs.readFile(value))
        const handle = await fs.open(value, "r")
        try {
          const buffer = new Uint8Array(range.length)
          const result = await handle.read(buffer, 0, range.length, range.offset)
          return buffer.subarray(0, result.bytesRead)
        } finally {
          await handle.close()
        }
      })
      return { info, bytes }
    }),
  write: (value, bytes) =>
    attempt(value, async () => {
      await fs.mkdir(path.dirname(value), { recursive: true })
      await fs.writeFile(value, bytes)
    }),
  list: (value) =>
    Effect.gen(function* () {
      const info = yield* attempt(value, () => fs.stat(value), true).pipe(
        Effect.map((stats): FileInfo => ({ type: fileType(stats), size: stats.size, mtimeMs: stats.mtimeMs })),
      )
      if (info.type !== "directory") return yield* new WrongKind({ path: value, actual: info.type })
      const entries = yield* attempt(value, () => fs.readdir(value, { withFileTypes: true }), true)
      return entries.map((entry) => ({ name: entry.name, type: fileType(entry) }))
    }),
  remove: (value) => attempt(value, () => fs.rm(value, { recursive: true, force: true })),
  move: (from, to) =>
    Effect.gen(function* () {
      yield* attempt(from, () => fs.lstat(from), true)
      const destination = yield* attempt(to, () => fs.lstat(to), true).pipe(
        Effect.map((info) => (info.isDirectory() ? path.join(to, path.basename(from)) : to)),
        Effect.catchIf(
          (error) => error instanceof NotFound,
          () => Effect.succeed(to),
        ),
      )
      yield* attempt(from, () => fs.rename(from, destination))
    }),
  mkdir: (value) => attempt(value, () => fs.mkdir(value, { recursive: true }).then(() => undefined)),
})

function attempt<A>(value: string, run: () => Promise<A>): Effect.Effect<A, Failed>
function attempt<A>(value: string, run: () => Promise<A>, missing: true): Effect.Effect<A, NotFound | Failed>
function attempt<A>(value: string, run: () => Promise<A>, missing = false) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      missing && isMissing(cause) ? new NotFound({ path: value }) : new Failed({ path: value, cause }),
  })
}

const isMissing = (cause: unknown) =>
  cause !== null &&
  typeof cause === "object" &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR")

const fileType = (entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileType => {
  if (entry.isFile()) return "file"
  if (entry.isDirectory()) return "directory"
  if (entry.isSymbolicLink()) return "symlink"
  return "other"
}

export * as EnvironmentExecDefaults from "./exec-defaults.js"
