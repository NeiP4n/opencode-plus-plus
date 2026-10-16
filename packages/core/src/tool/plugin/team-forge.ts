export * as TeamForgeTool from "./team-forge.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { SessionEvent } from "@opencode/schema/session-event"
import type { SessionID } from "@opencode/schema/session-id"
import { Effect, Schema, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Hub } from "../../hub/index.js"
import { McpCatalog } from "../../mcp/catalog.js"
import { Orchestra } from "../../orchestra.js"

export const name = "team_forge"
export const command = "forge-teams"

const description = [
  "Design and add AI teams to the team registry the operator opens projects from. Only a session running the /forge-teams command has this tool.",
  "Actions: list shows every role (id, category, tools, read-only) and every team with its members, plus the tool groups, Registry categories and installed Registry programs a role can be limited to;",
  "role adds a new custom role (name, description, rules, category, readOnly, optional tools, hub, registry) and returns its id;",
  "team adds a new team (name, description, playbook, members: each an exact role id, a session title and a category). A team must not repeat the name or the same set of roles as an existing one.",
  "This tool only adds; it never edits or removes the operator's roles and teams.",
].join("\n")

const Member = Schema.Struct({
  role: Schema.String.annotate({ description: "Exact role id from list, or one returned by action role" }),
  title: Schema.String.annotate({ description: "Session title for this member, e.g. Backend developer" }),
  category: Schema.optionalKey(Schema.String).annotate({ description: "Planning, Build, Quality, ..." }),
})

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "role", "team"]),
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  rules: Schema.optionalKey(Schema.String).annotate({
    description: "For role: what the role does and how, one instruction per line, concrete and checkable",
  }),
  category: Schema.optionalKey(Schema.String),
  readOnly: Schema.optionalKey(Schema.Boolean),
  tools: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "For role: permission actions it may use (see the tool groups in list); omit for every tool",
  }),
  hub: Schema.optionalKey(Schema.Array(Schema.String)).annotate({ description: "For role: Registry categories" }),
  registry: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "For role: installed Registry programs it may use; omit for all of them",
  }),
  playbook: Schema.optionalKey(Schema.String).annotate({
    description: "For team: phases, who does what, what runs in parallel and when the work is done",
  }),
  members: Schema.optionalKey(Schema.Array(Member)),
})

export const Output = Schema.Struct({ output: Schema.String })

// A forging session keeps designing teams: each time its run ends, it is woken for the next one,
// until the operator stops it or the requested number of teams exists.
type Forge = { remaining?: number; focus: string }

