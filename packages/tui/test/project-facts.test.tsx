import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"

test("the Facts bar item opens and hides the project facts window", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    width: 150,
    height: 34,
    state: state.path,
    config: { animations: false, debug: { devtools: true } },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Facts") && frame.includes("Language"))

  const click = async (text: string, last = false) => {
    const lines = setup.captureCharFrame().split("\n")
    const y = last ? lines.findLastIndex((line) => line.includes(text)) : lines.findIndex((line) => line.includes(text))
    await setup.mockMouse.click(lines[y]!.indexOf(text) + 1, y)
  }

  await click("Facts", true)
  await setup.waitForFrame(
    (frame) => frame.includes("Project facts") && frame.includes("Open a session in this project to collect"),
  )
  // Without a session there is nothing to ask, so the window offers no refresh.
  expect(setup.captureCharFrame()).not.toContain("refresh")

  await click("hide")
  await setup.waitForFrame((frame) => !frame.includes("Project facts"))
})
