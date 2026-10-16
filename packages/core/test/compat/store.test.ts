import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { CompatStore } from "@opencode/core/compat/store"
import { CompatDetect } from "@opencode/core/compat/detect"
import { tmpdir } from "../fixture/tmpdir"

const run = <A, E>(effect: Effect.Effect<A, E, FSUtil.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(AppNodeBuilder.build(FSUtil.node))))

describe("CompatStore", () => {
  test("keeps choices and trust per project and drops empty records", async () => {
    await using tmp = await tmpdir()
    const file = CompatStore.file(path.join(tmp.path, "state"))
    const project = path.join(tmp.path, "project")
    const other = path.join(tmp.path, "other")
    await Promise.all([fs.mkdir(project), fs.mkdir(other)])

    await run(CompatStore.choose(file, project, "claude", false))
    await run(CompatStore.trust(file, project, "codex", true))
    expect(await run(CompatStore.project(file, project))).toEqual({ ecosystems: { claude: false }, trusted: ["codex"] })
    expect(await run(CompatStore.project(file, other))).toEqual({})

    await run(CompatStore.choose(file, project, "claude", undefined))
    await run(CompatStore.trust(file, project, "codex", false))
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ projects: {} })
  })

  test("a damaged store reads as empty", async () => {
    await using tmp = await tmpdir()
    const file = CompatStore.file(tmp.path)
    await fs.writeFile(file, "{not json")
    expect(await run(CompatStore.project(file, tmp.path))).toEqual({})
  })
})

describe("CompatDetect", () => {
  test("reports every ecosystem a project carries at once, with markers and home folders", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const project = path.join(tmp.path, "project")
    const nested = path.join(project, "packages", "app")
    await Promise.all([
      fs.mkdir(path.join(project, ".git"), { recursive: true }),
      fs.mkdir(path.join(project, ".claude"), { recursive: true }),
      fs.mkdir(path.join(project, ".codex"), { recursive: true }),
      fs.mkdir(path.join(nested, ".gemini"), { recursive: true }),
      fs.mkdir(path.join(home, ".cursor"), { recursive: true }),
    ])
    await fs.writeFile(path.join(project, "CLAUDE.md"), "# rules\n")
    const state = path.join(tmp.path, "state")
    await run(CompatStore.choose(CompatStore.file(state), project, "codex", false))

    const report = await run(
      CompatDetect.detect({
        directory: nested,
        home,
        state,
        settings: { ecosystems: { gemini: false }, order: ["gemini", "claude"] },
        env: {},
      }),
    )
    const byID = Object.fromEntries(report.ecosystems.map((item) => [item.id, item]))

    expect(report.root).toBe(await fs.realpath(project))
    expect(byID.claude).toMatchObject({ enabled: true, decidedBy: "default", trusted: false })
    expect(byID.claude.markers).toEqual([path.join(await fs.realpath(project), "CLAUDE.md")])
    expect(byID.codex).toMatchObject({ enabled: false, decidedBy: "project" })
    expect(byID.gemini).toMatchObject({ enabled: false, decidedBy: "config" })
    expect(byID.gemini.folders).toEqual([{ path: path.join(await fs.realpath(nested), ".gemini"), scope: "project" }])
    expect(byID.cursor.folders).toEqual([{ path: path.join(home, ".cursor"), scope: "global" }])
    expect(CompatDetect.present(byID.agents)).toBe(false)
    expect(report.order).toEqual(["claude", "agents", "cursor"])
  })
})
