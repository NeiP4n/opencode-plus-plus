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
      return RoomRules.merge(
        (yield* rooms.list()).flatMap((room) =>
          room.rules && (room.sessionID === session.id || (room.directory && Orchestra.contains(room.directory, directory)))
            ? [room.rules]
            : [],
        ),
      )
    })

    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.gen(function* () {
        const rules = yield* rulesOf(event.sessionID)
        if (!rules) return
        const deny = (message: string) => {
          event.effect = "deny"
          event.message = message
        }
        if (rules.noOutbound && RoomRules.outbound.includes(event.action))
          return deny("This room does not let the AI send anything out")
        if (event.action === "shell") {
          // Shell commands can open arbitrary network connections that permission actions cannot see.
          // Fail closed: noOutbound disables shell execution rather than pretending command-name matching
          // can reliably distinguish local work from data exfiltration.
          if (rules.noOutbound) return deny("This room does not allow shell commands while outbound access is disabled")
          const blocked = event.resources.flatMap((command) => RoomRules.blockedCommand(rules, command) ?? [])[0]
          if (blocked) return deny(`This room forbids commands like "${blocked}"`)
          const protectedFile = event.resources.flatMap((command) => RoomRules.protectedFileInCommand(rules, command) ?? [])[0]
          if (protectedFile) return deny("This room keeps that file off limits to the AI")
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
