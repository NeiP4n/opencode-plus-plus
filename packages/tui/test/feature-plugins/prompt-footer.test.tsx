/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA, TextRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { createSignal } from "solid-js"
import { PromptFooter } from "../../src/feature-plugins/prompt/footer"

test("prompt footer separates simultaneous subagent, shell, and usage status", async () => {
  const color = RGBA.fromInts(200, 200, 200)
  const subdued = RGBA.fromInts(100, 100, 100)
  const dispatched: string[] = []
  const context = {
    location: { directory: "/workspace" },
    theme: {
      text: {
        base: color,
        muted: subdued,
      },
    },
    keymap: {
      shortcuts: (id: string) =>
        id === "session.child.first" ? ["ctrl+j"] : id === "command.palette.show" ? ["ctrl+p"] : [],
      dispatch: (id: string) => dispatched.push(id),
    },
    // The footer follows the composer's selected model to know whether a Freebuff
    // account is in use; without a selection there is nothing to show.
    ui: { model: { current: () => undefined } },
    data: {
      session: {
        family: () => ["session", "child"],
        status: (id: string) => (id === "child" ? "running" : "idle"),
        get: () => ({ id: "session", location: { directory: "/workspace" } }),
        cost: () => 1,
        message: { list: () => [] },
      },
      shell: {
        list: () => [{ metadata: { sessionID: "session" } }],
      },
      location: {
        model: { list: () => [] },
      },
    },
  } as unknown as Context
  const app = await testRender(
    () => <PromptFooter context={context} sessionID="session" mode="normal" showDetails={true} />,
    {
      width: 80,
      height: 2,
    },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("ctrl+j 1 subagent · 1 shell · $1.00")
    expect(app.captureCharFrame()).toContain("ctrl+p commands")

    await app.mockMouse.moveTo(2, 0)
    const live = app.renderer.root.getChildren()[0]?.getChildren()[0]?.getChildren()[0]
    expect(live).toBeInstanceOf(TextRenderable)
    expect((live as TextRenderable).fg.toInts()).toEqual(color.toInts())

    await app.mockMouse.click(2, 0)
    expect(dispatched).toEqual(["session.child.first"])
  } finally {
    app.renderer.destroy()
  }
})

test("prompt footer can hide details", async () => {
  const color = RGBA.fromInts(200, 200, 200)
  const context = {
    location: { directory: "/workspace" },
    theme: {
      text: {
        base: color,
        muted: color,
      },
    },
    keymap: {
      shortcuts: (id: string) => {
        if (id === "command.palette.show") return ["ctrl+p"]
        if (id === "agent.cycle") return ["shift+tab"]
        return []
      },
    },
    ui: { model: { current: () => undefined } },
    data: {
      session: {
        family: () => ["session"],
        status: () => "running",
        get: () => ({ id: "session", location: { directory: "/workspace" } }),
        cost: () => 1,
        message: {
          list: () => [
            {
              id: "message",
              type: "assistant",
              model: { providerID: "provider", id: "model" },
              tokens: { input: 1_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            },
          ],
        },
      },
      shell: { list: () => [] },
      location: {
        model: { list: () => [{ providerID: "provider", id: "model", limit: { context: 10_000 } }] },
      },
    },
  } as unknown as Context
  const [showDetails, setShowDetails] = createSignal(true)
  const [sessionID, setSessionID] = createSignal<string | undefined>("session")
  const app = await testRender(
    () => (
      <box width="100%" flexDirection="row" justifyContent="space-between" gap={2}>
        <PromptFooter
          context={context}
          sessionID={sessionID()}
          mode="normal"
          showDetails={showDetails()}
        />
      </box>
    ),
    {
      width: 80,
      height: 1,
    },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("1.0K (10%) · $1.00")
    expect(app.captureCharFrame()).toContain("ctrl+p commands")

    setShowDetails(false)
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("1.0K (10%)")
    expect(frame).not.toContain("$1.00")
    expect(frame).not.toContain("ctrl+p commands")

    setSessionID(undefined)
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("shift+tab agents")
  } finally {
    app.renderer.destroy()
  }
})

// The Freebuff account the live API answered with on 2026-10-20: 10 freebucks left of a
// daily limit of 25, 15 already spent.
const freebuffStatus = {
  loggedIn: true,
  balance: 10,
  spent: 15,
  limit: 25,
  resetIn: 8 * 60 * 60 * 1000 + 46 * 60 * 1000,
}

function freebuffContext(
  selected: { providerID: string; modelID: string } | undefined,
  committed: { providerID: string; id: string } = { providerID: "freebuff", id: "m-096e75164d" },
) {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    location: { directory: "/workspace" },
    theme: {
      text: {
        base: color,
        muted: color,
        feedback: { warning: { base: color } },
      },
    },
    keymap: { shortcuts: () => [] },
    ui: { model: { current: () => selected } },
    client: {
      rpc: {
        call: async () => ({ output: freebuffStatus }),
      },
    },
    data: {
      session: {
        family: () => ["session"],
        status: () => "idle",
        get: () => ({
          id: "session",
          location: { directory: "/workspace" },
          model: committed,
        }),
        cost: () => 0,
        message: { list: () => [] },
      },
      shell: { list: () => [] },
      location: {
        model: {
          list: () => [
            { providerID: "freebuff", id: "m-096e75164d", name: "DeepSeek V4.1 Flash 10/17" },
            { providerID: "demo", id: "first", name: "Demo model" },
          ],
        },
      },
    },
  } as unknown as Context
}

test("the footer shows the Freebuff balance for a Freebuff model", async () => {
  const app = await testRender(
    () => <PromptFooter context={freebuffContext({ providerID: "freebuff", modelID: "m-096e75164d" })} sessionID="session" mode="normal" showDetails={true} />,
    { width: 140, height: 4 },
  )

  try {
    const frame = await app.waitForFrame((frame) => frame.includes("10 freebucks"))
    expect(frame).toContain("DeepSeek V4.1 Flash 10/17")
    expect(frame).toContain("10 freebucks")
    expect(frame).toContain("15/25")
    expect(frame).toContain("reset in")
  } finally {
    app.renderer.destroy()
  }
})

test("the footer keeps the Freebuff balance away for another model", async () => {
  const app = await testRender(
    () => (
      <PromptFooter
        context={freebuffContext(
          { providerID: "demo", modelID: "first" },
          { providerID: "demo", id: "first" },
        )}
        sessionID="session"
        mode="normal"
        showDetails={true}
      />
    ),
    { width: 140, height: 4 },
  )

  try {
    await app.renderOnce()
    await Bun.sleep(50)
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).not.toContain("freebucks")
    expect(frame).not.toContain("Freebuff")
  } finally {
    app.renderer.destroy()
  }
})
