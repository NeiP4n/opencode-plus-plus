import { describe, expect } from "bun:test"
import path from "node:path"
import { mkdir, symlink } from "node:fs/promises"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Job } from "@opencode/core/job"
import { Agent } from "@opencode/core/agent"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Orchestra } from "@opencode/core/orchestra"
import { Plot } from "@opencode/core/plot"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { location } from "./fixture/location"

const idle = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.succeed(
    SessionExecution.Service,
    SessionExecution.Service.of({
      active: Effect.succeed(new Set()),
      isActive: () => Effect.succeed(false),
      resume: () => Effect.void,
      wake: () => Effect.void,
      interrupt: () => Effect.succeed(false),
      awaitIdle: () => Effect.void,
    }),
  ),
  deps: [],
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Job.node,
      Session.node,
      SessionExecution.node,
      LocationServiceMap.node,
      Orchestra.node,
      Agent.node,
      Plot.node,
    ]),
    [
      SessionExecution.node.replace(idle),
      Global.node.replace(tempGlobalLayer),
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") }))),
      ),
      offlineModels,
    ],
  ),
)

const refusal = <A>(effect: Effect.Effect<A, Plot.TakenError>) =>
  effect.pipe(
    Effect.map(() => undefined),
    Effect.catchTag("Plot.TakenError", (error) => Effect.succeed(error.message)),
  )

