import { describe, expect, test } from "bun:test"
import { renderHubHints } from "@opencode/core/hub/prompt"
import type { State } from "@opencode/core/hub/state"
import { Hub } from "@opencode/core/hub/index"

const stateOf = (enabled: Record<string, boolean>): State => ({ version: 1, enabled })

describe("renderHubHints", () => {
  test("enabled and available tool shows purpose, template, header and terminals", () => {
    const text = renderHubHints({
      state: stateOf({ mlr: true }),
      availability: ["mlr"],
      terminals: ["bash"],
    })
    expect(text).toContain("- mlr —")
    expect(text).toContain("Show the first N rows with headers aligned")
    expect(text).toContain("mlr --icsv --opprint")
    expect(text).toContain("the hub tool")
    expect(text).toContain("Terminals: bash")
  })

  test("an installed tool is listed without any switch, even one left off", () => {
    expect(renderHubHints({ state: stateOf({}), availability: ["mlr"] })).toContain("- mlr —")
    expect(renderHubHints({ state: stateOf({ mlr: false }), availability: ["mlr"] })).toContain("- mlr —")
  })

  test("a tool that is not installed produces nothing", () => {
    const text = renderHubHints({ state: stateOf({ mlr: true }), availability: ["orphanedTool"] })
    expect(text).toBe("")
  })

  test("nothing installed produces nothing — prompt stays byte-identical", () => {
    expect(renderHubHints({ state: stateOf({}), availability: [] })).toBe("")
  })

  test("block stays within 40 lines and 2000 characters with an explicit marker", () => {
    const tools = [
      ...new Set(Hub.all.filter((entry) => Hub.supportsPlatform(entry)).flatMap((entry) => entry.requires ?? [])),
    ]
    const enabled = Object.fromEntries(tools.map((tool) => [tool, true]))
    const text = renderHubHints({ state: stateOf(enabled), availability: tools })
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text.split("\n").length).toBeLessThanOrEqual(40)
    expect(text).toContain("more tools — details through the hub tool")
  })

  test("terminals line appears only when terminals are given", () => {
    const without = renderHubHints({ state: stateOf({ mlr: true }), availability: ["mlr"] })
    expect(without).not.toContain("Terminals:")
    const withTerminals = renderHubHints({
      state: stateOf({ mlr: true }),
      availability: ["mlr"],
      terminals: ["bash", "nu"],
    })
    expect(withTerminals).toContain("Terminals: bash, nu")
  })

  test("stale enabled keys are not advertised as tools without catalog recipes", () => {
    const text = renderHubHints({
      state: stateOf({ mlr: true, orphanedTool: true }),
      availability: ["mlr", "orphanedTool"],
    })

    expect(text).toContain("- mlr —")
    expect(text).not.toContain("- orphanedTool")
  })

  test("eligible tools are listed in sorted order", () => {
    const text = renderHubHints({
      state: stateOf({ mlr: true, rg: true, jq: true }),
      availability: ["mlr", "rg", "jq"],
    })
    const order = text.split("\n").filter((line) => line.startsWith("- "))
    expect(order[0]?.startsWith("- jq")).toBe(true)
    expect(order[1]?.startsWith("- mlr")).toBe(true)
    expect(order[2]?.startsWith("- rg")).toBe(true)
  })

  test.skipIf(process.platform === "win32")("entries for another OS stay out of the hints", () => {
    const windows = Hub.get("windows.processes")!
    const text = renderHubHints({ state: stateOf({ pwsh: true }), availability: ["pwsh"] })
    expect(text).not.toContain(windows.description)
  })
})
