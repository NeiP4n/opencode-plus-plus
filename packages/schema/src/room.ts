export * as Room from "./room.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { PositiveInt, statics } from "./schema.js"
import { Rules } from "./room-rules.js"
import { SessionID } from "./session-id.js"

// A Room shares one host Session with other devices on the network. Guests
// read it and post prompts into it; only the host's model answers.
export const ID = Schema.String.check(Schema.isStartsWith("room")).pipe(
  Schema.brand("RoomID"),
  statics((schema) => ({ create: () => schema.make("room_" + ascending()) })),
)
export type ID = typeof ID.Type

// Where the host's model may send messages on its own: only rooms the host
// linked to this one, or any room it discovered, each send asking permission.
export const AiMessaging = Schema.Literals(["linked", "discovered"])
export type AiMessaging = typeof AiMessaging.Type

// What a guest may do in a room. Viewers read, members also post prompts and start
// sessions, helpers also answer the host model's permission requests, cohosts manage models
// and commands with approval, and Trusted members may run remote commands without prompts.
export const Role = Schema.Literals(["viewer", "member", "helper", "cohost", "trusted"])
export type Role = typeof Role.Type

// Trusted remains per-member: it is deliberately not a default role for invite codes.
export const DefaultRole = Schema.Literals(["viewer", "member", "helper", "cohost"])
export type DefaultRole = typeof DefaultRole.Type

export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID,
  name: Schema.String,
  // Nickname guests and the host model use to identify this host in a room.
  hostName: Schema.String.pipe(Schema.optional),
  ai: AiMessaging,
  // Rooms saved before roles existed: whether guests could answer permission requests.
  // Read only to choose defaultRole for such rooms.
  guestApprovals: Schema.Boolean,
  // The role a guest gets on joining; absent on rooms saved before roles existed.
  defaultRole: DefaultRole.pipe(Schema.optional),
  // Set when the room shares a whole project: every session under this directory, and
  // new ones guests start there. Without it the room shares sessionID alone.
  directory: Schema.String.pipe(Schema.optional),
  // Whether guests may join without a code; absent on rooms saved before the option existed.
  open: Schema.Boolean.pipe(Schema.optional),
  // What nobody in the room may do or see, the host's AI included; see RoomRules.
  rules: Rules.pipe(Schema.optional),
  created: Schema.Number,
}).annotate({ identifier: "Room.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const JoinCode = Schema.Struct({
  code: Schema.String,
  expires_in: PositiveInt,
}).annotate({ identifier: "Room.JoinCode" })
export interface JoinCode extends Schema.Schema.Type<typeof JoinCode> {}

export const Guest = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
}).annotate({ identifier: "Room.Guest" })
export interface Guest extends Schema.Schema.Type<typeof Guest> {}

// A guest the host admitted. Removing the member revokes its token; the device key
// and address are what a ban matches when the same person tries to join again.
export const Member = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Role,
  // A random key the guest's client keeps across joins.
  device: Schema.String.pipe(Schema.optional),
  // The network address it joined from; absent for loopback, which tunnels such as Porthole share.
  address: Schema.String.pipe(Schema.optional),
  joined: Schema.Number,
}).annotate({ identifier: "Room.Member" })
export interface Member extends Schema.Schema.Type<typeof Member> {}

// A member as the host sees it, with when the server last heard from them.
export const MemberView = Schema.Struct({
  ...Member.fields,
  seen: Schema.Number.pipe(Schema.optional),
  online: Schema.Boolean,
}).annotate({ identifier: "Room.MemberView" })
export interface MemberView extends Schema.Schema.Type<typeof MemberView> {}

// Keeps a banned guest out of one room by device key or by address.
export const Ban = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  device: Schema.String.pipe(Schema.optional),
  address: Schema.String.pipe(Schema.optional),
  created: Schema.Number,
}).annotate({ identifier: "Room.Ban" })
export interface Ban extends Schema.Schema.Type<typeof Ban> {}

// What a guest receives for a valid join code: the token to send as a Bearer
// credential on guest routes, scoped to this one room.
export const Joined = Schema.Struct({
  token: Schema.String,
  guest: Guest,
  role: Role,
  room: Info,
}).annotate({ identifier: "Room.Joined" })
export interface Joined extends Schema.Schema.Type<typeof Joined> {}

// What a guest sees of the shared session: who said what. Tool calls, reasoning
// and file paths stay on the host.
export const Message = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  // The guest's name, "host" for the host's own prompts, absent for the model.
  author: Schema.String.pipe(Schema.optional),
  text: Schema.String,
  created: Schema.Number,
}).annotate({ identifier: "Room.Message" })
export interface Message extends Schema.Schema.Type<typeof Message> {}

