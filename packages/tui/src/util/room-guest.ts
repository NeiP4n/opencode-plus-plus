import { OpenCode, type OpenCodeClient } from "@opencode/client"
import type { JoinedRoom } from "./room"

// Room clients are immutable transport wrappers. Recreating one for every render/poll creates
// unnecessary objects and can retain short-lived transport state until the next GC cycle.
// WeakMap keeps the cache bounded by the lifetime of the joined-room object itself.
const clients = new WeakMap<object, OpenCodeClient>()

export function roomClient(room: Pick<JoinedRoom, "url" | "token">) {
  const key = room as object
  const cached = clients.get(key)
  if (cached) return cached
  const client = OpenCode.make({ baseUrl: room.url, headers: { authorization: `Bearer ${room.token}` } })
  clients.set(key, client)
  return client
}

// The joined room as this computer's server keeps it, so this computer's AI can work with
// the AI there. Registering is idempotent; a server that cannot be reached is told next time.
export function linkRoom(client: OpenCodeClient, room: JoinedRoom) {
  return client.room.link
    .save({ url: room.url, roomID: room.roomID, token: room.token, name: room.name, guest: room.guest })
    .catch(() => undefined)
}

export function unlinkRoom(client: OpenCodeClient, room: Pick<JoinedRoom, "url" | "roomID">) {
  return client.room.link.remove({ url: room.url, roomID: room.roomID }).catch(() => undefined)
}

// Tells the host this guest left, so it drops out of the host's participants. A host
// that is gone cannot hear it; the room is forgotten here either way.
export function tellHostLeft(room: Pick<JoinedRoom, "url" | "token" | "roomID">) {
  return roomClient(room)
    .room.guest.leave({ roomID: room.roomID })
    .catch(() => undefined)
}

// The shared session as a guest reaches it: the slice of the client API the
// session transcript and the data layer use, answered by the room's guest
// routes. Everything else belongs to the host and rejects, so a component that
// reaches past the slice fails loudly instead of touching this computer's server.
// onLive runs once the first log connection has caught up with the host: events that came
// while it replayed were skipped, so the view reloads what the host has now.
export function guestApi(room: JoinedRoom, sessionID?: string, onLive?: () => void): OpenCodeClient {
  const remote = roomClient(room)
  const roomID = room.roomID
  // Where this view's room log has read up to, so a reconnect only replays what it missed.
  const cursor: { seq?: number } = {}
  const slice = {
    session: {
      get: () => remote.room.guest.get({ roomID, sessionID }).then((result) => result.session),
      // The data layer shows the message at once under the ID it minted; the host admits that
      // same ID, so the row it echoes replaces the shown one instead of adding a second.
      prompt: (input: { id?: string; sessionID: string; text: string }) =>
        remote.room.guest.prompt({ roomID, sessionID: input.sessionID, id: input.id, text: input.text }),
      // Whether the host model is working now, so a guest who opens a busy session sees it busy;
      // later starts and ends arrive on the room log.
      active: () =>
        remote.room.guest
          .messages({ roomID, sessionID })
          .then((result) => (result.running && sessionID ? { [sessionID]: {} } : {})),
      inbox: { list: async () => [] },
      form: { list: async () => [] },
    },
    message: {
      list: (input: { limit?: number; order?: "asc" | "desc"; cursor?: string; type?: string }) =>
        remote.room.guest.session.messages({
          roomID,
          sessionID,
          limit: input.limit,
          order: input.order,
          cursor: input.cursor,
          type: input.type as Parameters<typeof remote.room.guest.session.messages>[0]["type"],
        }),
    },
    permission: {
      list: () => remote.room.guest.permission.list({ roomID, sessionID }),
      reply: (input: { requestID: string; decision: "once" | "always" | "reject"; message?: string }) =>
        remote.room.guest.permission.reply({
          roomID,
          requestID: input.requestID,
          decision: input.decision,
          message: input.message,
          sessionID,
        }),
    },
    form: { list: async () => [] },
    event: {
      subscribe: (options?: { signal?: AbortSignal; onActivity?: () => void }) =>
        events(remote, roomID, sessionID, cursor, onLive, options),
    },
  }
  // A typed client cannot be assembled from a slice; the proxy stands in for the rest of it.
  return host(slice, "") as unknown as OpenCodeClient
}

