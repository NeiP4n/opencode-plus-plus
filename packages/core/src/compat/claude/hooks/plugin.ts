export * as ClaudeHooksPlugin from "./plugin.js"

/**
 * Runs Claude Code command hooks at the matching OpenCode points:
 *
 * - PreToolUse / PostToolUse — tool `execute.before` / `execute.after`, plus `permission.evaluate` for a
 *   PreToolUse `allow` or `ask` decision on that call;
 * - UserPromptSubmit — session `prompt`, which may refuse the prompt with `PromptInput.Rejected`;
 * - Stop / SubagentStop — `session.execution.succeeded`; a `block` continues the session with the reason;
 * - SessionStart — `session.created` (startup) and `session.compaction.ended` (compact);
 * - SessionEnd — `session.deleted`; PreCompact — `session.compaction.started`; Notification — `permission.asked`.
 *
 * Which hooks may run comes from `Config.compatibility().hooks`: home hooks always, project hooks only when
 * the user trusts Claude for the project.
 */

import path from "path"
import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { PromptInput } from "@opencode/schema/prompt-input"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { FSUtil } from "@opencode/util/fs-util"
import { AppProcess } from "@opencode/util/process"
import { Global } from "@opencode/util/global"
import { Effect, Stream } from "effect"
import { Config } from "../../../config.js"
import { ClaudeHookConfig } from "./config.js"
import { ClaudeHookRun } from "./run.js"
import { ClaudeHookTools } from "./tools.js"

/** A Stop hook that keeps blocking would loop forever; Claude relies on hooks checking `stop_hook_active`. */
const MAX_STOP_CONTINUATIONS = 8

