import { expect, test } from "bun:test"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"

test.each(["click", "enter", "space"] as const)(
  "choosing a topic in the chat outline by %s scrolls the chat to it",
  async (choose) => {
    await using state = await tmpdir()
    const session = {
      id: "ses_outline",
      title: "Outline fixture",
      projectID: "project",
      location: { directory },
      agent: "build",
      model: { providerID: "fixture", id: "model" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
    }
    const body = Array.from({ length: 12 }, (_, line) => `line ${line}`).join("\n\n")
    // The message endpoint pages newest first.
    const messages = Array.from({ length: 6 }, (_, index) => [
      { id: `msg_u${index}`, type: "user", text: `Request${index}`, time: { created: index * 2 } },
      {
        id: `msg_a${index}`,
        type: "assistant",
        agent: session.agent,
        model: session.model,
        time: { created: index * 2 + 1, completed: index * 2 + 1 },
        content: [{ type: "text", text: `Answer${index}\n\n${body}` }],
      },
    ])
      .flat()
      .reverse()
    await using setup = await createAppFixture({
      width: 100,
      height: 30,
      state: state.path,
      config: { animations: false, tabs: { mode: "off" }, session: { sidebar: "hide" } },
      args: { sessionID: session.id },
      fetch: (url) => {
        if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
        if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages, cursor: {} })
        if (
          url.pathname === `/api/session/${session.id}/inbox` ||
          url.pathname === `/api/session/${session.id}/permission`
        )
          return json({ data: [] })
        if (url.pathname === "/api/room/mesh") return new Response(null, { status: 503 })
        return undefined
      },
    })
    await setup.waitForFrame((frame) => frame.includes("line 11"))
    const rail = setup.captureCharFrame().split("\n")
    const top = rail.findIndex((line) => line.includes("━━"))
    expect(top).toBeGreaterThanOrEqual(0)
    await setup.mockMouse.moveTo(rail[top].indexOf("━━") + 1, top)
    const panel = (await setup.waitForFrame((frame) => frame.includes("1. Request0"))).split("\n")
    const row = panel.findIndex((line) => line.includes("1. Request0"))
    const column = panel[row].indexOf("Request0")
    // A real pointer crosses every row on its way to a title.
    for (const y of panel
      .map((_, y) => y)
      .filter((y) => y >= row && y <= top)
      .reverse()) {
      await setup.mockMouse.moveTo(column, y)
      await setup.renderOnce()
    }
    const marked = setup.captureCharFrame().split("\n")[row]
    expect(marked).toContain("› 1. Request0")
    expect(setup.captureCharFrame()).toContain("enter or space to go")
    if (choose === "click") await setup.mockMouse.click(column, row)
    if (choose === "enter") setup.mockInput.pressEnter()
    if (choose === "space") setup.mockInput.pressKey(" ")
    const jumped = await setup.waitForFrame((frame) => frame.includes("Answer0") && !frame.includes("1. Request0"))
    expect(jumped).toContain("Request0")
  },
)
