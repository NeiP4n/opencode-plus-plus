import { expect } from "bun:test"
import { SessionExecution } from "@opencode/core/session/execution"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Effect, Fiber, Layer, Schedule } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { ServerRoomDiscovery } from "../src/room-discovery"
import { PORT, QUERY, decodeReply } from "@opencode/protocol/room-discovery"
import { isRoomGuestURL } from "@opencode/protocol/groups/room"
import { createSocket } from "node:dgram"
import { hostname } from "node:os"
import path from "node:path"

// Every guest path the server.room group registers (verified against the group's
// endpoint list). Each one carries a room token instead of the server credential,
// so the Authorization middleware must let it through; the room handler then
// checks the token against the one room it names.
const GUEST_PATHS = [
  "/api/room/join",
  "/api/room/public",
  "/api/room/room_1/guest",
  "/api/room/room_1/guest/session",
  "/api/room/room_1/guest/session/message",
  "/api/room/room_1/guest/session/ses_1/model",
  "/api/room/room_1/guest/session/ses_1/agent",
  "/api/room/room_1/guest/session/ses_1/command",
  "/api/room/room_1/guest/model",
  "/api/room/room_1/guest/agent",
  "/api/room/room_1/guest/command",
  "/api/room/room_1/guest/mcp",
  "/api/room/room_1/guest/log",
  "/api/room/room_1/guest/message",
  "/api/room/room_1/guest/note",
  "/api/room/room_1/guest/prompt",
  "/api/room/room_1/guest/permission",
  "/api/room/room_1/guest/permission/per_1/reply",
  "/api/room/room_1/guest/dod",
  "/api/room/room_1/guest/dod/submit",
  "/api/room/room_1/guest/feed",
]

// Host-only paths: the guest token is not a server credential, so none of these
// may skip the password check. Covers room.list/create/update/remove/code, the
// link endpoints, and every member/ban endpoint.
const HOST_PATHS = [
  "/api/room",
  "/api/room/room_1",
  "/api/room/room_1/code",
  "/api/room/link",
  "/api/room/link/remove",
  "/api/room/room_1/member",
  "/api/room/room_1/member/guest_1",
  "/api/room/room_1/member/guest_1/ban",
  "/api/room/room_1/ban",
  "/api/room/room_1/ban/ban_1",
  "/api/room/room_1/dod",
  "/api/room/room_1/dod/release",
  "/api/room/room_1/feed",
]

// Paths under /api/room/ that no endpoint registers, plus session paths. A broad
// "/api/room/<id>/guest/*" prefix would wrongly exempt these from the password;
// isRoomGuestURL must refuse every one.
const UNKNOWN_PATHS = [
  "/api/room/room_1/guest/unknown",
  "/api/room/room_1/guest/session/ses_1/unknown",
  "/api/room/room_1/guest/permission/per_1",
  "/api/room/unknown",
  "/api/room/room_1/unknown",
  "/api/room/room_1/guestX",
  "/api/session",
  "/api/session/ses_1",
  "/api/session/ses_1/message",
]

const guestURL = (path: string) => isRoomGuestURL(new URL(`http://room.test${path}`))

// Rooms only admit prompts; no model runs in these tests.
const idle = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    isActive: () => Effect.succeed(false),
    resume: () => Effect.void,
    wake: () => Effect.void,
    interrupt: () => Effect.succeed(false),
    awaitIdle: () => Effect.void,
  }),
)

const host = { authorization: `Basic ${btoa("opencode:secret")}` }

const setup = Effect.gen(function* () {
  const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-room-")))
  const handler = yield* ServerFetch.make(
    {
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
      config: { directory: tmp.path, project: false, content: "{}" },
      password: "secret",
    },
    {
      overrides: [
        SessionExecution.node.replace(makeGlobalNode({ service: SessionExecution.Service, layer: idle, deps: [] })),
      ],
    },
  )
  const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://opencode.local${path}`, {
          method: init.method ?? "GET",
          headers: { "content-type": "application/json", ...init.headers },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
      )
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : undefined }
    })
  const session = (yield* call("/api/session", {
    method: "POST",
    headers: host,
    body: { title: "Shared", location: { directory: tmp.path } },
  })).body.data
  const room = (yield* call("/api/room", {
    method: "POST",
    headers: host,
    body: { sessionID: session.id, name: "Lab" },
  })).body.data
  const code = (yield* call(`/api/room/${room.id}/code`, { method: "POST", headers: host })).body.code as string
  return { call, handler, session, room, code, directory: tmp.path }
})

it.live("isRoomGuestURL admits every registered guest route", () =>
  Effect.sync(() => {
    for (const path of GUEST_PATHS) expect(`${path} -> ${guestURL(path)}`).toBe(`${path} -> true`)
  }),
)

it.live("isRoomGuestURL refuses host routes, so a guest token is never a server credential", () =>
  Effect.sync(() => {
    for (const path of HOST_PATHS) expect(`${path} -> ${guestURL(path)}`).toBe(`${path} -> false`)
  }),
)

it.live("isRoomGuestURL refuses unregistered room paths and session paths", () =>
  Effect.sync(() => {
    for (const path of UNKNOWN_PATHS) expect(`${path} -> ${guestURL(path)}`).toBe(`${path} -> false`)
  }),
)

