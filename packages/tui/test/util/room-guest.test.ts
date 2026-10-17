import { afterEach, describe, expect, test } from "bun:test"
import { guestApi } from "../../src/util/room-guest"

// The host's guest routes as far as these tests reach them.
function host(logFrames?: Record<string, unknown>[]) {
  const prompts: unknown[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/room/room_1/guest/prompt") {
        const body = (await request.json()) as { id: string; text: string }
        prompts.push(body)
        return Response.json({ data: { id: body.id, type: "user", payload: { text: body.text } } })
      }
      if (url.pathname === "/api/room/room_1/guest/log") {
        const frames = logFrames ?? [
          { type: "log.synced", aggregateID: "ses_1", seq: 0 },
          {
            id: "evt_1",
            created: 1,
            type: "permission.asked",
            data: { id: "per_1", sessionID: "ses_1", action: "bash", resources: ["ls"] },
          },
          {
            id: "evt_2",
            created: 2,
            type: "session.text.delta",
            data: { sessionID: "ses_1", assistantMessageID: "msg_assistant1", ordinal: 0, delta: "hello" },
          },
          {
            id: "evt_3",
            created: 3,
            type: "session.reasoning.delta",
            data: { sessionID: "ses_1", assistantMessageID: "msg_assistant1", ordinal: 0, delta: "thinking" },
          },
        ]
        return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), {
          headers: { "content-type": "text/event-stream" },
        })
      }
      return new Response(null, { status: 404 })
    },
  })
  const room = { url: server.url.toString(), roomID: "room_1", name: "Lab", token: "token", guest: "Phone" }
  return { server, prompts, room }
}

const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => servers.splice(0).forEach((server) => server.stop(true)))

describe("guestApi", () => {
  test("a prompt keeps the ID the client minted, so the shown message and the host's echo are one", async () => {
    const fake = host()
    servers.push(fake.server)
    const api = guestApi(fake.room, "ses_1")
    const admitted = await api.session.prompt({ sessionID: "ses_1", id: "msg_local1", text: "hi" })
    expect(fake.prompts).toEqual([{ id: "msg_local1", text: "hi", sessionID: "ses_1" }])
    expect(admitted.id).toBe("msg_local1")
  })

  test("live assistant boundaries and deltas are delivered before history replay is synced", async () => {
    const fake = host([
      {
        id: "evt_step_live",
        created: 2,
        type: "session.step.started",
        metadata: { __opencodeRoomLive: true },
        durable: { aggregateID: "ses_1", seq: 6, version: 1 },
        data: { sessionID: "ses_1", assistantMessageID: "msg_live", agent: "build", model: { providerID: "p", id: "m" }, started: 2 },
      },
      {
        id: "evt_text_start_live",
        created: 3,
        type: "session.text.started",
        metadata: { __opencodeRoomLive: true },
        durable: { aggregateID: "ses_1", seq: 7, version: 1 },
        data: { sessionID: "ses_1", assistantMessageID: "msg_live", ordinal: 0 },
      },
      {
        id: "evt_delta_live",
        created: 4,
        type: "session.text.delta",
        metadata: { __opencodeRoomLive: true },
        data: { sessionID: "ses_1", assistantMessageID: "msg_live", ordinal: 0, delta: "Hello" },
      },
      { type: "log.synced", aggregateID: "ses_1", seq: 5 },
      {
        id: "evt_step_live",
        created: 2,
        type: "session.step.started",
        durable: { aggregateID: "ses_1", seq: 6, version: 1 },
        data: { sessionID: "ses_1", assistantMessageID: "msg_live", agent: "build", model: { providerID: "p", id: "m" }, started: 2 },
      },
    ])
    servers.push(fake.server)
    const seen: Array<{ type: string; metadata?: Record<string, unknown> }> = []
    for await (const event of guestApi(fake.room, "ses_1").event.subscribe())
      seen.push(event as { type: string; metadata?: Record<string, unknown> })
    expect(seen.map((event) => event.type)).toEqual([
      "server.connected",
      "session.step.started",
      "session.text.started",
      "session.text.delta",
    ])
    expect(seen[1]?.metadata).toBeUndefined()
  })

  test("a permission request on the room log reaches the data layer without polling", async () => {
    const fake = host()
    servers.push(fake.server)
    const seen: string[] = []
    for await (const event of guestApi(fake.room, "ses_1").event.subscribe()) seen.push(event.type)
    expect(seen).toEqual(["server.connected", "permission.asked", "session.text.delta", "session.reasoning.delta"])
  })
})
