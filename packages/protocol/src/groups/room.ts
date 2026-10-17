import { Room } from "@opencode/schema/room"
import { RoomMesh } from "@opencode/schema/room-mesh"
import { RoomRules } from "@opencode/schema/room-rules"
import { Session } from "@opencode/schema/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { EventLog } from "@opencode/schema/event-log"
import { Event } from "@opencode/schema/event"
import { Note } from "@opencode/schema/note"
import { Permission } from "@opencode/schema/permission"
import { Model } from "@opencode/schema/model"
import { Agent } from "@opencode/schema/agent"
import { Command } from "@opencode/schema/command"
import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import {
  CommandExecutionError,
  CommandNotFoundError,
  ForbiddenError,
  LocationNotFoundError,
  InvalidCursorError,
  InvalidRequestError,
  PermissionNotFoundError,
  RoomNotFoundError,
  SessionNotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  UnknownError,
} from "../errors.js"
import { BooleanFromString } from "./session.js"
import { PublicSessionMessage, SessionMessagesQuery } from "./message.js"

// Guest routes carry a room token instead of the server credential, so the
// Authorization middleware lets them through and the room handler verifies the
// token against the one room it names. The paths are listed one by one rather
// than as a "/api/room/<id>/guest/*" prefix: a prefix would hand every future
// handler under that prefix the same exemption, so an unregistered path would
// reach the server unchecked. A route belongs here once RoomGroup registers it.
const GUEST_PATHS = [
  // room.join, room.public, and authenticated Mesh peer RPC.
  /^\/api\/room\/(join|public)$/,
  /^\/api\/room\/mesh\/rpc$/,
  // room.guest.get, room.guest.leave
  /^\/api\/room\/[^/]+\/guest$/,
  // room.guest.session.list, room.guest.session.create
  /^\/api\/room\/[^/]+\/guest\/session$/,
  // room.guest.session.messages
  /^\/api\/room\/[^/]+\/guest\/session\/message$/,
  // room.guest.session.model
  /^\/api\/room\/[^/]+\/guest\/session\/[^/]+\/model$/,
  // room.guest.session.agent
  /^\/api\/room\/[^/]+\/guest\/session\/[^/]+\/agent$/,
  // room.guest.session.command
  /^\/api\/room\/[^/]+\/guest\/session\/[^/]+\/command$/,
  // room.guest.model.list
  /^\/api\/room\/[^/]+\/guest\/model$/,
  // room.guest.agent.list
  /^\/api\/room\/[^/]+\/guest\/agent$/,
  // room.guest.command.list
  /^\/api\/room\/[^/]+\/guest\/command$/,
  // room.guest.mcp.list
  /^\/api\/room\/[^/]+\/guest\/mcp$/,
  // room.guest.log
  /^\/api\/room\/[^/]+\/guest\/log$/,
  // room.guest.messages
  /^\/api\/room\/[^/]+\/guest\/message$/,
  // room.guest.note
  /^\/api\/room\/[^/]+\/guest\/note$/,
  // room.guest.prompt
  /^\/api\/room\/[^/]+\/guest\/prompt$/,
  // room.guest.permission.list
  /^\/api\/room\/[^/]+\/guest\/permission$/,
  // room.guest.permission.reply
  /^\/api\/room\/[^/]+\/guest\/permission\/[^/]+\/reply$/,
  // room.guest.passport
  /^\/api\/room\/[^/]+\/guest\/passport$/,
  // room.guest.run
  /^\/api\/room\/[^/]+\/guest\/run$/,
  // room.guest.dod.get, room.guest.dod.claim
  /^\/api\/room\/[^/]+\/guest\/dod$/,
  // room.guest.dod.submit
  /^\/api\/room\/[^/]+\/guest\/dod\/submit$/,
  // room.guest.feed
  /^\/api\/room\/[^/]+\/guest\/feed$/,
]

