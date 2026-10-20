export * as TeamForgeTool from "./team-forge.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
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
  "Manage the shared team registry. This tool is available in every session so the operator can inspect, edit and delete teams without first running /forge-teams.",
  "Always list or fetch the exact entry before changing it. Only mutate the registry when the operator explicitly requests a specific change; never infer permission to edit or delete from an unrelated task.",
  "Actions: list shows role/team ids and summaries; get_role and get_team return the full editable definition by exact id;",
  "role creates a custom role; edit_role fully replaces an existing role by id; delete_role removes a custom role or restores an edited built-in role to defaults;",
  "team creates a team; edit_team fully replaces an existing team by id; delete_team removes a custom team or restores a built-in team to defaults.",
  "For edit_role, provide id, name, description, rules, category and readOnly. Optional model, models, autoTools, tools, hub and registry are replacement fields: omit a field to clear its override (omitting tools/hub/registry means unrestricted defaults).",
  "For edit_team, provide id, name, description and the complete members array. Omit playbook to clear it. Members use exact role ids, titles and optional categories.",
  "Deleting a role still used by a team fails; remove it from those teams first. Built-in roles/teams cannot be permanently deleted: the delete action restores their defaults.",
  "Never edit or delete an existing entry unless the operator explicitly requests that exact change. Automated forge runs should only list and add.",
].join("\n")

const Member = Schema.Struct({
  role: Schema.String.annotate({ description: "Exact role id from list, or one returned by action role" }),
  title: Schema.String.annotate({ description: "Session title for this member, e.g. Backend developer" }),
  category: Schema.optionalKey(Schema.String).annotate({ description: "Planning, Build, Quality, ..." }),
})

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "get_role", "get_team", "role", "edit_role", "delete_role", "team", "edit_team", "delete_team"]),
  id: Schema.optionalKey(Schema.String).annotate({ description: "Exact role/team id returned by list or get_role/get_team; required for get, edit and delete actions" }),
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  rules: Schema.optionalKey(Schema.String).annotate({
    description: "For role: what the role does and how, one instruction per line, concrete and checkable",
  }),
  category: Schema.optionalKey(Schema.String),
  readOnly: Schema.optionalKey(Schema.Boolean),
  model: Schema.optionalKey(Schema.String).annotate({ description: "For role: default model as provider/model" }),
  models: Schema.optionalKey(Schema.Array(Schema.String)).annotate({ description: "For role: allowed model list; omit to use defaults" }),
  autoTools: Schema.optionalKey(Schema.Boolean).annotate({ description: "For role: enable automatically discovered tools" }),
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
type Forge = { remaining: number; focus: string; newRoles: number; progress: boolean }

