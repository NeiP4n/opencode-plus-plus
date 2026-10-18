import { describe, expect, it } from "bun:test"
import { groupActionAllowed } from "../../src/tool/plugin/federation"

describe("group-bound federation sessions", () => {
  it("keeps President read-only and prevents peer dispatch", () => {
    expect(groupActionAllowed("lead", "group_status")).toBe(true)
    expect(groupActionAllowed("lead", "send")).toBe(false)
    expect(groupActionAllowed("lead", "consult_all")).toBe(false)
    expect(groupActionAllowed("lead", "decide")).toBe(false)
  })

  it("lets Society consult every member only through the explicit council action", () => {
    expect(groupActionAllowed("council", "group_status")).toBe(true)
    expect(groupActionAllowed("council", "consult_all")).toBe(true)
    expect(groupActionAllowed("council", "send")).toBe(false)
    expect(groupActionAllowed("council", "link_group")).toBe(false)
    expect(groupActionAllowed("council", "set_policy")).toBe(false)
  })
})
