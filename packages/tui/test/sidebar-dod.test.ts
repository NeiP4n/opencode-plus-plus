import { expect, test } from "bun:test"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  DOD_PANEL,
  openDodPanel,
  parseDodBoard,
  readDodBoard,
  resolveDodRoot,
  summarizeDodBoard,
  orderDodTasks,
  filterDodTasks,
} from "../src/feature-plugins/sidebar/dod"

test("nested sessions resolve the DoD board from the nearest repository root", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "opencode-dod-root-"))
  const project = path.join(temporary, "project")
  const nested = path.join(project, "packages", "core", "src")
  try {
    await mkdir(path.join(project, ".git"), { recursive: true })
    await mkdir(nested, { recursive: true })
    await access(path.join(project, ".git"))
    expect(await resolveDodRoot(nested)).toBe(project)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test("markerless projects keep their selected directory as the DoD root", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "opencode-dod-markerless-"))
  const project = path.join(temporary, "plain-project")
  const nested = path.join(project, "src")
  try {
    await mkdir(nested, { recursive: true })
    expect(await resolveDodRoot(project)).toBe(project)
    expect(await resolveDodRoot(nested)).toBe(nested)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test("DoD progress counts only tasks with a terminal state", () => {
  const items = parseDodBoard(
    [
      "task_id: PROJECT-BOARD",
      "stages: []",
      "leaves:",
      "  - id: L-001",
      "    what: Parse the board",
      "    task_state: DONE",
      "    steps:",
      '      - "[x] parse"',
      '      - "[X] validate"',
      "  - id: L-002",
      "    what: Add tests",
      "    task_state: IN_PROGRESS",
      "    steps:",
      '      - "[x] add test"',
      '      - "[ ] run test"',
      "  - id: L-003",
      "    what: Not in scope",
      "    task_state: OUT_OF_SCOPE",
    ].join("\n"),
  )

  expect(items.map((item) => ({ id: item.id, done: item.done, total: item.total }))).toEqual([
    { id: "L-001", done: 2, total: 2 },
    { id: "L-002", done: 1, total: 2 },
    { id: "L-003", done: 0, total: 0 },
  ])
  expect(summarizeDodBoard(items)).toEqual({ finished: 2, total: 3, percent: 67 })
})

test("an empty DoD board is zero progress, not completed work", () => {
  const items = parseDodBoard("task_id: PROJECT-BOARD\nstages: []\nleaves: []")
  expect(summarizeDodBoard(items)).toEqual({ finished: 0, total: 0, percent: 0 })
})

test("malformed DoD data raises an error rather than looking like an empty board", () => {
  expect(() => parseDodBoard("nope")).toThrow("DoD must be a YAML mapping")
  expect(() => parseDodBoard("leaves: nope")).toThrow("DoD leaves must be a list")
})

test("the DoD launcher opens the registered full task panel", () => {
  const opened: string[] = []
  const context = {
    ui: {
      panel: {
        open: (name: string) => {
          opened.push(name)
          return true
        },
      },
    },
  } as unknown as Parameters<typeof openDodPanel>[0]

  expect(openDodPanel(context)).toBe(true)
  expect(opened).toEqual([DOD_PANEL])
})

test("a task carries its checklist, holder and the unfinished tasks it waits for", () => {
  const [first, second] = parseDodBoard(
    [
      "leaves:",
      "  - id: A",
      "    task_state: DONE",
      "  - id: B",
      "    what: Build it",
      "    owner: Alex",
      "    depends_on: [A, C, Z]",
      "    steps:",
      '      - "[x] write"',
      '      - "[ ] check"',
      "  - id: C",
    ].join("\n"),
  ).slice(1)
  expect(first).toMatchObject({
    id: "B",
    owner: "Alex",
    // A is done and Z is not on the board, so only C holds it back
    waits: ["C"],
    steps: [
      { text: "write", done: true },
      { text: "check", done: false },
    ],
  })
  expect(second).toMatchObject({ id: "C", waits: [], steps: [] })
})

test("active work is listed first and the filter splits unfinished from finished", () => {
  const items = parseDodBoard(
    [
      "leaves:",
      ...["DONE", "NOT_STARTED", "FAILED", "IN_PROGRESS", "BLOCKED", "OUT_OF_SCOPE"].map(
        (state, index) => `  - id: T${index}\n    task_state: ${state}`,
      ),
    ].join("\n"),
  )
  expect(orderDodTasks(items).map((item) => item.state)).toEqual([
    "FAILED",
    "BLOCKED",
    "IN_PROGRESS",
    "NOT_STARTED",
    "DONE",
    "OUT_OF_SCOPE",
  ])
  expect(filterDodTasks(items, "active").map((item) => item.id)).toEqual(["T2", "T4", "T3", "T1"])
  expect(filterDodTasks(items, "done").map((item) => item.id)).toEqual(["T0", "T5"])
  expect(filterDodTasks(items, "all")).toHaveLength(6)
})

test("a board caught mid-save is read again instead of reported broken", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "opencode-dod-read-"))
  const file = path.join(temporary, "dod.yaml")
  try {
    await writeFile(file, 'leaves:\n  - id: L-001\n    what: "half')
    setTimeout(() => void writeFile(file, 'leaves:\n  - id: L-001\n    what: "Whole"\n'), 50)
    expect((await readDodBoard(file)).map((item) => item.title)).toEqual(["Whole"])

    await writeFile(file, 'leaves:\n  - id: L-001\n    what: "still broken')
    await expect(readDodBoard(file)).rejects.toThrow()
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