export const Plugin = {
  id: "opencode.tool.team-forge",
  effect: Effect.fn("TeamForgeTool.Plugin")(function* (ctx: Context) {
    const orchestra = yield* Orchestra.Service
    const bus = yield* Bus.Service
    const forging = new Map<SessionID, Forge>()

    const list = Effect.fnUntraced(function* () {
      const roles = yield* orchestra.roles()
      const templates = yield* orchestra.templates()
      const installed = Hub.all
        .filter((entry) => Hub.supportsPlatform(entry))
        .flatMap((entry) => entry.requires ?? [])
        .filter((tool, index, all) => all.indexOf(tool) === index && Hub.HubHost.has(tool))
        .sort()
      return [
        "Roles:",
        ...roles.map(
          (role) =>
            `- ${role.id} (${role.name}, ${role.category}${role.readOnly ? ", read-only" : ""}${role.tools ? `, tools ${role.tools.join(" ")}` : ""}): ${role.description}`,
        ),
        "",
        "Teams:",
        ...templates.map(
          (template) =>
            `- ${template.name}: ${template.description} [${template.members
              .map((member) => roles.find((role) => role.agent === member.agent)?.id ?? member.agent)
              .join(", ")}]`,
        ),
        "",
        `Tool groups: ${Orchestra.toolGroups.map((group) => `${group.id}=${group.actions.join("+")}`).join(", ")}`,
        `Registry categories: ${[...new Set(Hub.all.filter((entry) => Hub.supportsPlatform(entry)).map((entry) => entry.category))].sort().join(", ")}`,
        `Installed Registry programs: ${installed.join(", ") || "none"}`,
        `AI tools a role can be given in tools as <id>_*: ${McpCatalog.forPlatform()
          .map((entry) => `${entry.id} (${entry.description})`)
          .join("; ")}`,
        `Computer tools: desktop and desktop_* share the permission action "desktop"; give it to roles that must see or operate the screen.`,
      ].join("\n")
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
              switch (input.action) {
                case "list":
                  return { output: yield* list() }
                case "role": {
                  const role = yield* orchestra
                    .saveRole(undefined, {
                      name: input.name ?? "",
                      description: input.description ?? "",
                      rules: input.rules ?? "",
                      category: input.category ?? "",
                      readOnly: input.readOnly ?? false,
                      ...(input.tools ? { tools: input.tools } : {}),
                      ...(input.hub ? { hub: input.hub } : {}),
                      ...(input.registry ? { registry: input.registry } : {}),
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                  return { output: `Added role ${role.id} (${role.name}). Use this id in a team's members.` }
                }
                case "team": {
                  const roles = yield* orchestra.roles()
                  const templates = yield* orchestra.templates()
                  const members = input.members ?? []
                  const unknown = members.filter((member) => !roles.some((role) => role.id === member.role))
                  if (unknown.length > 0)
                    return yield* new ToolFailure({
                      message: `Unknown role ids: ${unknown.map((member) => member.role).join(", ")}. Call list, or add them with action role first.`,
                    })
                  const agents = members.map((member) => roles.find((role) => role.id === member.role)!.agent)
                  const key = [...agents].sort().join(" ")
                  const same = templates.find(
                    (template) =>
                      template.name.trim().toLowerCase() === (input.name ?? "").trim().toLowerCase() ||
                      template.members.map((member) => member.agent).sort().join(" ") === key,
                  )
                  if (same)
                    return yield* new ToolFailure({
                      message: `Team ${same.name} already has this name or exactly these roles. Design a different team.`,
                    })
                  const template = yield* orchestra
                    .saveTemplate(undefined, {
                      name: input.name ?? "",
                      description: input.description ?? "",
                      ...(input.playbook ? { playbook: input.playbook } : {}),
                      members: members.map((member, index) => ({
                        agent: agents[index]!,
                        title: member.title,
                        category:
                          member.category ?? roles.find((role) => role.id === member.role)?.category ?? "Team",
                      })),
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                  const forge = forging.get(context.sessionID)
                  if (forge?.remaining !== undefined) forge.remaining -= 1
                  const left =
                    forge?.remaining === undefined
                      ? " Continue with the next team."
                      : forge.remaining > 0
                        ? ` ${forge.remaining} more to go; continue with the next team.`
                        : " That was the last requested team: summarize what you added and stop."
                  if (forge?.remaining === 0) forging.delete(context.sessionID)
                  return { output: `Added team ${template.name} (${template.members.length} members).${left}` }
                }
              }
            }).pipe(Effect.map((output) => ({ output, content: output.output }))),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.command.transform((editor) =>
      editor.add({
        name: command,
        description: "AI agents design and add the best teams, one after another until stopped [count] [focus]",
        execute: (input) => {
          const [first, ...rest] = input.prompt.text.trim().split(/\s+/)
          const count = first && /^\d+$/.test(first) ? Number(first) : undefined
          const focus = (count === undefined ? input.prompt.text : rest.join(" ")).trim()
          forging.set(input.sessionID, { remaining: count, focus })
          return ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: prompt(count, focus),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid)
        },
      }),
    )

    // Wake a forging session for its next team when a run ends; a stop or failure ends the forge.
    yield* bus
      .subscribe([SessionEvent.Execution.Succeeded, SessionEvent.Execution.Failed, SessionEvent.Execution.Interrupted])
      .pipe(
        Stream.runForEach((event) => {
          const forge = forging.get(event.data.sessionID)
          if (!forge) return Effect.void
          if (event.type !== SessionEvent.Execution.Succeeded.type) {
            if (event.type === SessionEvent.Execution.Interrupted.type && event.data.reason === "shutdown")
              return Effect.void
            forging.delete(event.data.sessionID)
            return Effect.void
          }
          return ctx.session
            .prompt({
              sessionID: event.data.sessionID,
              delivery: "queue",
              text: [
                "<team-forge>",
                "Design and add the next team now: call team_forge list, find a kind of work the registry still serves poorly, and add the best team for it with action team (adding any missing roles first).",
                forge.focus ? `Focus: ${forge.focus}` : "",
                forge.remaining !== undefined ? `${forge.remaining} more teams requested.` : "Keep going until the operator stops you.",
                "</team-forge>",
              ]
                .filter(Boolean)
                .join("\n"),
            })
            .pipe(Effect.ignore)
        }),
        Effect.forkScoped({ startImmediately: true }),
      )

    // Only a forging session sees the tool, so no other session can rewrite the registry.
    const hook = (event: SessionHooks["context"]) =>
      Effect.sync(() => {
        if (event.tools[name] && !forging.has(event.sessionID)) delete event.tools[name]
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}

function prompt(count: number | undefined, focus: string) {
  return [
    "You are the team forge: you design the best possible AI teams and add them to the team registry the operator opens projects from, one after another.",
    count === undefined
      ? "Keep designing teams without end: after each one, start the next. Only the operator stops you."
      : `Add ${count} teams, then stop.`,
    focus ? `Focus on: ${focus}` : "Cover the kinds of software work people really do: web, mobile, desktop, games, data/ML, infrastructure, security, documentation, migrations, performance, research.",
    "",
    "For each team:",
    "1. Call team_forge list. Never add a team whose name or set of roles already exists; find a gap instead.",
    "2. Pick one kind of work and decide the smallest set of roles that does it well (usually 3-6): who plans, who builds, who checks. Reuse existing roles when they fit.",
    "3. Add each missing role with action role: a precise description the Orchestrator can route on, concrete one-line rules (mission, what to read first, how to work, what evidence to report), readOnly for roles that must not edit, and the tool groups it really needs (a reviewer does not need edit; a researcher needs web).",
    "4. Add the team with action team: a clear name and description, members with titles and categories, and a playbook: phases, which role does what, what runs in parallel, and the definition of done with the checks that prove it.",
    "5. Say in one line what you added and why it is better than what existed, then go straight to the next team.",
  ].join("\n")
}
