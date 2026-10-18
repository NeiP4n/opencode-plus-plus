export * as Plot from "./plot.js"

import { mkdir, readdir, realpath, rm } from "node:fs/promises"
import { hostname } from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { SessionID } from "@opencode/schema/session-id"
import { Orchestra } from "./orchestra.js"
import { Session } from "./session.js"
import { SessionSchema } from "./session/schema.js"

// A plot (участок) is a part of a project an AI team took for its work, kept as a
// temporary file in the project's .opencode/plots folder so every team on the project,
// and AIs reaching it from other computers through rooms, sees it. Edits inside another
// team's plot are refused, so two teams never rewrite the same code at once. A plot
// lasts a while and stretches while its team keeps working in it; one left behind by a
// crash or a closed laptop simply runs out.
export const Info = Schema.Struct({
  id: Schema.String,
  // Absolute files or folders; a folder covers everything under it.
  paths: Schema.Array(Schema.String),
  purpose: Schema.String,
  // Who holds it: the team's or the session's name, for the people and AIs who meet it.
  team: Schema.String,
  // The sessions that may edit inside it: the claiming session, and an orchestrator's team.
  members: Schema.Array(SessionID),
  machine: Schema.String,
  created: Schema.Number,
  expires: Schema.Number,
}).annotate({ identifier: "Plot.Info" })
export type Info = typeof Info.Type

export class TakenError extends Schema.TaggedError<TakenError>()("Plot.TakenError", {
  message: Schema.String,
}) {}

export interface Interface {
  // Takes paths for the session's team. Fails when another team holds any of them.
  readonly claim: (input: {
    sessionID: SessionID
    directory: string
    paths: ReadonlyArray<string>
    purpose: string
  }) => Effect.Effect<Info, TakenError>
  // Gives back the session team's plots under the directory, or one of them by id.
  readonly release: (input: { sessionID: SessionID; directory: string; id?: string }) => Effect.Effect<number>
  // The live plots that cover the directory or lie under it.
  readonly list: (directory: string) => Effect.Effect<ReadonlyArray<Info>>
  // Refuses an edit of files inside another team's plot, and stretches the session's own.
  readonly guard: (input: { sessionID: SessionID; files: ReadonlyArray<string> }) => Effect.Effect<void, TakenError>
  // Whether a plot lets this session edit inside it.
  readonly holds: (plot: Info, sessionID: SessionID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Plot") {}

export const FOLDER = path.join(".opencode", "plots")
// Long enough to finish a task, short enough that an abandoned plot frees itself soon.
const TTL = Duration.minutes(30)
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Info))

// Whether one path is the other or lies under it.
export function covers(outer: string, inner: string) {
  return inner === outer || inner.startsWith(outer.endsWith(path.sep) ? outer : outer + path.sep)
}

