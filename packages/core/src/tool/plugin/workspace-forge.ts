export * as WorkspaceForgeTool from "./workspace-forge.js"

import { ToolFailure } from "@opencode/ai"
import path from "node:path"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Federation as FederationSchema } from "@opencode/schema/federation"
import { Effect, Schema } from "effect"
import { Federation } from "../../federation.js"
import { Orchestra } from "../../orchestra.js"
import { Permission } from "../../permission.js"

export const name = "workspace_forge"
const SandboxMode = Schema.Literals(["none", "environment", "strict"])
type SandboxMode = typeof SandboxMode.Type

const GroupMember = Schema.Struct({
  projectID: Schema.optionalKey(Schema.String).annotate({
    description: "Existing project ID from list. When set, do not pass name, directory, team or sandbox.",
  }),
  name: Schema.optionalKey(Schema.String).annotate({ description: "Name of a new project." }),
  directory: Schema.optionalKey(Schema.String).annotate({
    description: "Path to an existing directory for a new project. Sandboxed modes require a git repository.",
  }),
  team: Schema.optionalKey(Schema.String).annotate({
    description: "Exact AI team template ID from list; mutually exclusive with role.",
  }),
  role: Schema.optionalKey(Schema.String).annotate({
    description: "Exact individual AI role ID from list; creates one worker session alongside this project's Orchestrator. Mutually exclusive with team.",
  }),
  sandbox: Schema.optionalKey(SandboxMode),
})

export const Input = Schema.Struct({
  action: Schema.Literals(["list", "create_session", "create_group"]),
  name: Schema.optionalKey(Schema.String).annotate({ description: "Name of the new project/session or federated group." }),
  directory: Schema.optionalKey(Schema.String).annotate({
    description: "Path to an existing directory. Used by create_session.",
  }),
  team: Schema.optionalKey(Schema.String).annotate({
    description: "Exact AI team template ID from list. Omit for an Orchestrator-only project. Mutually exclusive with role.",
  }),
  role: Schema.optionalKey(Schema.String).annotate({
    description: "Exact individual AI role ID from list. Creates one worker session alongside the project Orchestrator. Mutually exclusive with team.",
  }),
  sandbox: Schema.optionalKey(SandboxMode).annotate({
    description: "none works directly in the selected directory; environment uses an isolated git worktree and separate OpenCode environment; strict adds bubblewrap confinement. Defaults to environment.",
  }),
  members: Schema.optionalKey(Schema.Array(GroupMember)).annotate({
    description: "For create_group: at least two ordered members. Each member is an existing projectID or a new project with directory and optional name/team/sandbox. The first project coordinates the group.",
  }),
  link: Schema.optionalKey(Schema.Boolean).annotate({
    description: "For create_group: link every pair after creation. Defaults to true and asks the operator for approval; false leaves the group unlinked.",
  }),
  mode: Schema.optionalKey(FederationSchema.CoordinationMode).annotate({
    description:
      "For create_group: lead creates the group's Президент chat above the member Orchestrators; council creates its Общество chat. Ask the operator which one they want; there is no default.",
  }),
})
export const Output = Schema.Struct({ output: Schema.String })

type MemberSpec =
  | { kind: "existing"; project: Orchestra.Project }
  | { kind: "create"; name: string; directory: string; team?: string; role?: Orchestra.Role; sandbox: SandboxMode }

const sandboxChoice = (value: SandboxMode | undefined): SandboxMode => value ?? "environment"
const sandboxArgs = (value: SandboxMode) => (value === "none" ? {} : { isolation: value })
type GroupMemberInput = typeof GroupMember.Type

export function groupMemberCountError(members: ReadonlyArray<GroupMemberInput> | undefined) {
  if (!members || members.length < 2)
    return "create_group needs at least two members: each must be an existing projectID or a new project with an existing directory."
}

export function groupModeError(mode: string | undefined) {
  if (!mode)
    return "create_group needs mode: lead creates the group's Президент chat, council creates its Общество chat. Ask the operator which one they want."
}

const projectLine = (project: Orchestra.Project) =>
  `${project.name} (${project.id}) · directory: ${project.directory} · main: ${project.main ?? "not initialized"} · sandbox: ${project.sandbox?.isolation ?? "none"}`

