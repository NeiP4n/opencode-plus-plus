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

// Resolve outbound tool aliases centrally so the policy is independent of the tool's display name.
// Keep this set at module scope: the hook can run for every tool invocation.
const OUTBOUND_TOOLS = new Set(RoomRules.outbound.map((name) => name.toLowerCase()))

export function blocksOutboundTool(tool: string, action?: string, namespaced = false) {
  const isOutbound = (name: string) => {
    const normalized = name.toLowerCase().replace(/^opencode_/, "")
    return (
      OUTBOUND_TOOLS.has(name.toLowerCase()) ||
      OUTBOUND_TOOLS.has(normalized) ||
      normalized.startsWith("desktop_") ||
      normalized.startsWith("mcp_") ||
      normalized.startsWith("opencode_mcp_")
    )
  }
  return isOutbound(tool) || (!!action && isOutbound(action)) || namespaced
}

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

    // Cache tool namespaces by effective name. MCP tools may arrive after plugin startup, so
    // resolve each new name once rather than enumerating the registry on every tool call.
    const namespacedTools = new Map<string, boolean>()

    // Enforce outbound restrictions at tool execution time. Context instructions alone are not
    // a security boundary: a model can ignore them, and compaction can remove them.
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
        // MCP tool names are server-defined, so a name-only allowlist is insufficient.
        // Registered namespaced tools are treated as MCP transports for this rule.
        if (blocksOutboundTool(tool, action, namespaced))
          return yield* new Tool.Error({
            message: "This room does not allow tools that can send data out.",
            metadata: { rule: "noOutbound", tool: event.tool, action },
          })
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
