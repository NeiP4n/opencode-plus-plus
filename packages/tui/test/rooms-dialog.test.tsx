import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const room = { id: "room_lab", sessionID: "ses_lab", name: "Lab", ai: "linked", guestApprovals: false, created: 0 }

function cell(frame: string, needle: string) {
  const lines = frame.split("\n")
  const y = lines.findLastIndex((line) => line.includes(needle))
  if (y < 0) throw new Error(`no ${needle} on screen`)
  return { x: lines[y].indexOf(needle), y }
}

const URLS = [
  "http://127.0.0.1:4096",
  "http://192.168.1.5:4096",
  "http://172.17.0.1:4096",
  "http://198.18.0.1:4096",
  "http://26.10.0.2:4096",
]

async function render(
  state: string,
  urls = URLS,
  service?: NonNullable<Parameters<typeof createAppFixture>[0]>["service"],
) {
  return createAppFixture({
    service,
    width: 130,
    height: 40,
    state,
    config: { animations: false, debug: { devtools: true } },
    fetch: (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/info")
        return json({
          version: "test",
          pid: 1,
          urls,
          paths: { tmp: "/tmp" },
        })
      if (url.pathname === "/api/room") return json({ data: [room] })
      if (url.pathname === `/api/room/${room.id}/member`) return json({ data: [] })
      if (url.pathname === `/api/room/${room.id}/ban`) return json({ data: [] })
      if (url.pathname === `/api/room/${room.id}/code` && request.method === "POST")
        return json({ code: "ABCD-EFGH", expires_in: 600 })
    },
  })
}

test("Host lists reachable addresses and hands out a join code", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path)
  const bar = await setup.waitForFrame((frame) => frame.includes("+ Host") && frame.includes("+ Connect"))
  const entry = cell(bar, "+ Host")
  await setup.mockMouse.click(entry.x, entry.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("Get join code"))
  // only addresses other devices can reach, not loopback or container bridges
  expect(frame).toContain("192.168.1.5:4096")
  expect(frame).toContain("26.10.0.2:4096")
  expect(frame).not.toContain("172.17.0.1")
  expect(frame).not.toContain("198.18.0.1")
  expect(frame).not.toContain("Join by address")
  expect(frame).toContain("[ With a code ]")

  const button = cell(frame, "Get join code")
  await setup.mockMouse.click(button.x + 2, button.y)
  const issued = await setup.waitForFrame((frame) => frame.includes("ABCD-EFGH  expires in"))
  expect(issued).toContain("On the other device open Connect")
})

test("Connect searches the network in its own window and offers manual entry", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path)
  const bar = await setup.waitForFrame((frame) => frame.includes("+ Connect"))
  const entry = cell(bar, "+ Connect")
  await setup.mockMouse.click(entry.x, entry.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("Join by address"))
  expect(frame).toContain("Rooms on this network")
  expect(frame).toContain("empty if not needed")
  expect(frame).toContain("[ Search again ]")
  expect(frame).toContain("Your name")
  expect(frame).not.toContain("VPN")
  expect(frame).not.toContain("Get join code")
})