// Without a count the forge adds one team, never an endless stream. A team may bring a couple of
// new roles at most, and the registry keeps a ceiling on custom roles, so the role list stays
// something an operator can still read.
const DEFAULT_TEAMS = 1
const MAX_TEAMS = 5
const MAX_NEW_ROLES_PER_TEAM = 2
const MAX_CUSTOM_ROLES = 12

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
            `- ${role.id} (${role.name}, ${role.category}, ${role.origin}${role.readOnly ? ", read-only" : ""}${role.tools === undefined ? ", all tools" : `, tools ${role.tools.join(" ") || "none"}`}): ${role.description}`,
        ),
        "",
        "Teams:",
        ...templates.map(
          (template) =>
            `- ${template.id} (${template.origin}) ${template.name}: ${template.description} [${template.members
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
        `Computer tools: desktop and desktop_* share the permission action "desktop"; give it to roles that must see or operate the screen. playtest (permission "playtest") runs and drives apps and games off-screen with a virtual mouse; give it to testers.`,
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
                case "get_role": {
                  const id = input.id?.trim()
                  if (!id) return yield* new ToolFailure({ message: "get_role requires the exact role id. Call list first." })
                  const role = (yield* orchestra.roles()).find((item) => item.id === id)
                  if (!role) return yield* new ToolFailure({ message: `Unknown role id: ${id}. Call list to see the current ids.` })
                  const spec = {
                    name: role.name,
                    description: role.description,
                    rules: role.rules,
                    category: role.category,
                    readOnly: role.readOnly,
                    ...(role.model !== undefined ? { model: role.model } : {}),
                    ...(role.models !== undefined ? { models: role.models } : {}),
                    ...(role.autoTools !== undefined ? { autoTools: role.autoTools } : {}),
                    ...(role.tools !== undefined ? { tools: role.tools } : {}),
                    ...(role.hub !== undefined ? { hub: role.hub } : {}),
                    ...(role.registry !== undefined ? { registry: role.registry } : {}),
                  }
                  return {
                    output: [
                      `Role id: ${role.id}`,
                      `Origin: ${role.origin}`,
                      "The following is the complete editable definition. For edit_role, send these fields with any desired changes.",
                      "When editing, omit optional fields to clear their overrides; for tools/hub/registry, omission means unrestricted defaults.",
                      JSON.stringify(spec, null, 2),
                    ].join("\n"),
                  }
                }
                case "get_team": {
                  const id = input.id?.trim()
                  if (!id) return yield* new ToolFailure({ message: "get_team requires the exact team id. Call list first." })
                  const template = (yield* orchestra.templates()).find((item) => item.id === id)
                  if (!template) return yield* new ToolFailure({ message: `Unknown team id: ${id}. Call list to see the current ids.` })
                  const roles = yield* orchestra.roles()
                  const spec = {
                    name: template.name,
                    description: template.description,
                    ...(template.playbook !== undefined ? { playbook: template.playbook } : {}),
                    members: template.members.map((member) => ({
                      role: roles.find((role) => role.agent === member.agent)?.id ?? member.agent,
                      title: member.title,
                      category: member.category,
                    })),
                  }
                  return {
                    output: [
                      `Team id: ${template.id}`,
                      `Origin: ${template.origin}`,
                      "The following is the complete editable definition. For edit_team, send the full name, description and members array.",
                      "Omit playbook when editing to clear it.",
                      JSON.stringify(spec, null, 2),
                    ].join("\n"),
                  }
                }
                case "role": {
                  const existing = yield* orchestra.roles()
                  const name = (input.name ?? "").trim().toLowerCase()
                  const duplicate = existing.find(
                    (item) =>
                      item.name.trim().toLowerCase() === name ||
                      (input.description !== undefined &&
                        item.description.trim().toLowerCase() === input.description.trim().toLowerCase()),
                  )
                  if (duplicate)
                    return yield* new ToolFailure({
                      message: `Role ${duplicate.name} (${duplicate.id}) already covers this. Use its id in the team instead of adding a new role.`,
                    })
                  if (existing.filter((item) => item.origin === "custom").length >= MAX_CUSTOM_ROLES)
                    return yield* new ToolFailure({
                      message: `The registry already has ${MAX_CUSTOM_ROLES} custom roles. Reuse existing roles; the operator can delete unused ones with delete_role.`,
                    })
                  const forge = forging.get(context.sessionID)
                  if (forge && forge.newRoles >= MAX_NEW_ROLES_PER_TEAM)
                    return yield* new ToolFailure({
                      message: `A team may add at most ${MAX_NEW_ROLES_PER_TEAM} new roles. Build the team from existing roles.`,
                    })
                  if (forge) forge.newRoles += 1
                  const role = yield* orchestra
                    .saveRole(undefined, {
                      name: input.name ?? "",
                      description: input.description ?? "",
                      rules: input.rules ?? "",
                      category: input.category ?? "",
                      readOnly: input.readOnly ?? false,
                      ...(input.model !== undefined ? { model: input.model } : {}),
                      ...(input.models !== undefined ? { models: input.models } : {}),
                      ...(input.autoTools !== undefined ? { autoTools: input.autoTools } : {}),
                      ...(input.tools !== undefined ? { tools: input.tools } : {}),
                      ...(input.hub !== undefined ? { hub: input.hub } : {}),
                      ...(input.registry !== undefined ? { registry: input.registry } : {}),
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                  return { output: `Added role ${role.id} (${role.name}). Use this id in a team's members.` }
                }
                case "edit_role": {
                  const id = input.id?.trim()
                  if (!id) return yield* new ToolFailure({ message: "edit_role requires the exact role id. Call list first." })
                  if (
                    input.name === undefined ||
                    input.description === undefined ||
                    input.rules === undefined ||
                    input.category === undefined ||
                    input.readOnly === undefined
                  )
                    return yield* new ToolFailure({
                      message: "edit_role is a full replacement, not a patch. Provide id, name, description, rules, category and readOnly; use get_role first to preserve fields you do not intend to change.",
                    })
                  const existing = (yield* orchestra.roles()).find((item) => item.id === id)
                  if (!existing) return yield* new ToolFailure({ message: `Unknown role id: ${id}. Call list to see the current ids.` })
                  const role = yield* orchestra
                    .saveRole(id, {
                      name: input.name,
                      description: input.description,
                      rules: input.rules,
                      category: input.category,
                      readOnly: input.readOnly,
                      ...(input.model !== undefined ? { model: input.model } : {}),
                      ...(input.models !== undefined ? { models: input.models } : {}),
                      ...(input.autoTools !== undefined ? { autoTools: input.autoTools } : {}),
                      ...(input.tools !== undefined ? { tools: input.tools } : {}),
                      ...(input.hub !== undefined ? { hub: input.hub } : {}),
                      ...(input.registry !== undefined ? { registry: input.registry } : {}),
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                  return { output: `Updated role ${role.id} (${role.name}) using a full replacement.` }
                }
                case "delete_role": {
                  const id = input.id?.trim()
                  if (!id) return yield* new ToolFailure({ message: "delete_role requires the exact role id. Call list first." })
                  const existing = (yield* orchestra.roles()).find((item) => item.id === id)
                  if (!existing) return yield* new ToolFailure({ message: `Unknown role id: ${id}. Call list to see the current ids.` })
                  yield* orchestra.removeRole(id).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                  return {
                    output: existing.origin === "custom"
                      ? `Deleted custom role ${existing.name} (${id}).`
                      : `Restored built-in role ${existing.name} (${id}) to defaults; built-in roles cannot be permanently deleted.`,
                  }
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
                  if (forge) {
                    forge.remaining -= 1
                    forge.newRoles = 0
                    forge.progress = true
                  }
                  const left =
                    !forge || forge.remaining <= 0
                      ? " That was the last requested team: summarize what you added and stop."
                      : ` ${forge.remaining} more to go; continue with the next team.`
                  if (forge && forge.remaining <= 0) forging.delete(context.sessionID)
                  return { output: `Added team ${template.name} (${template.members.length} members).${left}` }
                }
                case "edit_team": {
                  const id = input.id?.trim()
                  if (!id) return yield* new ToolFailure({ message: "edit_team requires the exact team id. Call list first." })
                  if (input.name === undefined || input.description === undefined || input.members === undefined)
                    return yield* new ToolFailure({
                      message: "edit_team is a full replacement, not a patch. Provide id, name, description and the complete members array; use get_team first to preserve existing members and the playbook if needed.",
                    })
                  const roles = yield* orchestra.roles()
                  const templates = yield* orchestra.templates()
                  const existing = templates.find((item) => item.id === id)
                  if (!existing) return yield* new ToolFailure({ message: `Unknown team id: ${id}. Call list to see the current ids.` })
                  const members = input.members
                  const unknown = members.filter((member) => !roles.some((role) => role.id === member.role))
                  if (unknown.length > 0)
                    return yield* new ToolFailure({
                      message: `Unknown role ids: ${unknown.map((member) => member.role).join(", ")}. Call list or get_role first.`,
                    })
                  const agents = members.map((member) => roles.find((role) => role.id === member.role)!.agent)
                  const key = [...agents].sort().join(" ")
                  const normalizedName = input.name.trim().toLowerCase()
                  const same = templates.find(
                    (template) =>
                      template.id !== id &&
                      (template.name.trim().toLowerCase() === normalizedName ||
                        template.members.map((member) => member.agent).sort().join(" ") === key),
                  )
                  if (same)
                    return yield* new ToolFailure({
                      message: `Cannot update ${existing.name}: team ${same.name} already has this name or exactly these roles.`,
                    })
                  const template = yield* orchestra
                    .saveTemplate(id, {
                      name: input.name,
                      description: input.description,
                      ...(input.playbook !== undefined ? { playbook: input.playbook } : {}),
                      members: members.map((member, index) => ({
                        agent: agents[index]!,
                        title: member.title,
                        category:
                          member.category ?? roles.find((role) => role.id === member.role)?.category ?? "Team",
                      })),
                    })
                    .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                  return { output: `Updated team ${template.id} (${template.name}) with a full replacement.` }
                }
                case "delete_team": {
                  const id = input.id?.trim()
                  if (!id) return yield* new ToolFailure({ message: "delete_team requires the exact team id. Call list first." })
                  const existing = (yield* orchestra.templates()).find((item) => item.id === id)
                  if (!existing) return yield* new ToolFailure({ message: `Unknown team id: ${id}. Call list to see the current ids.` })
                  yield* orchestra.removeTemplate(id).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error })))
                  return {
                    output: existing.origin === "custom"
                      ? `Deleted custom team ${existing.name} (${id}).`
                      : `Restored built-in team ${existing.name} (${id}) to defaults; built-in teams cannot be permanently deleted.`,
                  }
                }
              }
            }).pipe(Effect.map((output) => ({ output, content: output.output }))),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.command.transform((editor) =>
      editor.add({
        name: command,
        description: "Manage the team registry without auto-generating teams with `manage`, or design and add teams with [count] [focus]",
        execute: (input) => {
          const [first, ...rest] = input.prompt.text.trim().split(/\s+/)
          if (first?.toLowerCase() === "manage") {
            // Enable CRUD access without starting the automatic team-generation loop.
            forging.delete(input.sessionID)
            return ctx.session
              .prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: [
                  "You are now in team registry management mode.",
                  "Do not create or change anything automatically. Wait for the operator's concrete request.",
                  "Use team_forge list/get_role/get_team to inspect entries, edit_role/edit_team for full replacements, and delete_role/delete_team for removals.",
                  "For deletion, first list the registry and use the exact ID; ask for clarification if the requested entry is ambiguous.",
                  "Acknowledge that management mode is ready, then wait.",
                ].join("\n"),
                delivery: input.delivery,
              })
              .pipe(Effect.asVoid)
          }
          const given = first && /^\d+$/.test(first) ? Number(first) : undefined
          const count = Math.min(Math.max(given ?? DEFAULT_TEAMS, 1), MAX_TEAMS)
          const focus = (given === undefined ? input.prompt.text : rest.join(" ")).trim()
          forging.set(input.sessionID, { remaining: count, focus, newRoles: 0, progress: false })
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

    yield* ctx.command.transform((editor) =>
      editor.add({
        name: "forge-group",
        description: "Create a federation group from existing projects: roles, then the group, its projects and its one chat (Президент or Общество). [group name] [projects] [lead|council]",
        execute: (input) =>
          ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: groupPrompt(input.prompt.text.trim()),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid),
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
          // A run that added no team means the forge has nothing more to add: stop instead of re-prompting.
          if (!forge.progress) {
            forging.delete(event.data.sessionID)
            return Effect.void
          }
          forge.progress = false
          return ctx.session
            .prompt({
              sessionID: event.data.sessionID,
              delivery: "queue",
              text: [
                "<team-forge>",
                "Design and add the next team now: call team_forge list, find a kind of work the registry still serves poorly, and add the best team for it with action team (adding any missing roles first).",
                forge.focus ? `Focus: ${forge.focus}` : "",
                `${forge.remaining} more teams requested.`,
                "</team-forge>",
              ]
                .filter(Boolean)
                .join("\n"),
            })
            .pipe(Effect.ignore)
        }),
        Effect.forkScoped({ startImmediately: true }),
      )


  }),
}

