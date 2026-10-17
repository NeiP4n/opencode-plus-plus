export * as Room from "./room.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { PositiveInt, statics } from "./schema.js"
import { SessionID } from "./session-id.js"

export const ID = Schema.String.check(Schema.isStartsWith("room")).pipe(Schema.brand("RoomID"), statics((schema) => ({ create: () => schema.make("room_" + ascending()) })))
export type ID = typeof ID.Type
export const AiMessaging = Schema.Literals(["linked", "discovered"])
export type AiMessaging = typeof AiMessaging.Type
export const Role = Schema.Literals(["viewer", "member", "helper", "cohost", "trusted"])
export type Role = typeof Role.Type
export const DefaultRole = Schema.Literals(["viewer", "member", "helper", "cohost"])
export type DefaultRole = typeof DefaultRole.Type

export const Rules = Schema.Struct({
  protectSecrets: Schema.Boolean,
  hidePaths: Schema.Boolean,
  blockDangerousCommands: Schema.Boolean,
  blockedCommands: Schema.Array(Schema.String),
  instructions: Schema.String,
}).annotate({ identifier: "Room.Rules" })
export interface Rules extends Schema.Schema.Type<typeof Rules> {}
export const DEFAULT_RULES: Rules = { protectSecrets: true, hidePaths: true, blockDangerousCommands: true, blockedCommands: [], instructions: "" }
export function effectiveRules(value: { rules?: Rules | undefined }): Rules {
  return { ...DEFAULT_RULES, ...value.rules, blockedCommands: [...(value.rules?.blockedCommands ?? [])], instructions: value.rules?.instructions ?? "" }
}

export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  name: Schema.String,
  hostName: Schema.String.pipe(Schema.optional),
  ai: AiMessaging,
  guestApprovals: Schema.Boolean,
  defaultRole: DefaultRole.pipe(Schema.optional),
  directory: Schema.String.pipe(Schema.optional),
  open: Schema.Boolean.pipe(Schema.optional),
  rules: Rules.pipe(Schema.optional),
  created: Schema.Number,
}).annotate({ identifier: "Room.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const JoinCode = Schema.Struct({ code: Schema.String, expires_in: PositiveInt }).annotate({ identifier: "Room.JoinCode" })
export interface JoinCode extends Schema.Schema.Type<typeof JoinCode> {}
export const Guest = Schema.Struct({ id: Schema.String, name: Schema.String }).annotate({ identifier: "Room.Guest" })
export interface Guest extends Schema.Schema.Type<typeof Guest> {}
export const Member = Schema.Struct({ id: Schema.String, name: Schema.String, role: Role, device: Schema.String.pipe(Schema.optional), address: Schema.String.pipe(Schema.optional), joined: Schema.Number }).annotate({ identifier: "Room.Member" })
export interface Member extends Schema.Schema.Type<typeof Member> {}
export const MemberView = Schema.Struct({ ...Member.fields, seen: Schema.Number.pipe(Schema.optional), online: Schema.Boolean }).annotate({ identifier: "Room.MemberView" })
export interface MemberView extends Schema.Schema.Type<typeof MemberView> {}
export const Ban = Schema.Struct({ id: Schema.String, name: Schema.String, device: Schema.String.pipe(Schema.optional), address: Schema.String.pipe(Schema.optional), created: Schema.Number }).annotate({ identifier: "Room.Ban" })
export interface Ban extends Schema.Schema.Type<typeof Ban> {}
export const Joined = Schema.Struct({ token: Schema.String, guest: Guest, role: Role, room: Info }).annotate({ identifier: "Room.Joined" })
export interface Joined extends Schema.Schema.Type<typeof Joined> {}
export const Message = Schema.Struct({ id: Schema.String, role: Schema.Literals(["user", "assistant"]), author: Schema.String.pipe(Schema.optional), text: Schema.String, created: Schema.Number }).annotate({ identifier: "Room.Message" })
export interface Message extends Schema.Schema.Type<typeof Message> {}
export const Passport = Schema.Struct({
  machine: Schema.String, os: Schema.String, release: Schema.String, arch: Schema.String, shells: Schema.Array(Schema.String), tools: Schema.Array(Schema.String),
  project: Schema.Struct({ directory: Schema.String, branch: Schema.String.pipe(Schema.optional), commit: Schema.String.pipe(Schema.optional), changed: Schema.Number.pipe(Schema.optional) }),
  plots: Schema.Array(Schema.Struct({ team: Schema.String, machine: Schema.String, purpose: Schema.String, paths: Schema.Array(Schema.String), expires: Schema.Number })),
}).annotate({ identifier: "Room.Passport" })
export interface Passport extends Schema.Schema.Type<typeof Passport> {}
export const RunResult = Schema.Struct({ shell: Schema.String, exitCode: Schema.Number, output: Schema.String, cut: Schema.Boolean.pipe(Schema.optional) }).annotate({ identifier: "Room.RunResult" })
export interface RunResult extends Schema.Schema.Type<typeof RunResult> {}
export const DodItem = Schema.Struct({ id: Schema.String, what: Schema.String, stage: Schema.String, state: Schema.String, done: Schema.Number, total: Schema.Number, owner: Schema.String.pipe(Schema.optional), ownerID: Schema.String.pipe(Schema.optional), stale: Schema.Boolean.pipe(Schema.optional), mine: Schema.Boolean.pipe(Schema.optional), waits: Schema.Array(Schema.String).pipe(Schema.optional), verify: Schema.String.pipe(Schema.optional) }).annotate({ identifier: "Room.DodItem" })
export interface DodItem extends Schema.Schema.Type<typeof DodItem> {}
export const DodNote = Schema.Struct({ name: Schema.String, text: Schema.String }).annotate({ identifier: "Room.DodNote" })
export interface DodNote extends Schema.Schema.Type<typeof DodNote> {}
export const Dod = Schema.Struct({ items: Schema.Array(DodItem), status: Schema.Literals(["ready", "disabled"]).pipe(Schema.optional), taken: Schema.String.pipe(Schema.optional), note: DodNote.pipe(Schema.optional), check: Schema.Struct({ exitCode: Schema.Number, output: Schema.String }).pipe(Schema.optional) }).annotate({ identifier: "Room.Dod" })
export interface Dod extends Schema.Schema.Type<typeof Dod> {}
export const EventKind = Schema.Literals(["join", "leave", "remove", "ban", "take", "release", "expire", "pass", "fail", "run"])
export type EventKind = typeof EventKind.Type
export const Event = Schema.Struct({ seq: Schema.Number, at: Schema.Number, kind: EventKind, who: Schema.String, item: Schema.String.pipe(Schema.optional), detail: Schema.String.pipe(Schema.optional) }).annotate({ identifier: "Room.Event" })
export interface Event extends Schema.Schema.Type<typeof Event> {}
export const Feed = Schema.Struct({ events: Schema.Array(Event) }).annotate({ identifier: "Room.Feed" })
export interface Feed extends Schema.Schema.Type<typeof Feed> {}