it.live("a join code admits a guest whose token opens only that room", () =>
  Effect.gen(function* () {
    const { call, session, room, code } = yield* setup
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)

    // codes are typed by hand, so case and separators do not matter
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code: code.toLowerCase().replace("-", " "), name: "Laptop" },
    })
    expect(joined.status).toBe(200)
    expect(joined.body.room).toMatchObject({ id: room.id, sessionID: session.id, name: "Lab" })
    const guest = { authorization: `Bearer ${joined.body.token}` }

    const view = yield* call(`/api/room/${room.id}/guest`, { headers: guest })
    expect(view.status).toBe(200)
    expect(view.body.session.id).toBe(session.id)
    expect(view.body.guest.name).toBe("Laptop")

    // the token is no server credential: the host API stays closed
    expect((yield* call("/api/session", { headers: guest })).status).toBe(401)
    expect((yield* call(`/api/session/${session.id}`, { headers: guest })).status).toBe(401)
    expect((yield* call("/api/room", { headers: guest })).status).toBe(401)
    // and it does not open another room
    const other = (yield* call("/api/room", { method: "POST", headers: host, body: { sessionID: session.id } })).body
      .data
    expect((yield* call(`/api/room/${other.id}/guest`, { headers: guest })).status).toBe(401)
    // without a token the guest routes refuse as well
    expect((yield* call(`/api/room/${room.id}/guest`)).status).toBe(401)

    // a name reaches the host's terminal and notes, so control characters stay out of it
    const escape = yield* call("/api/room/join", { method: "POST", body: { code, name: "Eve\u001b[2J" } })
    expect(escape.status).toBe(400)
    expect((yield* call("/api/room/join", { method: "POST", body: { code, name: "Eve\nhost" } })).status).toBe(400)

    // a new code retires the one before it
    const next = (yield* call(`/api/room/${room.id}/code`, { method: "POST", headers: host })).body.code as string
    expect((yield* call("/api/room/join", { method: "POST", body: { code, name: "Late" } })).status).toBe(401)
    expect((yield* call("/api/room/join", { method: "POST", body: { code: next, name: "Late" } })).status).toBe(200)
  }).pipe(Effect.scoped),
)

it.live("the room list anyone may read names only the open rooms; a closed one keeps its id but not its name", () =>
  Effect.gen(function* () {
    const { call, room } = yield* setup
    const listed = yield* call("/api/room/public")
    expect(listed.status).toBe(200)
    expect(typeof listed.body.host).toBe("string")

    // The room stays in the list, because Connect needs to offer it and to tell
    // one closed room apart from no room at all; only the name is withheld.
    expect(listed.body.rooms).toHaveLength(1)
    expect(listed.body.rooms[0].id).toBe(room.id)
    expect(listed.body.rooms[0].open).toBe(false)
    // Absent on the wire, not present-and-undefined: a stray "name": null would
    // read as a room called nothing rather than as a room whose name is private.
    expect(Object.keys(listed.body.rooms[0])).toEqual(["id", "open"])

    yield* call(`/api/room/${room.id}`, { method: "PATCH", headers: host, body: { open: true } })
    expect((yield* call("/api/room/public")).body.rooms).toEqual([{ id: room.id, name: "Lab", open: true }])
  }).pipe(Effect.scoped),
)

it.live("an open room admits guests by its ID without a code; a closed one does not", () =>
  Effect.gen(function* () {
    const { call, room } = yield* setup
    const closed = yield* call("/api/room/join", { method: "POST", body: { roomID: room.id, name: "Phone" } })
    expect(closed.status).toBe(401)

    yield* call(`/api/room/${room.id}`, { method: "PATCH", headers: host, body: { open: true } })
    expect((yield* call("/api/room/public")).body.rooms).toEqual([{ id: room.id, name: "Lab", open: true }])
    const joined = yield* call("/api/room/join", { method: "POST", body: { roomID: room.id, name: "Phone" } })
    expect(joined.status).toBe(200)
    expect(joined.body.room).toMatchObject({ id: room.id, open: true })
    const view = yield* call(`/api/room/${room.id}/guest`, {
      headers: { authorization: `Bearer ${joined.body.token}` },
    })
    expect(view.status).toBe(200)

    // anyone on the network may enter an open room, so only a code earns more than member
    yield* call(`/api/room/${room.id}`, { method: "PATCH", headers: host, body: { defaultRole: "cohost" } })
    // Trusted access must be granted to an individual member, never to every invite-code guest.
    const rejectedTrustedDefault = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { defaultRole: "trusted" },
    })
    expect(rejectedTrustedDefault.status).toBe(400)
    const open = yield* call("/api/room/join", { method: "POST", body: { roomID: room.id, name: "Stranger" } })
    expect(open.body.role).toBe("member")
    const code = (yield* call(`/api/room/${room.id}/code`, { method: "POST", headers: host })).body.code as string
    const invited = yield* call("/api/room/join", { method: "POST", body: { code, name: "Friend" } })
    expect(invited.body.role).toBe("cohost")
  }).pipe(Effect.scoped),
)

it.live("noOutbound refuses guest shell execution even for a cohost", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const configured = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { defaultRole: "cohost", rules: { noOutbound: true } },
    })
    expect(configured.status).toBe(200)
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code, name: "Remote teammate" },
    })
    expect(joined.status).toBe(200)
    const result = yield* call(`/api/room/${room.id}/guest/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${joined.body.token}` },
      body: { command: "echo harmless-looking" },
    })
    expect(result.status).toBe(403)
    expect(result.body.message).toContain("does not allow commands")
  }).pipe(Effect.scoped),
)

it.live("denyGuestCommands blocks shell execution even for a cohost", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const configured = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { defaultRole: "cohost", rules: { denyGuestCommands: true } },
    })
    expect(configured.status).toBe(200)
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code, name: "Remote teammate" },
    })
    expect(joined.status).toBe(200)
    const result = yield* call(`/api/room/${room.id}/guest/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${joined.body.token}` },
      body: { command: "echo should-not-run" },
    })
    expect(result.status).toBe(403)
    expect(result.body.message).toContain("does not allow guest command execution")
  }).pipe(Effect.scoped),
)