export const Plugin = {
  id: "opencode.tool.workspace-forge",
  effect: Effect.fn("WorkspaceForgeTool.Plugin")(function* (ctx: Context) {
    const orchestra = yield* Orchestra.Service
    const federation = yield* Federation.Service
    const permission = yield* Permission.Service

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name,
        options: { codemode: false },
        description: [
          "Create OpenCode++ workspaces and federated groups. Available only to a project's main Orchestrator; workers should ask their Orchestrator to do this.",
          "Call action=list first for exact project IDs, team-template IDs and roles. An AI team is an Orchestra team template of role-based sessions. A federated group is a set of projects with one group-bound chat: Президент in lead mode or Общество in council mode.",
          "create_session creates a project/workspace and its main Orchestrator session. Choose one exact team-template ID to create every role session in that team, or one exact role ID to create a single worker session; team and role are mutually exclusive. Omit both for an Orchestrator-only project. directory must already exist.",
          "Sandbox modes: none uses the selected directory directly; environment (default) uses a separate git worktree and OpenCode data/config/state; strict adds bubblewrap confinement. Sandbox modes require a git repository; strict also requires bwrap. Never silently fall back to no sandbox.",
          "create_group creates a whole federation in one call: at least two ordered members, each an existing projectID or a new project (directory, optional name, one role or team, and sandbox). Each new member gets its own Orchestrator and, with team, exactly one session per template role. The first project coordinates the group. Then the group is registered and gets exactly one chat for the required mode. Linking defaults on and requires operator approval.",
          "Never invent paths or IDs, and never emulate a team by creating extra worker sessions in the current project: a project's team comes only from its own template. A group chat only uses sanitized federation status and permission-checked tickets; it must not access other projects' files or sessions.",
        ].join("\n"),
        input: Input,
        output: Output,
        execute: (input, context) =>
          Effect.gen(function* () {
            const mainSession = yield* orchestra.mainOf(context.sessionID)
            if (!mainSession)
              return yield* new ToolFailure({
                message:
                  "workspace_forge is available only to a project's main Orchestrator session (the ★ Оркестратор row). Do not search the filesystem, the database or the config for these tools. Tell the operator to run /forge-group from that session.",
              })

            const assertExternalDirectories = (directories: readonly string[]) =>
              Effect.gen(function* () {
                const external = [
                  ...new Set(
                    directories
                      .map((directory) =>
                        path.resolve(directory.trim().replace(/^~(?=$|[\\/])/, process.env.HOME ?? "~")),
                      )
                      .filter((directory) => !Orchestra.contains(mainSession.directory, directory)),
                  ),
                ]
                if (external.length === 0) return
                // Explicit confirmation bypasses the Orchestra team's unattended external-directory
                // auto-allow hook. A saved operator grant for these exact resources can still apply.
                yield* permission.confirm({
                  action: "external_directory",
                  resources: external,
                  save: [],
                  metadata: input,
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, id: context.id },
                })
              })

            switch (input.action) {
              case "list": {
                const projects = yield* orchestra.projects()
                const templates = yield* orchestra.templates()
                const roles = yield* orchestra.roles()
                const groups = yield* federation.groups()
                return {
                  output: [
                    "Projects:",
                    ...(projects.length ? projects.map(projectLine) : ["(none)"]),
                    "",
                    "AI team templates (use exact ID as team):",
                    ...(templates.length
                      ? templates.map((template) =>
                          `- ${template.id}: ${template.name} — ${template.description}; roles: ${template.members.map((member) => roles.find((role) => role.agent === member.agent)?.id ?? member.agent).join(", ") || "none"}`,
                        )
                      : ["(none)"]),
                    "",
                    "Individual AI role IDs (pass role to create one worker session; pass team for a whole template):",
                    ...roles.map((role) => `- ${role.id}: ${role.name} — ${role.description}`),
                    "",
                    "Federated groups:",
                    ...(groups.length
                      ? groups.map((group) => `- ${group.name}: projects ${group.projects.join(", ")}; coordinator ${group.projects[0] ?? "(none)"}; supervisor ${group.supervisor ?? "(none)"}`)
                      : ["(none)"]),
                    "",
                    "Sandbox: none, environment (default), strict. The selected directory must already exist; sandbox modes need a git repo; strict also needs bwrap.",
                  ].join("\n"),
                }
              }

              case "create_session": {
                const directory = input.directory?.trim()
                if (!directory) return yield* new ToolFailure({ message: "create_session requires directory: an existing path. Call list for team IDs first." })
                const team = input.team?.trim()
                const roleID = input.role?.trim()
                if (team && roleID)
                  return yield* new ToolFailure({ message: "Choose either team (a full AI team template) or role (one AI agent), not both." })
                const templates = yield* orchestra.templates()
                if (team && !templates.some((template) => template.id === team))
                  return yield* new ToolFailure({ message: 'Unknown team template ID "' + team + '". Call list and use an exact ID.' })
                const roles = yield* orchestra.roles()
                const selectedRole = roleID ? roles.find((role) => role.id === roleID) : undefined
                if (roleID && !selectedRole)
                  return yield* new ToolFailure({ message: 'Unknown AI role ID "' + roleID + '". Call list and use an exact role ID.' })
                yield* assertExternalDirectories([directory])
                const sandbox = sandboxChoice(input.sandbox)
                const created = yield* orchestra.create({
                  name: input.name?.trim() ?? "",
                  directory,
                  ...(team ? { template: team } : {}),
                  ...sandboxArgs(sandbox),
                }).pipe(
                  Effect.mapError((error) => new ToolFailure({
                    message: 'Could not create workspace/session at "' + directory + '" using sandbox "' + sandbox + '": ' + String(error) + ". Check the path, repository and sandbox dependencies; retry with corrected arguments.",
                    error,
                  })),
                )
                const selectedTeam = team ? templates.find((template) => template.id === team) : undefined
                let workerSessionID: string | undefined
                if (selectedRole) {
                  const worker = yield* orchestra.createMember({
                    project: created,
                    agent: selectedRole.agent,
                    title: selectedRole.name,
                    category: selectedRole.category,
                  }).pipe(
                    Effect.mapError((error) => new ToolFailure({
                      message: 'Workspace ' + created.name + ' (' + created.id + ') was created, but the individual ' + selectedRole.name + ' session could not be created: ' + error.message,
                      error,
                    })),
                  )
                  workerSessionID = worker.id
                }
                return {
                  output: [
                    'Created workspace ' + created.name + ' (' + created.id + ').',
                    'Main Orchestrator session: ' + (created.main ?? "not initialized"),
                    'Working directory: ' + created.directory,
                    'Sandbox: ' + (created.sandbox?.isolation ?? "none"),
                    'AI setup: ' + (selectedTeam
                      ? selectedTeam.name + ' (' + selectedTeam.id + '); ' + selectedTeam.members.length + ' role session(s)'
                      : selectedRole
                        ? selectedRole.name + ' (' + selectedRole.id + '); worker session ' + workerSessionID
                        : "Orchestrator only"),
                    "The main session can now delegate work to its team with the sessions tool.",
                  ].join("\n"),
                }
              }

              case "create_group": {
                const groupName = input.name?.trim()
                if (!groupName) return yield* new ToolFailure({ message: "create_group requires a non-empty name." })
                const inputMembers = input.members ?? []
                const memberCountError = groupMemberCountError(inputMembers)
                if (memberCountError) return yield* new ToolFailure({ message: memberCountError })
                const modeError = groupModeError(input.mode)
                if (modeError) return yield* new ToolFailure({ message: modeError })
                const mode = input.mode!
                if ((yield* federation.groups()).some((group) => group.name === groupName))
                  return yield* new ToolFailure({ message: `Group "${groupName}" already exists. Choose a different name; existing groups are not overwritten.` })

                const projects = yield* orchestra.projects()
                const templates = yield* orchestra.templates()
                const roles = yield* orchestra.roles()
                const usedIDs = new Set<string>()
                const specs: MemberSpec[] = []
                for (let index = 0; index < inputMembers.length; index++) {
                  const member = inputMembers[index]!
                  if (member.projectID?.trim()) {
                    if (member.name !== undefined || member.directory !== undefined || member.team !== undefined || member.role !== undefined || member.sandbox !== undefined)
                      return yield* new ToolFailure({ message: `Member ${index + 1}: when using projectID, provide no other fields.` })
                    const project = projects.find((item) => item.id === member.projectID)
                    if (!project) return yield* new ToolFailure({ message: `Member ${index + 1}: unknown project ID "${member.projectID}". Call list and use an exact ID.` })
                    if (usedIDs.has(project.id)) return yield* new ToolFailure({ message: `Project ${project.id} appears more than once in the group.` })
                    usedIDs.add(project.id)
                    specs.push({ kind: "existing", project })
                    continue
                  }
                  const directory = member.directory?.trim()
                  if (!directory) return yield* new ToolFailure({ message: `Member ${index + 1}: provide projectID or directory.` })
                  const team = member.team?.trim()
                  const roleID = member.role?.trim()
                  if (team && roleID)
                    return yield* new ToolFailure({ message: "Member " + (index + 1) + ": choose either team or role, not both." })
                  if (team && !templates.some((template) => template.id === team))
                    return yield* new ToolFailure({ message: 'Member ' + (index + 1) + ': unknown team template "' + team + '". Call list.' })
                  const role = roleID ? roles.find((item) => item.id === roleID) : undefined
                  if (roleID && !role)
                    return yield* new ToolFailure({ message: 'Member ' + (index + 1) + ': unknown AI role ID "' + roleID + '". Call list.' })
                  specs.push({
                    kind: "create",
                    name: member.name?.trim() ?? "",
                    directory,
                    ...(team ? { team } : {}),
                    ...(role ? { role } : {}),
                    sandbox: sandboxChoice(member.sandbox),
                  })
                }

                yield* assertExternalDirectories(
                  specs.flatMap((spec) => (spec.kind === "create" ? [spec.directory] : [])),
                )
                const shouldLink = input.link ?? true
                if (shouldLink)
                  yield* permission.assert({
                    action: "federation",
                    resources: [`link_group:${groupName}`],
                    save: [],
                    metadata: input,
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.messageID, id: context.id },
                  })

                const resolved: Orchestra.Project[] = []
                for (const spec of specs) {
                  if (spec.kind === "existing") {
                    resolved.push(spec.project)
                    continue
                  }
                  const project = yield* orchestra.create({
                    name: spec.name,
                    directory: spec.directory,
                    ...(spec.team ? { template: spec.team } : {}),
                    ...sandboxArgs(spec.sandbox),
                  }).pipe(
                    Effect.mapError((error) => new ToolFailure({
                      message: [
                        `Could not create a group member at "${spec.directory}": ${String(error)}.`,
                        "Member projects listed below have already been created; no group was registered.",
                        ...resolved.map(projectLine),
                      ].join("\n"),
                      error,
                    })),
                  )
                  resolved.push(project)
                  if (spec.role) {
                    const role = spec.role
                    yield* orchestra.createMember({
                      project,
                      agent: role.agent,
                      title: role.name,
                      category: role.category,
                    }).pipe(
                      Effect.mapError((error) => new ToolFailure({
                        message: "Group member workspace " + project.name + " (" + project.id + ") was created, but AI role " + role.name + " could not be started: " + error.message + ". No group was registered. Existing member projects:\n" + resolved.map(projectLine).join("\n"),
                        error,
                      })),
                    )
                  }
                }

                const unique = [...new Map(resolved.map((project) => [project.id, project])).values()]
                if (unique.length < 2) return yield* new ToolFailure({ message: "A federated group must contain at least two distinct projects." })
                const coordinator = unique[0]!
                const members = unique.map((project) => project.id)
                yield* federation
                  .setGroup({ name: groupName, projects: members, mode })
                  .pipe(
                    Effect.mapError((error) => new ToolFailure({
                      message: `Projects exist, but group registration failed: ${String(error)}.\n${unique.map(projectLine).join("\n")}`,
                      error,
                    })),
                  )

                let linkSummary = "Not linked. The operator can later approve federation action link_group."
                if (shouldLink) {
                  const count = yield* federation.linkGroup(groupName).pipe(
                    Effect.mapError((error) => new ToolFailure({
                      message: `Group "${groupName}" was registered, but linking failed: ${String(error)}. Retry federation action link_group after checking group status.`,
                      error,
                    })),
                  )
                  linkSummary = `Linked ${count} project pair(s) after operator approval.`
                }

                // The group owns exactly one chat, in its own directory. It is created here so a
                // forged group is usable immediately and never gets a President/Society session
                // inside a member project.
                const chatTitle = mode === "council" ? "Общество" : "Президент"
                const chat = yield* federation.ensureGroupChat({ name: groupName, projects: members, mode }).pipe(
                  Effect.mapError((error) => new ToolFailure({
                    message: `Group "${groupName}" was registered, but its ${chatTitle} chat could not be created: ${String(error)}. The projects and the group are saved; retry federation action=group_chat name="${groupName}".`,
                    error,
                  })),
                )

                return {
                  output: [
                    `Created federated group "${groupName}" in ${mode} mode.`,
                    `Coordinator: ${coordinator.name} (${coordinator.id}); main session ${coordinator.main ?? "not initialized"}.`,
                    ...unique.map((project, index) => `${index + 1}. ${projectLine(project)}`),
                    `Group chat: ${chatTitle} (session ${chat.sessionID}) in ${chat.directory}.`,
                    linkSummary,
                    "The chat waits for the operator: it does not dispatch work to member projects on its own.",
                  ].join("\n"),
                }
              }
            }
            }).pipe(
              Effect.map((result) => ({ output: result, content: result.output })),
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `workspace_forge failed: ${String(error)}`, error }),
              ),
            ),
      }),
    ).pipe(Effect.orDie)
  }),
}