const session = {
  id: room.sessionID,
  projectID: "proj_test",
  title: "Lab",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

const guestPrompt = (id: string, name: string, text: string) => ({
  id,
  type: "user",
  text,
  time: { created: 1 },
  metadata: { room: { id: room.id, guest: { id: `guest_${id}`, name } } },
})

async function renderSession(state: string, input: { rooms: () => unknown[]; onCreate?: () => void }) {
  return createAppFixture({
    width: 170,
    height: 40,
    state,
    args: { sessionID: room.sessionID },
    config: { animations: false, debug: { devtools: true } },
    fetch: (url, request) => {
      if (url.pathname === "/api/info")
        return json({ version: "test", pid: 1, urls: ["http://192.168.1.5:4096"], paths: { tmp: "/tmp" } })
      if (url.pathname === "/api/room" && request.method === "POST") {
        input.onCreate?.()
        return json({ data: room })
      }
      if (url.pathname === "/api/room") return json({ data: input.rooms() })
      if (url.pathname === `/api/room/${room.id}/member`) return json({ data: [] })
      if (url.pathname === `/api/room/${room.id}/ban`) return json({ data: [] })
      if (url.pathname === `/api/room/${room.id}/code` && request.method === "POST")
        return json({ code: "ABCD-EFGH", expires_in: 600 })
      if (url.pathname === `/api/session/${room.sessionID}`) return json({ data: session })
      if (url.pathname === `/api/session/${room.sessionID}/message`)
        return json({
          data: [
            guestPrompt("msg_1", "Alex", "Can you check the tests?"),
            guestPrompt("msg_2", "Sam", "And the docs please"),
            guestPrompt("msg_3", "Alex", "Thanks"),
            { id: "msg_4", type: "user", text: "Host speaking", time: { created: 2 } },
          ],
          cursor: {},
        })
      if (url.pathname === `/api/session/${room.sessionID}/inbox`) return json({ data: [] })
    },
  })
}

test("a hosted session names guest authors and shows a multiplayer indicator that opens Host", async () => {
  await using state = await tmpdir()
  await using setup = await renderSession(state.path, { rooms: () => [room] })
  const frame = await setup.waitForFrame((frame) => frame.includes("Multiplayer · Lab"))
  expect(frame).toContain("Multiplayer · Lab · 2 guests")
  expect(frame).toContain("Alex · via room")
  expect(frame).toContain("Sam · via room")

  const indicator = cell(frame, "Multiplayer · Lab")
  await setup.mockMouse.click(indicator.x + 2, indicator.y)
  const host = await setup.waitForFrame((frame) => frame.includes("Get join code"))
  expect(host).toContain("New guests")
  expect(host).toContain("[ Member ]")
  expect(host).toContain("Linked rooms only")
})

test("hosting a session issues a join code at once and shows the indicator", async () => {
  await using state = await tmpdir()
  const rooms: unknown[] = []
  await using setup = await renderSession(state.path, { rooms: () => rooms, onCreate: () => rooms.push(room) })
  const bar = await setup.waitForFrame((frame) => frame.includes("+ Host") && frame.includes("+ Connect"))
  expect(bar).not.toContain("Multiplayer · Lab")
  const entry = cell(bar, "+ Host")
  await setup.mockMouse.click(entry.x, entry.y)
  // the address loads after the window opens and moves the button down
  const dialog = await setup.waitForFrame(
    (frame) => frame.includes("Host this session") && frame.includes("192.168.1.5:4096"),
  )
  const button = cell(dialog, "Host this session")
  await setup.mockMouse.click(button.x + 2, button.y)
  const issued = await setup.waitForFrame((frame) => /ABCD-EFGH {2}expires in (10:00|9:5\d)/.test(frame))
  expect(issued).toContain("New join code")
  setup.mockInput.pressEscape()
  const closed = await setup.waitForFrame((frame) => !frame.includes("New join code"))
  expect(closed).toContain("Multiplayer · Lab · 2 guests")
})

test("the Language bar item switches the bar and room windows to Russian and back", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path)
  const bar = await setup.waitForFrame((frame) => frame.includes("Language EN"))
  const entry = cell(bar, "Language EN")
  await setup.mockMouse.click(entry.x, entry.y)
  const translated = await setup.waitForFrame((frame) => frame.includes("+ Подключиться") && frame.includes("Язык RU"))
  expect(translated).toContain("Спроси что угодно…")
  expect(translated).toContain("команды")
  const connect = cell(translated, "+ Подключиться")
  await setup.mockMouse.click(connect.x, connect.y)
  const dialog = await setup.waitForFrame((frame) => frame.includes("Вход по адресу"))
  expect(dialog).toContain("Комнаты в этой сети")
})