// The room log replays the session's history before following it. The data layer
// loads that history itself, so only events after the replay pass through. The followed
// log also carries live permission requests and the ephemeral stream fragments (text,
// reasoning, tool input and progress), so a guest watches the host model work as it goes.
//
// server.connected goes out as soon as the log answers, not after the replay: the
// connection gives up on a stream that has not connected within a couple of seconds, and
// replaying a long session takes longer, so it kept reconnecting and never got live.
// A reconnect resumes after the last durable event seen and passes the missed ones on.
async function* events(
  remote: ReturnType<typeof roomClient>,
  roomID: string,
  sessionID: string | undefined,
  cursor: { seq?: number },
  onLive: (() => void) | undefined,
  options?: { signal?: AbortSignal; onActivity?: () => void },
) {
  const resumed = cursor.seq !== undefined
  const log = remote.room.guest
    .log({ roomID, sessionID, follow: true, after: cursor.seq }, options)
    [Symbol.asyncIterator]()
  yield { id: "room", type: "server.connected" as const, data: {} }
  let replaying = !resumed
  let liveDurableSeq: number | undefined

  // Keep only a small recent deduplication window. The previous Set + Array pair retained up
  // to 5000 IDs per live room connection, with the same IDs represented twice. A single Map
  // provides insertion order and lookup while using substantially less bookkeeping memory.
  const liveDurableIDs = new Map<string, number>()
  const LIVE_DEDUPE_LIMIT = 1024
  const rememberLiveDurable = (id: string, seq: number) => {
    liveDurableIDs.delete(id)
    liveDurableIDs.set(id, seq)
    liveDurableSeq = Math.max(liveDurableSeq ?? -1, seq)
    while (liveDurableIDs.size > LIVE_DEDUPE_LIMIT) {
      const oldest = liveDurableIDs.keys().next().value
      if (oldest === undefined) break
      liveDurableIDs.delete(oldest)
    }
  }
  for (let item = await log.next(); !item.done; item = await log.next()) {
    let value = item.value
    if (value.type === "log.synced") {
      if (value.seq !== undefined) cursor.seq = Math.max(cursor.seq ?? -1, value.seq)
      if (liveDurableSeq !== undefined) cursor.seq = Math.max(cursor.seq ?? -1, liveDurableSeq)
      liveDurableSeq = undefined
      if (replaying) onLive?.()
      replaying = false
      continue
    }

    const metadata = "metadata" in value ? value.metadata : undefined
    const live = metadata?.__opencodeRoomLive === true
    if (live && metadata) {
      const clean = { ...metadata }
      delete clean.__opencodeRoomLive
      value = {
        ...value,
        metadata: Object.keys(clean).length ? clean : undefined,
      } as typeof item.value
    }

    // History is loaded through the message API. Live boundaries create the assistant
    // before the first ephemeral text delta reaches the UI.
    if (replaying && !live) continue

    if ("durable" in value && value.durable) {
      if (live) rememberLiveDurable(value.id, value.durable.seq)
      else {
        if (liveDurableIDs.has(value.id)) continue
        if (!replaying) cursor.seq = Math.max(cursor.seq ?? -1, value.durable.seq)
      }
    }
    yield value
  }
}

function host(target: object, path: string): unknown {
  return new Proxy(target, {
    get(object, key) {
      // Promise resolution probes `then`; the client is not a promise.
      if (typeof key !== "string" || key === "then") return undefined
      const next = path ? `${path}.${key}` : key
      if (key in object) {
        // oxlint-disable-next-line no-restricted-globals -- Proxy forwarding reads the slice by key.
        const value: unknown = Reflect.get(object, key)
        return typeof value === "object" && value !== null ? host(value, next) : value
      }
      return host(missing(next), next)
    },
  })
}

function missing(path: string) {
  return () => Promise.reject(new GuestUnavailable(path))
}

// The data layer refreshes host-wide state such as projects on its own; a guest skips it.
export class GuestUnavailable extends Error {
  constructor(path: string) {
    super(`${path} is not available to room guests`)
  }
}

export function ignoreGuestUnavailable(error: unknown) {
  if (error instanceof GuestUnavailable) return
  console.error("Failed to refresh room data", error)
}