export const Plugin = define({
  id: "opencode.compat.claude.hooks",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const location = ctx.location
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    // Hook callbacks run in their caller's context, so the process service comes from activation.
    const runContext = yield* Effect.context<AppProcess.Service>()

    let hooks: readonly ClaudeHookConfig.Hook[] = []
    const refresh = Effect.gen(function* () {
      hooks = config.compatibility ? (yield* config.compatibility()).hooks : []
    })
    yield* refresh

    // PreToolUse decisions waiting for the permission check of the same call.
    const decisions = new Map<string, "allow" | "ask">()
    // Sessions continued by a blocking Stop hook, and how many times in a row.
    const continued = new Map<string, number>()
    const mcpNames = new Map<string, ClaudeHookTools.Mcp>()

    const select = (event: ClaudeHookConfig.Event, subject?: string) => {
      const seen = new Set<string>()
      return hooks.filter((hook) => {
        if (hook.event !== event || !ClaudeHookConfig.matches(hook, subject) || seen.has(hook.command)) return false
        seen.add(hook.command)
        return true
      })
    }

    const transcriptFile = (sessionID: Session.ID) =>
      path.join(global.state, "claude-transcripts", `${sessionID}.jsonl`)
    const transcript = Effect.fnUntraced(function* (sessionID: Session.ID) {
      const file = transcriptFile(sessionID)
      const messages = yield* ctx.session.context({ sessionID }).pipe(Effect.orElseSucceed(() => []))
      const lines = messages.flatMap((message) => transcriptLine(message, sessionID))
      yield* fs
        .writeWithDirs(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n")
        .pipe(Effect.orElseSucceed(() => undefined))
      return file
    })

    /** Runs the selected hooks in parallel with Claude's common fields plus the event's own. */
    const runAll = Effect.fnUntraced(function* (
      selected: readonly ClaudeHookConfig.Hook[],
      event: ClaudeHookConfig.Event,
      sessionID: Session.ID,
      fields: Record<string, unknown>,
    ) {
      if (selected.length === 0) return []
      const payload = {
        session_id: sessionID,
        transcript_path: yield* transcript(sessionID),
        cwd: location.directory,
        hook_event_name: event,
        permission_mode: "default",
        ...fields,
      }
      const outcomes = yield* Effect.forEach(
        selected,
        (hook) =>
          ClaudeHookRun.run(hook, payload, { projectDir: location.project.directory, env: process.env }).pipe(
            Effect.provideContext(runContext),
          ),
        { concurrency: "unbounded" },
      )
      for (const outcome of outcomes)
        if (outcome.type === "error")
          yield* Effect.logWarning("Claude hook failed", { event, message: outcome.message })
      for (const outcome of outcomes)
        if (outcome.type === "success" && outcome.output?.systemMessage)
          yield* Effect.logInfo("Claude hook message", { event, message: outcome.output.systemMessage })
      return outcomes
    })

    /** `continue: false` stops the session outright, whatever the event. */
    const stopped = (outcomes: readonly ClaudeHookRun.Outcome[]) =>
      outcomes.find((outcome) => outcome.type === "success" && outcome.output?.continue === false) as
        | Extract<ClaudeHookRun.Outcome, { type: "success" }>
        | undefined

    const context = (outcomes: readonly ClaudeHookRun.Outcome[], plainStdout: boolean) =>
      outcomes
        .flatMap((outcome) => {
          if (outcome.type !== "success") return []
          if (outcome.output?.hookSpecificOutput?.additionalContext)
            return [outcome.output.hookSpecificOutput.additionalContext]
          return plainStdout && !outcome.output && outcome.stdout ? [outcome.stdout] : []
        })
        .join("\n\n")

    const claudeName = Effect.fnUntraced(function* (tool: string) {
      if (!mcpNames.has(tool)) {
        for (const item of yield* ctx.tool.list())
          if (item.options?.namespace) mcpNames.set(item.id, { namespace: item.options.namespace, name: item.name })
      }
      return ClaudeHookTools.name(tool, mcpNames.get(tool))
    })

    yield* ctx.tool.hook("execute.before", (event) =>
      Effect.gen(function* () {
        if (!hooks.some((hook) => hook.event === "PreToolUse")) return
        const name = yield* claudeName(event.tool)
        const outcomes = yield* runAll(select("PreToolUse", name), "PreToolUse", event.sessionID, {
          tool_name: name,
          tool_input: ClaudeHookTools.toClaude(event.tool, event.input),
          tool_use_id: event.id,
        })
        const stop = stopped(outcomes)
        if (stop) {
          yield* ctx.session.interrupt({ sessionID: event.sessionID }).pipe(Effect.ignore)
          return yield* new Tool.Error({ message: stop.output?.stopReason ?? "Stopped by a Claude hook" })
        }
        for (const outcome of outcomes) {
          if (outcome.type === "block") return yield* new Tool.Error({ message: outcome.reason })
          if (outcome.type !== "success" || !outcome.output) continue
          const specific = outcome.output.hookSpecificOutput
          const decision =
            specific?.permissionDecision ??
            (outcome.output.decision === "block" ? "deny" : outcome.output.decision === "approve" ? "allow" : undefined)
          if (decision === "deny")
            return yield* new Tool.Error({
              message: specific?.permissionDecisionReason ?? outcome.output.reason ?? "Denied by a Claude hook",
            })
          if (decision) decisions.set(event.id, decision)
          if (specific?.updatedInput && typeof event.input === "object" && event.input !== null)
            event.input = { ...event.input, ...ClaudeHookTools.fromClaude(event.tool, specific.updatedInput) }
        }
      }),
    )

    // A hook's allow only lifts an `ask`; it never overrides a deny rule.
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        const decision = event.source?.id === undefined ? undefined : decisions.get(event.source.id)
        if (!decision || event.effect === "deny") return
        event.effect = decision
      }),
    )

    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        decisions.delete(event.id)
        if (event.status !== "completed" || !hooks.some((hook) => hook.event === "PostToolUse")) return
        const name = yield* claudeName(event.tool)
        const outcomes = yield* runAll(select("PostToolUse", name), "PostToolUse", event.sessionID, {
          tool_name: name,
          tool_input: ClaudeHookTools.toClaude(event.tool, event.input),
          tool_response: event.result.output ?? event.result.content ?? null,
          tool_use_id: event.id,
        })
        if (stopped(outcomes)) yield* ctx.session.interrupt({ sessionID: event.sessionID }).pipe(Effect.ignore)
        // Feedback for the model rides on the tool result it is about to read.
        const feedback = outcomes
          .flatMap((outcome) => {
            if (outcome.type === "block") return [outcome.reason]
            if (outcome.type !== "success" || !outcome.output) return []
            return [
              outcome.output.decision === "block" ? outcome.output.reason : undefined,
              outcome.output.hookSpecificOutput?.additionalContext,
            ].filter((item): item is string => !!item)
          })
          .join("\n\n")
        if (feedback) event.result = appendToResult(event.result, `PostToolUse hook feedback:\n${feedback}`)
      }),
    )

    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        continued.delete(event.sessionID)
        const selected = select("UserPromptSubmit")
        if (selected.length === 0) return
        const outcomes = yield* runAll(selected, "UserPromptSubmit", event.sessionID, { prompt: event.prompt.text })
        for (const outcome of outcomes) {
          if (outcome.type === "block")
            return yield* new PromptInput.Rejected({ reason: outcome.reason, source: "UserPromptSubmit hook" })
          if (
            outcome.type === "success" &&
            (outcome.output?.decision === "block" || outcome.output?.continue === false)
          )
            return yield* new PromptInput.Rejected({
              reason: outcome.output.reason ?? outcome.output.stopReason ?? "Blocked by a Claude hook",
              source: "UserPromptSubmit hook",
            })
        }
        const extra = context(outcomes, true)
        if (extra)
          event.prompt.text = `${event.prompt.text}\n\n<user-prompt-submit-hook>\n${extra}\n</user-prompt-submit-hook>`
      }),
    )

    const sessionStart = Effect.fnUntraced(function* (sessionID: Session.ID, source: "startup" | "compact") {
      const selected = select("SessionStart", source)
      if (selected.length === 0) return
      const extra = context(yield* runAll(selected, "SessionStart", sessionID, { source }), true)
      if (extra)
        yield* ctx.session
          .synthetic({ sessionID, text: extra, description: "SessionStart hook", resume: false })
          .pipe(Effect.ignore)
    })

    const stop = Effect.fnUntraced(function* (sessionID: Session.ID) {
      const session = yield* ctx.session.get({ sessionID }).pipe(Effect.orElseSucceed(() => undefined))
      if (!session) return
      const event = session.parentID ? "SubagentStop" : "Stop"
      const selected = select(event)
      if (selected.length === 0) return
      const count = continued.get(sessionID) ?? 0
      const outcomes = yield* runAll(selected, event, sessionID, { stop_hook_active: count > 0 })
      if (stopped(outcomes)) return continued.delete(sessionID)
      const reasons = outcomes.flatMap((outcome) => {
        if (outcome.type === "block") return [outcome.reason]
        if (outcome.type === "success" && outcome.output?.decision === "block" && outcome.output.reason)
          return [outcome.output.reason]
        return []
      })
      if (reasons.length === 0) return continued.delete(sessionID)
      // The ceiling holds until the user prompts again, which clears the count.
      if (count >= MAX_STOP_CONTINUATIONS) return
      continued.set(sessionID, count + 1)
      yield* ctx.session
        .synthetic({ sessionID, text: reasons.join("\n\n"), description: `${event} hook`, resume: true })
        .pipe(Effect.ignore)
    })

    yield* ctx.event.subscribe().pipe(
      Stream.runForEach((event) => {
        const handled = (() => {
          switch (event.type) {
            case "config.updated":
              return refresh
            case "session.created":
              return event.data.parentID ? Effect.void : sessionStart(event.data.sessionID, "startup")
            case "session.compaction.ended":
              return sessionStart(event.data.sessionID, "compact")
            case "session.execution.succeeded":
              return stop(event.data.sessionID)
            case "session.deleted":
              return runAll(select("SessionEnd"), "SessionEnd", event.data.sessionID, { reason: "other" }).pipe(
                // The transcript only exists for hooks; it goes with its session.
                Effect.andThen(fs.remove(transcriptFile(event.data.sessionID)).pipe(Effect.ignore)),
              )
            case "session.compaction.started":
              return runAll(select("PreCompact", event.data.reason), "PreCompact", event.data.sessionID, {
                trigger: event.data.reason,
                custom_instructions: "",
              })
            case "permission.asked":
              return runAll(select("Notification", "permission_prompt"), "Notification", event.data.sessionID, {
                message: `OpenCode needs your permission to use ${event.data.action}`,
                notification_type: "permission_prompt",
              })
            default:
              return Effect.void
          }
        })()
        return Effect.asVoid(handled).pipe(
          Effect.catchCause((cause) => Effect.logWarning("Claude hook event failed", { cause })),
        )
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

function appendToResult(result: Tool.Result, text: string): Tool.Result {
  if (typeof result.content === "string") return { ...result, content: `${result.content}\n\n${text}` }
  if (Array.isArray(result.content)) return { ...result, content: [...result.content, { type: "text", text }] }
  const output = result.output === undefined ? "" : `${JSON.stringify(result.output)}\n\n`
  return { ...result, content: `${output}${text}` }
}

/** A minimal Claude-shaped transcript line: user and assistant text, and tool calls by their Claude names. */
function transcriptLine(message: SessionMessage.Info, sessionID: Session.ID): unknown[] {
  if (message.type === "user")
    return [{ type: "user", sessionId: sessionID, message: { role: "user", content: message.text } }]
  if (message.type !== "assistant") return []
  const content = message.content.flatMap((part): unknown[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }]
    if (part.type === "tool")
      return [
        {
          type: "tool_use",
          id: part.id,
          name: ClaudeHookTools.name(part.name),
          input: ClaudeHookTools.toClaude(part.name, "input" in part.state ? part.state.input : {}),
        },
      ]
    return []
  })
  return content.length ? [{ type: "assistant", sessionId: sessionID, message: { role: "assistant", content } }] : []
}
