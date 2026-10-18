import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkspaceForgeTool } from "@opencode/core/tool/plugin/workspace-forge"

const decode = Schema.decodeUnknownSync(WorkspaceForgeTool.Input)

describe("workspace forge input", () => {
  test("accepts explicit sandbox modes for workspace creation", () => {
    for (const sandbox of ["none", "environment", "strict"] as const) {
      expect(
        decode({
          action: "create_session",
          directory: "/work/project",
          sandbox,
        }),
      ).toMatchObject({ action: "create_session", directory: "/work/project", sandbox })
    }
  })

  test("accepts group members that mix existing projects with newly configured workspaces", () => {
    expect(
      decode({
        action: "create_group",
        name: "mobile-platform",
        members: [
          { projectID: "prj_existing" },
          { name: "Android app", directory: "/work/android", team: "mobile-app", sandbox: "strict" },
          { name: "API", directory: "/work/api", team: "backend", sandbox: "none" },
        ],
        link: false,
      }),
    ).toMatchObject({
      action: "create_group",
      name: "mobile-platform",
      members: [
        { projectID: "prj_existing" },
        { name: "Android app", directory: "/work/android", team: "mobile-app", sandbox: "strict" },
        { name: "API", directory: "/work/api", team: "backend", sandbox: "none" },
      ],
      link: false,
    })
  })

  test("rejects unsupported actions and sandbox modes", () => {
    expect(() => decode({ action: "delete_all" })).toThrow()
    expect(() => decode({ action: "create_session", directory: "/work/project", sandbox: "unconfined" })).toThrow()
  })

  test("rejects a missing group-member list at the tool boundary when the shape is required by callers", () => {
    const input = decode({ action: "create_group", name: "empty-group" })
    expect(input.members).toBeUndefined()
  })
})