test("a joined room opens in the main area like a session and stays in the left panel under Multiplayer", async () => {
  await using state = await tmpdir()
  const remote = { ...room, id: "room_far", sessionID: "ses_far", name: "Far lab", open: true, directory }
  const shared = { ...session, id: remote.sessionID, title: "Far lab" }
  const second = { ...session, id: "ses_second", title: "Second task" }
  const messages = [
    {
      id: "msg_1",
      type: "user",
      text: "Hello from far",
      time: { created: 0 },
      metadata: { room: { id: remote.id, guest: { id: "guest_0", name: "Ann" } } },
    },
    {
      id: "msg_2",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "test" },
      content: [
        {
          type: "tool",
          id: "tool_1",
          name: "shell",
          state: {
            status: "completed",
            input: { command: "echo from the host" },
            content: [{ type: "text", text: "ok" }],
            metadata: { shell: "bash", exit: 0 },
          },
          time: { created: 1, completed: 2 },
        },
        { type: "text", id: "text_1", text: "Done on the host." },
      ],
      time: { created: 1, completed: 2 },
    },
  ]
  const prompts: unknown[] = []
  const host = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const guest = `/api/room/${remote.id}/guest`
      if (url.pathname === "/api/room/public") return json({ host: "studio", rooms: [remote] })
      if (url.pathname === "/api/room/join" && request.method === "POST")
        return json({ token: "token", guest: { id: "guest_1", name: "Bo" }, role: "member", room: remote })
      if (url.pathname === `${guest}/session` && request.method === "GET") return json({ data: [shared, second] })
      if (url.pathname === guest)
        return json({
          room: remote,
          guest: { id: "guest_1", name: "Bo" },
          role: "member",
          session: url.searchParams.get("sessionID") === second.id ? second : shared,
        })
      if (url.pathname === `${guest}/session/message`) return json({ data: messages.toReversed(), cursor: {} })
      if (url.pathname === `${guest}/message`)
        return json({ data: [], running: false, note: { name: "release-plan", title: "Release plan" } })
      if (url.pathname === `${guest}/note`)
        return json({
          data: {
            name: "release-plan",
            frontmatter: { title: "Release plan", status: "active", tags: [], created: 0, updated: 0 },
            body: "Ship the notes canvas.",
            mtime: 1,
          },
        })
      if (url.pathname === `${guest}/permission`) return json({ data: [] })
      if (url.pathname === `${guest}/dod`) return json({ items: [], status: "disabled" })
      if (url.pathname === `${guest}/feed`) return json({ events: [] })
      if (url.pathname === `${guest}/prompt` && request.method === "POST") {
        prompts.push(await request.json())
        return json({ data: {} })
      }
      // The log replays history up to log.synced, then follows; this host has nothing new to say.
      if (url.pathname === `${guest}/log`) return followLog(shared.id, 2)
      return new Response(null, { status: 404 })
    },
  })
  try {
    await using setup = await render(state.path)
    const bar = await setup.waitForFrame((frame) => frame.includes("+ Connect"))
    const entry = cell(bar, "+ Connect")
    await setup.mockMouse.click(entry.x, entry.y)
    const dialog = await setup.waitForFrame((frame) => frame.includes("Join by address"))
    const address = cell(dialog, "e.g. 192.168.1.5")
    await setup.mockMouse.click(address.x, address.y)
    await setup.mockInput.typeText(`127.0.0.1:${host.port}`)
    setup.mockInput.pressEnter()

    // the host's transcript as the session view draws it: the prompt, the tool call and the answer
    const joined = await setup.waitForFrame(
      (frame) =>
        frame.includes("echo from the host") &&
        frame.includes("Done on the host.") &&
        !frame.includes("Join by address"),
    )
    expect(joined).toContain("Hello from far")
    expect(joined).toContain("Multiplayer")
    expect(joined).toContain("[Member]")
    // the right panel tells what the session is and who may change it
    expect(joined).toMatch(/Role +Member/)
    expect(joined).toContain("The host or a cohost picks")
    // A separate section below the projects: hosted sessions and joined rooms, each marked as multiplayer.
    expect(joined).toContain("Multiplayer")
    expect(joined).toContain("+ Host")
    expect(joined).toContain("+ Connect")
    expect(joined).toMatch(/[⇄↔] Lab +×/)
    expect(joined).toContain("Far lab")
    expect(joined).toContain(`:${host.port}`)

    await setup.mockInput.typeText("next step please")
    setup.mockInput.pressEnter()
    await setup.waitFor(() => prompts.length > 0)
    // the client mints the message ID, so its message shows before the host answers
    expect(prompts).toEqual([{ id: expect.stringMatching(/^msg_/), text: "next step please", sessionID: shared.id }])

    // a project room lists its sessions under the room; another one opens and takes the prompts
    const listed = await setup.waitForFrame((frame) => frame.includes("Second task") && frame.includes("+ New session"))
    const row = cell(listed, "Second task")
    await setup.mockMouse.click(row.x + 1, row.y)
    await setup.waitForFrame((frame) => /Second task/.test(frame.split("\n").slice(0, 3).join("\n")))
    await setup.mockInput.typeText("over here")
    setup.mockInput.pressEnter()
    await setup.waitFor(() => prompts.length > 1)
    expect(prompts[1]).toEqual({ id: expect.stringMatching(/^msg_/), text: "over here", sessionID: second.id })

    // the note the room writes into opens in place of the transcript
    const chip = await setup.waitForFrame((frame) => frame.includes("Note: Release"))
    const read = cell(chip, "Read note")
    await setup.mockMouse.click(read.x + 1, read.y)
    await setup.waitForFrame((frame) => frame.includes("Ship the notes canvas.") && frame.includes("Back to chat"))
  } finally {
    await host.stop()
  }
})

