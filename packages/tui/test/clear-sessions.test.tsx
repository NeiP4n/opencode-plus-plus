/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { SessionInfo } from "@opencode/client/promise"
import { ClearSessionsAction } from "../src/component/clear-sessions"
import { ConfigProvider } from "../src/config"
import { ThemeProvider } from "../src/context/theme"
import { emptyThemeSource } from "./fixture/fixture"
import { TestTuiContexts } from "./fixture/tui-environment"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

// The fake answers with the fields the cleanup reads; the rest of a session
// record is irrelevant here.
const SESSIONS = [{ id: "ses_a" }, { id: "ses_b" }] as unknown as SessionInfo[]

function harness(options?: { confirm?: boolean; removeFails?: boolean }) {
  const removed: string[] = []
  const toasts: Array<{ message: string; variant: string }> = []
  const confirmations: boolean[] = []
  const listed: Array<{ archived?: boolean }> = []
  const left: string[] = []
  const api = {
    list: async (query?: { archived?: boolean }) => {
      listed.push(query ?? {})
      return { data: query?.archived ? [] : SESSIONS, cursor: {} }
    },    remove: async (input: { sessionID: string }) => {
      if (options?.removeFails) throw new Error("Cannot delete the main orchestrator session")
      removed.push(input.sessionID)
    },
  }
  const confirm = async () => {
    const answer = options?.confirm ?? true
    confirmations.push(answer)
    return answer
  }
  const notify = (toast: { message: string; variant: string }) => void toasts.push(toast)
  return { api, confirm, notify, removed, toasts, confirmations, listed, left }
}

async function render(props: ReturnType<typeof harness>) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <box width="100%">
              <ClearSessionsAction
                api={props.api}
                confirm={props.confirm}
                notify={props.notify}
                currentSessionID="ses_a"
                leaveCurrentSession={() => props.left.push("left")}
              />
            </box>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 10 },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Clear all sessions"))
  return app
}

async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Expected state was not reached")
}

async function click(app: Awaited<ReturnType<typeof render>>) {
  const action = app.renderer.root.findDescendantById("project-tree.clear-sessions.action")!
  await app.mockMouse.click(action.x, action.y)
}

test("the left panel offers the clear sessions action", async () => {
  const props = harness()
  const app = await render(props)

  try {
    expect(app.captureCharFrame()).toContain("Clear all sessions")
  } finally {
    app.renderer.destroy()
  }
})

test("the action highlights while the pointer is on it", async () => {
  const props = harness()
  const app = await render(props)

  try {
    const label = () => app.renderer.root.findDescendantById("project-tree.clear-sessions.action")!
    const color = () => {
      const frame = app.captureSpans()
      for (const line of frame.lines) {
        for (const span of line.spans) {
          if (span.text.includes("Clear all sessions")) return span
        }
      }
      return undefined
    }
    const before = color()
    await app.mockMouse.moveTo(label().x, label().y)
    await app.renderOnce()
    const after = color()
    expect(after).toBeDefined()
    expect(after).not.toEqual(before)
  } finally {
    app.renderer.destroy()
  }
})

test("cancelling the confirmation keeps every session", async () => {
  const props = harness({ confirm: false })
  const app = await render(props)

  try {
    await click(app)
    await until(() => props.confirmations.length > 0)
    // The answer is read right after the dialog settles; a late removal would still be caught.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(props.confirmations).toEqual([false])
    expect(props.removed).toEqual([])
    expect(props.toasts).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("confirming deletes every session, leaves the current one and reports the count", async () => {
  const props = harness()
  const app = await render(props)

  try {
    await click(app)
    await until(() => props.toasts.length > 0)
    expect(props.removed).toEqual(["ses_a", "ses_b"])
    expect(props.left).toEqual(["left"])
    expect(props.listed.map((query) => query.archived)).toEqual([false, true])
    expect(props.toasts[0].message).toContain("Deleted 2 sessions.")
  } finally {
    app.renderer.destroy()
  }
})

test("a session the server refuses to delete is reported instead of hidden", async () => {
  const props = harness({ removeFails: true })
  const app = await render(props)

  try {
    await click(app)
    await until(() => props.toasts.length > 0)
    expect(props.removed).toEqual([])
    expect(props.toasts[0].message).toContain("Deleted 0 of 2 sessions")
  } finally {
    app.renderer.destroy()
  }
})