it.live("denyGuestPrompts blocks guest messages before they reach the host AI", () =>
  Effect.gen(function* () {
    const { call, room, code, session } = yield* setup
    const configured = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { rules: { denyGuestPrompts: true } },
    })
    expect(configured.status).toBe(200)
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code, name: "Remote teammate" },
    })
    expect(joined.status).toBe(200)
    const result = yield* call(`/api/room/${room.id}/guest/prompt`, {
      method: "POST",
      headers: { authorization: `Bearer ${joined.body.token}` },
      body: { sessionID: session.id, id: "msg_blocked_guest_prompt", text: "run this task" },
    })
    expect(result.status).toBe(403)
    expect(result.body.message).toContain("does not allow guests to prompt")
  }).pipe(Effect.scoped),
)

it.live("guest commands inherit stricter rules from another room sharing the session", () =>
  Effect.gen(function* () {
    const { call, session, room, code } = yield* setup
    const own = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { defaultRole: "cohost" },
    })
    expect(own.status).toBe(200)
    const other = yield* call("/api/room", {
      method: "POST",
      headers: host,
      body: { sessionID: session.id, name: "Restricted", rules: { noOutbound: true } },
    })
    expect(other.status).toBe(200)
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code, name: "Remote teammate" },
    })
    expect(joined.status).toBe(200)
    const result = yield* call(`/api/room/${room.id}/guest/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${joined.body.token}` },
      body: { command: "echo harmless-looking" },
    })
    expect(result.status).toBe(403)
    expect(result.body.message).toContain("does not allow commands")
  }).pipe(Effect.scoped),
)

it.live("guest prompt and command rules also block slash commands", () =>
  Effect.gen(function* () {
    const { call, room, session, code } = yield* setup
    const configured = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { defaultRole: "cohost", rules: { denyGuestPrompts: true } },
    })
    expect(configured.status).toBe(200)
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code, name: "Remote teammate" },
    })
    expect(joined.status).toBe(200)
    const guest = { authorization: `Bearer ${joined.body.token}` }
    const commandPath = `/api/room/${room.id}/guest/session/${session.id}/command`
    const promptDenied = yield* call(commandPath, {
      method: "POST",
      headers: guest,
      body: { name: "compact", text: "" },
    })
    expect(promptDenied.status).toBe(403)
    const commandsBlocked = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { rules: { denyGuestCommands: true } },
    })
    expect(commandsBlocked.status).toBe(200)
    const commandDenied = yield* call(commandPath, {
      method: "POST",
      headers: guest,
      body: { name: "compact", text: "" },
    })
    expect(commandDenied.status).toBe(403)
  }).pipe(Effect.scoped),
)

it.live("guest log replay excludes host-only session events and hidden shell output", () =>
  Effect.gen(function* () {
    const { call, handler, room, session, code, directory } = yield* setup
    const configured = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { rules: { hideExecution: true, hidePaths: true } },
    })
    expect(configured.status).toBe(200)
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code, name: "Remote teammate" },
    })
    expect(joined.status).toBe(200)
    const command = "echo private-replay-command"
    const executed = yield* call(`/api/session/${session.id}/shell`, {
      method: "POST",
      headers: host,
      body: { command },
    })
    expect(executed.status).toBe(204)
    const response = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/room/${room.id}/guest/log?follow=false`, {
          headers: { authorization: `Bearer ${joined.body.token}` },
        }),
      ),
    )
    expect(response.status).toBe(200)
    const body = yield* Effect.promise(() => response.text())
    expect(body).not.toContain("session.created")
    expect(body).not.toContain("private-replay-command")
    expect(body).not.toContain(directory)
  }).pipe(Effect.scoped),
)

it.live("hideExecution hides shell history from room guests", () =>
  Effect.gen(function* () {
    const { call, room, session, code } = yield* setup
    const configured = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { rules: { hideExecution: true } },
    })
    expect(configured.status).toBe(200)
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code, name: "Remote teammate" },
    })
    expect(joined.status).toBe(200)
    const command = "echo private-shell-command"
    const executed = yield* call(`/api/session/${session.id}/shell`, {
      method: "POST",
      headers: host,
      body: { command },
    })
    expect(executed.status).toBe(204)
    const messages = yield* call(`/api/room/${room.id}/guest/session/message`, {
      headers: { authorization: `Bearer ${joined.body.token}` },
    })
    expect(messages.status).toBe(200)
    expect(messages.body.data.some((message: { type: string }) => message.type === "shell")).toBe(false)
    expect(JSON.stringify(messages.body.data)).not.toContain("private-shell-command")
  }).pipe(Effect.scoped),
)

it.live("hideExecution removes command details from guest-visible room feed", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const configured = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { defaultRole: "cohost", rules: { hideExecution: true } },
    })
    expect(configured.status).toBe(200)
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code, name: "Remote teammate" },
    })
    expect(joined.status).toBe(200)
    const trusted = yield* call(`/api/room/${room.id}/member/${joined.body.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "trusted" },
    })
    expect(trusted.status).toBe(200)
    const guestHeaders = { authorization: `Bearer ${joined.body.token}` }
    const run = yield* call(`/api/room/${room.id}/guest/run`, {
      method: "POST",
      headers: guestHeaders,
      body: { command: "echo command-hidden-from-feed" },
    })
    expect(run.status).toBe(200)
    expect(run.body.output).toContain("command-hidden-from-feed")
    const feed = yield* call(`/api/room/${room.id}/guest/feed`, { headers: guestHeaders })
    const event = feed.body.events.find((item: { kind: string }) => item.kind === "run")
    expect(event).toBeDefined()
    expect(event.detail).toBeUndefined()
  }).pipe(Effect.scoped),
)

it.live("protected files cannot be read through guest shell commands", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const configured = yield* call(`/api/room/${room.id}`, {
      method: "PATCH",
      headers: host,
      body: { defaultRole: "cohost", rules: { protectedFiles: [".env*"] } },
    })
    expect(configured.status).toBe(200)
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code, name: "Remote teammate" },
    })
    expect(joined.status).toBe(200)
    const result = yield* call(`/api/room/${room.id}/guest/run`, {
      method: "POST",
      headers: { authorization: `Bearer ${joined.body.token}` },
      body: { command: "cat .env.local" },
    })
    expect(result.status).toBe(403)
    expect(result.body.message).toContain("keeps that file off limits")
  }).pipe(Effect.scoped),
)