test("the classic Windows console gets drawable stand-ins for the panel's symbols", async () => {
  process.env.OPENCODE_BASIC_SYMBOLS = "1"
  try {
    await using state = await tmpdir()
    await using setup = await render(state.path)
    const frame = await setup.waitForFrame((frame) => frame.includes("+ Connect"))
    expect(frame).toContain("↔ Multiplayer")
    expect(frame).not.toContain("⇄")
    expect(frame).toContain("√ Server")
  } finally {
    delete process.env.OPENCODE_BASIC_SYMBOLS
  }
})

test("Host says how to open the server to the network when it only listens on this computer", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path, ["http://127.0.0.1:4096"])
  const bar = await setup.waitForFrame((frame) => frame.includes("+ Host"))
  const entry = cell(bar, "+ Host")
  await setup.mockMouse.click(entry.x + 2, entry.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("only listens on this machine"))
  expect(frame).toContain("service set hostname 0.0.0.0")
  expect(frame).not.toContain("127.0.0.1:4096")
})

test("Host still shows virtual adapter addresses when nothing else listens, with a warning", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path, ["http://127.0.0.1:4096", "http://172.20.3.4:4096"])
  const bar = await setup.waitForFrame((frame) => frame.includes("+ Host"))
  const entry = cell(bar, "+ Host")
  await setup.mockMouse.click(entry.x + 2, entry.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("172.20.3.4:4096"))
  expect(frame).toContain("Only virtual adapters")
})

test("Host opens a loopback-only service to the network with one click", async () => {
  await using state = await tmpdir()
  const urls = ["http://127.0.0.1:4096"]
  let opened = 0
  await using setup = await render(state.path, urls, (endpoint) => ({
    reconnect: async () => endpoint,
    restart: async () => {},
    openToNetwork: async () => {
      opened += 1
      urls.push("http://192.168.1.5:4096")
    },
  }))
  const bar = await setup.waitForFrame((frame) => frame.includes("+ Host"))
  const entry = cell(bar, "+ Host")
  await setup.mockMouse.click(entry.x + 2, entry.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("Open to the network"))
  expect(frame).not.toContain("service set hostname")
  const button = cell(frame, "Open to the network")
  await setup.mockMouse.click(button.x + 2, button.y)
  await setup.waitForFrame((frame) => frame.includes("192.168.1.5:4096"))
  expect(opened).toBe(1)
})

