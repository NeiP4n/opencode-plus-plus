import { describe, expect, test } from "bun:test"
import { Hub } from "@opencode/core/hub/index"
import type { State } from "@opencode/core/hub/state"

const stateOf = (enabled: Record<string, boolean>): State => ({ version: 1, enabled })

const entry = (id: string, requires?: readonly string[]): Hub.Entry => ({
  id,
  title: id,
  description: id,
  category: "search",
  ...(requires === undefined ? {} : { requires }),
  templates: { bash: "true" },
})

describe("hub visibility", () => {
  test("every installed tool is hinted unless the role's list leaves it out", () => {
    expect(Hub.hinted(stateOf({}), "rg")).toBe(true)
    // the old per-tool switch no longer hides anything
    expect(Hub.hinted(stateOf({ rg: false }), "rg")).toBe(true)
    expect(Hub.hinted(stateOf({}), "rg", ["rg", "jq"])).toBe(true)
    expect(Hub.hinted(stateOf({}), "rg", ["jq"])).toBe(false)
    expect(Hub.hinted(stateOf({}), "rg", [])).toBe(false)
  })

  test("an entry is discoverable when the role may use every tool it needs", () => {
    const entryWithRg = entry("search.content", ["rg"])
    expect(Hub.discoverable(stateOf({ rg: false }), entryWithRg)).toBe(true)
    expect(Hub.discoverable(stateOf({}), entryWithRg, ["rg"])).toBe(true)
    expect(Hub.discoverable(stateOf({}), entryWithRg, ["fd"])).toBe(false)
  })

  test("an entry with no requirements is never withdrawn", () => {
    const coreutils = entry("files.remove")
    expect(Hub.discoverable(stateOf({}), coreutils, [])).toBe(true)
  })

  test("one tool outside the role's list is enough to withdraw an entry that needs several", () => {
    const multi = entry("data.join", ["mlr", "jq"])
    expect(Hub.discoverable(stateOf({}), multi, ["mlr", "jq"])).toBe(true)
    expect(Hub.discoverable(stateOf({}), multi, ["mlr"])).toBe(false)
  })

  test("without a role list the whole catalog is listed", () => {
    expect(Hub.all.filter((item) => Hub.discoverable(stateOf({}), item)).length).toBe(Hub.all.length)
  })
})
