export * as RoomRulesPlugin from "./room-rules.js"

import { define } from "@opencode/plugin/effect/plugin"
import { RoomRules } from "@opencode/schema/room-rules"
import type { SessionID } from "@opencode/schema/session-id"
import type { Session as SessionSchema } from "@opencode/schema/session"
import { Effect } from "effect"
import { Orchestra } from "../orchestra.js"
import { Room } from "../room.js"
import { Session } from "../session.js"

// External tools are deny-by-default in shared rooms. Keep this allowlist explicit;
// tools added by plugins remain blocked until their network/data behavior is reviewed.
const LOCAL_ONLY_ACTIONS = new Set([
  "read", "edit", "write", "patch", "apply_patch", "apply-patch", "multiedit", "grep", "glob", "list",
  "todowrite", "todoread", "task", "plan", "question", "skill", "lsp", "dod",
])

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
          room.sessionID === session.id || (room.directory && Orchestra.contains(room.directory, directory))
            ? [room.rules ?? {}]
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
        if (
          rules.noOutbound !== false &&
          (RoomRules.outbound.includes(event.action) ||
            event.metadata?.transport === "mcp" ||
            !LOCAL_ONLY_ACTIONS.has(event.action))
        )
          return deny("This room blocks outbound, connected-account and unrecognized tools by default")
        if (RoomRules.commandActions.includes(event.action)) {
          const commands = event.resources
          if (commands.some((command) => RoomRules.commandLeaksCredentials(command)))
            return deny("Commands that print the host's environment or credentials are not allowed")
          const protectedFile = commands.flatMap((command) => RoomRules.protectedFileInCommand(rules, command) ?? [])[0]
          if (protectedFile) return deny("This room keeps that file off limits to the AI")
          const programs = [...new Set(commands.flatMap((command) => RoomRules.programsRequiringApproval(rules, command)))]
          if (programs.length) {
            event.effect = "ask"
            event.message = `Room rules require host approval to use: ${programs.join(", ")}.`
          }
          return
        }
        if (["read", "edit", "write", "patch", "apply_patch", "apply-patch", "multiedit", "grep", "glob", "list"].includes(event.action)) {
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
