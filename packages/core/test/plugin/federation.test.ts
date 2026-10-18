import { describe, expect, it } from "bun:test"
import { groupActionAllowed, hasExplicitCouncilTask } from "../../src/tool/plugin/federation"

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

  it("only authorizes a Council round from the operator's latest user message", () => {
    expect(
      hasExplicitCouncilTask([
        { type: "user", text: "setup", metadata: { "opencode-pp:group-supervisor-bootstrap": true } },
      ]),
    ).toBe(false)
    expect(
      hasExplicitCouncilTask([
        { type: "user", text: "previous task" },
        { type: "user", text: "internal result", metadata: { federation: { group: "Shop", councilRound: "council_1", complete: true } } },
      ]),
    ).toBe(false)
    expect(
      hasExplicitCouncilTask([
        { type: "user", text: "internal result", metadata: { federation: { complete: true } } },
        { type: "user", text: "Please compare the proposals and recommend an approach." },
      ]),
    ).toBe(true)
    expect(hasExplicitCouncilTask([{ type: "assistant", text: "not a user task" }])).toBe(false)
  })
})
