/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { SidebarContext } from "../../src/feature-plugins/sidebar/context"

function context(options?: {
  cost?: number
  tokens?: number
  limit?: number
  actionColor?: boolean
  directory?: string
  openPanel?: (name: string) => boolean
}) {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    theme: {
      // Hover tokens are intentionally absent; DoD must use its visible color fallback.
      background: { base: RGBA.fromInts(20, 20, 20) },
      increase: () => RGBA.fromInts(60, 60, 60),
      text: {
        base: color,
        muted: color,
        ...(options?.actionColor === false ? {} : { action: { primary: { base: color } } }),
        feedback: { success: { base: color }, info: { base: color }, warning: { base: color }, error: { base: color } },
      },
    },
    data: {
      session: {
        get: () => ({ location: { directory: options?.directory ?? "/workspace" } }),
        cost: () => options?.cost ?? 0,
        message: {
          list: () =>
            options?.tokens
              ? [
                  {
                    id: "message",
                    type: "assistant",
                    model: { providerID: "provider", id: "model" },
                    tokens: {
                      input: options.tokens,
                      output: 0,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  },
                ]
              : [],
        },
      },
      location: {
        model: {
          list: () =>
            options?.limit ? [{ providerID: "provider", id: "model", limit: { context: options.limit } }] : [],
        },
      },
    },
    ui: {
      panel: {
        open: (name: string) => options?.openPanel?.(name) ?? true,
      },
    },
  } as unknown as Context
}

test("sidebar omits context before usage is available", async () => {
  const app = await testRender(() => <SidebarContext context={context()} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Context")
    expect(app.captureCharFrame()).not.toContain("Not measured")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar shows available context usage", async () => {
  const app = await testRender(() => <SidebarContext context={context({ tokens: 1234 })} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Context")
    expect(app.captureCharFrame()).toContain("1.2K tokens")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar shows usage against the model context limit", async () => {
  const app = await testRender(
    () => <SidebarContext context={context({ tokens: 150000, limit: 200000, cost: 1.5 })} sessionID="session" />,
    { width: 42, height: 8 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("75% used")
    expect(frame).toContain("█")
    expect(frame).toContain("150.0K / 200.0K tokens")
    expect(frame).toContain("$1.50 spent")
  } finally {
    app.renderer.destroy()
  }
})

test("only the explicit Open button launches the existing DoD task panel and keeps hover feedback without an action theme color", async () => {
  const opened: string[] = []
  const app = await testRender(
    () => (
      <SidebarContext
        context={context({
          actionColor: false,
          openPanel: (name) => {
            opened.push(name)
            return true
          },
        })}
        sessionID="session"
      />
    ),
    { width: 72, height: 12 },
  )

  try {
    await app.renderOnce()
    let frame = app.captureCharFrame()
    expect(frame).toContain("DoD")
    let lines = frame.split("\n")
    let y = lines.findIndex((line) => line.includes("DoD"))
    expect(y).toBeGreaterThanOrEqual(0)

    // The preview chevron is a separate control: it must not launch the task panel.
    const toggleX = lines[y].indexOf("▸")
    expect(toggleX).toBeGreaterThanOrEqual(0)
    app.mockMouse.click(toggleX, y)
    await app.renderOnce()
    expect(opened).toEqual([])

    // Clicking the title or progress text is informational only; only [Open] launches the panel.
    frame = app.captureCharFrame()
    lines = frame.split("\n")
    y = lines.findIndex((line) => line.includes("DoD"))
    const titleX = lines[y].indexOf("DoD")
    app.mockMouse.click(titleX, y)
    await app.renderOnce()
    expect(opened).toEqual([])

    frame = app.captureCharFrame()
    lines = frame.split("\n")
    y = lines.findIndex((line) => line.includes("DoD"))
    const openX = lines[y].indexOf("[Open]")
    expect(openX).toBeGreaterThanOrEqual(0)
    app.mockMouse.click(openX, y)
    await app.renderOnce()
    expect(opened).toEqual(["opencode.sidebar.dod"])
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar DoD progress bar reflects completed project tasks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-sidebar-dod-"))
  await mkdir(path.join(directory, ".opencode"), { recursive: true })
  await writeFile(
    path.join(directory, ".opencode", "dod.yaml"),
    [
      "stages: []",
      "leaves:",
      "  - id: L-001",
      "    what: Implement feature",
      "    task_state: DONE",
      "    steps:",
      '      - "[x] Implement"',
      "  - id: L-002",
      "    what: Verify feature",
      "    task_state: IN_PROGRESS",
      "    steps:",
      '      - "[ ] Verify"',
      "",
    ].join("\n"),
    "utf8",
  )
  const app = await testRender(
    () => <SidebarContext context={context({ directory })} sessionID="session" />,
    { width: 72, height: 16 },
  )

  try {
    const started = Date.now()
    let frame = ""
    while (Date.now() - started < 3_000) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("50%")) break
      await Bun.sleep(20)
    }
    expect(frame).toContain("DoD")
    expect(frame).toContain("1/2")
    expect(frame).toContain("50%")
    expect(frame).toContain("█")
    expect(frame).toContain("░")
  } finally {
    app.renderer.destroy()
    await rm(directory, { recursive: true, force: true })
  }
})