describe("Plot", () => {
  it.live("a session's plot keeps other sessions out until it is released", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-plot-")))
      const plots = yield* Plot.Service
      const sessions = yield* Session.Service
      const directory = AbsolutePath.make(tmp.path)
      const mine = yield* sessions.create({ location: { directory }, title: "Parser work" })
      const theirs = yield* sessions.create({ location: { directory }, title: "Other team" })
      const inside = path.join(tmp.path, "src", "parser.ts")
      const outside = path.join(tmp.path, "docs", "readme.md")

      const plot = yield* plots.claim({
        sessionID: mine.id,
        directory: tmp.path,
        paths: ["src"],
        purpose: "rewrite the parser",
      })
      // the plot is a temporary file in the project that git never picks up
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, Plot.FOLDER, `${plot.id}.json`)).exists())).toBe(
        true,
      )
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, Plot.FOLDER, ".gitignore")).text())).toBe("*\n")

      expect(yield* refusal(plots.guard({ sessionID: mine.id, files: [inside] }))).toBeUndefined()
      const refused = yield* refusal(plots.guard({ sessionID: theirs.id, files: [inside] }))
      expect(refused).toContain("Parser work")
      expect(refused).toContain("rewrite the parser")
      expect(yield* refusal(plots.guard({ sessionID: theirs.id, files: ["src/parser.ts"] }))).toContain("Parser work")
      expect(yield* refusal(plots.guard({ sessionID: theirs.id, files: [outside] }))).toBeUndefined()
      // nor may the other team take an overlapping plot
      expect(
        yield* refusal(
          plots.claim({ sessionID: theirs.id, directory: tmp.path, paths: ["src/parser.ts"], purpose: "x" }),
        ),
      ).toContain("Parser work")
      expect((yield* plots.list(tmp.path)).map((item) => item.id)).toEqual([plot.id])

      // only its holder gives it back
      expect(yield* plots.release({ sessionID: theirs.id, directory: tmp.path })).toBe(0)
      expect(yield* plots.release({ sessionID: mine.id, directory: tmp.path })).toBe(1)
      expect(yield* refusal(plots.guard({ sessionID: theirs.id, files: [inside] }))).toBeUndefined()
      expect(yield* plots.list(tmp.path)).toEqual([])
    }).pipe(Effect.scoped),
  )

  it.live("plot claims cannot escape the project directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-plot-")))
      const plots = yield* Plot.Service
      const sessions = yield* Session.Service
      const directory = tmp.path
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })

      expect(
        yield* refusal(
          plots.claim({
            sessionID: session.id,
            directory,
            paths: ["../outside"],
            purpose: "attempted path escape",
          }),
        ),
      ).toContain("must stay inside the project directory")
      expect(
        yield* refusal(
          plots.claim({
            sessionID: session.id,
            directory,
            paths: [path.resolve(directory, "..", "outside")],
            purpose: "attempted absolute path escape",
          }),
        ),
      ).toContain("must stay inside the project directory")
      expect(
        yield* refusal(
          plots.claim({ sessionID: session.id, directory, paths: [], purpose: "empty" }),
        ),
      ).toContain("between 1 and 128")
      expect(
        yield* refusal(
          plots.claim({ sessionID: session.id, directory, paths: Array.from({ length: 129 }, () => "src"), purpose: "too many" }),
        ),
      ).toContain("between 1 and 128")
      expect(
        yield* refusal(
          plots.guard({ sessionID: session.id, files: [path.resolve(directory, "..", "outside")] }),
        ),
      ).toContain("must stay inside the project directory")
      expect(yield* plots.list(directory)).toEqual([])
    }).pipe(Effect.scoped),
  )

  it.live("plot claims cannot follow a symlink outside the project", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-plot-")))
      const outside = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-plot-outside-")))
      const plots = yield* Plot.Service
      const sessions = yield* Session.Service
      const directory = tmp.path
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
      yield* Effect.promise(() => symlink(outside.path, path.join(directory, "linked")))

      expect(
        yield* refusal(
          plots.claim({
            sessionID: session.id,
            directory,
            paths: ["linked"],
            purpose: "attempted symlink escape",
          }),
        ),
      ).toContain("must stay inside the project directory")
      expect(yield* plots.list(directory)).toEqual([])

      // An in-project symlink must not bypass a claim by using a different lexical path.
      yield* Effect.promise(() => mkdir(path.join(directory, "src"), { recursive: true }))
      yield* Effect.promise(() => symlink(path.join(directory, "src"), path.join(directory, "alias")))
      const other = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
      yield* plots.claim({ sessionID: session.id, directory, paths: ["src"], purpose: "parser work" })
      expect(yield* refusal(plots.guard({ sessionID: other.id, files: ["alias/parser.ts"] }))).toContain("parser work")
    }).pipe(Effect.scoped),
  )

  it.live("plot storage symlinks cannot read or delete files outside the project", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-plot-")))
      const outside = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-plot-outside-")))
      const plots = yield* Plot.Service
      const sessions = yield* Session.Service
      const directory = tmp.path
      const session = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
      const externalFolder = path.join(outside.path, ".opencode", "plots")
      yield* Effect.promise(() => mkdir(externalFolder, { recursive: true }))
      const marker = path.join(externalFolder, "do-not-delete.json")
      yield* Effect.promise(() => Bun.write(marker, "not a plot"))
      yield* Effect.promise(() => symlink(path.join(outside.path, ".opencode"), path.join(directory, ".opencode")))

      expect(yield* refusal(plots.claim({ sessionID: session.id, directory, paths: ["src"], purpose: "safe plot" }))).toContain(
        "Plot storage must stay inside the project directory",
      )
      expect(yield* plots.release({ sessionID: session.id, directory })).toBe(0)
      expect(yield* plots.list(directory)).toEqual([])
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.live("an orchestrator's plot covers its team, and a plot left behind runs out", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-plot-")))
      const plots = yield* Plot.Service
      const sessions = yield* Session.Service
      const orchestra = yield* Orchestra.Service
      const project = yield* orchestra.create({ name: "Team", directory: tmp.path, template: "bugfix" })
      const [member] = yield* orchestra.sessions(project.id)
      yield* orchestra.setAccess(member.id, "write")
      const stranger = yield* sessions.create({ location: { directory: AbsolutePath.make(tmp.path) } })
      const file = path.join(tmp.path, "src", "bug.ts")

      const plot = yield* plots.claim({
        sessionID: project.main!,
        directory: tmp.path,
        paths: ["src"],
        purpose: "fix the bug",
      })
      expect(plot.team).toBe("Team team")
      expect(yield* refusal(plots.guard({ sessionID: member.id, files: [file] }))).toBeUndefined()
      expect(yield* refusal(plots.guard({ sessionID: stranger.id, files: [file] }))).toContain("Team team")

      // a crash leaves the file behind; past its time it no longer counts and is cleared
      const stored = path.join(tmp.path, Plot.FOLDER, `${plot.id}.json`)
      yield* Effect.promise(() => Bun.write(stored, JSON.stringify({ ...plot, expires: Date.now() - 1 })))
      expect(yield* refusal(plots.guard({ sessionID: stranger.id, files: [file] }))).toBeUndefined()
      expect(yield* Effect.promise(() => Bun.file(stored).exists())).toBe(false)
    }).pipe(Effect.scoped),
  )
})