it.live("hidePaths redacts project directories from guest room responses", () =>
  Effect.gen(function* () {
    const { call, session, directory } = yield* setup
    const created = yield* call("/api/room", {
      method: "POST",
      headers: host,
      body: { sessionID: session.id, name: "Private project", directory, rules: { hidePaths: true } },
    })
    expect(created.status).toBe(200)
    const room = created.body.data
    const code = (yield* call(`/api/room/${room.id}/code`, { method: "POST", headers: host })).body.code as string
    const joined = yield* call("/api/room/join", {
      method: "POST",
      body: { code, name: "Remote teammate" },
    })
    expect(joined.status).toBe(200)
    expect(joined.body.room.directory).toBe("<project>")
    const view = yield* call(`/api/room/${room.id}/guest`, {
      headers: { authorization: `Bearer ${joined.body.token}` },
    })
    expect(view.status).toBe(200)
    expect(JSON.stringify(view.body)).not.toContain(directory)
  }).pipe(Effect.scoped),
)

it.live("the discovery responder answers a broadcast query with name and port", () =>
  Effect.gen(function* () {
    yield* ServerRoomDiscovery.respond(4321)
    const reply = yield* Effect.promise(
      () =>
        new Promise<string>((resolve) => {
          const socket = createSocket("udp4")
          socket.on("message", (message) => {
            socket.close()
            resolve(message.toString())
          })
          socket.bind(0, () => socket.send(QUERY, PORT, "127.0.0.1"))
        }),
    )
    expect(decodeReply(reply)).toEqual({ name: hostname(), port: 4321 })
  }).pipe(Effect.scoped),
)

it.live("a wrong code is refused and a forged token does not verify", () =>
  Effect.gen(function* () {
    const { call, room } = yield* setup
    const wrong = yield* call("/api/room/join", { method: "POST", body: { code: "AAAA-AAAA", name: "Phone" } })
    expect(wrong.status).toBe(401)
    const forged = { authorization: `Bearer ${room.id}.guest.9999999999.UGhvbmU.signature` }
    expect((yield* call(`/api/room/${room.id}/guest`, { headers: forged })).status).toBe(401)
  }).pipe(Effect.scoped),
)

it.live("the server stamps the guest as author and keeps approvals with the host", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }

    const prompt = yield* call(`/api/room/${room.id}/guest/prompt`, {
      method: "POST",
      headers: guest,
      body: { text: "hello from the phone" },
    })
    expect(prompt.status).toBe(200)
    const roomContext = prompt.body.data.payload.metadata.room
    expect(roomContext.id).toBe(room.id)
    expect(roomContext.guest).toEqual(joined.guest)
    expect(roomContext.hostName).toBeTypeOf("string")
    expect(roomContext.participants).toContain("Phone")
    expect(roomContext.participants).toContain(roomContext.hostName)

    // the guest's chat shows plain messages with their author
    const chat = yield* call(`/api/room/${room.id}/guest/message`, { headers: guest })
    expect(chat.status).toBe(200)
    expect(chat.body.running).toBe(false)

    const reply = yield* call(`/api/room/${room.id}/guest/permission/per_missing/reply`, {
      method: "POST",
      headers: guest,
      body: { decision: "once" },
    })
    expect(reply.status).toBe(403)
  }).pipe(Effect.scoped),
)

it.live("a guest's message keeps the ID its client minted, and a retry is admitted once", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }
    const send = () =>
      call(`/api/room/${room.id}/guest/prompt`, {
        method: "POST",
        headers: guest,
        body: { id: "msg_guestminted0001", text: "hello" },
      })
    const first = yield* send()
    expect(first.status).toBe(200)
    expect(first.body.data.id).toBe("msg_guestminted0001")
    expect((yield* send()).body.data.id).toBe("msg_guestminted0001")
    const inbox = yield* call(`/api/session/${room.sessionID}/inbox`, { headers: host })
    expect(inbox.body.data.filter((item: { id: string }) => item.id === "msg_guestminted0001")).toHaveLength(1)
  }).pipe(Effect.scoped),
)

it.live("a following guest log carries the session's permission requests as they are asked and answered", () =>
  Effect.gen(function* () {
    const { call, handler, directory } = yield* setup
    const session = (yield* call("/api/session", {
      method: "POST",
      headers: host,
      body: { title: "Work", location: { directory }, agent: "build" },
    })).body.data
    const room = (yield* call("/api/room", { method: "POST", headers: host, body: { sessionID: session.id } })).body
      .data
    const code = (yield* call(`/api/room/${room.id}/code`, { method: "POST", headers: host })).body.code as string
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }
    yield* call(`/api/room/${room.id}/member/${joined.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "cohost" },
    })

    const controller = new AbortController()
    yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()))
    const response = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/room/${room.id}/guest/log?follow=true`, {
          headers: guest,
          signal: controller.signal,
        }),
      ),
    )
    expect(response.status).toBe(200)
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    const seen: string[] = []
    const until = (type: string) =>
      Effect.promise(async () => {
        while (!seen.some((frame) => frame.includes(`"type":"${type}"`))) {
          const chunk = await reader.read()
          if (chunk.done) throw new Error(`log ended before ${type}`)
          seen.push(...chunk.value.split("\n\n"))
        }
        return seen.find((frame) => frame.includes(`"type":"${type}"`))!
      }).pipe(Effect.timeout("5 seconds"))

    yield* until("log.synced")
    const pending = yield* call(`/api/room/${room.id}/guest/run`, {
      method: "POST",
      headers: guest,
      body: { command: "echo hi" },
    }).pipe(Effect.forkScoped)
    const asked = JSON.parse((yield* until("permission.asked")).replace(/^data: /, ""))
    expect(asked.data.action).toBe("room.run")
    expect(asked.data.sessionID).toBe(session.id)
    expect(asked.metadata.__opencodeRoomLive).toBe(true)
    // the host's directory is not the guest's business
    expect(asked.location).toBeUndefined()
    yield* call(`/api/session/${session.id}/permission/${asked.data.id}/reply`, {
      method: "POST",
      headers: host,
      body: { decision: "once" },
    })
    const replied = JSON.parse((yield* until("permission.replied")).replace(/^data: /, ""))
    expect(replied.data.requestID).toBe(asked.data.id)
    expect((yield* Fiber.join(pending)).status).toBe(200)
  }).pipe(Effect.scoped),
)

