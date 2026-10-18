import { Instance } from "@opencode/core/instance/service"
import { Bus } from "@opencode/core/bus"
import { NoteStore } from "@opencode/core/note"
import { Permission } from "@opencode/core/permission"
import { Room } from "@opencode/core/room"
import { Peer } from "@opencode/core/peer"
import { Plot } from "@opencode/core/plot"
import { Passport } from "@opencode/core/passport"
import { RoomRules } from "@opencode/schema/room-rules"
import { Dod } from "@opencode/core/dod"
import path from "node:path"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/schema/session-event"
import { Model } from "@opencode/core/model"
import { Agent } from "@opencode/core/agent"
import { Mcp } from "@opencode/core/mcp/index"
import { Command } from "@opencode/core/command"
import { AbsolutePath } from "@opencode/core/schema"
import { Orchestra } from "@opencode/schema/orchestra"
import { Orchestra as OrchestraService } from "@opencode/core/orchestra"
import {
  CommandExecutionError,
  CommandNotFoundError,
  ForbiddenError,
  InvalidRequestError,
  PermissionNotFoundError,
  RoomNotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "@opencode/protocol/errors"
import { hostname } from "node:os"
import { randomBytes } from "node:crypto"
import { DateTime, Effect, Option, Predicate, Queue, Schema, Stream } from "effect"
import type { SessionMessage } from "@opencode/core/session/message"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ServerAuth } from "../auth"
import { locationErrors, sessionInfo } from "../location"
import { ServerRooms } from "../rooms"
import { ServerMesh } from "../mesh"
import { missingSession } from "./session-error"
import { messagePage } from "./message"

function missingRequest(id: Permission.ID) {
  return new PermissionNotFoundError({ requestID: id, message: `Permission request not found: ${id}` })
}

const CHAT_LIMIT = 100

function chatMessage(message: SessionMessage.Info, hostName = "host"): Room.Message[] {
  const created = DateTime.toEpochMillis(message.time.created)
  if (message.type === "user") {
    const room = message.metadata?.room
    const author = Predicate.isObject(room) && Predicate.isObject(room.guest) ? room.guest.name : undefined
    return [
      {
        id: message.id,
        role: "user" as const,
        author: typeof author === "string" ? author : hostName,
        text: message.text,
        created,
      },
    ]
  }
  if (message.type !== "assistant") return []
  const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  return text ? [{ id: message.id, role: "assistant" as const, text, created }] : []
}

const RANK: Record<Room.Role, number> = { viewer: 0, member: 1, helper: 2, cohost: 3, trusted: 4 }

// Sessions a project room lists; enough for a shared project, bounded for a busy host.
const SESSION_LIMIT = 200

// Guests a room keeps; joining an open room needs no code, so a flood of joins stops here.
const MEMBER_LIMIT = 100

// Requests that run a command on the host for a guest. Only the host answers them, so a
// cohost or helper cannot approve its own command.
const HOST_ONLY = new Set(["room.run", "room.check", "room.program"])

// The live events a following guest log adds to the durable ones. Stream fragments (text,
// reasoning, tool input, compaction) and tool progress are ephemeral, so they never appear in
// the durable replay even though the UI needs them to show the host model working live.
const RoomLiveEvent = Schema.Union([
  Permission.Event.Asked,
  Permission.Event.Replied,
  SessionEvent.AgentSelected,
  SessionEvent.ModelSelected,
  SessionEvent.Renamed,
  SessionEvent.Execution.Started,
  SessionEvent.Execution.Succeeded,
  SessionEvent.Execution.Failed,
  SessionEvent.Execution.Interrupted,
  SessionEvent.Step.Started,
  SessionEvent.Step.Streamed,
  SessionEvent.Step.Ended,
  SessionEvent.Step.Failed,
  SessionEvent.Text.Started,
  SessionEvent.Text.Ended,
  SessionEvent.Reasoning.Started,
  SessionEvent.Reasoning.Ended,
  SessionEvent.Tool.Input.Started,
  SessionEvent.Tool.Input.Ended,
  SessionEvent.Tool.Called,
  SessionEvent.Tool.Success,
  SessionEvent.Tool.Failed,
  SessionEvent.RetryScheduled,
  SessionEvent.Compaction.Started,
  SessionEvent.Compaction.Ended,
  SessionEvent.Compaction.Failed,
  SessionEvent.Shell.Started,
  SessionEvent.Shell.Ended,
  SessionEvent.Synthetic,
  SessionEvent.Skill.Activated,
  ...SessionEvent.EphemeralDefinitions,
])
const decodeRoomLiveEvent = Schema.decodeUnknownOption(RoomLiveEvent)

// Control and format characters in a name would reach the host's terminal, notes and feed.
const UNSAFE_NAME = /[\p{Cc}\p{Cf}\u2028\u2029]/u

function invalidDisplayName(name: string | undefined, field: string) {
  if (name === undefined) return
  const value = name.trim()
  if (value === "" || value.length > 64)
    return new InvalidRequestError({ message: "Name must be 1 to 64 characters", field })
  if (UNSAFE_NAME.test(value))
    return new InvalidRequestError({ message: "Name has characters that cannot be shown", field })
}

// Loopback is left out: tunnels such as Porthole deliver every guest from it, so a ban on it would ban them all.
function remoteAddress(request: HttpServerRequest.HttpServerRequest) {
  const address = Option.getOrUndefined(request.remoteAddress)?.replace(/^::ffff:/, "")
  if (!address || address === "::1" || address.startsWith("127.")) return
  return address
}

function invalidDod(error: Dod.DodError) {
  return new InvalidRequestError({ message: error.message })
}

// A plot taken for a DoD item names the item first, so freeing the item finds it.
function dodPurpose(id: string, owner: string) {
  return `DoD ${id} for ${owner}`
}