function groupPrompt(request: string) {
  return [
    "You are configuring one federation group of existing OpenCode projects for the operator. You have every tool this needs: team_forge for roles and teams, and the federation tool for projects, groups and the group's chat.",
    request ? `Operator request: ${request}` : "The operator did not provide a group name or project list yet. Ask one concise question for the group name, the exact projects and the coordination mode.",
    "",
    "Workflow, in this order:",
    "1. Roles first. Call team_forge action=list and read the current roles, teams and tool groups. Reuse an existing role whenever it can do the work; add a role only for work no role covers, with action=role: a precise description, concrete one-line rules and the minimum tools (reviewers are read-only without edit or shell; research roles get read plus web; build roles get write tools only when the work needs them). If the projects need a reusable team, add it with action=team using exact role ids, titles and a playbook. Never edit or delete an existing role or team during this run.",
    "2. Resolve projects. Call federation action=projects to get the exact id of every requested project. Never invent an id or create a project record. Every project already has its own Orchestrator session, created together with the project: do not create orchestrator sessions and do not open or message sessions in member projects.",
    "3. Create the group. Work out the mode: lead means one coordinator above the member Orchestrators (Президент); council means every member Orchestrator contributes to one shared chat (Общество). If the request does not say, ask. Then call federation action=group_create with the group name, the exact project ids in coordinator-first order and the mode.",
    "4. Adjust membership as requested with federation action=group_add (append projects) or action=group_remove (take projects out); action=group_edit renames the group or changes its mode. Changing the name, the mode or the first (coordinator) project unbinds the existing chat, so create the chat again after that.",
    "5. Create exactly one chat for the group with federation action=group_chat. In lead mode it creates Президент, which reads status and receives reports from the member Orchestrators; in council mode it creates Общество, which can call consult_all after an explicit operator task. Never create a President or Society session inside a project, and never create both chats for one group.",
    "6. Report what was done: roles and teams added, group name, mode, projects in coordinator-first order, the chat session id and title, and any project whose Orchestrator session is missing (report it; do not create one).",
    "",
    "Rules:",
    "- Do not call link_group unless the operator explicitly asks to link every pair; linking changes communication policy.",
    "- Delete a group, role or team only when the operator explicitly asks for that exact deletion, and then use group_delete or the team_forge delete actions.",
    "- A group chat is not a project session: it owns no files, cannot edit project code, cannot dispatch tasks and does not change project permissions or approvals.",
  ].join("\n")
}