test("room management separates participants from safety rules and exposes guest restrictions", async () => {
  await using state = await tmpdir()
  const updates: unknown[] = []
  let savedRules: Record<string, unknown> = {}
  await using setup = await createAppFixture({
    width: 130,
    height: 40,
    state: state.path,
    config: { animations: false, debug: { devtools: true } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/room" && request.method === "GET")
        return json({ data: [{ ...room, rules: savedRules }] })
      if (url.pathname === `/api/room/${room.id}/dod`) return json({ items: [], status: "ready" })
      if (url.pathname === `/api/room/${room.id}/feed`) return json({ events: [] })
      if (url.pathname === `/api/room/${room.id}/member`) return json({ data: [] })
      if (url.pathname === `/api/room/${room.id}/ban`) return json({ data: [] })
      if (url.pathname === `/api/room/${room.id}` && request.method === "PATCH") {
        const body = await request.json() as { rules?: Record<string, unknown> }
        updates.push(body)
        savedRules = body.rules ?? savedRules
        return json({ data: { ...room, rules: savedRules } })
      }
      if (url.pathname.startsWith(`/api/room/${room.id}/`)) return new Response(null, { status: 204 })
    },
  })
  const bar = await setup.waitForFrame((frame) => frame.includes("+ Host"))
  const host = cell(bar, "+ Host")
  await setup.mockMouse.click(host.x, host.y)
  const overview = await setup.waitForFrame((frame) => frame.includes("Safety rules") && frame.includes("Participants"))
  expect(overview).toContain("Room management")
  const line = overview.split("\n").findIndex((item) => item.includes("Safety rules"))
  await setup.mockMouse.click(overview.split("\n")[line].indexOf("Open") + 1, line)
  const rules = await setup.waitForFrame((frame) => frame.includes("Guest prompts") && frame.includes("Guest commands"))
  expect(rules).toContain("Privacy & visibility")
  expect(rules).toContain("Command & file restrictions")
  expect(rules).toContain("Off-limits files")
  const promptsLine = rules.split("\n").findIndex((item) => item.includes("Guest prompts"))
  await setup.mockMouse.click(rules.split("\n")[promptsLine].indexOf("Allowed") + 1, promptsLine)
  await setup.waitFor(() => updates.length > 0)
  expect(updates[0]).toEqual({ rules: { denyGuestPrompts: true } })
})

