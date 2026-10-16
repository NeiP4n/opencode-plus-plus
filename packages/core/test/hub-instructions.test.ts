import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { HubInstructions } from "@opencode/core/hub/instructions"
import { Instructions } from "@opencode/core/instructions/index"
import { tmpdir } from "./fixture/tmpdir"

// Assembles the prompt text exactly the way request assembly does: read →
// values → renderInitial. Keys whose value observed an absence are skipped,
// so a source with nothing to say must render an empty string.
const rendered = async (list: Instructions.List): Promise<string> => {
  const observed = await Effect.runPromise(Instructions.read(list))
  const values: Record<string, Schema.Json> = {}
  for (const entry of observed) {
    if (typeof entry.value === "string") values[entry.key] = entry.value
  }
  return Instructions.renderInitial(list, values)
}

describe("hub hint instructions source", () => {
  test("an installed tool reaches the rendered prompt text", async () => {
    const dir = await tmpdir()
    const list = HubInstructions.make({ directory: dir.path, availability: ["mlr"], terminals: ["bash"] })
    const text = await rendered(list)
    expect(text).toContain("- mlr —")
    expect(text).toContain("the hub tool")
    expect(text).toContain("Terminals: bash")
  })

  test("nothing installed contributes nothing — prompt stays byte-identical", async () => {
    const dir = await tmpdir()
    const list = HubInstructions.make({ directory: dir.path, availability: [], terminals: ["bash"] })
    expect(await rendered(list)).toBe("")
  })

  test("a session that may not run the hub tool is told nothing", async () => {
    const dir = await tmpdir()
    const options = { directory: dir.path, availability: ["mlr"], terminals: ["bash"] }
    const denied = [{ action: "*", resource: "*", effect: "deny" as const }]
    const allowed = [...denied, { action: "hub", resource: "*", effect: "allow" as const }]
    expect(await rendered(HubInstructions.forPermissions(denied, options))).toBe("")
    expect(await rendered(HubInstructions.forPermissions(allowed, options))).toContain("- mlr —")
    expect(await rendered(HubInstructions.forPermissions(undefined, options))).toContain("- mlr —")
  })

  test("a tool that is not installed contributes nothing", async () => {
    const dir = await tmpdir()
    const list = HubInstructions.make({ directory: dir.path, availability: [] })
    expect(await rendered(list)).toBe("")
  })

  test("changed supersedes the previous list and carries the new block", () => {
    const [source] = HubInstructions.make({ directory: "/nonexistent", availability: [] })
    const text = source.changed("old inventory", "new inventory")
    expect(text).toContain("this list replaces the previous one")
    expect(text).toContain("new inventory")
  })

  test("removed message is non-empty — requireText must not throw", () => {
    const [source] = HubInstructions.make({ directory: "/nonexistent", availability: [] })
    const text = source.removed("old inventory")
    expect((text ?? "").length).toBeGreaterThan(0)
  })
})
