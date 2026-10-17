import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { RoomDod } from "@opencode/client/promise"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { ThemeProvider } from "../../src/context/theme"
import { ToastProvider } from "../../src/ui/toast"
import { RoomDodRows } from "../../src/component/room-dod"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const board: RoomDod = {
  status: "ready",
  items: [
    { id: "auth", what: "Login works", stage: "build", state: "IN_PROGRESS", done: 1, total: 2 },
    { id: "docs", what: "Docs updated", stage: "build", state: "DONE", done: 1, total: 1 },
  ],
}

async function render(
  load: () => Promise<RoomDod>,
  roomID: () => string = () => "room",
  feed: (after: number, wait: number) => Promise<{ events: [] }> = () => new Promise(() => {}),
) {
  const [hover, setHover] = createSignal<string>()
  return testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
            <ToastProvider>
              <RoomDodRows
                id={roomID()}
                load={load}
                release={load}
                feed={feed}
                hover={hover}
                setHover={setHover}
              />
            </ToastProvider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 12 },
  )
}

async function frameWith(setup: Awaited<ReturnType<typeof render>>, text: string) {
  const started = Date.now()
  while (Date.now() - started < 3_000) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (frame.includes(text)) return frame
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for "${text}":\n${setup.captureCharFrame()}`)
}

test("a DoD that cannot be read says why instead of listing nothing", async () => {
  const setup = await render(() => Promise.reject(new Error("host unreachable")))
  try {
    const frame = await frameWith(setup, "DoD connection error")
    expect(frame).toContain("host unreachable")
  } finally {
    setup.renderer.destroy()
  }
})

test("a synchronous DoD adapter failure is rendered as a connection error", async () => {
  const setup = await render(() => {
    throw new Error("synchronous adapter failure")
  })
  try {
    const frame = await frameWith(setup, "DoD connection error")
    expect(frame).toContain("synchronous adapter failure")
  } finally {
    setup.renderer.destroy()
  }
})

test("a failed refresh keeps the board and says since when it is stale", async () => {
  const outcomes = [Promise.resolve(board)]
  const setup = await render(() => outcomes.shift() ?? Promise.reject(new Error("connection reset")))
  try {
    await frameWith(setup, "1/2")
    // The panel polls every five seconds; the second read fails.
    const frame = await waitLong(setup, "DoD response is stale")
    expect(frame).toContain("connection reset")
    expect(frame).toContain("1/2")
  } finally {
    setup.renderer.destroy()
  }
}, 12_000)

test("a state-unknown response is not presented as ready", async () => {
  const setup = await render(() => Promise.reject(new Error("Service did not answer: state unknown")))
  try {
    const frame = await frameWith(setup, "DoD state unknown")
    expect(frame).toContain("Service did not answer: state unknown")
  } finally {
    setup.renderer.destroy()
  }
})

test("a project without a DoD shows nothing, not an empty completed board", async () => {
  const setup = await render(() => Promise.resolve({ items: [], status: "disabled" as const }))
  try {
    // The answer settles within a few frames; the starting notice must be gone, not replaced.
    for (let attempt = 0; attempt < 5; attempt++) {
      await Bun.sleep(10)
      await setup.renderOnce()
    }
    const frame = setup.captureCharFrame()
    expect(frame).not.toContain("DoD")
    expect(frame).not.toContain("Everything is done.")
  } finally {
    setup.renderer.destroy()
  }
})

test("a response without an explicit state remains unknown", async () => {
  const legacy: RoomDod = { items: board.items }
  const setup = await render(() => Promise.resolve(legacy))
  try {
    const frame = await frameWith(setup, "DoD state unknown")
    expect(frame).toContain("omitted the explicit service state")
    expect(frame).toContain("1/2")
  } finally {
    setup.renderer.destroy()
  }
})

test("a recovered connection returns the panel to ready", async () => {
  const outcomes = [Promise.reject(new Error("connection reset")), Promise.resolve(board)]
  const setup = await render(() => outcomes.shift() ?? Promise.resolve(board))
  try {
    const error = await frameWith(setup, "DoD connection error")
    expect(error).toContain("connection reset")
    const recovered = await waitLong(setup, "1/2")
    expect(recovered).not.toContain("DoD connection error")
    expect(recovered).not.toContain("DoD state unknown")
  } finally {
    setup.renderer.destroy()
  }
}, 12_000)

test("switching projects ignores a late response from the previous project", async () => {
  const [roomID, setRoomID] = createSignal("first")
  let resolvePrevious!: (dod: RoomDod) => void
  const previous = new Promise<RoomDod>((resolve) => {
    resolvePrevious = resolve
  })
  const next: RoomDod = {
    status: "ready",
    items: [{ id: "new", what: "Current project task", stage: "build", state: "IN_PROGRESS", done: 0, total: 1 }],
  }
  const setup = await render(() => (roomID() === "first" ? previous : Promise.resolve(next)), roomID)
  try {
    await frameWith(setup, "DoD service is starting")
    setRoomID("second")
    const current = await frameWith(setup, "DoD 0/1")
    expect(current).not.toContain("DoD 1/2")
    resolvePrevious(board)
    await Bun.sleep(50)
    await setup.renderOnce()
    const afterLateResponse = setup.captureCharFrame()
    expect(afterLateResponse).toContain("DoD 0/1")
    expect(afterLateResponse).not.toContain("DoD 1/2")
  } finally {
    setup.renderer.destroy()
  }
})

async function waitLong(setup: Awaited<ReturnType<typeof render>>, text: string) {
  const started = Date.now()
  while (Date.now() - started < 8_000) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (frame.includes(text)) return frame
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for "${text}":\n${setup.captureCharFrame()}`)
}

test("a long poll that waited and came back empty asks again at once, so the next event is not delayed", async () => {
  const asked: number[] = []
  const setup = await render(
    async () => board,
    undefined,
    async () => {
      asked.push(Date.now())
      // the host waited for events and ran out of time
      if (asked.length === 1) await Bun.sleep(1_100)
      return asked.length > 1 ? new Promise(() => {}) : { events: [] }
    },
  )
  try {
    const started = Date.now()
    while (asked.length < 2 && Date.now() - started < 4_000) await Bun.sleep(20)
    expect(asked.length).toBe(2)
    // the second ask follows the waited one at once instead of after the retry pause
    expect(asked[1] - asked[0]).toBeLessThan(1_500)
  } finally {
    setup.renderer.destroy()
  }
}, 15_000)