test("Participants under Multiplayer lists guests, steps their role and removes or bans them", async () => {
  await using state = await tmpdir()
  const calls: { method: string; path: string; body?: unknown }[] = []
  const members = [
    { id: "guest_1", name: "Ann", role: "member", joined: 0, online: true, address: "192.168.1.7" },
    { id: "guest_2", name: "Sam", role: "viewer", joined: 1, online: false },
  ]
  await using setup = await createAppFixture({
    width: 130,
    height: 40,
    state: state.path,
    config: { animations: false, debug: { devtools: true } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/room") return json({ data: [room] })
      if (url.pathname === `/api/room/${room.id}/dod`) return json({ items: [], status: "ready" })
      if (url.pathname === `/api/room/${room.id}/feed`) return json({ events: [] })
      if (url.pathname.startsWith(`/api/room/${room.id}/`) && request.method !== "GET")
        calls.push({
          method: request.method,
          path: url.pathname,
          body: request.method === "PATCH" ? await request.json() : undefined,
        })
      if (url.pathname === `/api/room/${room.id}/member` && request.method === "GET") return json({ data: members })
      if (url.pathname === `/api/room/${room.id}/ban`)
        return json({ data: [{ id: "ban_1", name: "Max", created: 0, device: "dev-9" }] })
      if (url.pathname.startsWith(`/api/room/${room.id}/member/`) && request.method === "PATCH")
        return json({ data: members[0] })
      if (url.pathname.startsWith(`/api/room/${room.id}/`)) return new Response(null, { status: 204 })
    },
  })
  const frame = await setup.waitForFrame((frame) => frame.includes("Participants") && frame.includes("Sam"))
  expect(frame).toContain("1/2 online")
  expect(frame).toMatch(/● Ann[ \t]+\[Member\][ \t]+×[ \t]+ban/)
  expect(frame).toMatch(/○ Sam[ \t]+\[Viewer\][ \t]+×[ \t]+ban/)
  expect(frame).toMatch(/Max +unban/)

  const lines = frame.split("\n")
  const ann = lines.findIndex((line) => line.includes("● Ann"))
  await setup.mockMouse.click(lines[ann].indexOf("[Member]") + 2, ann)
  await setup.waitFor(() => calls.some((call) => call.method === "PATCH"))
  expect(calls.find((call) => call.method === "PATCH")).toEqual({
    method: "PATCH",
    path: `/api/room/${room.id}/member/guest_1`,
    body: { role: "helper" },
  })

  // removing asks twice
  const sam = lines.findIndex((line) => line.includes("○ Sam"))
  await setup.mockMouse.click(lines[sam].indexOf("×"), sam)
  const armed = await setup.waitForFrame((frame) => frame.includes("Kick?"))
  expect(calls.some((call) => call.method === "DELETE")).toBe(false)
  const sure = cell(armed, "Kick?")
  await setup.mockMouse.click(sure.x + 1, sure.y)
  await setup.waitFor(() => calls.some((call) => call.method === "DELETE"))
  expect(calls.find((call) => call.method === "DELETE")?.path).toBe(`/api/room/${room.id}/member/guest_2`)
})

