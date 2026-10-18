export * as RoomRulesPlugin from "./room-rules.js"

import { define } from "@opencode/plugin/effect/plugin"
import { RoomRules } from "@opencode/schema/room-rules"
import type { SessionID } from "@opencode/schema/session-id"
import type { Session as SessionSchema } from "@opencode/schema/session"
import { Effect } from "effect"
import { Orchestra } from "../orchestra.js"
import { Room } from "../room.js"
import { Session } from "../session.js"

// Applies a room's rules to the host's own AI. The server applies them to guests' commands and to
// what guests see; this covers the sessions the room shares, subagents included, wherever they run.
export const Plugin = define({
  id: "opencode.room-rules",
  effect: Effect.fn(function* (ctx) {
    const rooms = yield* Room.Service
    const sessions = yield* Session.Service

    const top = (sessionID: SessionID): Effect.Effect<SessionSchema.Info | undefined> =>
      Effect.gen(function* () {
        const session = yield* sessions.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))
        if (!session?.parentID) return session
        return yield* top(session.parentID)
      })

    // The rules of every room that shares this session or the directory it works in.
    const rulesOf = Effect.fnUntraced(function* (sessionID: SessionID) {
      const session = yield* top(sessionID)
      if (!session) return undefined
      const directory = session.location.directory
      const shared = (yield* rooms.list()).filter(
        (room) =>
          room.sessionID === session.id ||
          (room.directory && Orchestra.contains(room.directory, directory)),
      )
      // Any room gets built-in secret-file protections, even when the host has not configured
      // any optional rules yet. Rules from overlapping rooms are merged restrictively.
      return RoomRules.merge(shared.map((room) => room.rules ?? {}))
    })

    // A shell tool call belongs to the user prompt that triggered its assistant message.
    // Looking backwards from the tool's own message ID prevents one guest's "Always allow"
    // decision from being attached to whichever guest happened to speak most recently.
    const guestContext = Effect.fnUntraced(function* (sessionID: SessionID, sourceMessageID?: string) {
      const messages = yield* sessions.messages({ sessionID, limit: 100, order: "desc" }).pipe(
        Effect.orElseSucceed(() => []),
      )
      if (!sourceMessageID) return undefined
      const sourceIndex = messages.findIndex((item) => item.id === sourceMessageID)
      if (sourceIndex < 0) return undefined
      const recent = messages.slice(sourceIndex)
      const prompt = recent.find((item) => {
        if (item.type !== "user" || !item.metadata || typeof item.metadata !== "object") return false
        const room = (item.metadata as Record<string, unknown>).room
        return room !== null && typeof room === "object" && "guest" in room && "id" in room
      })
      if (!prompt || !prompt.metadata || typeof prompt.metadata !== "object") return undefined
      const metadata = prompt.metadata as Record<string, unknown>
      const roomInfo = metadata.room as Record<string, unknown>
      const guest = roomInfo.guest as Record<string, unknown>
      if (typeof roomInfo.id !== "string" || typeof guest.id !== "string") return undefined
      const room = yield* rooms.get(roomInfo.id as Room.ID).pipe(Effect.orElseSucceed(() => undefined))
      if (!room) return undefined
      const member = yield* rooms.member(room.id, guest.id)
      if (!member) return undefined
      return { room, member }
    })

    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
        const rules = yield* rulesOf(event.sessionID)
        if (!rules) return
        const deny = (message: string) => {
          event.effect = "deny"
          event.message = message
        }
        if (rules.noOutbound && RoomRules.outboundAction(event.action))
          return deny("This room does not let the AI send anything out")
        if (event.action === "shell") {
          const command = event.resources.join("\\n")
          if (rules.noOutbound && RoomRules.commandSendsOutbound(command))
            return deny("This room does not let the AI send commands that connect or send data outside")
          const protectedFile = event.resources.find((item) => RoomRules.commandTouchesProtectedFile(rules, item))
          if (protectedFile) return deny("This room keeps that file off limits to the AI")

          const matchedPrograms = [...new Set(event.resources.flatMap((item) => RoomRules.programsRequiringApproval(rules, item)))]
          const identity = yield* guestContext(event.sessionID, event.source?.messageID)
          if (identity?.member.role === "trusted") return
          const commandPrograms = [...new Set(event.resources.map((item) => RoomRules.programName(item)).filter((item): item is string => !!item))]
          if (
            identity &&
            matchedPrograms.length === 0 &&
            commandPrograms.length > 0 &&
            commandPrograms.every((program) => identity.member.approvedPrograms?.includes(program))
          ) return
          if (matchedPrograms.length === 0) return
          const programs = identity
            ? matchedPrograms.filter((program) => !identity.member.approvedPrograms?.includes(program))
            : matchedPrograms
          if (programs.length === 0) return

          // The regular permission UI still asks before running the shell tool. "Always allow"
          // is redirected to this device's room-member record and is never a project-wide grant.
          event.effect = "ask"
          event.scoped = true
          event.message = identity
            ? `Allow ${identity.member.name} to use ${programs.join(", ")}? This approval is private to this room member.`
            : `This room requires approval to use ${programs.join(", ")}. Only a one-time approval is available without a room member identity.`
          if (identity) {
            event.save = programs
            event.onAlways = () =>
              Effect.gen(function* () {
                const current = yield* rooms.member(identity.room.id, identity.member.id)
                if (!current) return
                yield* rooms.saveMember(identity.room.id, {
                  ...current,
                  approvedPrograms: [...new Set([...(current.approvedPrograms ?? []), ...programs])],
                })
                return
              })
          } else {
            event.save = []
            event.onAlways = undefined
          }
          return
        }
        if (event.action === "read" || event.action === "edit") {
          const file = event.resources.find((item) => RoomRules.protectedFile(rules, item))
          if (file) return deny("This room keeps that file off limits to the AI")
        }
      }),
    )

    // The AI follows rules it knows about instead of only meeting refusals.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const text = RoomRules.describe(yield* rulesOf(event.sessionID))
        if (text) event.system.push({ type: "text", text: `# Room rules\nThe host set these rules for this room; they cannot be lifted from inside it.\n${text}` })
      }),
    )
  }),
})