// A guest reads its own items marked, so neither its client nor its AI matches by name.
function forGuest(dod: Room.Dod, member: Room.Member): Room.Dod {
  return { ...dod, items: dod.items.map((item) => (item.ownerID === member.id ? { ...item, mine: true } : item)) }
}

function redactForGuest<A>(room: Room.Info, directory: string, value: A): A {
  const filtered = RoomRules.hideExecutionFeed(room.rules, value)
  return RoomRules.sanitizeForGuest(filtered as A, room.rules, directory)
}

// The handover note of a DoD item: L-003 keeps its notes in dod-l-003.
function handoverName(id: string) {
  return `dod-${id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`.slice(0, 60)
}

// The last lines of a check's output, short enough for one line of the DoD.
function outputSummary(output: string, exitCode: number) {
  const tail = output.trim().split("\n").slice(-3).join(" / ").slice(0, 300)
  return tail || `exit code ${exitCode}, no output`
}

function missingRoom(error: Room.NotFoundError) {
  return Effect.fail(new RoomNotFoundError({ roomID: error.roomID, message: `Room not found: ${error.roomID}` }))
}

function meshError(error: ServerMesh.MeshError) {
  if (error.status === 401) return new UnauthorizedError({ message: error.message })
  if (error.status === 403) return new ForbiddenError({ message: error.message })
  if (error.status >= 500) return new ServiceUnavailableError({ message: error.message, service: "mesh room" })
  return new InvalidRequestError({ message: error.message })
}

