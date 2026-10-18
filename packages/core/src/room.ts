export * as Room from "./room.js"

import { Context, Effect, Layer, Option, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Room } from "@opencode/schema/room"
import { RoomRules } from "@opencode/schema/room-rules"
import { SessionID } from "@opencode/schema/session-id"
import { KV } from "./kv.js"

export const ID = Room.ID
export type ID = Room.ID

export const Info = Room.Info
export type Info = Room.Info

export const Message = Room.Message
export type Message = Room.Message

export const Role = Room.Role
export type Role = Room.Role

export type Member = Room.Member
export type Ban = Room.Ban
export type Dod = Room.Dod
export type DodNote = Room.DodNote
export type EventKind = Room.EventKind

export const CreateInput = Schema.Struct({
  sessionID: SessionID,
  name: Schema.String.pipe(Schema.optional),
  hostName: Schema.String.pipe(Schema.optional),
  ai: Room.AiMessaging.pipe(Schema.optional),
  guestApprovals: Schema.Boolean.pipe(Schema.optional),
  defaultRole: Room.DefaultRole.pipe(Schema.optional),
  directory: Schema.String.pipe(Schema.optional),
  open: Schema.Boolean.pipe(Schema.optional),
  rules: RoomRules.Rules.pipe(Schema.optional),
}).annotate({ identifier: "Room.CreateInput" })
export type CreateInput = typeof CreateInput.Type

export const UpdateInput = Schema.Struct({
  name: Schema.String.pipe(Schema.optional),
  hostName: Schema.String.pipe(Schema.optional),
  ai: Room.AiMessaging.pipe(Schema.optional),
  guestApprovals: Schema.Boolean.pipe(Schema.optional),
  defaultRole: Room.DefaultRole.pipe(Schema.optional),
  open: Schema.Boolean.pipe(Schema.optional),
  // Replaces the room's rules whole; an empty object lifts them.
  rules: RoomRules.Rules.pipe(Schema.optional),
}).annotate({ identifier: "Room.UpdateInput" })
export type UpdateInput = typeof UpdateInput.Type

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Room.NotFoundError", {
  roomID: Schema.String,
}) {}

export interface Interface {
  readonly list: () => Effect.Effect<ReadonlyArray<Info>>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly update: (id: ID, input: UpdateInput) => Effect.Effect<Info, NotFoundError>
  readonly remove: (id: ID) => Effect.Effect<void, NotFoundError>
  readonly members: (id: ID) => Effect.Effect<ReadonlyArray<Member>>
  readonly member: (id: ID, guestID: string) => Effect.Effect<Member | undefined>
  readonly saveMember: (id: ID, member: Member) => Effect.Effect<Member>
  readonly removeMember: (id: ID, guestID: string) => Effect.Effect<void>
  readonly bans: (id: ID) => Effect.Effect<ReadonlyArray<Ban>>
  readonly ban: (id: ID, ban: Ban) => Effect.Effect<Ban>
  readonly unban: (id: ID, banID: string) => Effect.Effect<void>
}

// The role a new guest gets: the room's choice, or for rooms saved before roles
// existed, helper when guests could answer permission requests.
export function joinRole(room: Info): Role {
  return room.defaultRole ?? (room.guestApprovals ? "helper" : "member")
}

