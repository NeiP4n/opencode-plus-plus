import { describe, expect, test } from "bun:test"
import { Passport } from "@opencode/core/passport"
import { tmpdir } from "./fixture/tmpdir"

describe.skipIf(process.platform === "win32")("Passport.run", () => {
  test("returns when the command exits although it left a child in the background", async () => {
    await using dir = await tmpdir()
    const started = Date.now()
    const result = await Passport.run("echo hi; sleep 30 &", dir.path)
    expect(result.output.trim()).toBe("hi")
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  test("large command output is drained without exceeding the output limit", async () => {
    await using dir = await tmpdir()
    const result = await Passport.run(
      "i=0; while [ \"$i\" -lt 5000 ]; do printf '0123456789'; i=$((i + 1)); done",
      dir.path,
    )
    expect(result.output.length).toBeLessThanOrEqual(20_000)
    expect(result.cut).toBe(true)
    expect(result.output.endsWith("0123456789")).toBe(true)
  })

  test("an abort stops the command and everything it started", async () => {
    await using dir = await tmpdir()
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    const started = Date.now()
    await Passport.run("sleep 30 & sleep 30", dir.path, controller.signal)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
