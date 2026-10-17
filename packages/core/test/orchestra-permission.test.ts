import { describe, expect, test } from "bun:test"
import { parsePermissionDecision } from "../src/orchestra"

describe("Orchestra permission decisions", () => {
  test("accepts explicit allow and deny decisions", () => {
    expect(parsePermissionDecision('{"decision":"allow","reason":"Read-only access needed for the task."}')).toEqual({
      decision: "allow",
      reason: "Read-only access needed for the task.",
    })
    expect(parsePermissionDecision('{"decision":"deny","reason":"This writes outside the project."}')).toEqual({
      decision: "deny",
      reason: "This writes outside the project.",
    })
  })

  test("accepts fenced JSON and bounds the reason length", () => {
    expect(parsePermissionDecision('Decision:\n```json\n{"decision":"allow","reason":"ok"}\n```')).toEqual({
      decision: "allow",
      reason: "ok",
    })
    expect(parsePermissionDecision(JSON.stringify({ decision: "deny", reason: "x".repeat(600) }))?.reason).toHaveLength(500)
  })

  test("never treats unclear, malformed, or unsupported decisions as approval", () => {
    expect(parsePermissionDecision("Looks safe, go ahead.")).toBeUndefined()
    expect(parsePermissionDecision('{"decision":"approve","reason":"not a supported decision"}')).toBeUndefined()
    expect(parsePermissionDecision('{"decision":"allow","reason":[]}')).toBeUndefined()
    expect(parsePermissionDecision('{"decision":"allow"}')).toBeUndefined()
    expect(parsePermissionDecision("not json")).toBeUndefined()
  })
})
