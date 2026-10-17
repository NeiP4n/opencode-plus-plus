import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { Dod } from "@opencode/core/dod"
import { readInitial } from "./lib/instructions"
import { tmpdir } from "./fixture/tmpdir"

const FILE = `# The plan; comments stay.
task_id: T-1
stages:
  - name: "Stage 1"
    id: L-002
leaves:
  - id: L-001
    what: "Read the protocol"
    group: "Stage 1"
    task_state: DONE
    steps:
      - "[x] read it"

  - id: L-002
    what: "Add the check"   # keep this comment
    group: "Stage 1"
    task_state: NOT_STARTED
    steps:
      - "[x] find the spot"
      - "[ ] write it"
    depends_on: [L-001]

  - id: L-003
    what: "Document it"
`

async function project(text = FILE) {
  const dir = await tmpdir()
  await mkdir(path.join(dir.path, ".opencode"), { recursive: true })
  await Bun.write(path.join(dir.path, Dod.FILE), text)
  return dir
}

const alex = { id: "g-alex", name: "Alex" }
const bo = { id: "g-bo", name: "Bo" }

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const fails = <A>(effect: Effect.Effect<A, Dod.DodError>) =>
  Effect.runPromise(Effect.flip(effect)).then((error) => error.message)

describe("Dod", () => {
  test("initializes the board atomically and never overwrites project edits", async () => {
    await using dir = await tmpdir()
    const results = await Promise.all([run(Dod.initialize(dir.path)), run(Dod.initialize(dir.path))])
    expect(results.toSorted()).toEqual(["created", "existing"])

    const file = path.join(dir.path, Dod.FILE)
    const starter = await Bun.file(file).text()
    expect(starter).toContain("task_id: PROJECT-BOARD")
    expect(starter).toContain("leaves: []")

    const custom = "task_id: CUSTOM\nstages: []\nleaves: []\n"
    await Bun.write(file, custom)
    expect(await run(Dod.initialize(dir.path))).toBe("existing")
    expect(await Bun.file(file).text()).toBe(custom)
  })

  test("reads the items in file order with their step counts", async () => {
    await using dir = await project()
    const dod = await run(Dod.read(dir.path))
    expect(dod.items).toEqual([
      { id: "L-001", what: "Read the protocol", stage: "Stage 1", state: "DONE", done: 1, total: 1 },
      { id: "L-002", what: "Add the check", stage: "Stage 1", state: "NOT_STARTED", done: 1, total: 2 },
      { id: "L-003", what: "Document it", stage: "Ungrouped", state: "NOT_STARTED", done: 0, total: 0 },
    ])
  })

  test("a project without a DoD has no items", async () => {
    await using dir = await tmpdir()
    expect((await run(Dod.read(dir.path))).items).toEqual([])
  })

  test("the DoD source explicitly reports a missing board as disabled", async () => {
    await using dir = await tmpdir()
    const initial = await run(readInitial(Dod.instructions(dir.path)))
    expect(initial.text).toContain("Project DoD status: DISABLED")
    expect(initial.text.replaceAll("\\", "/")).toContain(".opencode/dod.yaml does not exist")
    expect(initial.text).not.toContain("Project DoD status: READY")
  })

  test("the DoD source is bound to each project's own root", async () => {
    await using first = await project()
    await using second = await tmpdir()
    const firstText = (await run(readInitial(Dod.instructions(first.path)))).text
    const secondText = (await run(readInitial(Dod.instructions(second.path)))).text
    expect(firstText).toContain("Project DoD status: READY")
    expect(firstText).toContain('"id": "L-001"')
    expect(secondText).toContain("Project DoD status: DISABLED")
    expect(secondText).not.toContain('"id": "L-001"')
  })

  test("a malformed DoD remains an error and never becomes ready", async () => {
    await using dir = await project("leaves: [")
    const board = await run(Dod.status(dir.path))
    expect(board).toMatchObject({ type: "error" })
    const prompt = (await run(readInitial(Dod.instructions(dir.path)))).text
    expect(prompt).toContain("Project DoD status: ERROR")
    expect(prompt).not.toContain("Project DoD status: READY")
  })

  test("taking an item edits only its owner and state lines", async () => {
    await using dir = await project()
    const dod = await run(Dod.take({ directory: dir.path, id: "L-002", owner: alex }))
    expect(dod.items[1]).toMatchObject({ id: "L-002", state: "IN_PROGRESS", owner: "Alex", ownerID: "g-alex" })
    const text = await Bun.file(path.join(dir.path, Dod.FILE)).text()
    expect(text).toBe(
      FILE.replace(
        '    task_state: NOT_STARTED\n    steps:\n      - "[x] find',
        '    task_state: IN_PROGRESS\n    owner: "Alex"\n    owner_id: "g-alex"\n    steps:\n      - "[x] find',
      ),
    )
  })

  test("two members taking the same item at once cannot both get it", async () => {
    await using dir = await project()
    const results = await Promise.all(
      [alex, bo].map((owner) =>
        Effect.runPromise(Effect.result(Dod.take({ directory: dir.path, id: "L-003", owner }))),
      ),
    )
    expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
    const holder = (await run(Dod.read(dir.path))).items.find((item) => item.id === "L-003")?.owner
    expect(
      results.find((result) => result._tag === "Success")?.success.items.find((item) => item.id === "L-003")?.owner,
    ).toBe(holder)
  })

  test("an item without task_state gets the owner at its end, before the blank line", async () => {
    await using dir = await project(FILE + '\n  - id: L-004\n    what: "Last"\n\n')
    await run(Dod.take({ directory: dir.path, id: "L-003", owner: bo }))
    const text = await Bun.file(path.join(dir.path, Dod.FILE)).text()
    expect(text).toContain(
      '  - id: L-003\n    what: "Document it"\n    owner: "Bo"\n    owner_id: "g-bo"\n    task_state: IN_PROGRESS\n\n  - id: L-004',
    )
  })

  test("someone else's or a finished item cannot be taken", async () => {
    await using dir = await project()
    await run(Dod.take({ directory: dir.path, id: "L-002", owner: alex }))
    expect(await fails(Dod.take({ directory: dir.path, id: "L-002", owner: bo }))).toBe("L-002 is taken by Alex")
    expect(await fails(Dod.take({ directory: dir.path, id: "L-001", owner: bo }))).toBe("L-001 is already done")
    expect(await fails(Dod.take({ directory: dir.path, id: "L-404", owner: bo }))).toBe("The DoD has no item L-404")
  })

  test("releasing gives the item back; only its owner or the host may", async () => {
    await using dir = await project()
    await run(Dod.take({ directory: dir.path, id: "L-003", owner: alex }))
    expect(await fails(Dod.release({ directory: dir.path, id: "L-003", owner: bo }))).toBe("L-003 is taken by Alex")
    const dod = await run(Dod.release({ directory: dir.path, id: "L-003", owner: alex }))
    expect(dod.items[2]).toEqual({
      id: "L-003",
      what: "Document it",
      stage: "Ungrouped",
      state: "NOT_STARTED",
      done: 0,
      total: 0,
    })
    // Started work stays in progress for whoever picks it up next.
    await run(Dod.take({ directory: dir.path, id: "L-002", owner: alex }))
    const host = await run(Dod.release({ directory: dir.path, id: "L-002" }))
    expect(host.items[1]).toEqual({
      id: "L-002",
      what: "Add the check",
      stage: "Stage 1",
      state: "IN_PROGRESS",
      done: 1,
      total: 2,
    })
    expect(await Bun.file(path.join(dir.path, Dod.FILE)).text()).not.toContain("owner:")
  })

  test("a namesake cannot give back or take over another member's item", async () => {
    await using dir = await project()
    await run(Dod.take({ directory: dir.path, id: "L-003", owner: alex }))
    const namesake = { id: "g-alex-2", name: "Alex" }
    expect(await fails(Dod.release({ directory: dir.path, id: "L-003", owner: namesake }))).toBe(
      "L-003 is taken by Alex",
    )
    expect(await fails(Dod.take({ directory: dir.path, id: "L-003", owner: namesake }))).toBe("L-003 is taken by Alex")
  })

  test("an item whose holder's lease ran out reads stale and passes to a new taker", async () => {
    await using dir = await project()
    await run(Dod.take({ directory: dir.path, id: "L-003", owner: alex }))
    const gone = (id: string) => id !== alex.id
    expect((await run(Dod.read(dir.path, gone))).items[2]).toMatchObject({ owner: "Alex", stale: true })
    const dod = await run(Dod.take({ directory: dir.path, id: "L-003", owner: bo, live: gone }))
    expect(dod.items[2]).toMatchObject({ owner: "Bo", ownerID: "g-bo", state: "IN_PROGRESS" })
  })

  test("an item waits for its unfinished dependencies, and next skips it", async () => {
    await using dir = await project(
      FILE.replace("    task_state: DONE\n", "    task_state: NOT_STARTED\n") +
        '\n  - id: L-004\n    what: "Ship"\n    depends_on: [L-404]\n',
    )
    expect((await run(Dod.read(dir.path))).items[1].waits).toEqual(["L-001"])
    expect(await fails(Dod.take({ directory: dir.path, id: "L-002", owner: bo }))).toBe("L-002 waits for L-001")
    // A dependency the file does not list holds nothing back.
    expect((await run(Dod.read(dir.path))).items[3].waits).toBeUndefined()
    await run(Dod.take({ directory: dir.path, id: "L-001", owner: alex }))
    expect((await run(Dod.next({ directory: dir.path, owner: bo }))).id).toBe("L-003")
    // The owner's own unfinished item comes back before a new one.
    expect((await run(Dod.next({ directory: dir.path, owner: alex }))).id).toBe("L-001")
  })

  test("releasing a member's items frees only theirs", async () => {
    await using dir = await project()
    await run(Dod.take({ directory: dir.path, id: "L-002", owner: alex }))
    await run(Dod.take({ directory: dir.path, id: "L-003", owner: bo }))
    expect(await run(Dod.releaseOwner({ directory: dir.path, ownerID: alex.id }))).toEqual(["L-002"])
    const items = (await run(Dod.read(dir.path))).items
    expect(items[1].owner).toBeUndefined()
    expect(items[2].owner).toBe("Bo")
  })

  test("the host's check records evidence and decides DONE or FAILED", async () => {
    await using dir = await project(
      FILE.replace(
        '      - "[ ] write it"\n',
        '      - "[x] write it"\n    verification:\n      state: NOT_CHECKED\n      command: "bun test x"   # the oracle\n      evidence:\n        command: "old"\n        exit_code: 1\n',
      ),
    )
    expect(await fails(Dod.command({ directory: dir.path, id: "L-002", owner: alex }))).toBe(
      "Take L-002 before submitting it; only its holder submits",
    )
    await run(Dod.take({ directory: dir.path, id: "L-002", owner: alex }))
    expect(await run(Dod.command({ directory: dir.path, id: "L-002", owner: alex }))).toBe("bun test x")
    expect(
      await fails(
        Dod.accept({
          directory: dir.path,
          id: "L-002",
          command: "bun test something-else",
          exitCode: 0,
          summary: "forged pass",
          by: "Alex",
        }),
      ),
    ).toBe('L-002 verification command mismatch; expected "bun test x"')
    expect(await fails(Dod.command({ directory: dir.path, id: "L-003", owner: alex }))).toBe(
      "Take L-003 before submitting it; only its holder submits",
    )
    const input = { directory: dir.path, id: "L-002", command: "bun test x", summary: "1 fail", by: "Alex" }
    const failed = await run(Dod.accept({ ...input, exitCode: 1 }))
    expect(failed.items[1].state).toBe("FAILED")
    const passed = await run(Dod.accept({ ...input, exitCode: 0, summary: "3 pass" }))
    expect(passed.items[1]).toMatchObject({ state: "DONE", owner: "Alex" })
    const text = await Bun.file(path.join(dir.path, Dod.FILE)).text()
    const block = text.slice(text.indexOf("    verification:"), text.indexOf("    depends_on: [L-001]"))
    expect(block).toMatch(
      /^    verification:\n      state: PASSED\n      command: "bun test x"   # the oracle\n      evidence:\n        command: "bun test x"\n        exit_code: 0\n        at: "[^"]+"\n        by: "Alex"\n        output_summary: "3 pass"\n$/,
    )
    expect(text).not.toContain("1 fail")
  })

  test("the prompt makes the AI responsible and spells out the steps of the work in hand", async () => {
    await using dir = await project()
    await run(Dod.take({ directory: dir.path, id: "L-002", owner: alex }))
    const prompt = (await run(readInitial(Dod.instructions(dir.path)))).text
    expect(prompt).toContain("You are responsible for this board")
    expect(prompt).toContain("`dod verify`")
    expect(prompt).toContain('"[ ] write it"')
    expect(prompt).not.toContain('"[x] read it"')
  })

  test("checking a step takes a free item and edits only that step's checkbox", async () => {
    await using dir = await project()
    expect(await fails(Dod.check({ directory: dir.path, id: "L-002", step: 3, checked: true, owner: alex }))).toBe(
      "L-002 has steps 1 to 2; there is no step 3",
    )
    const dod = await run(Dod.check({ directory: dir.path, id: "L-002", step: 2, checked: true, owner: alex }))
    expect(dod.items[1]).toMatchObject({ state: "IN_PROGRESS", owner: "Alex", done: 2, total: 2 })
    const text = await Bun.file(path.join(dir.path, Dod.FILE)).text()
    expect(text).toContain('      - "[x] write it"\n')
    expect(text).toContain('    what: "Add the check"   # keep this comment\n')
    expect(await fails(Dod.check({ directory: dir.path, id: "L-002", step: 1, checked: false, owner: bo }))).toBe(
      "L-002 is taken by Alex",
    )
    const unchecked = await run(Dod.check({ directory: dir.path, id: "L-002", step: 1, checked: false, owner: alex }))
    expect(unchecked.items[1].done).toBe(1)
  })

  test("blocking records the reason and unblocking takes it back", async () => {
    await using dir = await project()
    const blocked = await run(Dod.block({ directory: dir.path, id: "L-002", owner: alex, reason: "needs a key" }))
    expect(blocked.items[1]).toMatchObject({ state: "BLOCKED", owner: "Alex" })
    expect(await Bun.file(path.join(dir.path, Dod.FILE)).text()).toContain('blocked_by: "needs a key"')
    const resumed = await run(Dod.block({ directory: dir.path, id: "L-002", owner: alex }))
    expect(resumed.items[1].state).toBe("IN_PROGRESS")
    expect(await Bun.file(path.join(dir.path, Dod.FILE)).text()).not.toContain("blocked_by")
  })

  test("adding items starts a missing board and appends after the last item", async () => {
    await using dir = await tmpdir()
    const first = await run(
      Dod.add({ directory: dir.path, what: "Ship it", steps: ["build", "[x] plan"], verify: "bun test" }),
    )
    expect(first.id).toBe("L-001")
    expect(first.dod.items).toEqual([
      { id: "L-001", what: "Ship it", stage: "Ungrouped", state: "NOT_STARTED", done: 1, total: 2, verify: "bun test" },
    ])
    const second = await run(
      Dod.add({ directory: dir.path, what: 'Say "done"', group: "Stage 2", dependsOn: ["L-001"] }),
    )
    expect(second.id).toBe("L-002")
    expect(second.dod.items[1]).toMatchObject({ what: 'Say "done"', stage: "Stage 2", waits: ["L-001"] })
    expect(await fails(Dod.add({ directory: dir.path, what: "Again", id: "L-001" }))).toBe("The DoD already has L-001")

    await using existing = await project()
    const added = await run(Dod.add({ directory: existing.path, what: "Release" }))
    expect(added.id).toBe("L-004")
    expect(added.dod.items.map((item) => item.id)).toEqual(["L-001", "L-002", "L-003", "L-004"])
    const text = await Bun.file(path.join(existing.path, Dod.FILE)).text()
    expect(text.startsWith(FILE)).toBe(true)
  })

  test("detail returns an item's step lines as written", async () => {
    await using dir = await project()
    const detail = await run(Dod.detail(dir.path, "L-002"))
    expect(detail.steps).toEqual(["[x] find the spot", "[ ] write it"])
    expect(detail.item.waits).toBeUndefined()
  })
})