const layer: Layer.Layer<Service, never, Session.Service | Orchestra.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const orchestra = yield* Orchestra.Service

    // Subagents act for the session that started them, so a plot belongs to the top session.
    const root = (sessionID: SessionID): Effect.Effect<SessionSchema.Info | undefined> =>
      Effect.gen(function* () {
        const session = yield* sessions.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))
        if (!session?.parentID) return session
        return yield* root(session.parentID)
      })

    // An orchestrator claims for its team: the sessions it may give tasks to.
    const team = Effect.fnUntraced(function* (sessionID: SessionID) {
      const session = yield* root(sessionID)
      const id = session?.id ?? sessionID
      const project = yield* orchestra.mainOf(id)
      if (!project) return { name: session?.title || "a session", members: [id] }
      const members = yield* orchestra.sessions(project.id).pipe(Effect.orElseSucceed(() => []))
      const access = yield* orchestra.accessMany(members.map((member) => member.id))
      return {
        name: `${project.name} team`,
        members: [
          id,
          ...members
            .filter((member) => Orchestra.allows(access[member.id] ?? "read", "write"))
            .map((member) => member.id),
        ],
      }
    })

    const holds = Effect.fnUntraced(function* (plot: Info, sessionID: SessionID) {
      const session = yield* root(sessionID)
      return plot.members.includes(session?.id ?? sessionID)
    })

    // Plot folders that can hold plots over these paths: each path's own folder and every
    // folder above it, so a plot taken at the project root covers a file deep inside.
    const folders = (paths: ReadonlyArray<string>, directory: string) =>
      [...new Set(paths.flatMap((item) => ancestors(item, directory)))].map((folder) => path.join(folder, FOLDER))

    const read = (folder: string) =>
      Effect.promise(async () => {
        const names = await readdir(folder).catch(() => [])
        const now = Date.now()
        const plots = await Promise.all(
          names
            .filter((name) => name.endsWith(".json"))
            .map(async (name) => {
              const file = path.join(folder, name)
              const plot = Option.getOrUndefined(
                decode(
                  await Bun.file(file)
                    .text()
                    .catch(() => ""),
                ),
              )
              // A plot past its time or unreadable is left over from a crash; it goes.
              if (!plot || plot.expires < now) {
                await rm(file, { force: true })
                return []
              }
              return [{ plot, folder }]
            }),
        )
        return plots.flat()
      })

    const live = (paths: ReadonlyArray<string>, directory: string) =>
      Effect.gen(function* () {
        const candidates = folders(paths, directory)
        const safe = yield* Effect.forEach(candidates, (folder) =>
          Effect.promise(() => pathsInside(directory, [folder]).catch(() => false)).pipe(
            Effect.map((inside) => (inside ? folder : undefined)),
          ),
        )
        return (yield* Effect.forEach(safe.filter((folder): folder is string => folder !== undefined), read)).flat()
      })

    const write = (folder: string, plot: Info) =>
      Effect.promise(async () => {
        await mkdir(folder, { recursive: true })
        // Plots are working state, never history.
        await Bun.write(path.join(folder, ".gitignore"), "*\n")
        await Bun.write(path.join(folder, `${plot.id}.json`), JSON.stringify(plot, null, 2) + "\n")
      })

    const taken = (plot: Info) =>
      new TakenError({
        message: [
          `This part of the project is a plot taken by ${plot.team} on ${plot.machine}: ${plot.purpose}.`,
          `It covers ${plot.paths.join(", ")} until ${new Date(plot.expires).toLocaleTimeString()}.`,
          "Work outside it, or ask the operator or that team to release it.",
        ].join(" "),
      })

    return Service.of({
      claim: Effect.fn("Plot.claim")(function* (input) {
        if (input.paths.length === 0 || input.paths.length > 128)
          return yield* new TakenError({ message: "A plot must contain between 1 and 128 paths." })
        if (input.paths.some((item) => item.length > 4096 || item.includes("\0")))
          return yield* new TakenError({ message: "Plot paths must be shorter than 4096 characters and contain no NUL." })
        if (input.purpose.length > 500)
          return yield* new TakenError({ message: "Plot purpose must be 500 characters or fewer." })
        const directory = path.resolve(input.directory)
        const paths = input.paths.map((item) => path.resolve(directory, item))
        // Guests may choose paths only inside this project. Without this check, a ../ path
        // makes live() scan plot folders elsewhere on the host and can remove stale files there.
        const outside = paths.some((item) => {
          const relative = path.relative(directory, item)
          return relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)
        })
        if (outside)
          return yield* new TakenError({ message: "Plot paths must stay inside the project directory." })
        // Lexical containment is not enough: a symlink inside the project can point outside it.
        // Resolve each target, or its nearest existing ancestor, before live() scans plot folders.
        const canonicalPaths = yield* Effect.promise(() =>
          Promise.all(paths.map((item) => canonicalInside(directory, item))).catch(() => []),
        )
        if (canonicalPaths.length !== paths.length || canonicalPaths.some((item) => item === undefined))
          return yield* new TakenError({ message: "Plot paths must stay inside the project directory." })
        const safePaths = canonicalPaths as string[]
        const storage = path.join(directory, FOLDER)
        const safeStorage = yield* Effect.promise(() => pathsInside(directory, [storage]).catch(() => false))
        if (!safeStorage)
          return yield* new TakenError({ message: "Plot storage must stay inside the project directory." })
        const others = yield* live(safePaths, directory)
        for (const { plot } of others) {
          if (yield* holds(plot, input.sessionID)) continue
          if (plot.paths.some((held) => safePaths.some((wanted) => covers(held, wanted) || covers(wanted, held))))
            return yield* taken(plot)
        }
        const owner = yield* team(input.sessionID)
        const now = Date.now()
        const plot: Info = {
          id: `plot_${randomBytes(6).toString("hex")}`,
          paths: safePaths,
          purpose: input.purpose.trim() || "work in progress",
          team: owner.name,
          members: owner.members,
          machine: hostname(),
          created: now,
          expires: now + Duration.toMillis(TTL),
        }
        yield* write(storage, plot)
        return plot
      }),
      release: Effect.fn("Plot.release")(function* (input) {
        const directory = path.resolve(input.directory)
        const folder = path.join(directory, FOLDER)
        const safeStorage = yield* Effect.tryPromise({
          try: () => pathsInside(directory, [folder]),
          catch: () => new Error("Unable to verify plot storage path."),
        }).pipe(Effect.catchAll(() => Effect.succeed(false)))
        if (!safeStorage) return 0
        const plots = (yield* read(folder)).map((entry) => entry.plot)
        const mine = yield* Effect.filter(plots, (plot) =>
          holds(plot, input.sessionID).pipe(Effect.map((held) => held && (!input.id || plot.id === input.id))),
        )
        yield* Effect.forEach(mine, (plot) =>
          Effect.promise(() => rm(path.join(folder, `${plot.id}.json`), { force: true })),
        )
        return mine.length
      }),
      list: (directory) =>
        Effect.gen(function* () {
          const above = yield* live([directory], directory)
          const below = yield* Effect.promise(() => plotFolders(directory)).pipe(
            Effect.flatMap((found) => Effect.forEach(found, read)),
          )
          const all = [...above, ...below.flat()].map((entry) => entry.plot)
          return all.filter((plot, index) => all.findIndex((other) => other.id === plot.id) === index)
        }),
      guard: Effect.fn("Plot.guard")(function* (input) {
        if (input.files.length === 0) return
        const session = yield* root(input.sessionID)
        if (!session) return
        const directory = path.resolve(session.location.directory)
        const files = input.files.map((file) => path.resolve(directory, file))
        const outside = files.some((file) => {
          const relative = path.relative(directory, file)
          return relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)
        })
        const canonicalFiles = !outside
          ? yield* Effect.promise(() =>
              Promise.all(files.map((file) => canonicalInside(directory, file))).catch(() => []),
            )
          : []
        if (canonicalFiles.length !== files.length || canonicalFiles.some((file) => file === undefined))
          return yield* new TakenError({ message: "Plot paths must stay inside the project directory." })
        const safeFiles = canonicalFiles as string[]
        for (const { plot, folder } of yield* live(safeFiles, directory)) {
          const touched = safeFiles.some((file) => plot.paths.some((held) => covers(held, file)))
          if (!touched) continue
          if (!(yield* holds(plot, input.sessionID))) return yield* taken(plot)
          // Working inside its own plot keeps it alive.
          yield* write(folder, { ...plot, expires: Date.now() + Duration.toMillis(TTL) })
        }
      }),
      holds,
    })
  }),
)