it.live("guests see the note the shared session is bound to", () =>
  Effect.gen(function* () {
    const { call, session, room, code, directory } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }

    const before = yield* call(`/api/room/${room.id}/guest/note`, { headers: guest })
    expect(before.status).toBe(200)
    expect(before.body.data).toBeNull()
    expect((yield* call(`/api/room/${room.id}/guest/message`, { headers: guest })).body.note).toBeUndefined()

    const created = yield* call(`/api/note?location[directory]=${encodeURIComponent(directory)}`, {
      method: "POST",
      headers: host,
      body: { title: "Room plan", body: "draft", session: session.id },
    })
    expect(created.status).toBe(200)

    const after = yield* call(`/api/room/${room.id}/guest/note`, { headers: guest })
    expect(after.status).toBe(200)
    expect(after.body.data).toMatchObject({ name: "room-plan", body: "draft", frontmatter: { title: "Room plan" } })
    const chat = yield* call(`/api/room/${room.id}/guest/message`, { headers: guest })
    expect(chat.body.note).toEqual({ name: "room-plan", title: "Room plan" })
    // the room token opens the note of its own room only
    expect((yield* call(`/api/room/${room.id}/guest/note`)).status).toBe(401)
  }).pipe(Effect.scoped),
)

it.live("closing a room revokes its guests", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    expect((yield* call(`/api/room/${room.id}`, { method: "DELETE", headers: host })).status).toBe(204)
    expect(
      (yield* call(`/api/room/${room.id}/guest`, { headers: { authorization: `Bearer ${joined.token}` } })).status,
    ).toBe(404)
    // the code dies with the room
    expect((yield* call("/api/room/join", { method: "POST", body: { code, name: "Late" } })).status).toBe(401)
  }).pipe(Effect.scoped),
)

it.live("guests join as members the host lists, and a viewer may read but not post", () =>
  Effect.gen(function* () {
    const { call, room, code, session } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone", device: "dev-1" } }))
      .body
    expect(joined.role).toBe("member")
    const guest = { authorization: `Bearer ${joined.token}` }
    expect((yield* call(`/api/room/${room.id}/guest`, { headers: guest })).body.role).toBe("member")

    const members = (yield* call(`/api/room/${room.id}/member`, { headers: host })).body.data
    expect(members).toMatchObject([
      { id: joined.guest.id, name: "Phone", role: "member", device: "dev-1", online: true },
    ])
    // the member list is the host's: a guest token does not open it
    expect((yield* call(`/api/room/${room.id}/member`, { headers: guest })).status).toBe(401)

    // guests read the full session, as the host's own message list pages it
    const full = yield* call(`/api/room/${room.id}/guest/session/message`, { headers: guest })
    expect(full.status).toBe(200)
    expect(full.body.cursor).toBeDefined()
    yield* call(`/api/room/${room.id}/guest/prompt`, { method: "POST", headers: guest, body: { text: "hi" } })
    expect((yield* call(`/api/session/${session.id}/inbox`, { headers: host })).status).toBe(200)

    const updated = yield* call(`/api/room/${room.id}/member/${joined.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "viewer" },
    })
    expect(updated.body.data.role).toBe("viewer")
    expect((yield* call(`/api/room/${room.id}/guest/message`, { headers: guest })).status).toBe(200)
    const blocked = yield* call(`/api/room/${room.id}/guest/prompt`, {
      method: "POST",
      headers: guest,
      body: { text: "may I?" },
    })
    expect(blocked.status).toBe(403)
  }).pipe(Effect.scoped),
)

it.live("a kicked guest loses the room until it joins again; a banned one cannot", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const join = (name: string, device: string) =>
      call("/api/room/join", { method: "POST", body: { code, name, device } })
    const first = (yield* join("Phone", "dev-1")).body
    const guest = { authorization: `Bearer ${first.token}` }

    expect(
      (yield* call(`/api/room/${room.id}/member/${first.guest.id}`, { method: "DELETE", headers: host })).status,
    ).toBe(204)
    expect((yield* call(`/api/room/${room.id}/guest`, { headers: guest })).status).toBe(401)

    const again = (yield* join("Phone", "dev-1")).body
    expect(again.token).toBeDefined()
    const ban = yield* call(`/api/room/${room.id}/member/${again.guest.id}/ban`, { method: "POST", headers: host })
    expect(ban.body.data).toMatchObject({ name: "Phone", device: "dev-1" })
    expect(
      (yield* call(`/api/room/${room.id}/guest`, { headers: { authorization: `Bearer ${again.token}` } })).status,
    ).toBe(401)
    // a new name does not get past the ban; another device does
    expect((yield* join("Tablet", "dev-1")).status).toBe(401)
    expect((yield* join("Tablet", "dev-2")).status).toBe(200)

    const bans = (yield* call(`/api/room/${room.id}/ban`, { headers: host })).body.data
    expect(bans).toHaveLength(1)
    yield* call(`/api/room/${room.id}/ban/${bans[0].id}`, { method: "DELETE", headers: host })
    expect((yield* join("Phone", "dev-1")).status).toBe(200)
  }).pipe(Effect.scoped),
)

it.live("a helper answers permission requests; a member may not", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }
    const reply = () =>
      call(`/api/room/${room.id}/guest/permission/per_missing/reply`, {
        method: "POST",
        headers: guest,
        body: { decision: "once" },
      })
    expect((yield* reply()).status).toBe(403)
    yield* call(`/api/room/${room.id}/member/${joined.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "helper" },
    })
    // past the role check the request is simply unknown
    expect((yield* reply()).status).toBe(404)
  }).pipe(Effect.scoped),
)

