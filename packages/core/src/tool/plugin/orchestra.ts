export * as OrchestraTool from "./orchestra.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import type { Permission } from "@opencode/schema/permission"
import { Effect, Option, Schema } from "effect"
import { Orchestra } from "../../orchestra.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import type { SessionMessage } from "../../session/message.js"

export const name = "sessions"

const description = [
  "Run this project's AI team: the other sessions of the project, each a separate chat with its own role.",
  "Only the project's main session (the orchestrator) has this tool.",
  "Before creating a worker, inspect the roster and reuse an existing writable session with the needed role. Action create reuses an existing session of that role by default; set newInstance=true only when an additional parallel worker is deliberately needed.",
  "Do not call HTTP endpoints directly or invent /api/orchestra routes for team management. Use this tool. If a team action returns an endpoint or API error, report the actual error instead of creating a replacement session.",
  "Actions: list shows the team by category with each session's role, status, access and whether a task is outstanding;",
  "send queues a task without interrupting the worker's current work; its task-linked <team-report> arrives automatically when it finishes and wakes the Orchestrator again. The current turn ending after send is intentional; it does not mean the project task is complete.",
  "A report's state describes whether the worker run ended; outcome describes task progress. If outcome is partial, incomplete, failed, or stopped, treat the task as still open unless it is explicitly blocked or cancelled. outcome=unknown means the worker did not state its status: judge the report text yourself instead of re-sending the task. Compare the report with the acceptance criteria and send a focused follow-up to that same worker after its previous task is no longer outstanding. Do not mark the overall task complete until evidence satisfies the acceptance criteria; if the work is blocked, state the exact blocker.",
  "Copy the complete sessionID exactly from the roster or action list; never abbreviate or invent one. If a sessions action fails, inspect the exact error and current list/read state, correct the cause, then retry only with changed/corrected arguments. Never repeat an identical failed call.",
  "read returns a session's latest messages; create accepts an exact role ID from the global Orchestra role registry even if no session exists for that role yet, reuses a writable matching session by default or creates one if needed, and can give it a first task; stop interrupts a running session.",
  "Never pass a display title as a role ID: use an exact role id from the roles listed with your team.",
  "Access per session is hidden < read < write < full: read allows list and read, write adds send, full adds stop. Sessions you create get full access.",
].join("\n")

type WorkerRow = {
  role: string
  access: Orchestra.Access
  session: { id: string; title?: string }
}

export function reusableWorker<T extends WorkerRow>(
  rows: ReadonlyArray<T>,
  role: string,
  pending: ReadonlySet<string>,
) {
  const matches = rows.filter((row) => row.role === role)
  const writable = matches.filter((row) => Orchestra.allows(row.access, "write"))
  return {
    matches,
    writable,
    session: writable.find((row) => !pending.has(row.session.id)),
  }
}

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "read", "send", "create", "stop"]),
  sessionID: Schema.optionalKey(SessionSchema.ID).annotate({ description: "Target session for read, send and stop" }),
  text: Schema.optionalKey(Schema.String).annotate({
    description: "Message for send, or the first task for create",
  }),
  title: Schema.optionalKey(Schema.String).annotate({ description: "Title of the session to create" }),
  role: Schema.optionalKey(Schema.String).annotate({
    description: "Exact ID of a built-in or saved Orchestra role, required for create; not the display title. The available role ids are listed with your team.",
  }),
  category: Schema.optionalKey(Schema.String).annotate({
    description: "Category of the session to create, e.g. Planning, Build or Quality",
  }),
  newInstance: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Normally omit this: create reuses an existing writable session with this role. Set true only when a separate parallel worker is deliberately needed.",
  }),
  limit: Schema.optionalKey(Schema.Int).annotate({ description: "How many recent messages read returns (default 10)" }),
  model: Schema.optionalKey(Schema.String).annotate({
    description:
      "For send and create: the provider/model the worker runs this task on. Only for roles in automatic model mode, and only one of the models listed for that role.",
  }),
  tools: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description:
      'For send and create: narrow the worker to these tools for this task (e.g. ["read", "grep", "glob"] for a pure investigation). Only for roles that allow it; ["all"] restores the role\'s full set.',
  }),
})

export const Output = Schema.Struct({
  output: Schema.String,
  sessionID: Schema.optionalKey(SessionSchema.ID),
})