export const RoomHandler = HttpApiBuilder.group(Api, "server.room", (handlers) =>
  Effect.gen(function* () {
    const rooms = yield* Room.Service
    const codes = yield* ServerRooms.Service
    const mesh = yield* ServerMesh.Service
    const sessions = yield* Session.Service
    const instances = yield* Instance.Service
    const auth = yield* ServerAuth.Config
    const peers = yield* Peer.Service
    const plots = yield* Plot.Service
    const bus = yield* Bus.Service
    const orchestra = yield* OrchestraService.Service

    // Guest routes skip the server credential; the room token is the only proof,
    // and it only opens the room it was issued for, while the host keeps its guest a member.
    const guestOf = Effect.fnUntraced(function* (roomID: Room.ID) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")?.[1]
      const token = bearer ? ServerRooms.verifyToken(auth, bearer) : undefined
      if (!token || token.roomID !== roomID)
        return yield* new UnauthorizedError({ message: "Room token is missing, expired or for another room" })
      const room = yield* rooms.get(roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
      const member = yield* rooms.member(roomID, token.guest.id)
      if (!member) return yield* new UnauthorizedError({ message: "The host removed you from this room" })
      codes.touch(member.id)
      return { room, guest: token.guest, member }
    })

    // Viewers read; posting needs member, answering permission requests needs helper, and
    // switching models or agents and running commands needs cohost.
    const guestWho = Effect.fnUntraced(function* (roomID: Room.ID, needs: Exclude<Room.Role, "viewer">) {
      const joined = yield* guestOf(roomID)
      if (RANK[joined.member.role] < RANK[needs])
        return yield* new ForbiddenError({
          message:
            needs === "cohost"
              ? "Only cohosts pick the model, the agent and commands in this room"
              : needs === "helper"
                ? "The host answers permission requests in this room"
                : "You may only watch this room",
        })
      return joined
    })

    // A session the room shares: its own, or for a project room any session under the
    // project's directory. Others read as missing so a guest learns nothing of them.
    const inRoom = Effect.fnUntraced(function* (room: Room.Info, sessionID?: Session.ID) {
      const id = sessionID ?? room.sessionID
      const session = yield* sessions.get(id).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
      if (id === room.sessionID) return session
      if (room.directory !== undefined && Orchestra.contains(room.directory, session.location.directory)) return session
      return yield* missingSession(new Session.NotFoundError({ sessionID: id }))
    })

    // Host-wide lists such as models and agents, read where the room's own session lives.
    const atRoom = <A, E, R>(room: Room.Info, effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const session = yield* sessions
          .get(room.sessionID)
          .pipe(Effect.catchTag("Session.NotFoundError", missingSession))
        return yield* effect.pipe(instances.provide(session), locationErrors, Effect.orDie)
      })

    const memberOf = Effect.fnUntraced(function* (roomID: Room.ID, guestID: string) {
      yield* rooms.get(roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
      const member = yield* rooms.member(roomID, guestID)
      if (!member) return yield* new InvalidRequestError({ message: "This guest is not in the room", field: "guestID" })
      return member
    })

    // Notes live in the session's location, which a guest never names, so the session decides where to look.
    const boundNote = Effect.fnUntraced(function* (sessionID: Session.ID) {
      const session = yield* sessionInfo(sessions, sessionID)
      return yield* NoteStore.Service.use((notes) => notes.bound(sessionID)).pipe(
        instances.provide(session),
        locationErrors,
        Effect.orDie,
      )
    })

    // The project a room shares: its directory, or the folder of its one session.
    const roomDirectory = Effect.fnUntraced(function* (room: Room.Info) {
      if (room.directory !== undefined) return room.directory
      const session = yield* sessions.get(room.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
      return session.location.directory
    })

    // Room rules are enforced before role exemptions. Trusted skips confirmations, not file or
    // outbound restrictions. "Always allow" saves the executable on this member's record only.
    const confirmRoomCommand = Effect.fnUntraced(function* (input: {
      room: Room.Info
      member: Room.Member
      session: Session.Info
      command: string
      metadata?: Record<string, unknown>
    }) {
      if (RoomRules.commandTouchesProtectedFile(input.room.rules, input.command))
        return yield* new ForbiddenError({ message: "This room keeps that file off limits to the AI" })
      if (input.room.rules?.noOutbound !== false && RoomRules.commandSendsOutbound(input.command))
        return yield* new ForbiddenError({ message: "This room forbids commands that send data outside" })
      if (input.member.role === "trusted") return

      const programs = RoomRules.programsForCommand(input.room.rules, input.command)
      if (programs.length === 0)
        return yield* new ForbiddenError({ message: "Could not identify the program to approve for this command" })
      const knownMember = yield* rooms.member(input.room.id, input.member.id)
      const approved = new Set(knownMember?.approvedPrograms ?? input.member.approvedPrograms ?? [])
      for (const program of programs) {
        if (approved.has(program)) continue
        yield* Permission.Service.use((permission) =>
          permission.confirm({
            action: "room.program",
            resources: [program],
            save: [program],
            force: true,
            metadata: {
              ...input.metadata,
              guest: input.member.name,
              program,
              command: input.command,
              scope: "this room member only",
            },
            sessionID: input.session.id,
            onAlways: () =>
              Effect.gen(function* () {
                const current = yield* rooms.member(input.room.id, input.member.id)
                if (!current) return
                yield* rooms.saveMember(input.room.id, {
                  ...current,
                  approvedPrograms: [...new Set([...(current.approvedPrograms ?? []), program])],
                })
                return
              }),
          }),
        ).pipe(
          instances.provide(input.session),
          locationErrors,
          Effect.catchTag("LocationNotFoundError", Effect.die),
          Effect.mapError(() => new ForbiddenError({ message: `The host did not approve use of ${program}` })),
        )
        approved.add(program)
      }
    })

    // Re-check current room policy after a permission wait. A host may tighten rules or
    // demote a member while the prompt is open; an old approval must not bypass the new policy.
    const assertCurrentRoomCommand = Effect.fnUntraced(function* (input: {
      roomID: Room.ID
      memberID: string
      command: string
      minimumRole: "member" | "cohost"
      initiallyRequiredPrograms: ReadonlyArray<string>
    }) {
      const found = yield* rooms.get(input.roomID).pipe(Effect.option)
      if (Option.isNone(found)) return yield* new ForbiddenError({ message: "This room is no longer available" })
      const room = found.value
      if (RoomRules.commandTouchesProtectedFile(room.rules, input.command))
        return yield* new ForbiddenError({ message: "This room keeps that file off limits to the AI" })
      if (room.rules?.noOutbound !== false && RoomRules.commandSendsOutbound(input.command))
        return yield* new ForbiddenError({ message: "This room forbids commands that send data outside" })

      const member = yield* rooms.member(room.id, input.memberID)
      if (!member || RANK[member.role] < RANK[input.minimumRole])
        return yield* new ForbiddenError({ message: "The host changed this member's role while the command was awaiting approval" })
      if (member.role === "trusted") return

      const approved = new Set(member.approvedPrograms ?? [])
      const newlyRequired = RoomRules.programsForCommand(room.rules, input.command).filter(
        (program) => !input.initiallyRequiredPrograms.includes(program) && !approved.has(program),
      )
      if (newlyRequired.length > 0)
        return yield* new ForbiddenError({
          message: "Room rules changed and now require approval for " + newlyRequired.join(", ") + ". Run the command again to request approval.",
        })
    })

    // A member keeps a DoD item while it stays in some room on this server and was heard
    // from within the lease; a restart counts as hearing from everyone once.
    const live = Effect.fnUntraced(function* () {
      const ids = new Set(
        (yield* Effect.forEach(yield* rooms.list(), (room) => rooms.members(room.id)))
          .flat()
          .map((member) => member.id),
      )
      const now = Date.now()
      return (ownerID: string) =>
        ids.has(ownerID) && now - (codes.seen(ownerID) ?? codes.started) < ServerRooms.LEASE_MS
    })

    const ownerOf = (member: Room.Member): Dod.Owner => ({ id: member.id, name: member.name })

    const readHandover = (room: Room.Info, id: string) =>
      atRoom(
        room,
        NoteStore.Service.use((notes) => notes.get(handoverName(id))).pipe(
          Effect.map((note): Room.DodNote => ({ name: note.name, text: note.body })),
          Effect.orElseSucceed(() => undefined),
        ),
      )

    // Adds a dated entry to the item's handover note, starting the note on its first entry.
    const writeHandover = (room: Room.Info, id: string, who: string, text: string) => {
      const name = handoverName(id)
      const entry = `\n## ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${who}\n\n${text.trim()}\n`
      return atRoom(
        room,
        NoteStore.Service.use((notes) =>
          notes.get(name).pipe(
            Effect.flatMap((note) => notes.edit({ name, body: entry, mode: "append", expectedMtime: note.mtime })),
            Effect.catchTag("NoteStore.NotFoundError", () =>
              notes.create({ name, title: `DoD ${id}`, body: entry.trimStart(), tags: ["dod"] }),
            ),
          ),
        ),
      )
    }

    // A member who left or was removed gives back what it held, and the room hears of it.
    const releaseMember = Effect.fnUntraced(function* (room: Room.Info, member: Room.Member) {
      const directory = yield* roomDirectory(room).pipe(Effect.orElseSucceed(() => undefined))
      if (directory === undefined) return
      const freed = yield* Dod.releaseOwner({ directory, ownerID: member.id }).pipe(Effect.orElseSucceed(() => []))
      yield* Effect.forEach(freed, (id) => freeDodPlots(directory, id))
      freed.forEach((id) => codes.record(room.id, { kind: "release", who: member.name, item: id }))
    })

    // Plots that were taken for a DoD item go with it, whichever session holds them.
    const freeDodPlots = Effect.fnUntraced(function* (directory: string, id: string) {
      const held = (yield* plots.list(directory)).filter((plot) => plot.purpose.startsWith(`DoD ${id} for `))
      yield* Effect.forEach(held, (plot) =>
        plot.members[0] ? plots.release({ sessionID: plot.members[0], directory, id: plot.id }) : Effect.void,
      )
    })

    return handlers
      .handle("room.list", () => rooms.list().pipe(Effect.map((data) => ({ data }))))
      .handle(
        "room.create",
        Effect.fn(function* (ctx) {
          const nameError = invalidDisplayName(ctx.payload.hostName, "hostName")
          if (nameError) return yield* nameError
          yield* sessions.get(ctx.payload.sessionID).pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          return { data: yield* rooms.create(ctx.payload) }
        }),
      )
      .handle(
        "room.update",
        Effect.fn(function* (ctx) {
          const nameError = invalidDisplayName(ctx.payload.hostName, "hostName")
          if (nameError) return yield* nameError
          return {
            data: yield* rooms
              .update(ctx.params.roomID, ctx.payload)
              .pipe(Effect.catchTag("Room.NotFoundError", missingRoom)),
          }
        }),
      )
      .handle(
        "room.remove",
        Effect.fn(function* (ctx) {
          yield* rooms.remove(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "room.code",
        Effect.fn(function* (ctx) {
          yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          return yield* codes.issueCode(ctx.params.roomID)
        }),
      )
      .handle(
        "room.public",
        Effect.fn(function* () {
          const list = yield* rooms.list()
          // Public Host discovery must still work if the optional Mesh store cannot be read.
          const meshResult = yield* mesh.status().pipe(
            Effect.map((value) => ({ value })),
            Effect.catchTag("ServerMesh.Error", () => Effect.succeed({ value: undefined })),
          )
          const state = meshResult.value
          const owner = state?.members.find((member) => member.id === state.ownerNodeID)
          const local = state?.members.find((member) => member.id === state.nodeID)
          const meshInfo =
            !state || state.status === "unconfigured"
              ? undefined
              : {
                  clusterID: state.clusterID ?? state.nodeID,
                  status: state.status,
                  name: local?.name ?? hostname(),
                  // Joining enrollment is owner-only, so discovery supplies the actual seed.
                  ownerURL: owner?.url ?? "",
                  isOwner: state.nodeID === state.ownerNodeID,
                  memberCount: state.members.length,
                }
          return {
            host: hostname(),
            // A closed room stays in the list, because a device needs to see it exists
            // to ask its host for the code; the name does not, so it is left out. This
            // route answers without a credential, and the name was the only thing about
            // a closed room that gave a passer-by anything.
            rooms: list.map((room) => ({
              id: room.id,
              name: room.open === true ? room.name : undefined,
              open: room.open === true,
            })),
            ...(meshInfo ? { mesh: meshInfo } : {}),
          }
        }),
      )
      .handle(
        "room.join",
        Effect.fn(function* (ctx) {
          const name = ctx.payload.name.trim()
          if (name === "" || name.length > 64)
            return yield* new InvalidRequestError({ message: "Name must be 1 to 64 characters", field: "name" })
          if (UNSAFE_NAME.test(name))
            return yield* new InvalidRequestError({
              message: "Name has characters that cannot be shown",
              field: "name",
            })
          const address = remoteAddress(yield* HttpServerRequest.HttpServerRequest)
          // Without a password every route is open to anyone who reaches the server, so it
          // shares rooms only with this computer.
          if (!ServerAuth.required(auth) && address !== undefined)
            return yield* new UnauthorizedError({ message: "The host must set a server password to share rooms" })
          const code = ctx.payload.code?.trim()
          const roomID = code ? yield* codes.redeemCode(code) : ctx.payload.roomID
          // A code can outlive its room; both cases read the same to the guest.
          const room = roomID ? yield* rooms.get(roomID).pipe(Effect.orElseSucceed(() => undefined)) : undefined
          if (!room || (!code && !room.open))
            return yield* new UnauthorizedError({
              message: code ? "Join code is wrong or expired" : "This room needs the join code its host shows",
            })
          const hostSession = Option.getOrUndefined(yield* sessions.get(room.sessionID).pipe(Effect.option))
          const roomPath = room.directory ?? hostSession?.location.directory
          if (!roomPath)
            return yield* new UnauthorizedError({ message: "This room's session is unavailable" })
          const device = ctx.payload.device?.trim() || undefined
          if (Room.banned(yield* rooms.bans(room.id), { device, address }))
            return yield* new UnauthorizedError({ message: "The host banned you from this room" })
          if ((yield* rooms.members(room.id)).length >= MEMBER_LIMIT)
            return yield* new InvalidRequestError({ message: "This room is full" })
          const role = Room.joinRole(room)
          const issued = ServerRooms.issueToken(auth, room.id, name)
          const member = yield* rooms.saveMember(room.id, {
            id: issued.guest.id,
            name,
            // Anyone on the network may enter an open room, so only a code earns more than member.
            role: !code && RANK[role] > RANK.member ? "member" : role,
            device,
            address,
            joined: Date.now(),
          })
          codes.record(room.id, { kind: "join", who: name })
          return redactForGuest(room, roomPath, { ...issued, role: member.role, room })
        }),
      )
      .handle(
        "room.member.list",
        Effect.fn(function* (ctx) {
          yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          const now = Date.now()
          return {
            data: (yield* rooms.members(ctx.params.roomID)).map((member) => {
              const seen = codes.seen(member.id)
              return { ...member, seen, online: seen !== undefined && now - seen < ServerRooms.ONLINE_MS }
            }),
          }
        }),
      )
      .handle(
        "room.member.update",
        Effect.fn(function* (ctx) {
          const member = yield* memberOf(ctx.params.roomID, ctx.params.guestID)
          return { data: yield* rooms.saveMember(ctx.params.roomID, { ...member, role: ctx.payload.role }) }
        }),
      )
      .handle(
        "room.member.remove",
        Effect.fn(function* (ctx) {
          const member = yield* memberOf(ctx.params.roomID, ctx.params.guestID)
          yield* rooms.removeMember(ctx.params.roomID, ctx.params.guestID)
          const room = yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          codes.record(room.id, { kind: "remove", who: member.name })
          yield* releaseMember(room, member)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "room.member.ban",
        Effect.fn(function* (ctx) {
          const member = yield* memberOf(ctx.params.roomID, ctx.params.guestID)
          const ban = yield* rooms.ban(ctx.params.roomID, {
            id: randomBytes(9).toString("base64url"),
            name: member.name,
            device: member.device,
            address: member.address,
            created: Date.now(),
          })
          yield* rooms.removeMember(ctx.params.roomID, member.id)
          const room = yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          codes.record(room.id, { kind: "ban", who: member.name })
          yield* releaseMember(room, member)
          return { data: ban }
        }),
      )
      .handle(
        "room.ban.list",
        Effect.fn(function* (ctx) {
          yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          return { data: yield* rooms.bans(ctx.params.roomID) }
        }),
      )
      .handle(
        "room.ban.remove",
        Effect.fn(function* (ctx) {
          yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          yield* rooms.unban(ctx.params.roomID, ctx.params.banID)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "room.guest.session.messages",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* inRoom(joined.room, ctx.query.sessionID)
          return redactForGuest(
            joined.room,
            joined.room.directory ?? session.location.directory,
            yield* messagePage(sessions, session.id, ctx.query),
          )
        }),
      )
      .handle(
        "room.guest.get",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* inRoom(joined.room, ctx.query.sessionID)
          return redactForGuest(joined.room, joined.room.directory ?? session.location.directory, {
            room: joined.room,
            guest: joined.guest,
            role: joined.member.role,
            session,
          })
        }),
      )
      .handle(
        "room.guest.log",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* inRoom(joined.room, ctx.query.sessionID)
          const durable = sessions
            .log({ sessionID: session.id, after: ctx.query.after, follow: ctx.query.follow })
            .pipe(Stream.orDie)
          const directory = joined.room.directory ?? session.location.directory
          const applyCurrentRoomPolicy = <A>(event: A) =>
            Effect.gen(function* () {
              const current = yield* rooms.get(joined.room.id).pipe(Effect.orElseSucceed(() => joined.room))
              if (RoomRules.hideExecutionEvent(current.rules, event)) return undefined
              const filtered = RoomRules.hideExecutionFeed(current.rules, event)
              return RoomRules.sanitizeForGuest(filtered as A, current.rules, directory)
            })
          const protectStream = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
            stream.pipe(
              Stream.mapEffect(applyCurrentRoomPolicy),
              Stream.filter((event) => event !== undefined),
              Stream.map((event) => event!),
            )
          if (!ctx.query.follow) return protectStream(durable)
          // Permission requests are not in the durable log; a following guest hears this session's
          // live ones too, instead of polling for them. The same dynamic policy covers replay and live events.
          const live = Stream.callback<typeof RoomLiveEvent.Type>((queue) =>
            Effect.acquireRelease(
              bus.listen((event) =>
                Effect.sync(() =>
                  // Only transcript/permission events for this room's session leave the host.
                  // The JSON round trip omits optional fields and keeps the host's location private.
                  Option.filter(
                    decodeRoomLiveEvent(
                      JSON.parse(
                        JSON.stringify({
                        id: event.id,
                        created: event.created,
                        type: event.type,
                        data: event.data,
                        ...("durable" in event && event.durable ? { durable: event.durable } : {}),
                      }),
                      ),
                    ),
                    (item) => item.data.sessionID === session.id,
                  ).pipe(
                    Option.map((item) =>
                      Queue.offerUnsafe(queue, {
                        ...item,
                        // Guests distinguish live boundaries from durable history replay.
                        metadata: { ...(item.metadata ?? {}), __opencodeRoomLive: true },
                      }),
                    ),
                  ),
                ),
              ),
              (unsubscribe) => unsubscribe,
            ),
          )
          const combined = durable.pipe(Stream.merge(live, { haltStrategy: "left" }))
          return protectStream(combined)
        }),
      )
      .handle(
        "room.guest.messages",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* inRoom(joined.room, ctx.query.sessionID)
          const messages = yield* sessions
            .messages({ sessionID: session.id, limit: CHAT_LIMIT, order: "desc" })
            .pipe(Effect.catchTag("Session.NotFoundError", missingSession), Effect.orDie)
          const note = yield* boundNote(session.id)
          return redactForGuest(joined.room, joined.room.directory ?? session.location.directory, {
            data: messages.toReversed().flatMap((message) => chatMessage(message, joined.room.hostName?.trim() || hostname())),
            running: (yield* sessions.active).has(session.id),
            note: note && { name: note.name, title: note.frontmatter.title || note.name },
          })
        }),
      )
      .handle(
        "room.guest.note",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* inRoom(joined.room, ctx.query.sessionID)
          return redactForGuest(joined.room, joined.room.directory ?? session.location.directory, {
            data: (yield* boundNote(session.id)) ?? null,
          })
        }),
      )
      .handle(
        "room.guest.prompt",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "member")
          const session = yield* inRoom(joined.room, ctx.payload.sessionID)
          if (ctx.payload.text.trim() === "")
            return yield* new InvalidRequestError({ message: "Message is empty", field: "text" })
          const hostName = joined.room.hostName?.trim() || hostname()
          const participants = [
            ...new Set([hostName, ...(yield* rooms.members(joined.room.id)).map((member) => member.name)]),
          ]
          return {
            data: yield* sessions
              .prompt({
                sessionID: session.id,
                id: ctx.payload.id,
                text: ctx.payload.text,
                // The server stamps the author from the token, so a guest cannot speak as someone else.
                metadata: {
                  room: {
                    id: joined.room.id,
                    guest: joined.guest,
                    hostName,
                    participants,
                    ...(ctx.payload.ai ? { ai: true } : {}),
                  },
                },
              })
              .pipe(
                Effect.catchTag("Session.NotFoundError", missingSession),
                Effect.catchTag("Session.PromptConflictError", () =>
                  Effect.fail(new InvalidRequestError({ message: "This message ID is already taken", field: "id" })),
                ),
                Effect.orDie,
              ),
          }
        }),
      )
      .handle(
        "room.guest.permission.list",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* inRoom(joined.room, ctx.query.sessionID)
          const requests = yield* Permission.Service.use((permission) => permission.forSession(session.id)).pipe(
            instances.provide(session),
            locationErrors,
            Effect.orDie,
          )
          const directory = joined.room.directory ?? session.location.directory
          return redactForGuest(joined.room, directory, { data: requests })
        }),
      )
      .handle(
        "room.guest.permission.reply",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "helper")
          const session = yield* inRoom(joined.room, ctx.payload.sessionID)
          yield* Effect.gen(function* () {
            const permission = yield* Permission.Service
            const request = yield* permission.get(ctx.params.requestID)
            if (!request || request.sessionID !== session.id) return yield* missingRequest(ctx.params.requestID)
            if (HOST_ONLY.has(request.action))
              return yield* new ForbiddenError({ message: "Only the host answers this request" })
            yield* permission
              .reply({ requestID: ctx.params.requestID, reply: ctx.payload.decision, message: ctx.payload.message })
              .pipe(Effect.catchTag("Permission.NotFoundError", () => missingRequest(ctx.params.requestID)))
          }).pipe(instances.provide(session), locationErrors, Effect.catchTag("LocationNotFoundError", Effect.die))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("room.link.list", () => peers.links().pipe(Effect.map((data) => ({ data }))))
      .handle("room.link.save", (ctx) => peers.saveLink(ctx.payload).pipe(Effect.as(HttpApiSchema.NoContent.make())))
      .handle("room.link.remove", (ctx) =>
        peers.removeLink(ctx.payload).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
      .handle(
        "room.guest.passport",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* inRoom(joined.room, undefined)
          const directory = joined.room.directory ?? session.location.directory
          const held = yield* plots.list(directory)
          const passport = Passport.read(directory)
          return redactForGuest(joined.room, directory, {
            ...passport,
            project: joined.room.rules?.hidePaths
              ? { ...passport.project, directory: "<project>" }
              : passport.project,
            plots: held.map((plot) => ({
              team: plot.team,
              machine: plot.machine,
              purpose: plot.purpose,
              paths: plot.paths.map((item) => path.relative(directory, item) || "."),
              expires: plot.expires,
            })),
          })
        }),
      )
      .handle(
        "room.guest.run",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "cohost")
          const session = yield* inRoom(joined.room, ctx.payload.sessionID)
          const command = ctx.payload.command.trim()
          if (!command) return yield* new InvalidRequestError({ message: "Command is empty", field: "command" })
          const initiallyRequiredPrograms = RoomRules.programsForCommand(joined.room.rules, command)
          yield* confirmRoomCommand({
            room: joined.room,
            member: joined.member,
            session,
            command,
            metadata: { operation: "room.run" },
          })
          yield* assertCurrentRoomCommand({
            roomID: joined.room.id,
            memberID: joined.member.id,
            command,
            minimumRole: "cohost",
            initiallyRequiredPrograms,
          })
          codes.record(joined.room.id, { kind: "run", who: joined.member.name, detail: command })
          const result = yield* Effect.tryPromise({
            try: (signal) => Passport.run(command, session.location.directory, signal),
            catch: (error) => new InvalidRequestError({ message: `Could not run the command: ${String(error)}` }),
          })
          // Re-read the member and room after the process finishes too. Privacy rules may have
          // changed while it ran, or the host may have removed/demoted the guest meanwhile.
          const current = yield* guestWho(joined.room.id, "cohost")
          yield* assertCurrentRoomCommand({
            roomID: current.room.id,
            memberID: current.member.id,
            command,
            minimumRole: "cohost",
            initiallyRequiredPrograms,
          })
          return redactForGuest(current.room, current.room.directory ?? session.location.directory, result)
        }),
      )
      .handle(
        "room.dod.get",
        Effect.fn(function* (ctx) {
          const room = yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          return yield* Dod.read(yield* roomDirectory(room), yield* live()).pipe(Effect.mapError(invalidDod))
        }),
      )
      .handle(
        "room.dod.release",
        Effect.fn(function* (ctx) {
          const room = yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          const directory = yield* roomDirectory(room)
          const dod = yield* Dod.release({ directory, id: ctx.payload.id }).pipe(Effect.mapError(invalidDod))
          yield* freeDodPlots(directory, ctx.payload.id)
          codes.record(room.id, { kind: "release", who: "host", item: ctx.payload.id })
          return dod
        }),
      )
      .handle(
        "room.guest.dod.get",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const directory = yield* roomDirectory(joined.room)
          const dod = yield* Dod.read(directory, yield* live()).pipe(Effect.mapError(invalidDod))
          return redactForGuest(joined.room, directory, forGuest(dod, joined.member))
        }),
      )
      .handle(
        "room.guest.dod.claim",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "member")
          const session = yield* inRoom(joined.room, ctx.payload.sessionID)
          const directory = yield* roomDirectory(joined.room)
          const owner = ownerOf(joined.member)
          const record = (kind: Room.EventKind, item: string, who = owner.name) =>
            codes.record(joined.room.id, { kind, who, item })
          if (!ctx.payload.take) {
            const id = ctx.payload.id?.trim()
            if (!id) return yield* new InvalidRequestError({ message: "Name the item to give back", field: "id" })
            // Release first: it refuses an item the guest does not hold, and the handover is only the holder's to write.
            const dod = yield* Dod.release({ directory, id, owner }).pipe(Effect.mapError(invalidDod))
            if (ctx.payload.handover?.trim()) yield* writeHandover(joined.room, id, owner.name, ctx.payload.handover)
            yield* freeDodPlots(directory, id)
            record("release", id)
            return redactForGuest(joined.room, directory, forGuest(dod, joined.member))
          }
          const alive = yield* live()
          const before = yield* Dod.read(directory, alive).pipe(Effect.mapError(invalidDod))
          const taken = ctx.payload.next
            ? yield* Dod.next({ directory, owner, live: alive }).pipe(Effect.mapError(invalidDod))
            : yield* Effect.gen(function* () {
                const id = ctx.payload.id?.trim()
                if (!id)
                  return yield* new InvalidRequestError({ message: "Name the item to take, or pass next", field: "id" })
                return {
                  id,
                  dod: yield* Dod.take({ directory, id, owner, live: alive }).pipe(Effect.mapError(invalidDod)),
                }
              })
          const previous = before.items.find((item) => item.id === taken.id)
          // An item taken over from a holder whose lease ran out drops that holder's plots too.
          if (previous?.stale && previous.ownerID !== owner.id) {
            yield* freeDodPlots(directory, taken.id)
            record("expire", taken.id, previous.owner ?? "?")
          }
          if (previous?.ownerID !== owner.id) record("take", taken.id)
          const result = redactForGuest(joined.room, directory, {
            ...forGuest(taken.dod, joined.member),
            taken: taken.id,
            note: yield* readHandover(joined.room, taken.id),
          })
          const paths = ctx.payload.paths ?? []
          if (paths.length === 0) return result
          // A refused plot undoes a fresh take, so the item is not left marked for work that cannot start.
          return yield* plots
            .claim({ sessionID: session.id, directory, paths, purpose: dodPurpose(taken.id, owner.name) })
            .pipe(
              Effect.as(result),
              Effect.catchTag("Plot.TakenError", (error) =>
                Effect.gen(function* () {
                  if (previous?.ownerID !== owner.id) {
                    yield* Dod.release({ directory, id: taken.id, owner }).pipe(Effect.ignore)
                    record("release", taken.id)
                  }
                  return yield* new ForbiddenError({ message: error.message })
                }),
              ),
            )
        }),
      )
      .handle(
        "room.guest.dod.submit",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "member")
          const directory = yield* roomDirectory(joined.room)
          const owner = ownerOf(joined.member)
          const id = ctx.payload.id.trim()
          const command = yield* Dod.command({ directory, id, owner }).pipe(Effect.mapError(invalidDod))
          const session = yield* inRoom(joined.room, undefined)
          const initiallyRequiredPrograms = RoomRules.programsRequiringApproval(joined.room.rules, command)
          yield* confirmRoomCommand({
            room: joined.room,
            member: joined.member,
            session,
            command,
            metadata: { operation: "room.check", item: id },
          })
          yield* assertCurrentRoomCommand({
            roomID: joined.room.id,
            memberID: joined.member.id,
            command,
            minimumRole: "member",
            initiallyRequiredPrograms,
          })
          if (ctx.payload.handover?.trim()) yield* writeHandover(joined.room, id, owner.name, ctx.payload.handover)
          const result = yield* Effect.tryPromise({
            try: (signal) => Passport.run(command, directory, signal),
            catch: (error) => new InvalidRequestError({ message: `Could not run the check: ${String(error)}` }),
          })
          // A rule or role change while the check runs still applies before its result is exposed
          // or committed to the shared DoD board.
          const current = yield* guestWho(joined.room.id, "member")
          yield* assertCurrentRoomCommand({
            roomID: current.room.id,
            memberID: current.member.id,
            command,
            minimumRole: "member",
            initiallyRequiredPrograms,
          })
          const dod = yield* Dod.accept({
            directory,
            id,
            command,
            exitCode: result.exitCode,
            summary: outputSummary(result.output, result.exitCode),
            by: owner.name,
          }).pipe(Effect.mapError(invalidDod))
          const passed = result.exitCode === 0
          if (passed) yield* freeDodPlots(directory, id)
          codes.record(joined.room.id, {
            kind: passed ? "pass" : "fail",
            who: owner.name,
            item: id,
            ...(passed ? {} : { detail: outputSummary(result.output, result.exitCode).slice(0, 120) }),
          })
          const latest = yield* guestWho(joined.room.id, "member")
          return redactForGuest(latest.room, latest.room.directory ?? directory, {
            ...forGuest(dod, latest.member),
            check: { exitCode: result.exitCode, output: result.output },
          })
        }),
      )
      .handle(
        "room.guest.feed",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const directory = yield* roomDirectory(joined.room).pipe(
            Effect.catchTag("SessionNotFoundError", () =>
              Effect.fail(new RoomNotFoundError({
                roomID: joined.room.id,
                message: "This room's session is unavailable",
              })),
            ),
          )
          const data = yield* codes.feed(joined.room.id, ctx.query.after ?? 0, ctx.query.wait)
          // The feed can wait for an event, so use the current policy after the wait finishes.
          const current = yield* guestOf(joined.room.id)
          return redactForGuest(current.room, current.room.directory ?? directory, data)
        }),
      )
      .handle(
        "room.feed",
        Effect.fn(function* (ctx) {
          const room = yield* rooms.get(ctx.params.roomID).pipe(Effect.catchTag("Room.NotFoundError", missingRoom))
          return yield* codes.feed(room.id, ctx.query.after ?? 0, ctx.query.wait)
        }),
      )
      .handle(
        "room.guest.leave",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          yield* rooms.removeMember(joined.room.id, joined.member.id)
          codes.record(joined.room.id, { kind: "leave", who: joined.member.name })
          yield* releaseMember(joined.room, joined.member)
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "room.guest.session.list",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const directory = joined.room.directory
          // A room whose session the host deleted lists nothing rather than failing the guest's screen.
          if (directory === undefined) {
            const result = yield* sessions.get(joined.room.sessionID).pipe(Effect.option)
            const session = Option.getOrUndefined(result)
            return redactForGuest(joined.room, session?.location.directory ?? "", { data: Option.toArray(result) })
          }
          const page = yield* sessions.list({ parentID: null, limit: SESSION_LIMIT })
          const data = page.data.filter((session) => Orchestra.contains(directory, session.location.directory))
          // The host's grouping, so a guest's tree shows the same categories as the host's.
          return redactForGuest(joined.room, directory, { data, category: yield* orchestra.categories(data.map((session) => session.id)) })
        }),
      )
      .handle(
        "room.guest.session.create",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "member")
          if (joined.room.directory === undefined)
            return yield* new InvalidRequestError({ message: "This room shares one session; the host starts others" })
          // A guest's new session runs on the room session's model, the one the host picked; left
          // unset it would fall to the first model in the host's catalog.
          const shared = yield* sessions.get(joined.room.sessionID).pipe(Effect.option)
          const created = yield* sessions
            .create({
              title: ctx.payload.title?.trim() || undefined,
              location: { directory: AbsolutePath.make(joined.room.directory) },
              model: Option.getOrUndefined(shared)?.model,
            })
            .pipe(Effect.orDie)
          return redactForGuest(joined.room, joined.room.directory, { data: created })
        }),
      )
      .handle(
        "room.guest.model.list",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* inRoom(joined.room, undefined)
          return redactForGuest(joined.room, joined.room.directory ?? session.location.directory, {
            data: yield* atRoom(joined.room, Model.Service.use((models) => models.available())),
          })
        }),
      )
      .handle(
        "room.guest.agent.list",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* inRoom(joined.room, undefined)
          return redactForGuest(joined.room, joined.room.directory ?? session.location.directory, {
            data: yield* atRoom(joined.room, Agent.Service.use((agents) => agents.list())),
          })
        }),
      )
      .handle(
        "room.guest.mcp.list",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const servers = yield* atRoom(
            joined.room,
            Mcp.Service.use((mcp) => mcp.servers()),
          )
          const session = yield* inRoom(joined.room, undefined)
          return redactForGuest(joined.room, joined.room.directory ?? session.location.directory, {
            data: servers.map((server) => ({ name: server.name, status: server.status.status })),
          })
        }),
      )
      .handle(
        "room.guest.command.list",
        Effect.fn(function* (ctx) {
          const joined = yield* guestOf(ctx.params.roomID)
          const session = yield* inRoom(joined.room, undefined)
          return redactForGuest(joined.room, joined.room.directory ?? session.location.directory, {
            data: yield* atRoom(joined.room, Command.Service.use((commands) => commands.list())),
          })
        }),
      )
      .handle(
        "room.guest.session.model",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "cohost")
          const session = yield* inRoom(joined.room, ctx.params.sessionID)
          yield* sessions
            .switchModel({ sessionID: session.id, model: ctx.payload.model })
            .pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "room.guest.session.agent",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "cohost")
          const session = yield* inRoom(joined.room, ctx.params.sessionID)
          yield* sessions
            .switchAgent({ sessionID: session.id, agent: ctx.payload.agent })
            .pipe(Effect.catchTag("Session.NotFoundError", missingSession))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "room.mesh.status",
        Effect.fn(function* () {
          return yield* mesh.status().pipe(
            Effect.catchTag("ServerMesh.Error", (error) => Effect.fail(meshError(error))),
          )
        }),
      )
      .handle(
        "room.mesh.invite",
        Effect.fn(function* () {
          return yield* mesh.invite().pipe(
            Effect.catchTag("ServerMesh.Error", (error) => Effect.fail(meshError(error))),
          )
        }),
      )
      .handle(
        "room.mesh.create",
        Effect.fn(function* (ctx) {
          return yield* mesh.create(ctx.payload).pipe(
            Effect.catchTag("ServerMesh.Error", (error) => Effect.fail(meshError(error))),
          )
        }),
      )
      .handle(
        "room.mesh.join",
        Effect.fn(function* (ctx) {
          return yield* mesh.join(ctx.payload).pipe(
            Effect.catchTag("ServerMesh.Error", (error) => Effect.fail(meshError(error))),
          )
        }),
      )
      .handle(
        "room.mesh.leave",
        Effect.fn(function* () {
          return yield* mesh.leave().pipe(
            Effect.catchTag("ServerMesh.Error", (error) => Effect.fail(meshError(error))),
          )
        }),
      )
      .handle(
        "room.mesh.activate",
        Effect.fn(function* () {
          return yield* mesh.activate().pipe(
            Effect.catchTag("ServerMesh.Error", (error) => Effect.fail(meshError(error))),
          )
        }),
      )
      .handle(
        "room.mesh.append",
        Effect.fn(function* (ctx) {
          return yield* mesh.append(ctx.payload).pipe(
            Effect.catchTag("ServerMesh.Error", (error) => Effect.fail(meshError(error))),
          )
        }),
      )
      .handle(
        "room.mesh.feed",
        Effect.fn(function* (ctx) {
          return yield* mesh.feed(ctx.query.after).pipe(
            Effect.catchTag("ServerMesh.Error", (error) => Effect.fail(meshError(error))),
          )
        }),
      )
      .handle(
        "room.mesh.rpc",
        Effect.fn(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          const token = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "")?.[1] ?? ""
          return yield* mesh.rpc(ctx.payload, token).pipe(
            Effect.catchTag("ServerMesh.Error", (error) => Effect.fail(meshError(error))),
          )
        }),
      )
      .handle(
        "room.guest.session.command",
        Effect.fn(function* (ctx) {
          const joined = yield* guestWho(ctx.params.roomID, "cohost")
          const session = yield* inRoom(joined.room, ctx.params.sessionID)
          yield* sessions.command({ sessionID: session.id, command: ctx.payload.name, text: ctx.payload.text }).pipe(
            Effect.catchTag("Session.NotFoundError", missingSession),
            Effect.catchTag("Command.NotFoundError", (error) =>
              Effect.fail(new CommandNotFoundError({ command: error.command, message: error.message })),
            ),
            Effect.catchTag("Command.ExecutionError", (error) =>
              Effect.fail(new CommandExecutionError({ command: error.command, message: error.message })),
            ),
            locationErrors,
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