// Reading the feed: events after a seq, and how long an empty answer may wait for the next.
const FeedQuery = {
  after: Schema.NumberFromString.pipe(Schema.optional),
  wait: Schema.NumberFromString.pipe(Schema.optional),
}

export function isRoomGuestURL(url: URL) {
  return GUEST_PATHS.some((path) => path.test(url.pathname))
}

// A room on another computer this computer joined, with the guest token its host issued.
const RoomLink = Schema.Struct({
  url: Schema.String,
  roomID: Schema.String,
  token: Schema.String,
  name: Schema.String,
  guest: Schema.String,
}).annotate({ identifier: "Room.Link" })

export const RoomGroup = HttpApiGroup.make("server.room")
  .add(
    HttpApiEndpoint.get("room.list", "/api/room", {
      success: Schema.Struct({ data: Schema.Array(Room.Info) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.list",
        summary: "List rooms",
        description: "List the rooms this host shares with other devices.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.create", "/api/room", {
      payload: Schema.Struct({
        sessionID: Session.ID,
        name: Schema.String.pipe(Schema.optional),
        hostName: Schema.String.pipe(Schema.optional),
        ai: Room.AiMessaging.pipe(Schema.optional),
        guestApprovals: Schema.Boolean.pipe(Schema.optional),
        defaultRole: Room.DefaultRole.pipe(Schema.optional),
        open: Schema.Boolean.pipe(Schema.optional),
        rules: RoomRules.Rules.pipe(Schema.optional),
        // Share the whole project under this directory, not just the session.
        directory: Schema.String.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: Room.Info }),
      error: [SessionNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.create",
        summary: "Create room",
        description: "Share a session as a room that other devices can join with a code.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("room.update", "/api/room/:roomID", {
      params: { roomID: Room.ID },
      payload: Schema.Struct({
        name: Schema.String.pipe(Schema.optional),
        hostName: Schema.String.pipe(Schema.optional),
        ai: Room.AiMessaging.pipe(Schema.optional),
        guestApprovals: Schema.Boolean.pipe(Schema.optional),
        defaultRole: Room.DefaultRole.pipe(Schema.optional),
        open: Schema.Boolean.pipe(Schema.optional),
        rules: RoomRules.Rules.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: Room.Info }),
      error: [RoomNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.update",
        summary: "Update room",
        description: "Rename a room, set the host nickname, or change what guests and the host model may do in it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("room.remove", "/api/room/:roomID", {
      params: { roomID: Room.ID },
      success: HttpApiSchema.NoContent,
      error: RoomNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.remove",
        summary: "Close room",
        description: "Stop sharing a room. Its session stays; every guest token for it stops working.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.dod.get", "/api/room/:roomID/dod", {
      params: { roomID: Room.ID },
      success: Room.Dod,
      error: [RoomNotFoundError, SessionNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.dod.get",
        summary: "Read a room's DoD",
        description: "The items of the shared project's Definition of Done, with the guests who took them.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.dod.release", "/api/room/:roomID/dod/release", {
      params: { roomID: Room.ID },
      payload: Schema.Struct({ id: Schema.String }),
      success: Room.Dod,
      error: [RoomNotFoundError, SessionNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.dod.release",
        summary: "Free a DoD item a guest took",
        description: "Give a guest's DoD item back to the room, for a guest who left or stopped working on it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.feed", "/api/room/:roomID/feed", {
      params: { roomID: Room.ID },
      query: FeedQuery,
      success: Room.Feed,
      error: [RoomNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.feed",
        summary: "Read a room's feed",
        description:
          "What happened in the room after a seq: joins and leaves, DoD items taken, given back, expired, passed or failed, and commands run. With wait, an empty answer waits that many milliseconds for the next event.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.code", "/api/room/:roomID/code", {
      params: { roomID: Room.ID },
      success: Room.JoinCode,
      error: RoomNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.code",
        summary: "Create join code",
        description: "Create a short-lived code that lets devices join this room until it expires.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.public", "/api/room/public", {
      success: Schema.Struct({
        host: Schema.String,
        // A closed room is listed so a device can see it exists and ask for its code,
        // but its name stays on the host: this route needs no credential, and the
        // name is the only part of a closed room worth hiding. Optional rather than
        // empty: absent says "the host is not sharing it", empty would look like a
        // room actually called nothing.
        rooms: Schema.Array(Schema.Struct({ id: Room.ID, name: optional(Schema.String), open: Schema.Boolean })),
        // Safe discovery metadata only: never expose the invitation secret on this public endpoint.
        mesh: Schema.Struct({
          clusterID: Schema.String,
          status: Schema.Literals(["forming", "active"]),
          name: Schema.String,
          ownerURL: Schema.String,
          isOwner: Schema.Boolean,
          memberCount: Schema.Int,
        }).pipe(Schema.optional),
      }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.public",
        summary: "List joinable rooms",
        description:
          "Names of the rooms this host shares, for devices looking for rooms on the network, and whether each one lets guests in without a code. A closed room is listed without its name.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.join", "/api/room/join", {
      // An open room is joined by its ID; any other room needs the code its host hands out.
      payload: Schema.Struct({
        code: Schema.String.pipe(Schema.optional),
        roomID: Room.ID.pipe(Schema.optional),
        name: Schema.String,
        // A random key the guest's client keeps, so a ban outlasts a new name.
        device: Schema.String.pipe(Schema.optional),
      }),
      success: Room.Joined,
      error: [UnauthorizedError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.join",
        summary: "Join room",
        description: "Redeem a join code, or name an open room, for a guest token scoped to one room.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.get", "/api/room/:roomID/guest", {
      params: { roomID: Room.ID },
      // A session of the room; the room's own session when omitted.
      query: { sessionID: Session.ID.pipe(Schema.optional) },
      success: Schema.Struct({ room: Room.Info, guest: Room.Guest, role: Room.Role, session: Session.Info }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.get",
        summary: "Get joined room",
        description: "Return the room, the calling guest and the shared session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.session.messages", "/api/room/:roomID/guest/session/message", {
      params: { roomID: Room.ID },
      query: Schema.Struct({ ...SessionMessagesQuery.fields, sessionID: Session.ID.pipe(Schema.optional) }),
      success: Schema.Struct({
        data: Schema.Array(PublicSessionMessage),
        cursor: Schema.Struct({
          previous: Schema.String.pipe(Schema.optional),
          next: Schema.String.pipe(Schema.optional),
        }),
      }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError, InvalidCursorError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.session.messages",
        summary: "Read the shared session",
        description:
          "The shared session's full messages, tool calls included, paged like the session message list, so guests see the session as the host does.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.link.list", "/api/room/link", {
      success: Schema.Struct({ data: Schema.Array(RoomLink) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.link.list",
        summary: "List joined rooms",
        description: "Rooms on other computers this computer joined, which its AI can work with.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("room.link.save", "/api/room/link", {
      payload: RoomLink,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.link.save",
        summary: "Remember a joined room",
        description: "Keep a room this computer joined, with its guest token, so this computer's AI can reach it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.link.remove", "/api/room/link/remove", {
      payload: Schema.Struct({ url: Schema.String, roomID: Schema.String }),
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.link.remove",
        summary: "Forget a joined room",
        description: "Forget a room this computer left; its AI no longer reaches it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.passport", "/api/room/:roomID/guest/passport", {
      params: { roomID: Room.ID },
      success: Room.Passport,
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.passport",
        summary: "Describe the host's computer",
        description:
          "The host's system, shells, Registry tools, the shared project's git state and the plots teams hold there.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.run", "/api/room/:roomID/guest/run", {
      params: { roomID: Room.ID },
      payload: Schema.Struct({ command: Schema.String, sessionID: Session.ID.pipe(Schema.optional) }),
      success: Room.RunResult,
      error: [UnauthorizedError, ForbiddenError, RoomNotFoundError, SessionNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.run",
        summary: "Run a command on the host's computer",
        description:
          "Run one command in a room session's directory with the host's shell, once the host allows it; cohosts only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.dod.get", "/api/room/:roomID/guest/dod", {
      params: { roomID: Room.ID },
      success: Room.Dod,
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.dod.get",
        summary: "Read the shared project's DoD",
        description: "The items of the host project's Definition of Done, with who took each one.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.dod.claim", "/api/room/:roomID/guest/dod", {
      params: { roomID: Room.ID },
      payload: Schema.Struct({
        // The item; with next instead, the server picks the first one the guest may start.
        id: Schema.String.pipe(Schema.optional),
        next: Schema.Boolean.pipe(Schema.optional),
        // True takes the item for the calling guest, false gives it back.
        take: Schema.Boolean,
        // On giving back: what was done, the dead ends and the next step, added to the item's handover note.
        handover: Schema.String.pipe(Schema.optional),
        // The room session that will do the work; the room's own when omitted.
        sessionID: Session.ID.pipe(Schema.optional),
        // Files or folders of the project the work changes, taken as a plot for that session.
        paths: Schema.Array(Schema.String).pipe(Schema.optional),
      }),
      success: Room.Dod,
      error: [UnauthorizedError, ForbiddenError, RoomNotFoundError, SessionNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.dod.claim",
        summary: "Take or give back a DoD item",
        description:
          "Take a free item of the host project's DoD for the calling guest, or the first ready one with next, optionally holding a plot over the paths it changes, or give back one the guest took; members and above. An item waiting for unfinished items cannot be taken, and one whose holder's lease ran out can. A take answers with the item's handover note.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.dod.submit", "/api/room/:roomID/guest/dod/submit", {
      params: { roomID: Room.ID },
      payload: Schema.Struct({
        id: Schema.String,
        // What was done, added to the item's handover note.
        handover: Schema.String.pipe(Schema.optional),
      }),
      success: Room.Dod,
      error: [UnauthorizedError, ForbiddenError, RoomNotFoundError, SessionNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.dod.submit",
        summary: "Submit a DoD item for the host's check",
        description:
          "The host runs the item's verification.command in its project and records the result: exit code 0 makes the item DONE with its evidence, anything else FAILED. Only the guest holding the item submits it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.feed", "/api/room/:roomID/guest/feed", {
      params: { roomID: Room.ID },
      query: FeedQuery,
      success: Room.Feed,
      error: [UnauthorizedError, RoomNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.feed",
        summary: "Read the room's feed",
        description:
          "What happened in the room after a seq. With wait, an empty answer waits that many milliseconds for the next event.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("room.guest.leave", "/api/room/:roomID/guest", {
      params: { roomID: Room.ID },
      success: HttpApiSchema.NoContent,
      error: [UnauthorizedError, RoomNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.leave",
        summary: "Leave the room",
        description:
          "Stop being a member of the room; the guest's token stops working and the host no longer lists it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.session.list", "/api/room/:roomID/guest/session", {
      params: { roomID: Room.ID },
      success: Schema.Struct({
        data: Schema.Array(Session.Info),
        // The host's categories by session ID; a shared-session room has none.
        category: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
      }),
      error: [UnauthorizedError, RoomNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.session.list",
        summary: "List the room's sessions",
        description: "The sessions a guest may open: every top-level session of a project room, or the shared one.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.session.create", "/api/room/:roomID/guest/session", {
      params: { roomID: Room.ID },
      payload: Schema.Struct({ title: Schema.String.pipe(Schema.optional) }),
      success: Schema.Struct({ data: Session.Info }),
      error: [UnauthorizedError, ForbiddenError, RoomNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.session.create",
        summary: "Start a session in the room",
        description: "Start a new session in a project room's directory. Viewers may not.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.model.list", "/api/room/:roomID/guest/model", {
      params: { roomID: Room.ID },
      success: Schema.Struct({ data: Schema.Array(Model.Info) }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.model.list",
        summary: "List the host's models",
        description: "The models the host can run in this room's sessions.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.agent.list", "/api/room/:roomID/guest/agent", {
      params: { roomID: Room.ID },
      success: Schema.Struct({ data: Schema.Array(Agent.Info) }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.agent.list",
        summary: "List the host's agents",
        description: "The agents the host can run in this room's sessions.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.mcp.list", "/api/room/:roomID/guest/mcp", {
      params: { roomID: Room.ID },
      // Names and states only: a failure's message can carry the host's paths and settings.
      success: Schema.Struct({
        data: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            status: Schema.Literals(["connected", "pending", "disabled", "failed", "needs_auth"]),
          }),
        ),
      }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.mcp.list",
        summary: "List the host's MCP servers",
        description: "The MCP servers the host's model can use in this room's sessions, with their state.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.command.list", "/api/room/:roomID/guest/command", {
      params: { roomID: Room.ID },
      success: Schema.Struct({ data: Schema.Array(Command.Info) }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.command.list",
        summary: "List the host's commands",
        description: "The commands a cohost may run in this room's sessions.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.session.model", "/api/room/:roomID/guest/session/:sessionID/model", {
      params: { roomID: Room.ID, sessionID: Session.ID },
      payload: Schema.Struct({ model: Model.Ref }),
      success: HttpApiSchema.NoContent,
      error: [UnauthorizedError, ForbiddenError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.session.model",
        summary: "Switch a room session's model",
        description: "Switch the model of one of the room's sessions; cohosts only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.session.agent", "/api/room/:roomID/guest/session/:sessionID/agent", {
      params: { roomID: Room.ID, sessionID: Session.ID },
      payload: Schema.Struct({ agent: Agent.ID }),
      success: HttpApiSchema.NoContent,
      error: [UnauthorizedError, ForbiddenError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.session.agent",
        summary: "Switch a room session's agent",
        description: "Switch the agent of one of the room's sessions; cohosts only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.session.command", "/api/room/:roomID/guest/session/:sessionID/command", {
      params: { roomID: Room.ID, sessionID: Session.ID },
      payload: Schema.Struct({ name: Schema.String, text: Schema.String }),
      success: HttpApiSchema.NoContent,
      error: [
        UnauthorizedError,
        ForbiddenError,
        RoomNotFoundError,
        SessionNotFoundError,
        CommandNotFoundError,
        CommandExecutionError,
        LocationNotFoundError,
      ],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.session.command",
        summary: "Run a command in a room session",
        description: "Run one of the host's commands, such as compact, in one of the room's sessions; cohosts only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.member.list", "/api/room/:roomID/member", {
      params: { roomID: Room.ID },
      success: Schema.Struct({ data: Schema.Array(Room.MemberView) }),
      error: RoomNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.member.list",
        summary: "List room members",
        description: "The guests admitted to a room, their roles and whether they are connected now.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("room.member.update", "/api/room/:roomID/member/:guestID", {
      params: { roomID: Room.ID, guestID: Schema.String },
      payload: Schema.Struct({ role: Room.Role }),
      success: Schema.Struct({ data: Room.Member }),
      error: [RoomNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.member.update",
        summary: "Change a member's role",
        description: "Let a guest only watch, also write, or also answer the model's permission requests.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("room.member.remove", "/api/room/:roomID/member/:guestID", {
      params: { roomID: Room.ID, guestID: Schema.String },
      success: HttpApiSchema.NoContent,
      error: [RoomNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.member.remove",
        summary: "Remove a member",
        description: "Revoke a guest's token; the guest may join again with a code or an open room.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.member.ban", "/api/room/:roomID/member/:guestID/ban", {
      params: { roomID: Room.ID, guestID: Schema.String },
      success: Schema.Struct({ data: Room.Ban }),
      error: [RoomNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.member.ban",
        summary: "Ban a member",
        description: "Remove a guest and keep its device and address out of this room.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.ban.list", "/api/room/:roomID/ban", {
      params: { roomID: Room.ID },
      success: Schema.Struct({ data: Schema.Array(Room.Ban) }),
      error: RoomNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.ban.list",
        summary: "List room bans",
        description: "Guests kept out of this room.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("room.ban.remove", "/api/room/:roomID/ban/:banID", {
      params: { roomID: Room.ID, banID: Schema.String },
      success: HttpApiSchema.NoContent,
      error: RoomNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.ban.remove",
        summary: "Lift a ban",
        description: "Let a banned guest join this room again.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.log", "/api/room/:roomID/guest/log", {
      params: { roomID: Room.ID },
      query: {
        sessionID: Session.ID.pipe(Schema.optional),
        after: Schema.NumberFromString.pipe(Schema.decodeTo(Event.Seq), Schema.optional),
        follow: BooleanFromString.pipe(Schema.optional),
      },
      success: HttpApiSchema.StreamSse({
        // Permission requests and stream fragments (text, reasoning, tool input and progress) are
        // not durable, so a following log also carries them; guests watch the host model work live.
        data: Schema.Union([
          SessionEvent.Durable,
          ...SessionEvent.EphemeralDefinitions,
          EventLog.Synced,
          Permission.Event.Asked,
          Permission.Event.Replied,
        ]).annotate({ identifier: "RoomLogItem" }),
      }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.log",
        summary: "Read the room log",
        description: "The shared session's durable event log, continuing with live events when follow=true.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.messages", "/api/room/:roomID/guest/message", {
      params: { roomID: Room.ID },
      // A session of the room; the room's own session when omitted.
      query: { sessionID: Session.ID.pipe(Schema.optional) },
      success: Schema.Struct({
        data: Schema.Array(Room.Message),
        running: Schema.Boolean,
        // Set while the shared session is bound to a note, so guests know prompts write into it.
        note: optional(Schema.Struct({ name: Note.Slug, title: Schema.String })),
      }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.messages",
        summary: "Read the room chat",
        description:
          "The latest messages of the shared session as plain chat, whether the host model is working, and the note the session writes into, if any.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.note", "/api/room/:roomID/guest/note", {
      params: { roomID: Room.ID },
      // A session of the room; the room's own session when omitted.
      query: { sessionID: Session.ID.pipe(Schema.optional) },
      success: Schema.Struct({ data: Schema.NullOr(Note.Info) }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.note",
        summary: "Read the room note",
        description:
          "The note bound to the shared session, which prompts in this room write into, or null when none is bound.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.prompt", "/api/room/:roomID/guest/prompt", {
      params: { roomID: Room.ID },
      payload: Schema.Struct({
        // A client-minted message ID, so the guest shows its message before the host answers
        // and a retry with the same ID is admitted once.
        id: SessionMessage.ID.pipe(Schema.optional),
        text: Schema.String,
        sessionID: Session.ID.pipe(Schema.optional),
        // Set when the guest's AI writes rather than the person, so the host shows it as such.
        ai: Schema.Boolean.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: SessionInbox.User }),
      error: [UnauthorizedError, ForbiddenError, RoomNotFoundError, SessionNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.prompt",
        summary: "Send a message to the room",
        description:
          "Post a message into the shared session as the calling guest; the host model answers. Viewers may not post.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.guest.permission.list", "/api/room/:roomID/guest/permission", {
      params: { roomID: Room.ID },
      // A session of the room; the room's own session when omitted.
      query: { sessionID: Session.ID.pipe(Schema.optional) },
      success: Schema.Struct({ data: Schema.Array(Permission.Request) }),
      error: [UnauthorizedError, RoomNotFoundError, SessionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.permission.list",
        summary: "List room permission requests",
        description: "Pending permission requests of the shared session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.guest.permission.reply", "/api/room/:roomID/guest/permission/:requestID/reply", {
      params: { roomID: Room.ID, requestID: Permission.ID },
      payload: Schema.Struct({
        decision: Permission.Reply,
        message: Schema.String.pipe(Schema.optional),
        // The session that asked; the room's own session when omitted.
        sessionID: Session.ID.pipe(Schema.optional),
      }),
      success: HttpApiSchema.NoContent,
      error: [UnauthorizedError, ForbiddenError, RoomNotFoundError, SessionNotFoundError, PermissionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.guest.permission.reply",
        summary: "Answer a room permission request",
        description: "Answer the host model's permission request; allowed only to guests with the helper role.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.mesh.status", "/api/room/mesh", {
      success: RoomMesh.Snapshot,
      error: [InvalidRequestError, UnauthorizedError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.mesh.status",
        summary: "Read the local Mesh status",
        description: "Read this device's view of its replicated Mesh room, elected coordinator and quorum health.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.mesh.invite", "/api/room/mesh/invite", {
      success: Schema.Struct({ token: Schema.String }),
      error: [InvalidRequestError, UnauthorizedError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.mesh.invite",
        summary: "Read the owner's Mesh invitation token",
        description: "Return the existing Mesh invitation token only to the original owner so it can invite additional learner devices after activation.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.mesh.create", "/api/room/mesh", {
      payload: RoomMesh.CreateInput,
      success: Schema.Struct({ data: RoomMesh.Snapshot, token: Schema.String }),
      error: [InvalidRequestError, UnauthorizedError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.mesh.create",
        summary: "Create a Mesh room",
        description: "Create a forming Mesh and return its enrollment secret for the other devices.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.mesh.join", "/api/room/mesh/join", {
      payload: RoomMesh.JoinInput,
      success: RoomMesh.Snapshot,
      error: [InvalidRequestError, UnauthorizedError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.mesh.join",
        summary: "Enroll this device in a Mesh",
        description: "Join a forming Mesh through a reachable seed device and its enrollment secret.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.mesh.leave", "/api/room/mesh/leave", {
      success: RoomMesh.Snapshot,
      error: [InvalidRequestError, UnauthorizedError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.mesh.leave",
        summary: "Disconnect this device from its local Mesh",
        description: "Forget the Mesh state stored on this device so it can join another room. Remaining peers keep their current fixed membership.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.mesh.activate", "/api/room/mesh/activate", {
      success: RoomMesh.Snapshot,
      error: [InvalidRequestError, UnauthorizedError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.mesh.activate",
        summary: "Activate a Mesh room",
        description: "Prepare the same voter set on all enrolled devices before starting coordinator elections.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.mesh.append", "/api/room/mesh/append", {
      payload: RoomMesh.AppendInput,
      success: RoomMesh.Entry,
      error: [InvalidRequestError, UnauthorizedError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.mesh.append",
        summary: "Append a shared Mesh event",
        description: "Propose a message or task; the event is accepted only after majority commit.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("room.mesh.feed", "/api/room/mesh/feed", {
      query: { after: Schema.NumberFromString.pipe(Schema.optional) },
      success: RoomMesh.Feed,
      error: [UnauthorizedError, ForbiddenError, InvalidRequestError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.mesh.feed",
        summary: "Read committed Mesh events",
        description: "Read committed room events from a cursor. Uncommitted entries are not exposed.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("room.mesh.rpc", "/api/room/mesh/rpc", {
      payload: RoomMesh.RpcRequest,
      success: RoomMesh.RpcResponse,
      error: [InvalidRequestError, UnauthorizedError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "room.mesh.rpc",
        summary: "Exchange authenticated Mesh protocol messages",
        description: "Internal peer transport for enrollment, elections and log replication. Requires the Mesh bearer secret.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "room", description: "Rooms shared with other devices." }))
