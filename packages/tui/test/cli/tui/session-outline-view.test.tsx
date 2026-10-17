import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { OutlineRail } from "../../../src/routes/session/outline-view"
import type { OutlineCategory } from "../../../src/routes/session/outline"
import type { PartRef } from "../../../src/routes/session/grouping/session"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const categories: OutlineCategory[] = [
  {
    key: "u1",
    title: "Fix the login bug",
    ref: { messageID: "u1", partID: "message" },
    messageIDs: ["u1", "a1"],
    entries: [
      {
        key: "a1:t1",
        kind: "activity",
        title: "Edits 2",
        level: 1,
        ref: { messageID: "a1", partID: "t1" },
        busy: false,
      },
      {
        key: "a1:h",
        kind: "heading",
        title: "Cause",
        level: 1,
        ref: { messageID: "a1", partID: "text:0" },
        busy: false,
      },
    ],
  },
  { key: "u2", title: "Now add tests", ref: { messageID: "u2", partID: "message" }, messageIDs: ["u2"], entries: [] },
]

test("shows a dash rail that opens into clickable titles on hover", async () => {
  const jumps: PartRef[] = []
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ animations: false })}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <box width={60} height={12} position="relative">
              <OutlineRail
                categories={categories}
                active={{ category: "u2" }}
                height={10}
                maxWidth={30}
                right={0}
                onJump={(ref) => jumps.push(ref)}
              />
            </box>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 12 },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("━━"))
  const rail = app.captureCharFrame()
  expect(rail).toContain("──")
  expect(rail).toContain("━━")
  expect(rail).not.toContain("Cause")

  await app.mockMouse.moveTo(59, 0)
  await app.waitForFrame((frame) => frame.includes("Cause"))
  const panel = app.captureCharFrame()
  expect(panel).toContain("Fix the login bug")
  expect(panel).toContain("Cause")
  const lines = panel.split("\n")
  const row = lines.findIndex((line) => line.includes("Cause"))
  await app.mockMouse.click(lines[row].indexOf("Cause"), row)
  expect(jumps).toEqual([{ messageID: "a1", partID: "text:0" }])
  app.renderer.destroy()
})
