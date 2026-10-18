export * as RoomRulesPlugin from "./room-rules.js"

import { define } from "@opencode/plugin/effect/plugin"
import { RoomRules } from "@opencode/schema/room-rules"
import type { SessionID } from "@opencode/schema/session-id"
import type { Session as SessionSchema } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"
import { Orchestra } from "../orchestra.js"
import { Room } from "../room.js"
import { Session } from "../session.js"

export function blocksOutboundTool(tool: string, action?: string, namespaced = false) {
  const rules: RoomRules.Rules = { noOutbound: true }
  const metadata = namespaced ? { transport: "mcp" } : undefined
  const denied = (name: string) =>
    RoomRules.policy(rules, {
      action: name.toLowerCase().replace(/^opencode_/, ""),
      resources: [],
      metadata,
    })?.effect === "deny"
  return denied(tool) || (!!action && denied(action))
}

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

    const namespacedTools = new Map<string, boolean>()

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        const rules = yield* rulesOf(event.sessionID)
        if (!rules?.noOutbound) return
        const tool = event.tool.toLowerCase()
        const input =
          event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>) : undefined
        const action = typeof input?.action === "string" ? input.action.toLowerCase() : undefined
        let namespaced = namespacedTools.get(tool)
        if (namespaced === undefined) {
          const registered = yield* ctx.tool.list()
          namespaced = !!registered.find((item) => item.name.toLowerCase() === tool)?.options?.namespace
          namespacedTools.set(tool, namespaced)
        }
        if (blocksOutboundTool(tool, action, namespaced))
          return yield* new Tool.Error({
            message: "This room does not allow tools that can send data out.",
            metadata: { rule: "noOutbound", tool: event.tool, action },
          })
      }),
    )

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const text = RoomRules.describe(yield* rulesOf(event.sessionID))
        if (text)
          event.system.push({
            type: "text",
            text: `# Room rules\nThe host set these rules for this room; they cannot be lifted from inside it.\n${text}`,
          })
      }),
    )
  }),
})