it.live("a project room opens every session under its directory and lets members start new ones", () =>
  Effect.gen(function* () {
    const { call, session, directory } = yield* setup
    const project = (yield* call("/api/room", {
      method: "POST",
      headers: host,
      body: { sessionID: session.id, name: "Project", directory, open: true },
    })).body.data
    expect(project.directory).toBe(directory)
    const other = (yield* call("/api/session", {
      method: "POST",
      headers: host,
      body: { title: "Other", location: { directory } },
    })).body.data
    const outside = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-room-outside-")))
    const elsewhere = (yield* call("/api/session", {
      method: "POST",
      headers: host,
      body: { title: "Elsewhere", location: { directory: outside.path } },
    })).body.data

    const joined = (yield* call("/api/room/join", { method: "POST", body: { roomID: project.id, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }
    const listed = (yield* call(`/api/room/${project.id}/guest/session`, { headers: guest })).body.data.map(
      (item: { id: string }) => item.id,
    )
    expect(listed).toContain(session.id)
    expect(listed).toContain(other.id)
    expect(listed).not.toContain(elsewhere.id)

    // another session of the project opens and takes prompts; one outside it reads as missing
    expect(
      (yield* call(`/api/room/${project.id}/guest?sessionID=${other.id}`, { headers: guest })).body.session.id,
    ).toBe(other.id)
    const prompt = yield* call(`/api/room/${project.id}/guest/prompt`, {
      method: "POST",
      headers: guest,
      body: { text: "in the other one", sessionID: other.id },
    })
    expect(prompt.status).toBe(200)
    expect((yield* call(`/api/room/${project.id}/guest?sessionID=${elsewhere.id}`, { headers: guest })).status).toBe(
      404,
    )
    expect(
      (yield* call(`/api/room/${project.id}/guest/session/message?sessionID=${elsewhere.id}`, { headers: guest }))
        .status,
    ).toBe(404)

    const created = yield* call(`/api/room/${project.id}/guest/session`, {
      method: "POST",
      headers: guest,
      body: { title: "From the phone" },
    })
    expect(created.status).toBe(200)
    expect(created.body.data.location.directory).toBe(directory)
  }).pipe(Effect.scoped),
)

it.live("only cohosts switch the model and agent or run commands; a single-session room starts no sessions", () =>
  Effect.gen(function* () {
    const { call, session, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }
    const agent = () =>
      call(`/api/room/${room.id}/guest/session/${session.id}/agent`, {
        method: "POST",
        headers: guest,
        body: { agent: "build" },
      })
    expect((yield* agent()).status).toBe(403)
    expect((yield* call(`/api/room/${room.id}/guest/agent`, { headers: guest })).status).toBe(200)
    expect(
      (yield* call(`/api/room/${room.id}/guest/session`, { method: "POST", headers: guest, body: {} })).status,
    ).toBe(400)

    yield* call(`/api/room/${room.id}/member/${joined.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "cohost" },
    })
    expect((yield* agent()).status).toBe(204)
  }).pipe(Effect.scoped),
)

it.live("a guest reads the host's MCP servers by name and state only", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const listed = yield* call(`/api/room/${room.id}/guest/mcp`, {
      headers: { authorization: `Bearer ${joined.token}` },
    })
    expect(listed.status).toBe(200)
    expect(Array.isArray(listed.body.data)).toBe(true)
    expect((yield* call(`/api/room/${room.id}/guest/mcp`)).status).toBe(401)
  }).pipe(Effect.scoped),
)

it.live("a guest who leaves drops out of the host's members and its token stops working", () =>
  Effect.gen(function* () {
    const { call, room, code } = yield* setup
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }
    expect((yield* call(`/api/room/${room.id}/member`, { headers: host })).body.data).toHaveLength(1)
    expect((yield* call(`/api/room/${room.id}/guest`, { method: "DELETE", headers: guest })).status).toBe(204)
    expect((yield* call(`/api/room/${room.id}/member`, { headers: host })).body.data).toEqual([])
    expect((yield* call(`/api/room/${room.id}/guest`, { headers: guest })).status).toBe(401)
  }).pipe(Effect.scoped),
)

it.live("a guest reads the host's passport, and a cohost runs a command once the host allows it", () =>
  Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.sync(() => (process.env.ROOM_TEST_API_KEY = "host-only")),
      () => Effect.sync(() => delete process.env.ROOM_TEST_API_KEY),
    )
    const { call, directory } = yield* setup
    // a session with an agent, as people use them, so its permission rules ask the host
    const session = (yield* call("/api/session", {
      method: "POST",
      headers: host,
      body: { title: "Work", location: { directory }, agent: "build" },
    })).body.data
    const room = (yield* call("/api/room", { method: "POST", headers: host, body: { sessionID: session.id } })).body
      .data
    const code = (yield* call(`/api/room/${room.id}/code`, { method: "POST", headers: host })).body.code as string
    const joined = (yield* call("/api/room/join", { method: "POST", body: { code, name: "Phone" } })).body
    const guest = { authorization: `Bearer ${joined.token}` }

    const passport = yield* call(`/api/room/${room.id}/guest/passport`, { headers: guest })
    expect(passport.status).toBe(200)
    expect(passport.body.os).toBe(process.platform)
    expect(passport.body.shells.length).toBeGreaterThan(0)
    expect(passport.body.plots).toEqual([])
    // the passport is for guests of this room only
    expect((yield* call(`/api/room/${room.id}/guest/passport`)).status).toBe(401)

    const run = (command = "echo from-the-host; env") =>
      call(`/api/room/${room.id}/guest/run`, {
        method: "POST",
        headers: guest,
        body: { command },
      })
    expect((yield* run()).status).toBe(403)
    yield* call(`/api/room/${room.id}/member/${joined.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "cohost" },
    })

    // nothing runs until the host answers the request in its session
    const pending = yield* run().pipe(Effect.forkScoped)
    const request = yield* call(`/api/session/${session.id}/permission`, { headers: host }).pipe(
      Effect.map((response) => response.body.data as { id: string; action: string }[]),
      Effect.filterOrFail((requests) => requests.length > 0),
      Effect.retry(Schedule.spaced("20 millis")),
      Effect.timeout("5 seconds"),
      Effect.map((requests) => requests[0]),
    )
    expect(request.action).toBe("room.run")
    // the cohost sees its request but only the host answers it
    const self = yield* call(`/api/room/${room.id}/guest/permission/${request.id}/reply`, {
      method: "POST",
      headers: guest,
      body: { decision: "once", sessionID: session.id },
    })
    expect(self.status).toBe(403)
    yield* call(`/api/session/${session.id}/permission/${request.id}/reply`, {
      method: "POST",
      headers: host,
      body: { decision: "once" },
    })
    const result = yield* Fiber.join(pending)
    expect(result.status).toBe(200)
    expect(result.body.exitCode).toBe(0)
    expect(result.body.output).toContain("from-the-host")
    // the output goes to the guest, so the host's keys are not in the command's environment
    expect(result.body.output).not.toContain("ROOM_TEST_API_KEY")

    yield* call(`/api/room/${room.id}/member/${joined.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "trusted" },
    })
    // Trusted is a per-device opt-in: it bypasses the host permission prompt, not the guest-role check.
    const unattended = yield* run("echo trusted-auto-run")
    expect(unattended.status).toBe(200)
    expect(unattended.body.exitCode).toBe(0)
    expect(unattended.body.output).toContain("trusted-auto-run")
  }).pipe(Effect.scoped),
)

it.live("guests share the host project's DoD: one takes an item with a plot, the host frees it", () =>
  Effect.gen(function* () {
    const { call, room, code, directory } = yield* setup
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, ".opencode", "dod.yaml"),
        [
          "leaves:",
          "  - id: L-001",
          '    what: "Write the parser"',
          "    task_state: NOT_STARTED",
          "    steps:",
          '      - "[ ] write it"',
          "  - id: L-002",
          '    what: "Ship it"',
          "    task_state: DONE",
          "",
        ].join("\n"),
      ),
    )
    const join = (name: string) =>
      call("/api/room/join", { method: "POST", body: { code, name } }).pipe(
        Effect.map((response) => ({ authorization: `Bearer ${response.body.token}` })),
      )
    const alex = yield* join("Alex")
    const second = (yield* call(`/api/room/${room.id}/code`, { method: "POST", headers: host })).body.code as string
    const bo = (yield* call("/api/room/join", { method: "POST", body: { code: second, name: "Bo" } })).body
    const boHeaders = { authorization: `Bearer ${bo.token}` }

    const dod = yield* call(`/api/room/${room.id}/guest/dod`, { headers: alex })
    expect(dod.status).toBe(200)
    expect(dod.body.items.map((item: { id: string }) => item.id)).toEqual(["L-001", "L-002"])
    expect((yield* call(`/api/room/${room.id}/guest/dod`)).status).toBe(401)

    const claim = (headers: Record<string, string>, body: Record<string, unknown>) =>
      call(`/api/room/${room.id}/guest/dod`, { method: "POST", headers, body })
    // a viewer only watches
    yield* call(`/api/room/${room.id}/member/${bo.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "viewer" },
    })
    expect((yield* claim(boHeaders, { id: "L-001", take: true })).status).toBe(403)

    const taken = yield* claim(alex, { id: "L-001", take: true, paths: ["src"] })
    expect(taken.status).toBe(200)
    expect(taken.body.items[0]).toMatchObject({ id: "L-001", state: "IN_PROGRESS", owner: "Alex" })
    expect((yield* claim(alex, { id: "L-002", take: true })).body.message).toBe("L-002 is already done")
    const passport = (yield* call(`/api/room/${room.id}/guest/passport`, { headers: alex })).body
    expect(passport.plots).toMatchObject([{ purpose: "DoD L-001 for Alex", paths: ["src"] }])

    yield* call(`/api/room/${room.id}/member/${bo.guest.id}`, {
      method: "PATCH",
      headers: host,
      body: { role: "member" },
    })
    expect((yield* claim(boHeaders, { id: "L-001", take: true })).body.message).toBe("L-001 is taken by Alex")
    expect((yield* claim(boHeaders, { id: "L-001", take: false })).body.message).toBe("L-001 is taken by Alex")

    // the host sees who has it and frees it, plot and all
    expect((yield* call(`/api/room/${room.id}/dod`, { headers: host })).body.items[0].owner).toBe("Alex")
    const freed = yield* call(`/api/room/${room.id}/dod/release`, {
      method: "POST",
      headers: host,
      body: { id: "L-001" },
    })
    expect(freed.body.items[0]).toEqual({
      id: "L-001",
      what: "Write the parser",
      stage: "Ungrouped",
      state: "NOT_STARTED",
      done: 0,
      total: 1,
    })
    expect((yield* call(`/api/room/${room.id}/guest/passport`, { headers: alex })).body.plots).toEqual([])
    expect((yield* claim(boHeaders, { id: "L-001", take: true })).body.items[0].owner).toBe("Bo")
  }).pipe(Effect.scoped),
)

it.live("a guest takes the next ready item, hands it over, and the host's check decides it", () =>
  Effect.gen(function* () {
    const { call, session, room, code, directory } = yield* setup
    yield* Effect.promise(() =>
      Bun.write(
        path.join(directory, ".opencode", "dod.yaml"),
        [
          "leaves:",
          "  - id: L-001",
          '    what: "Write the parser"',
          "    task_state: NOT_STARTED",
          "    verification:",
          "      state: NOT_CHECKED",
          '      command: "test -f parser.txt"',
          "  - id: L-002",
          '    what: "Ship it"',
          "    task_state: NOT_STARTED",
          "    depends_on: [L-001]",
          "",
        ].join("\n"),
      ),
    )
    const join = (joinCode: string, name: string) =>
      call("/api/room/join", { method: "POST", body: { code: joinCode, name } }).pipe(
        Effect.map((response) => response.body),
      )
    const alex = yield* join(code, "Alex")
    const alexHeaders = { authorization: `Bearer ${alex.token}` }
    const second = (yield* call(`/api/room/${room.id}/code`, { method: "POST", headers: host })).body.code as string
    const bo = yield* join(second, "Bo")
    const boHeaders = { authorization: `Bearer ${bo.token}` }
    const claim = (headers: Record<string, string>, body: Record<string, unknown>) =>
      call(`/api/room/${room.id}/guest/dod`, { method: "POST", headers, body })
    const send = (headers: Record<string, string>, body: Record<string, unknown>) =>
      call(`/api/room/${room.id}/guest/dod/submit`, { method: "POST", headers, body })
    // dod.yaml can change under the host, so its check runs only once the host allows it
    const submit = (headers: Record<string, string>, body: Record<string, unknown>, decision?: string) =>
      Effect.gen(function* () {
        const pending = yield* send(headers, body).pipe(Effect.forkScoped)
        if (decision === undefined) return yield* Fiber.join(pending)
        const request = yield* call(`/api/session/${session.id}/permission`, { headers: host }).pipe(
          Effect.map((response) => response.body.data as { id: string; action: string }[]),
          Effect.filterOrFail((requests) => requests.length > 0),
          Effect.retry(Schedule.spaced("20 millis")),
          Effect.timeout("5 seconds"),
          Effect.map((requests) => requests[0]),
        )
        expect(request.action).toBe("room.check")
        yield* call(`/api/session/${session.id}/permission/${request.id}/reply`, {
          method: "POST",
          headers: host,
          body: { decision },
        })
        return yield* Fiber.join(pending)
      })

    // L-002 waits for L-001, so next hands out L-001 and nothing to the second guest
    expect((yield* claim(boHeaders, { id: "L-002", take: true })).body.message).toBe("L-002 waits for L-001")
    const taken = yield* claim(alexHeaders, { next: true, take: true })
    expect(taken.body.taken).toBe("L-001")
    expect(taken.body.items[0]).toMatchObject({ owner: "Alex", ownerID: alex.guest.id, mine: true })
    expect((yield* call(`/api/room/${room.id}/guest/dod`, { headers: boHeaders })).body.items[0].mine).toBeUndefined()
    expect((yield* claim(boHeaders, { next: true, take: true })).body.message).toBe(
      "No item is ready: the rest are finished, taken or wait for others",
    )

    // only the holder submits; a failing check makes the item FAILED and says why
    expect((yield* submit(boHeaders, { id: "L-001" })).body.message).toBe(
      "Take L-001 before submitting it; only its holder submits",
    )
    const failed = yield* submit(
      alexHeaders,
      { id: "L-001", handover: "Parser stub is in, the file is not yet." },
      "always",
    )
    expect(failed.body.check.exitCode).not.toBe(0)
    expect(failed.body.items[0].state).toBe("FAILED")

    // Alex leaves: the item goes back to the room and Bo finds Alex's handover on taking it
    expect((yield* call(`/api/room/${room.id}/guest`, { method: "DELETE", headers: alexHeaders })).status).toBe(204)
    const handed = yield* claim(boHeaders, { id: "L-001", take: true })
    expect(handed.body.items[0]).toMatchObject({ owner: "Bo", mine: true })
    expect(handed.body.note.name).toBe("dod-l-001")
    expect(handed.body.note.text).toContain("Parser stub is in, the file is not yet.")

    yield* Effect.promise(() => Bun.write(path.join(directory, "parser.txt"), "done"))
    // "always" remembered this exact check, so it runs without asking again
    const passed = yield* submit(boHeaders, { id: "L-001" })
    expect(passed.body.check.exitCode).toBe(0)
    expect(passed.body.items[0].state).toBe("DONE")
    expect(passed.body.items[1].waits).toBeUndefined()
    const text = yield* Effect.promise(() => Bun.file(path.join(directory, ".opencode", "dod.yaml")).text())
    expect(text).toContain("      state: PASSED\n")
    expect(text).toContain('        by: "Bo"\n')

    // the feed tells the story in order, to guests and the host alike
    const feed = (yield* call(`/api/room/${room.id}/guest/feed`, { headers: boHeaders })).body.events as {
      seq: number
      kind: string
      who: string
      item?: string
    }[]
    expect(feed.map((event) => [event.kind, event.who, event.item])).toEqual([
      ["join", "Alex", undefined],
      ["join", "Bo", undefined],
      ["take", "Alex", "L-001"],
      ["fail", "Alex", "L-001"],
      ["leave", "Alex", undefined],
      ["release", "Alex", "L-001"],
      ["take", "Bo", "L-001"],
      ["pass", "Bo", "L-001"],
    ])
    const last = feed.at(-1)!.seq
    expect((yield* call(`/api/room/${room.id}/feed?after=${last}`, { headers: host })).body.events).toEqual([])
    // a waiting reader hears of the next event as it happens
    const waiting = yield* call(`/api/room/${room.id}/feed?after=${last}&wait=5000`, { headers: host }).pipe(
      Effect.forkScoped,
    )
    yield* claim(boHeaders, { id: "L-002", take: true })
    expect((yield* Fiber.join(waiting)).body.events).toMatchObject([{ kind: "take", who: "Bo", item: "L-002" }])
  }).pipe(Effect.scoped),
)
