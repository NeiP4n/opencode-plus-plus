import { describe, expect, test } from "bun:test"
import { Hub } from "@opencode/core/hub/index"

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
    expect(Hub.hinted("rg")).toBe(true)
    expect(Hub.hinted("rg", ["rg", "jq"])).toBe(true)
    expect(Hub.hinted("rg", ["jq"])).toBe(false)
    expect(Hub.hinted("rg", [])).toBe(false)
  })

  test("an entry is discoverable when the role may use every tool it needs", () => {
    const entryWithRg = entry("search.content", ["rg"])
    expect(Hub.discoverable(entryWithRg)).toBe(true)
    expect(Hub.discoverable(entryWithRg, ["rg"])).toBe(true)
    expect(Hub.discoverable(entryWithRg, ["fd"])).toBe(false)
  })

  test("an entry with no requirements is never withdrawn", () => {
    expect(Hub.discoverable(entry("files.remove"), [])).toBe(true)
  })

  test("one tool outside the role's list is enough to withdraw an entry that needs several", () => {
    const multi = entry("data.join", ["mlr", "jq"])
    expect(Hub.discoverable(multi, ["mlr", "jq"])).toBe(true)
    expect(Hub.discoverable(multi, ["mlr"])).toBe(false)
  })

  test("without a role list the whole catalog is listed", () => {
    expect(Hub.all.filter((item) => Hub.discoverable(item)).length).toBe(Hub.all.length)
  })
})