// The room log as a following server sends it: the replay ends at log.synced and the stream stays open.
function followLog(aggregateID: string, seq: number) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify({ type: "log.synced", aggregateID, seq })}\n\n`),
      )
    },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream" } })
}

test("a joined room its host closed shows why and can be left without a crash", async () => {
  await using state = await tmpdir()
  const remote = { ...room, id: "room_gone", sessionID: "ses_gone", name: "Gone lab", open: true }
  const left: string[] = []
  const host = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (request.method === "DELETE") left.push(url.pathname)
      if (url.pathname === "/api/room/public") return json({ host: "studio", rooms: [remote] })
      if (url.pathname === "/api/room/join" && request.method === "POST")
        return json({ token: "token", guest: { id: "guest_1", name: "Bo" }, role: "member", room: remote })
      // the host closed the room after this guest joined
      return json(
        { _tag: "RoomNotFoundError", roomID: remote.id, message: `Room not found: ${remote.id}` },
        { status: 404 },
      )
    },
  })
  try {
    await using setup = await render(state.path)
    const bar = await setup.waitForFrame((frame) => frame.includes("+ Connect"))
    const entry = cell(bar, "+ Connect")
    await setup.mockMouse.click(entry.x, entry.y)
    const dialog = await setup.waitForFrame((frame) => frame.includes("Join by address"))
    const address = cell(dialog, "e.g. 192.168.1.5")
    await setup.mockMouse.click(address.x, address.y)
    await setup.mockInput.typeText(`127.0.0.1:${host.port}`)
    setup.mockInput.pressEnter()

    const gone = await setup.waitForFrame((frame) => frame.includes("Room not found"))
    expect(gone).toContain("Gone lab")
    expect(gone).toContain("Room not found")
    // a few polls later the app still runs
    await Bun.sleep(4500)
    expect(setup.captureCharFrame()).toContain("Room not found")

    const leave = cell(setup.captureCharFrame(), "×")
    await setup.mockMouse.click(leave.x, leave.y)
    await setup.waitForFrame((frame) => frame.includes("leave?"))
    const sure = cell(setup.captureCharFrame(), "leave?")
    await setup.mockMouse.click(sure.x + 1, sure.y)
    await setup.waitForFrame((frame) => !frame.includes("Gone lab"))
    // leaving tells the host, even one that no longer answers
    await setup.waitFor(() => left.length > 0)
    expect(left).toEqual([`/api/room/${remote.id}/guest`])
  } finally {
    await host.stop()
  }
})

test("the red cross on a hosted room closes it after a second click", async () => {
  await using state = await tmpdir()
  const closed: string[] = []
  await using setup = await createAppFixture({
    width: 130,
    height: 40,
    state: state.path,
    config: { animations: false, debug: { devtools: true } },
    fetch: (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/room") return json({ data: closed.length ? [] : [room] })
      if (url.pathname === `/api/room/${room.id}/member`) return json({ data: [] })
      if (url.pathname === `/api/room/${room.id}/ban`) return json({ data: [] })
      if (url.pathname === `/api/room/${room.id}` && request.method === "DELETE") {
        closed.push(room.id)
        return new Response(null, { status: 204 })
      }
    },
  })
  const tree = await setup.waitForFrame((frame) => /[⇄↔] Lab +×/.test(frame))
  const row = tree.split("\n").findIndex((line) => /[⇄↔] Lab/.test(line))
  await setup.mockMouse.click(tree.split("\n")[row].indexOf("×"), row)
  const armed = await setup.waitForFrame((frame) => frame.includes("close?"))
  expect(closed).toEqual([])
  const sure = cell(armed, "close?")
  await setup.mockMouse.click(sure.x + 1, sure.y)
  await setup.waitFor(() => closed.length > 0)
  await setup.waitForFrame((frame) => !/[⇄↔] Lab +×/.test(frame))
})

test("a hosted room shows its project's DoD with who took each item, and the host frees one after a second click", async () => {
  await using state = await tmpdir()
  const freed: unknown[] = []
  const items = () => [
    { id: "L-001", what: "Write the parser", stage: "Stage 1", state: "DONE", done: 2, total: 2 },
    {
      id: "L-002",
      what: "Add the check",
      stage: "Stage 1",
      state: "IN_PROGRESS",
      done: 1,
      total: 3,
      ...(freed.length ? {} : { owner: "Alex" }),
    },
    { id: "L-003", what: "Document it", stage: "Stage 2", state: "NOT_STARTED", done: 0, total: 0 },
  ]
  await using setup = await createAppFixture({
    width: 130,
    height: 40,
    state: state.path,
    config: { animations: false, debug: { devtools: true } },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/room") return json({ data: [room] })
      if (url.pathname === `/api/room/${room.id}/member`) return json({ data: [] })
      if (url.pathname === `/api/room/${room.id}/ban`) return json({ data: [] })
      if (url.pathname === `/api/room/${room.id}/dod`) return json({ items: items() })
      if (url.pathname === `/api/room/${room.id}/dod/release` && request.method === "POST") {
        freed.push(await request.json())
        return json({ items: items() })
      }
    },
  })
  const tree = await setup.waitForFrame((frame) => /DoD 1\/3 · 1 taken/.test(frame))
  // finished items only count toward the bar; the open ones list under it
  const heading = cell(tree, "DoD")
  await setup.mockMouse.click(heading.x, heading.y)
  const open = await setup.waitForFrame((frame) => frame.includes("● L-002") && frame.includes("1/3 Alex ×"))
  expect(open).toContain("· L-003 Document it")
  expect(open).not.toContain("L-001")
  const cross = open.split("\n")[cell(open, "Alex").y].indexOf("×", cell(open, "Alex").x)
  await setup.mockMouse.click(cross, cell(open, "Alex").y)
  const armed = await setup.waitForFrame((frame) => frame.includes("free?"))
  expect(freed).toEqual([])
  const sure = cell(armed, "free?")
  await setup.mockMouse.click(sure.x + 1, sure.y)
  await setup.waitFor(() => freed.length > 0)
  expect(freed).toEqual([{ id: "L-002" }])
  await setup.waitForFrame(
    (frame) => !frame.includes("Alex") && frame.includes("DoD 1/3 ███") && frame.includes("● L-002"),
  )
})