export const Plugin = {
  id: "opencode.tool.orchestra",
  effect: Effect.fn("OrchestraTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const orchestra = yield* Orchestra.Service

    // Every action runs on behalf of the project's main session and only
    // reaches sessions of the same project at the level the operator granted.
    const target = Effect.fnUntraced(function* (
      project: Orchestra.Project,
      sessionID: SessionSchema.ID | undefined,
      required: Orchestra.Access,
    ) {
      if (!sessionID) return yield* new ToolFailure({ message: "Pass the sessionID of the target session" })
      const session = yield* sessions
        .get(sessionID)
        .pipe(Effect.mapError(() => new ToolFailure({ message: `Session not found: ${sessionID}` })))
      const access = yield* orchestra.access(session.id)
      if (session.id === project.main || access === "hidden" || !(yield* orchestra.owns(project, session)))
        return yield* new ToolFailure({ message: `Session not found: ${sessionID}` })
      if (!Orchestra.allows(access, required))
        return yield* new ToolFailure({
          message: `Access to ${sessionID} is "${access}"; this action needs "${required}". The operator can raise it in the project panel.`,
        })
      return session
    })

    // The team as the orchestrator may see it, grouped by category in first-seen order.
    // A session's role is named by its role id, the one action create takes, not its agent id.
    const team = Effect.fnUntraced(function* (project: Orchestra.Project) {
      const members = yield* orchestra.sessions(project.id).pipe(Effect.orDie)
      const access = yield* orchestra.accessMany(members.map((session) => session.id))
      const categories = yield* orchestra.categories(members.map((session) => session.id))
      const roles = yield* orchestra.roles()
      return members
        .filter((session) => access[session.id] !== "hidden")
        .map((session) => ({
          session,
          access: access[session.id],
          category: categories[session.id] ?? "Other",
          role: roles.find((role) => role.agent === session.agent)?.id ?? session.agent ?? "default",
        }))
    })

    const grouped = <T extends { category: string }>(rows: ReadonlyArray<T>, line: (row: T) => string) =>
      [...new Set(rows.map((row) => row.category))]
        .map((category) =>
          [`${category}:`, ...rows.filter((row) => row.category === category).map((row) => `- ${line(row)}`)].join(
            "\n",
          ),
        )
        .join("\n")

    const list = Effect.fnUntraced(function* (project: Orchestra.Project) {
      const rows = yield* team(project)
      if (rows.length === 0) return "No team sessions in this project yet. Create one with action create."
      const active = yield* sessions.active
      const pending = yield* Effect.forEach(rows, (row) => orchestra.pending(row.session.id))
      const now = Date.now()
      return grouped(
        rows.map((row, index) => ({ ...row, sent: pending[index] })),
        (row) =>
          [
            `${row.session.title ?? "(untitled)"} ${row.session.id}`,
            `role ${row.role}`,
            active.has(row.session.id) ? "running" : "idle",
            `access ${row.access}`,
            ...(row.sent === undefined
              ? []
              : [`task outstanding (sent ${Math.round((now - row.sent) / 60_000)} min ago)`]),
          ].join(" · "),
      )
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const project = yield* orchestra.mainOf(context.sessionID)
              if (!project)
                return yield* new ToolFailure({ message: "Only a project's main session can manage sessions" })
              const dispatch = (sessionID: SessionSchema.ID, text: string) =>
                orchestra.dispatch({ project, sessionID, text }).pipe(
                  Effect.mapError((error) => new ToolFailure({ message: `Could not send task: ${error.message}`, error })),
                )
              const roles = yield* orchestra.roles()
              // The Orchestrator's automatic choices for one task: a model from the role's list
              // and a narrower tool set. Both are checked against what the operator allowed.
              const choose = Effect.fnUntraced(function* (role: Orchestra.Role | undefined) {
                const model = input.model?.trim()
                if (model && !role?.models?.includes(model))
                  return yield* new ToolFailure({
                    message: role?.models?.length
                      ? `${model} is not one of ${role.name}'s models: ${role.models.join(", ")}`
                      : `${role?.name ?? "This session"} has no automatic model choice; omit model`,
                  })
                const tools = input.tools?.map((tool) => tool.trim()).filter(Boolean)
                if (tools && !role?.autoTools)
                  return yield* new ToolFailure({
                    message: `${role?.name ?? "This session"} does not let the Orchestrator change its tools; omit tools`,
                  })
                const outside = tools?.filter(
                  (tool) => tool !== "all" && role?.tools && !Orchestra.toolAllowed(role.tools, tool),
                )
                if (outside?.length)
                  return yield* new ToolFailure({
                    message: `${role?.name} may not use ${outside.join(", ")}; its tools are ${role?.tools?.join(", ")}`,
                  })
                return {
                  model: model ? Model.Ref.parse(model) : undefined,
                  permissions: tools ? (tools.includes("all") ? [] : Orchestra.toolRules(tools)) : undefined,
                }
              })
              const apply = Effect.fnUntraced(function* (
                sessionID: SessionSchema.ID,
                choice: { model?: Model.Ref; permissions?: Permission.Ruleset },
              ) {
                if (choice.model) yield* sessions.switchModel({ sessionID, model: choice.model }).pipe(Effect.orDie)
                if (choice.permissions)
                  yield* sessions.setPermissions({ sessionID, permissions: choice.permissions }).pipe(Effect.orDie)
              })
              const busy = (sessionID: SessionSchema.ID) =>
                Effect.gen(function* () {
                  if ((yield* orchestra.pending(sessionID)) === undefined) return
                  return yield* new ToolFailure({
                    message: `Session ${sessionID} already has an outstanding task. Wait for its <team-report> before sending another.`,
                  })
                })

              switch (input.action) {
                case "list":
                  return { output: yield* list(project) }
                case "read": {
                  const session = yield* target(project, input.sessionID, "read")
                  const messages = yield* sessions
                    .messages({ sessionID: session.id, limit: input.limit ?? 10, order: "desc" })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: "Could not read the session", error })))
                  const text = messages.toReversed().flatMap(render).join("\n\n")
                  return { sessionID: session.id, output: text || "The session has no messages yet." }
                }
                case "send": {
                  const session = yield* target(project, input.sessionID, "write")
                  if (!input.text?.trim()) return yield* new ToolFailure({ message: "Pass the message as text" })
                  yield* busy(session.id)
                  yield* apply(session.id, yield* choose(roles.find((role) => role.agent === session.agent)))
                  yield* dispatch(session.id, input.text)
                  return {
                    sessionID: session.id,
                    output: `Sent to ${session.title ?? session.id}. Its report will arrive here when it finishes.`,
                  }
                }
                case "create": {
                  const role = roles.find((item) => item.id === input.role)
                  // A role is required: without one the session runs the default agent under
                  // whatever title the model invents ("Architect"), a member the roster never had.
                  if (!role)
                    return yield* new ToolFailure({
                      message: `${input.role ? `Unknown role ${input.role}` : "Pass a role"}. Roles: ${roles.map((role) => role.id).join(", ")}`,
                    })
                  const choice = yield* choose(role)

                  // Reuse the project's existing worker by role before creating anything.
                  // A new instance is an explicit opt-in, not the default response to a new task.
                  if (!input.newInstance) {
                    const rows = yield* team(project)
                    const matching = rows.filter((row) => row.role === role.id)
                    if (matching.length > 0) {
                      const pending = new Set<string>()
                      for (const row of matching) {
                        if ((yield* orchestra.pending(row.session.id)) !== undefined) pending.add(row.session.id)
                      }
                      const reusable = reusableWorker(rows, role.id, pending)
                      if (reusable.session) {
                        const existing = reusable.session.session
                        yield* apply(existing.id, choice)
                        if (input.text?.trim()) yield* dispatch(existing.id, input.text)
                        return {
                          sessionID: existing.id,
                          output: input.text?.trim()
                            ? `Reused existing ${role.name} session ${existing.title ?? existing.id}; task queued. Its report will arrive here when it finishes.`
                            : `Reused existing ${role.name} session ${existing.title ?? existing.id}. No new session was created; use action send to assign work.`,
                        }
                      }
                      if (reusable.writable.length === 0) {
                        return yield* new ToolFailure({
                          message: `An existing ${role.name} session has no write access. Do not create a duplicate to bypass permissions; ask the operator to raise its access to write or full.`,
                        })
                      }
                      return yield* new ToolFailure({
                        message: `All existing ${role.name} sessions have an outstanding task. Wait for a <team-report> before sending more work. No duplicate session was created.`,
                      })
                    }
                  }

                  // A role without its own model runs on the orchestrator's, the one the operator picked,
                  // rather than the server's first catalog model.
                  const main = yield* sessions.get(context.sessionID).pipe(Effect.option)
                  // The core service holds the project lifecycle lock across ownership, creation,
                  // access and category writes; removal cannot leave a half-created member behind.
                  const created = yield* orchestra
                    .createMember({
                      project,
                      title: input.title?.trim() || undefined,
                      agent: role.agent,
                      model: choice.model ?? Orchestra.modelOf(role) ?? Option.getOrUndefined(main)?.model,
                      category: input.category,
                    })
                    .pipe(
                      Effect.mapError((error) => new ToolFailure({ message: `Could not create a session: ${error.message}`, error })),
                    )
                  if (choice.permissions)
                    yield* sessions.setPermissions({ sessionID: created.id, permissions: choice.permissions }).pipe(Effect.orDie)
                  if (input.text?.trim()) yield* dispatch(created.id, input.text)
                  return {
                    sessionID: created.id,
                    output: `Created ${created.id}${input.text?.trim() ? "; its report will arrive here when it finishes" : ""}.`,
                  }
                }
                case "stop": {
                  const session = yield* target(project, input.sessionID, "full")
                  const stopped = yield* sessions.interrupt(session.id)
                  return { sessionID: session.id, output: stopped ? "Stopped." : "The session was not running." }
                }
              }
            }).pipe(
              Effect.map((output) => ({
                output,
                content: output.output,
                metadata: output.sessionID ? { sessionID: output.sessionID } : {},
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)

    // The tool only exists for the project's main session; every other session
    // never sees it, so it cannot be prompted into managing its siblings.
    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        if (!event.tools[name]) return
        if (!(yield* orchestra.mainOf(event.sessionID))) delete event.tools[name]
      })
    // The main session also gets its team roster with every request. Status is left
    // out: it changes during a turn, and the stable roster keeps the prompt cacheable.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        yield* hook(event)
        if (!event.tools[name]) return
        const project = yield* orchestra.mainOf(event.sessionID)
        if (!project) return
        const rows = yield* team(project)
        const roles = yield* orchestra.roles()
        const playbook = yield* orchestra.playbook(project.id)
        const outcomes = yield* orchestra.outcomes(project.id)
        event.system.push({
          type: "text",
          text: [
            `# Your team — project "${project.name}" (${project.directory})`,
            rows.length === 0
              ? "The team has no sessions yet. No session exists until you create it with the sessions tool, action create."
              : [
                  "These are all the sessions of the team; no other session exists. Name and address them only by these titles and IDs.",
                  grouped(
                    rows,
                    (row) =>
                      [
                        `${row.session.title ?? "(untitled)"} ${row.session.id}`,
                        `role ${row.role}`,
                        `access ${row.access}`,
                        ...(outcomes[row.session.id] ? [`last report ${outcomes[row.session.id]?.outcome}`] : []),
                      ].join(" · "),
                  ),
                ].join("\n"),
            "",
            "Team workflow rules (mandatory):",
            "- Reuse an existing session with the needed role via action send; do not create a duplicate just because the task is new or a worker is busy.",
            "- Copy the complete session ID exactly from this roster. Never truncate, infer, or substitute an ID.",
            "- Sending a task ends this model turn while the worker runs; a task-linked <team-report> wakes you again. Do not tell the user the task is complete merely because send succeeded.",
            "- After each <team-report>, compare the worker's evidence with the original acceptance criteria. outcome=partial, incomplete, failed, or stopped means the task is still open unless explicitly blocked/cancelled (outcome=unknown: judge the report text itself): inspect the report and send a specific follow-up to the same worker once its previous task is no longer outstanding. outcome=complete is evidence to review, not a substitute for checking the criteria.",
            "- If a sessions tool call fails, inspect its exact error and use list/read to verify IDs and whether a task is outstanding. Fix the arguments or underlying cause before retrying; never repeat the identical failed call.",
            "- Do not call HTTP endpoints directly or guess /api/orchestra routes. If a tool/API error occurs, report its exact message and do not create a replacement session as a workaround.",
            "",
            ...(playbook
              ? [
                  "",
                  `# Team playbook — "${playbook.name}"`,
                  "This project was opened with this team. Follow its playbook unless the operator asks otherwise; scale it down for small requests.",
                  playbook.text,
                ]
              : []),
            "",
            "Roles you can create a session with (action create, role id):",
            ...roles.map((role) => `- ${role.id} (${role.name}, ${role.category}${role.readOnly ? ", read-only" : ""}): ${role.description}${setup(role)}`),
          ].join("\n"),
        })
      }),
    )
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}

// How a role is set up, when the operator changed anything the Orchestrator has to respect.
function setup(role: Orchestra.Role) {
  const parts = [
    role.models?.length ? `model: you choose per task from ${role.models.join(", ")}` : role.model ? `model ${role.model}` : "",
    role.tools ? `tools: ${role.tools.join(", ")}` : "",
    role.autoTools ? "you may narrow its tools per task" : "",
    role.hub ? `hub categories: ${role.hub.join(", ") || "none"}` : "",
  ].filter(Boolean)
  return parts.length > 0 ? ` [${parts.join("; ")}]` : ""
}

function render(message: SessionMessage.Info) {
  if (message.type === "user") return [`[user] ${message.text}`]
  if (message.type === "synthetic") return [`[note] ${message.text}`]
  if (message.type !== "assistant") return []
  const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
  const tools = message.content.flatMap((part) => (part.type === "tool" ? [part.name] : []))
  return [`[assistant] ${text}${tools.length > 0 ? `\n(tools: ${tools.join(", ")})` : ""}`]
}
