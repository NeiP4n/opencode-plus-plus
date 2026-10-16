import { describe, expect, test } from "bun:test"
import { renderHubHints } from "@opencode/core/hub/prompt"
import { Hub } from "@opencode/core/hub/index"

describe("renderHubHints", () => {
  test("an installed tool shows purpose, template, header and terminals", () => {
    const text = renderHubHints({
      availability: ["mlr"],
      terminals: ["bash"],
    })
    expect(text).toContain("- mlr —")
    expect(text).toContain("Show the first N rows with headers aligned")
    expect(text).toContain("mlr --icsv --opprint")
    expect(text).toContain("the hub tool")
    expect(text).toContain("Terminals: bash")
  })

  test("an installed tool is listed without any switch", () => {
    expect(renderHubHints({ availability: ["mlr"] })).toContain("- mlr —")
  })

  test("a role's Registry programs narrow the list", () => {
    const text = renderHubHints({ availability: ["mlr", "jq"], programs: ["jq"] })
    expect(text).toContain("- jq")
    expect(text).not.toContain("- mlr")
    expect(renderHubHints({ availability: ["mlr"], programs: [] })).toBe("")
  })

  test("a tool that is not installed produces nothing", () => {
    const text = renderHubHints({ availability: ["orphanedTool"] })
    expect(text).toBe("")
  })

  test("nothing installed produces nothing — prompt stays byte-identical", () => {
    expect(renderHubHints({ availability: [] })).toBe("")
  })

  test("block stays within 40 lines and 2000 characters with an explicit marker", () => {
    const tools = [
      ...new Set(Hub.all.filter((entry) => Hub.supportsPlatform(entry)).flatMap((entry) => entry.requires ?? [])),
    ]
    const text = renderHubHints({ availability: tools })
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text.split("\n").length).toBeLessThanOrEqual(40)
    expect(text).toContain("more tools — details through the hub tool")
  })

  test("terminals line appears only when terminals are given", () => {
    const without = renderHubHints({ availability: ["mlr"] })
    expect(without).not.toContain("Terminals:")
    const withTerminals = renderHubHints({
      availability: ["mlr"],
      terminals: ["bash", "nu"],
    })
    expect(withTerminals).toContain("Terminals: bash, nu")
  })

  test("programs without catalog recipes are not advertised as tools without catalog recipes", () => {
    const text = renderHubHints({
      availability: ["mlr", "orphanedTool"],
    })

    expect(text).toContain("- mlr —")
    expect(text).not.toContain("- orphanedTool")
  })

  test("eligible tools are listed in sorted order", () => {
    const text = renderHubHints({
      availability: ["mlr", "rg", "jq"],
    })
    const order = text.split("\n").filter((line) => line.startsWith("- "))
    expect(order[0]?.startsWith("- jq")).toBe(true)
    expect(order[1]?.startsWith("- mlr")).toBe(true)
    expect(order[2]?.startsWith("- rg")).toBe(true)
  })

  test.skipIf(process.platform === "win32")("entries for another OS stay out of the hints", () => {
    const windows = Hub.get("windows.processes")!
    const text = renderHubHints({ availability: ["pwsh"] })
    expect(text).not.toContain(windows.description)
  })
})
