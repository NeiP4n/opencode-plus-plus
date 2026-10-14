import { describe, expect, test } from "bun:test"
import type { Permission } from "@opencode/schema/permission"
import { compatibilityToolNames } from "../src/tool"

describe("Tool.compatibilityToolNames", () => {
  test("keeps schemas for every tool removed by a blanket deny while respecting explicit allows", () => {
    const tools = new Map([
      ["read", { options: { permission: "read" } }],
      ["bash", { options: { permission: "bash" } }],
      ["edit", { options: { permission: "edit" } }],
      ["custom-db", { options: { permission: "database" } }],
    ])
    const rules: Permission.Ruleset = [
      { action: "*", resource: "*", effect: "deny" },
      { action: "read", resource: "*", effect: "allow" },
    ]

    expect(compatibilityToolNames(tools, rules)).toEqual(["bash", "edit", "custom-db"])
  })

  test("does not treat scoped deny rules as whole-tool removal", () => {
    const tools = new Map([
      ["bash", { options: { permission: "bash" } }],
      ["read", { options: { permission: "read" } }],
    ])
    const rules: Permission.Ruleset = [
      { action: "bash", resource: "rm *", effect: "deny" },
      { action: "read", resource: "*.env", effect: "deny" },
    ]

    expect(compatibilityToolNames(tools, rules)).toEqual([])
  })
})
