import { expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import { DesktopTool } from "@opencode/core/tool/plugin/desktop"

// Drives the real desktop helper, so it only runs where the Windows desktop is there to read.
test.skipIf(process.platform !== "win32")("one helper answers a screenshot and a window listing", async () => {
  const host = DesktopTool.makeHost()
  try {
    const started = Date.now()
    const shot = await DesktopTool.run(host, { action: "screenshot", width: 640 }, undefined)
    if (typeof shot === "string") throw new Error("expected a screenshot")
    expect(shot.width).toBe(640)
    expect(shot.screenWidth).toBeGreaterThan(0)
    expect((await stat(shot.file)).size).toBeGreaterThan(1000)
    const first = Date.now() - started
    // The second call reuses the running helper instead of starting PowerShell again.
    const again = Date.now()
    await DesktopTool.run(host, { action: "windows" }, undefined)
    expect(Date.now() - again).toBeLessThan(Math.max(first, 1500))
    // The clipboard round-trips through the same helper, quotes and Cyrillic included.
    const text = `opencode 'desktop' тест ${Date.now()}`
    await DesktopTool.run(host, { action: "clipboard", text }, undefined)
    expect(await DesktopTool.run(host, { action: "clipboard" }, undefined)).toBe(text)
  } finally {
    host.close()
  }
}, 60_000)