export function banned(bans: ReadonlyArray<Ban>, guest: { device?: string; address?: string }) {
  return bans.some(
    (ban) =>
      (ban.device !== undefined && ban.device === guest.device) ||
      (ban.address !== undefined && ban.address === guest.address),
  )
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Room") {}

// Rooms are a handful of small records owned by this host, so they live in the
// shared KV table under one prefix instead of needing their own migration.
const PREFIX = "room/"
// Members and bans sit under their room's ID so closing a room drops them in one scan each.
const MEMBERS = "room-member/"
const BANS = "room-ban/"
const decode = Schema.decodeUnknownOption(Info)
const decodeMember = Schema.decodeUnknownOption(Room.Member)
const decodeBan = Schema.decodeUnknownOption(Room.Ban)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service

    const get = Effect.fn("Room.get")(function* (id: ID) {
      const room = decode(yield* kv.get(PREFIX + id))
      if (Option.isNone(room)) return yield* new NotFoundError({ roomID: id })
      return room.value
    })

    const save = (room: Info) => kv.set(PREFIX + room.id, Schema.encodeSync(Info)(room)).pipe(Effect.as(room))

    const scan = <A>(prefix: string, decodeEntry: (value: unknown) => Option.Option<A>) =>
      kv
        .scan({ prefix, limit: 1000 })
        .pipe(Effect.map((result) => result.entries.flatMap((entry) => Option.toArray(decodeEntry(entry.value)))))

    const members = (id: ID) => scan(`${MEMBERS}${id}/`, decodeMember)
    const bans = (id: ID) => scan(`${BANS}${id}/`, decodeBan)

    return Service.of({
      list: Effect.fn("Room.list")(function* () {
        const entries: { key: string; value: unknown }[] = []
        let after: string | undefined
        for (;;) {
          const page = yield* kv.scan({ prefix: PREFIX, limit: 1000, ...(after ? { after } : {}) })
          entries.push(...page.entries)
          if (!page.next) break
          after = page.next
        }
        return entries
          .flatMap((entry) => Option.toArray(decode(entry.value)))
          .toSorted((a, b) => a.created - b.created)
      }),
      get,
      create: Effect.fn("Room.create")(function* (input: CreateInput) {
        return yield* save({
          id: ID.create(),
          sessionID: input.sessionID,
          name: input.name?.trim() || "Room",
          hostName: input.hostName?.trim() || undefined,
          ai: input.ai ?? "linked",
          guestApprovals: input.guestApprovals ?? false,
          defaultRole: input.defaultRole ?? "member",
          directory: input.directory,
          open: input.open ?? false,
          rules: input.rules,
          created: Date.now(),
        })
      }),
      update: Effect.fn("Room.update")(function* (id: ID, input: UpdateInput) {
        const room = yield* get(id)
        return yield* save({
          ...room,
          name: input.name?.trim() || room.name,
          hostName: input.hostName?.trim() || room.hostName,
          ai: input.ai ?? room.ai,
          guestApprovals: input.guestApprovals ?? room.guestApprovals,
          defaultRole: input.defaultRole ?? room.defaultRole,
          open: input.open ?? room.open ?? false,
          rules: input.rules ?? room.rules,
        })
      }),
      remove: Effect.fn("Room.remove")(function* (id: ID) {
        yield* get(id)
        yield* kv.remove(PREFIX + id)
        yield* Effect.forEach(yield* members(id), (member) => kv.remove(`${MEMBERS}${id}/${member.id}`))
        yield* Effect.forEach(yield* bans(id), (ban) => kv.remove(`${BANS}${id}/${ban.id}`))
      }),
      members: Effect.fn("Room.members")(function* (id: ID) {
        return (yield* members(id)).toSorted((a, b) => a.joined - b.joined)
      }),
      member: Effect.fn("Room.member")(function* (id: ID, guestID: string) {
        return Option.getOrUndefined(decodeMember(yield* kv.get(`${MEMBERS}${id}/${guestID}`)))
      }),
      saveMember: Effect.fn("Room.saveMember")(function* (id: ID, member: Member) {
        yield* kv.set(`${MEMBERS}${id}/${member.id}`, Schema.encodeSync(Room.Member)(member))
        return member
      }),
      removeMember: Effect.fn("Room.removeMember")(function* (id: ID, guestID: string) {
        yield* kv.remove(`${MEMBERS}${id}/${guestID}`)
      }),
      bans: Effect.fn("Room.bans")(function* (id: ID) {
        return (yield* bans(id)).toSorted((a, b) => a.created - b.created)
      }),
      ban: Effect.fn("Room.ban")(function* (id: ID, ban: Ban) {
        yield* kv.set(`${BANS}${id}/${ban.id}`, Schema.encodeSync(Room.Ban)(ban))
        return ban
      }),
      unban: Effect.fn("Room.unban")(function* (id: ID, banID: string) {
        yield* kv.remove(`${BANS}${id}/${banID}`)
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node] })
