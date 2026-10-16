export * as ClaudeHookConfig from "./config.js"

/** The `hooks` section of Claude settings as a flat list of commands. */

import { ClaudeContext } from "../context.js"

export const EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "PreCompact",
  "Notification",
] as const
export type Event = (typeof EVENTS)[number]

export interface Hook {
  readonly event: Event
  /** Regex over the event's subject (a Claude tool name, a session source, ...); absent or `*` matches all. */
  readonly matcher?: string
  readonly command: string
  /** Seconds. */
  readonly timeout?: number
  readonly scope: "global" | "project"
  readonly source: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function parse(value: unknown, source: string, context: ClaudeContext.Context) {
  const hooks: Hook[] = []
  const skipped: ClaudeContext.Skipped[] = []
  if (!isRecord(value)) return { hooks, skipped }
  for (const [event, groups] of Object.entries(value)) {
    if (!(EVENTS as readonly string[]).includes(event)) {
      skipped.push({ source, reason: `hook event ${event} has no OpenCode counterpart` })
      continue
    }
    for (const group of Array.isArray(groups) ? groups : []) {
      if (!isRecord(group)) continue
      const matcher = typeof group.matcher === "string" && group.matcher !== "" ? group.matcher : undefined
      for (const hook of Array.isArray(group.hooks) ? group.hooks : []) {
        if (!isRecord(hook)) continue
        if (hook.type !== "command" || typeof hook.command !== "string") {
          skipped.push({
            source,
            reason: `${event} hook of type ${String(hook.type)} is not supported; only command hooks run`,
          })
          continue
        }
        // Hooks run code: a project's need trust, the user's own always run.
        if (!ClaudeContext.allowed(context)) {
          skipped.push({ source, reason: `${event} hook ${ClaudeContext.TRUST_HINT}` })
          continue
        }
        hooks.push({
          event: event as Event,
          ...(matcher ? { matcher } : {}),
          command: hook.command,
          ...(typeof hook.timeout === "number" && hook.timeout > 0 ? { timeout: hook.timeout } : {}),
          scope: context.scope,
          source,
        })
      }
    }
  }
  return { hooks, skipped }
}

/** Claude matchers are regexes anchored to the whole subject; `*` and an empty matcher match everything. */
export function matches(hook: Hook, subject: string | undefined) {
  if (hook.matcher === undefined || hook.matcher === "*") return true
  if (subject === undefined) return false
  try {
    return new RegExp(`^(?:${hook.matcher})$`).test(subject)
  } catch {
    return hook.matcher === subject
  }
}