// What a host's computer offers the AIs of its guests: its system, its shells and the
// tools its Registry finds, the state of the shared project, and the plots teams hold
// there, so another computer's AI can ask it for what only this machine can do.
export const Passport = Schema.Struct({
  machine: Schema.String,
  os: Schema.String,
  release: Schema.String,
  arch: Schema.String,
  shells: Schema.Array(Schema.String),
  tools: Schema.Array(Schema.String),
  project: Schema.Struct({
    directory: Schema.String,
    branch: Schema.String.pipe(Schema.optional),
    commit: Schema.String.pipe(Schema.optional),
    // Files changed and not yet committed.
    changed: Schema.Number.pipe(Schema.optional),
  }),
  plots: Schema.Array(
    Schema.Struct({
      team: Schema.String,
      machine: Schema.String,
      purpose: Schema.String,
      paths: Schema.Array(Schema.String),
      expires: Schema.Number,
    }),
  ),
}).annotate({ identifier: "Room.Passport" })
export interface Passport extends Schema.Schema.Type<typeof Passport> {}

// A command a cohost's AI ran on the host's computer, once the host allowed it.
export const RunResult = Schema.Struct({
  shell: Schema.String,
  exitCode: Schema.Number,
  output: Schema.String,
  // Set when the output was longer than what comes back.
  cut: Schema.Boolean.pipe(Schema.optional),
}).annotate({ identifier: "Room.RunResult" })
export interface RunResult extends Schema.Schema.Type<typeof RunResult> {}

// One item of the shared project's Definition of Done (.opencode/dod.yaml) as a room shows
// it. The DoD is the room's shared work queue: a guest or its AI takes a free item, the
// host's file records who has it, and everyone in the room sees who does what.
export const DodItem = Schema.Struct({
  id: Schema.String,
  what: Schema.String,
  stage: Schema.String,
  // The file's task_state: NOT_STARTED, IN_PROGRESS, BLOCKED, FAILED, DONE or OUT_OF_SCOPE.
  state: Schema.String,
  // Steps checked and steps in all.
  done: Schema.Number,
  total: Schema.Number,
  // The name of whoever took the item; absent while it is free.
  owner: Schema.String.pipe(Schema.optional),
  // The room member who holds it; absent for items the host's own people or AIs marked.
  ownerID: Schema.String.pipe(Schema.optional),
  // The holder left the room or has been silent past the lease, so anyone may take it over.
  stale: Schema.Boolean.pipe(Schema.optional),
  // Set on a guest's own items in what that guest reads.
  mine: Schema.Boolean.pipe(Schema.optional),
  // Items this one depends on that are not finished yet; it cannot be taken before them.
  waits: Schema.Array(Schema.String).pipe(Schema.optional),
  // The item's verification.command, which the host runs when the holder submits the item.
  verify: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Room.DodItem" })
export interface DodItem extends Schema.Schema.Type<typeof DodItem> {}

// The handover note of a DoD item, .opencode/notes/dod-<item>.md: what was done, the dead
// ends and the next step, kept for whoever holds the item next.
export const DodNote = Schema.Struct({
  name: Schema.String,
  text: Schema.String,
}).annotate({ identifier: "Room.DodNote" })
export interface DodNote extends Schema.Schema.Type<typeof DodNote> {}

export const Dod = Schema.Struct({
  items: Schema.Array(DodItem),
  // Explicit observation from the host: missing configuration is not a successful empty board.
  // Optional for compatibility with older hosts that do not send a status yet.
  status: Schema.Literals(["ready", "disabled"]).pipe(Schema.optional),
  // After a take: the item taken, and its handover note when one was written.
  taken: Schema.String.pipe(Schema.optional),
  note: DodNote.pipe(Schema.optional),
  // After a submit: what the host's run of the item's check printed.
  check: Schema.Struct({ exitCode: Schema.Number, output: Schema.String }).pipe(Schema.optional),
}).annotate({ identifier: "Room.Dod" })
export interface Dod extends Schema.Schema.Type<typeof Dod> {}

// What happened in a room, newest last: who came and went, who took, gave back, submitted
// or ran what. The host keeps the latest events in memory; a restart starts the feed anew.
export const EventKind = Schema.Literals([
  "join",
  "leave",
  "remove",
  "ban",
  "take",
  "release",
  "expire",
  "pass",
  "fail",
  "run",
])
export type EventKind = typeof EventKind.Type

export const Event = Schema.Struct({
  // Rises by one per event in the room, so a reader asks only for what came after the last it saw.
  seq: Schema.Number,
  at: Schema.Number,
  kind: EventKind,
  // The member's name, or "host".
  who: Schema.String,
  // The DoD item, for take, release, expire, pass and fail.
  item: Schema.String.pipe(Schema.optional),
  // A command for run; the first line of the check's output for fail.
  detail: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Room.Event" })
export interface Event extends Schema.Schema.Type<typeof Event> {}

export const Feed = Schema.Struct({
  events: Schema.Array(Event),
}).annotate({ identifier: "Room.Feed" })
export interface Feed extends Schema.Schema.Type<typeof Feed> {}