function prompt(count: number, focus: string) {
  return [
    "You are the team forge: you design AI teams and add them to the team registry the operator opens projects from.",
    `Add ${count} ${count === 1 ? "team" : "teams"}, then stop.`,
    focus ? `Focus on: ${focus}` : "Cover the kinds of software work people really do: web, mobile, desktop, games, data/ML, infrastructure, security, documentation, migrations, performance, research.",
    "",
    "For each team:",
    "1. Call team_forge list. Never add a team whose name or set of roles already exists; find a gap instead.",
    `2. Pick one kind of work and decide the smallest set of roles that does it well (usually 3-6): who plans, who builds, who checks. Build the team from existing roles first; add a new role only when no existing one can do the job, at most ${MAX_NEW_ROLES_PER_TEAM} per team. A role that differs from an existing one only in wording is a duplicate, not a new role.`,
    "3. Add each missing role with action role: a precise description the Orchestrator can route on, concrete one-line rules (mission, what to read first, how to work, what evidence to report), readOnly for roles that must not edit, and the tool groups it really needs (a reviewer does not need edit; a researcher needs web).",
    "4. Add the team with action team: a clear name and description, members with titles and categories, and a playbook: phases, which role does what, what runs in parallel, and the definition of done with the checks that prove it.",
    "5. Say in one line what you added and why it is better than what existed, then go straight to the next team.",
    "Never edit or delete an existing role or team unless the operator explicitly asked for that exact change; this automated loop only adds.",
  ].join("\n")
}
