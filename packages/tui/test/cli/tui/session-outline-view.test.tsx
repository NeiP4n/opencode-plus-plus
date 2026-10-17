import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { Keymap } from "../../../src/context/keymap"
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
        title: "Edits",
        ref: { messageID: "a1", partID: "message" },
      },
      {
        key: "a1:h",
        title: "Cause",
        ref: { messageID: "a1", partID: "text:0" },
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
          <Keymap.Provider>
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
          </Keymap.Provider>
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
  expect(panel).toContain("1. Fix the login bug")
  expect(panel).toContain("2. Now add tests")
  expect(panel).toContain("Cause")
  const lines = panel.split("\n")
  const row = lines.findIndex((line) => line.includes("Cause"))
  await app.mockMouse.click(lines[row].indexOf("Cause"), row)
  expect(jumps).toEqual([{ messageID: "a1", partID: "text:0" }])
  app.renderer.destroy()
})
