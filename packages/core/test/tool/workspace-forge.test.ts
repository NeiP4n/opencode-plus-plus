import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkspaceForgeTool } from "@opencode/core/tool/plugin/workspace-forge"
import { Orchestra } from "@opencode/schema/orchestra"

const decode = Schema.decodeUnknownSync(WorkspaceForgeTool.Input)

describe("workspace forge input", () => {
  test("Group Orchestrators can coordinate only through approval-checked federation", () => {
    expect(Orchestra.groupSupervisorPermissions()).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "federation", resource: "*", effect: "ask" },
      // The chat may ask its own operator a question; everything else still goes through federation approval.
      { action: "question", resource: "*", effect: "allow" },
    ])
  })

  test("accepts sandbox modes and an individual AI role for workspace creation", () => {
    for (const sandbox of ["none", "environment", "strict"] as const) {
      expect(
        decode({
          action: "create_session",
          directory: "/work/project",
          sandbox,
          role: "backend",
        }),
      ).toMatchObject({ action: "create_session", directory: "/work/project", sandbox, role: "backend" })
    }
  })

  test("accepts group members that mix existing projects with newly configured workspaces", () => {
    expect(
      decode({
        action: "create_group",
        name: "mobile-platform",
        mode: "council",
        members: [
          { projectID: "prj_existing" },
          { name: "Android app", directory: "/work/android", team: "mobile-app", sandbox: "strict" },
          { name: "API", directory: "/work/api", role: "backend", sandbox: "none" },
        ],
        link: false,
      }),
    ).toMatchObject({
      action: "create_group",
      name: "mobile-platform",
      mode: "council",
      members: [
        { projectID: "prj_existing" },
        { name: "Android app", directory: "/work/android", team: "mobile-app", sandbox: "strict" },
        { name: "API", directory: "/work/api", role: "backend", sandbox: "none" },
      ],
      link: false,
    })
  })

  test("rejects unsupported actions and sandbox modes", () => {
    expect(() => decode({ action: "delete_all" })).toThrow()
    expect(() => decode({ action: "create_session", directory: "/work/project", sandbox: "unconfined" })).toThrow()
  })

  test("requires at least two members to create a federated group", () => {
    expect(WorkspaceForgeTool.groupMemberCountError(undefined)).toContain("at least two members")
    expect(WorkspaceForgeTool.groupMemberCountError([{ projectID: "prj_existing" }])).toContain("at least two members")
    expect(
      WorkspaceForgeTool.groupMemberCountError([
        { projectID: "prj_existing" },
        { directory: "/work/new-project" },
      ]),
    ).toBeUndefined()
  })

  test("requires the operator's coordination mode before creating a group", () => {
    expect(WorkspaceForgeTool.groupModeError(undefined)).toContain("needs mode")
    expect(WorkspaceForgeTool.groupModeError("lead")).toBeUndefined()
    expect(WorkspaceForgeTool.groupModeError("council")).toBeUndefined()
  })
})