async function canonicalInside(directory: string, target: string): Promise<string | undefined> {
  const root = await realpath(directory)
  let current = path.resolve(target)
  const missing: string[] = []
  while (true) {
    try {
      const resolved = await realpath(current)
      const canonical = path.resolve(resolved, ...missing.reverse())
      const relative = path.relative(root, canonical)
      if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return undefined
      return canonical
    } catch (cause) {
      const code =
        typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : ""
      if (code !== "ENOENT" && code !== "ENOTDIR") throw cause
      const parent = path.dirname(current)
      if (parent === current) throw cause
      missing.push(path.basename(current))
      current = parent
    }
  }
}

async function pathsInside(directory: string, targets: readonly string[]) {
  const resolved = await Promise.all(targets.map((target) => canonicalInside(directory, target)))
  return resolved.every((target) => target !== undefined)
}

function ancestors(target: string, boundary: string): string[] {
  const resolved = path.resolve(target)
  const root = path.resolve(boundary)
  const relative = path.relative(root, resolved)
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return []
  if (resolved === root) return [resolved]
  const parent = path.dirname(resolved)
  return [resolved, ...ancestors(parent, root)]
}

// Plot folders under a directory, found without walking the whole tree: a project keeps
// its plots at its root or in a few subprojects, never deep inside dependencies.
async function plotFolders(directory: string) {
  const own = path.join(directory, FOLDER)
  const children = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const candidates = [
    own,
    ...children
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => path.join(directory, entry.name, FOLDER)),
  ]
  // The .opencode directory or its plots folder can itself be a symlink.
  // Never inspect or clean plot files outside the requested project tree.
  const safe: string[] = []
  for (const folder of candidates) {
    if (await pathsInside(directory, [folder]).catch(() => false)) safe.push(folder)
  }
  return safe
}

export const node = makeGlobalNode({ service: Service, layer, deps: [Session.node, Orchestra.node] })
