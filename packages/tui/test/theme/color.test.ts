import { describe, expect, test } from "bun:test"
import { ansiToRgba } from "../../src/theme/color"

describe("ansiToRgba", () => {
  test("keeps ANSI black readable in the dark TUI", () => {
    const color = ansiToRgba(0)
    expect(color.r).toBeGreaterThan(0.5)
    expect(color.g).toBeGreaterThan(0.5)
    expect(color.b).toBeGreaterThan(0.5)
  })

  test("uses the same readable fallback for invalid ANSI codes", () => {
    expect(ansiToRgba(256)).toEqual(ansiToRgba(0))
  })
})
