export * as ServerRooms from "./rooms"

import { Cache, Context, Duration, Effect, Layer, Option } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Room } from "@opencode/schema/room"
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import type { ServerAuth } from "./auth"

// Join codes stay valid until they expire so several devices can join with the
// one code the host reads out; a new code replaces the room's previous one.
const CODE_TTL = Duration.minutes(10)
// Unambiguous characters only, so a code read aloud or typed on a phone survives.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 8
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

export interface Interface {
  readonly issueCode: (roomID: Room.ID) => Effect.Effect<Room.JoinCode>
  readonly redeemCode: (code: string) => Effect.Effect<Room.ID | undefined>
  // Release transient room state when a room is deleted.
  readonly forget: (roomID: Room.ID, guestIDs?: readonly string[]) => Effect.Effect<void>
  // Presence lives in memory: every guest request marks its guest as seen.
  readonly touch: (guestID: string) => void
  readonly seen: (guestID: string) => number | undefined
  // When this server started, standing in for the last sight of a guest it has not heard from since.
  readonly started: number
  readonly record: (roomID: Room.ID, event: Omit<Room.Event, "seq" | "at">) => void
  // The room's events after seq. With wait, an empty answer waits up to that many
  // milliseconds for the next event, so a reader learns of it at once without fast polling.
  readonly feed: (roomID: Room.ID, after: number, wait?: number) => Effect.Effect<Room.Feed>
}

// Guests poll every couple of seconds, so a longer silence means they left.
export const ONLINE_MS = 15_000
// How long a DoD item stays with a guest the server has not heard from: long enough to
// survive a closed laptop lid over lunch, short enough that a vanished guest frees it today.
export const LEASE_MS = 30 * 60_000
// The events a room keeps; older ones fall off the front.
const FEED_LIMIT = 200
export const FEED_WAIT_MS = 25_000
// Readers one room may hold waiting at once; past it, a read answers at once instead of waiting.
const FEED_WAITERS = 100
export class Service extends Context.Service<Service, Interface>()("@opencode/ServerRooms") {}

const noLookup = () => Effect.die(new Error("ServerRooms cache must be used via set/getOption, never get"))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const codes = yield* Cache.make<string, Room.ID>({ capacity: 1_000, lookup: noLookup, timeToLive: CODE_TTL })
    // Each room's newest code, so a new code retires the one before it.
    const issued = new Map<Room.ID, string>()
    // Keep last-seen timestamps even for offline members: room.member.list exposes
    // this value, so deleting old entries would change the API's observable behavior.
    const presence = new Map<string, number>()
    const touch = (guestID: string) => void presence.set(guestID, Date.now())
    const feeds = new Map<Room.ID, Room.Event[]>()
    const waiters = new Map<Room.ID, Set<() => void>>()
    const after = (roomID: Room.ID, seq: number) => (feeds.get(roomID) ?? []).filter((event) => event.seq > seq)
    return Service.of({
      touch,
      seen: (guestID) => presence.get(guestID),
      started: Date.now(),
      record: (roomID, event) => {
        // Mutate the private bounded buffer instead of allocating/copying up to
        // FEED_LIMIT events for every live event.
        let list = feeds.get(roomID)
        if (!list) {
          list = []
          feeds.set(roomID, list)
        }
        list.push({ ...event, seq: (list.at(-1)?.seq ?? 0) + 1, at: Date.now() })
        if (list.length > FEED_LIMIT) list.splice(0, list.length - FEED_LIMIT)
        const waiting = waiters.get(roomID)
        waiters.delete(roomID)
        waiting?.forEach((wake) => wake())
      },
      feed: Effect.fn("ServerRooms.feed")(function* (roomID, seq, wait) {
        // A reader whose cursor is past the end saw a feed from before a restart; it starts over.
        const last = feeds.get(roomID)?.at(-1)?.seq ?? 0
        const from = seq > last ? 0 : seq
        const available = after(roomID, from)
        if (available.length > 0 || !wait || (waiters.get(roomID)?.size ?? 0) >= FEED_WAITERS)
          return { events: available }
        yield* Effect.callback<void>((resume) => {
          const forget = () => {
            clearTimeout(timer)
            const waiting = waiters.get(roomID)
            waiting?.delete(wake)
            if (waiting?.size === 0) waiters.delete(roomID)
          }
          const wake = () => {
            forget()
            resume(Effect.void)
          }
          const timer = setTimeout(wake, Math.min(wait, FEED_WAIT_MS))
          waiters.set(roomID, (waiters.get(roomID) ?? new Set<() => void>()).add(wake))
          return Effect.sync(forget)
        })
        return { events: after(roomID, from) }
      }),
      forget: Effect.fn("ServerRooms.forget")(function* (roomID, guestIDs = []) {
        const code = issued.get(roomID)
        if (code !== undefined) {
          yield* Cache.invalidate(codes, code)
          issued.delete(roomID)
        }
        for (const guestID of guestIDs) presence.delete(guestID)
        feeds.delete(roomID)
        const waiting = waiters.get(roomID)
        waiters.delete(roomID)
        waiting?.forEach((wake) => wake())
      }),
      issueCode: Effect.fn("ServerRooms.issueCode")(function* (roomID) {
        const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")
        const previous = issued.get(roomID)
        if (previous !== undefined) yield* Cache.invalidate(codes, previous)
        issued.set(roomID, code)
        yield* Cache.set(codes, code, roomID)
        return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expires_in: Duration.toSeconds(CODE_TTL) }
      }),
      redeemCode: Effect.fn("ServerRooms.redeemCode")(function* (code) {
        return Option.getOrUndefined(yield* Cache.getOption(codes, code.toUpperCase().replace(/[^A-Z0-9]/g, "")))
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

export type GuestToken = {
  readonly roomID: Room.ID
  readonly guest: Room.Guest
}

// Guest tokens are signed with a key derived from the server password, so
// rotating the password revokes every guest. A server without a password is
// loopback-only; it signs with a per-process key and guests rejoin after a restart.
const fallbackKey = randomBytes(32).toString("hex")

export function issueToken(config: ServerAuth.Info, roomID: Room.ID, name: string, now = Date.now()) {
  const expires = String(Math.floor(now / 1000) + TOKEN_TTL_SECONDS)
  const guest = randomBytes(9).toString("base64url")
  const payload = [roomID, guest, expires, Buffer.from(name).toString("base64url")].join(".")
  return {
    token: `${payload}.${sign(config, payload)}`,
    guest: { id: guest, name },
  }
}

export function verifyToken(config: ServerAuth.Info, token: string, now = Date.now()): GuestToken | undefined {
  const parts = token.split(".")
  if (parts.length !== 5) return
  const expected = Buffer.from(sign(config, parts.slice(0, 4).join(".")))
  const actual = Buffer.from(parts[4])
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return
  const expires = Number(parts[2])
  if (!Number.isSafeInteger(expires) || expires * 1000 <= now) return
  return {
    roomID: Room.ID.make(parts[0]),
    guest: { id: parts[1], name: Buffer.from(parts[3], "base64url").toString() },
  }
}

function sign(config: ServerAuth.Info, payload: string) {
  const secret = Option.getOrElse(config.password, () => fallbackKey)
  const key = createHmac("sha256", secret).update("opencode-room-v1").digest()
  return createHmac("sha256", key).update(payload).digest("base64url")
}
