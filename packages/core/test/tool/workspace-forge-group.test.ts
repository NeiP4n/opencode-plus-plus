import path from "node:path"
import { mkdir } from "node:fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Agent } from "@opencode/core/agent"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Orchestra } from "@opencode/core/orchestra"
import { Federation } from "@opencode/core/federation"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { Permission } from "@opencode/core/permission"
import { Tool } from "@opencode/core/tool"
import { WorkspaceForgeTool } from "@opencode/core/tool/plugin/workspace-forge"
import { AbsolutePath } from "@opencode/core/schema"
import { tmpdir } from "../fixture/tmpdir"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "../lib/tool"
import { permissionLayer } from "../lib/permission"

// Group creation never runs a session, so every execution stays idle.
const idleExecution = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.succeed(
    SessionExecution.Service,
    SessionExecution.Service.of({
      active: Effect.succeed(new Set()),
      isActive: () => Effect.succeed(false),
      resume: () => Effect.void,
      wake: () => Effect.void,
      interrupt: () => Effect.succeed(false),
      awaitIdle: () => Effect.void,
    }),
  ),
  deps: [],
})

const pluginNode = makeLocationNode({
  name: "test/workspace-forge-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(WorkspaceForgeTool.Plugin)),
  deps: [Tool.node, Orchestra.node, Federation.node, Permission.node, Database.node],
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Job.node,
      Session.node,
      KV.node,
      SessionExecution.node,
      LocationServiceMap.node,
      Orchestra.node,
      Federation.node,
      Agent.node,
      Tool.node,
      pluginNode,
    ]),
    [
      SessionExecution.node.replace(idleExecution),
      Global.node.replace(tempGlobalLayer),
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") }))),
      ),
      Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
      offlineModels,
    ],
  ),
)

const setup = Effect.gen(function* () {
  const orchestra = yield* Orchestra.Service
  const root = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-workspace-forge-")))
  const main = yield* orchestra.create({ name: "Command", directory: root.path })
  const member = (name: string) => path.join(root.path, name)
  yield* Effect.promise(() => mkdir(member("research"), { recursive: true }))
  yield* Effect.promise(() => mkdir(member("build"), { recursive: true }))
  return { root, main, member }
})

const run = (tools: Tool.Interface, sessionID: Session.ID, id: string, input: Record<string, unknown>) =>
  executeTool(tools, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call" as const, id, name: WorkspaceForgeTool.name, input },
  })

const text = (result: { readonly content?: ReadonlyArray<Tool.Content>; readonly error?: unknown }) => {
  const output = (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
  if (!output) throw new Error(`workspace_forge tool failed: ${JSON.stringify(result.error)}`)
  return output
}

describe("WorkspaceForgeTool group creation", () => {
  it.live("creates each member project and exactly one President chat for a lead group", () =>
    Effect.gen(function* () {
      const { main, member } = yield* setup
      const tools = yield* Tool.Service
      const federation = yield* Federation.Service
      const sessions = yield* Session.Service
      const orchestra = yield* Orchestra.Service
      const roles = yield* orchestra.roles()
      const team = yield* orchestra.saveTemplate(undefined, {
        name: "Forge Test Team",
        description: "Two roles for a forge test",
        members: roles.slice(0, 2).map((role) => ({ agent: role.agent, title: role.name, category: role.category })),
      })

      const created = text(
        yield* run(tools, main.main!, "lead", {
          action: "create_group",
          name: "Self-Improvement",
          mode: "lead",
          link: false,
          members: [
            { name: "Research", directory: member("research"), team: team.id, sandbox: "none" },
            { name: "Build", directory: member("build"), sandbox: "none" },
          ],
        }),
      )
      expect(created).toContain("Self-Improvement")
      expect(created).toContain("Президент")

      const group = (yield* federation.groups()).find((item) => item.name === "Self-Improvement")
      expect(group?.mode).toBe("lead")
      expect(group?.projects).toHaveLength(2)
      expect(group?.supervisor).toBeDefined()
      const chat = yield* sessions.get(group!.supervisor!)
      expect(chat.agent).toBe(Orchestra.president)
      expect(chat.title).toBe("Президент")
      expect(path.basename(path.dirname(String(chat.location.directory)))).toBe("group")

      // The member with a team gets exactly one session per template role, inside its own project.
      const members = yield* orchestra.projects()
      const research = members.find(
        (project) => group!.projects.includes(project.id) && project.directory === path.resolve(member("research")),
      )!
      const workers = yield* orchestra.sessions(research.id)
      expect(workers).toHaveLength(team.members.length)
      expect(workers.map((item) => item.title).sort()).toEqual(team.members.map((item) => item.title).sort())

      // No role sessions were invented in the caller's project, and the chat stays out of both projects.
      const own = yield* orchestra.sessions(main.id)
      expect(own).toHaveLength(0)
      const ids = [...workers.map((item) => item.id), group!.supervisor]
      const build = members.find((project) => project.id === group!.projects[1])!
      expect(ids).not.toContain(build.main)
      expect(ids).not.toContain(research.main)
    }),
  )

  it.live("creates Общество for a council group and refuses a group without a mode", () =>
    Effect.gen(function* () {
      const { main, member } = yield* setup
      const tools = yield* Tool.Service
      const federation = yield* Federation.Service
      const sessions = yield* Session.Service

      const refused = yield* run(tools, main.main!, "no-mode", {
        action: "create_group",
        name: "No Mode",
        link: false,
        members: [
          { directory: member("research"), sandbox: "none" },
          { directory: member("build"), sandbox: "none" },
        ],
      })
      expect(refused.error).toBeDefined()
      expect((yield* federation.groups()).find((item) => item.name === "No Mode")).toBeUndefined()

      const created = text(
        yield* run(tools, main.main!, "council", {
          action: "create_group",
          name: "Council",
          mode: "council",
          link: false,
          members: [
            { directory: member("research"), sandbox: "none" },
            { directory: member("build"), sandbox: "none" },
          ],
        }),
      )
      expect(created).toContain("Общество")

      const group = (yield* federation.groups()).find((item) => item.name === "Council")
      expect(group?.mode).toBe("council")
      const chat = yield* sessions.get(group!.supervisor!)
      expect(chat.agent).toBe(Orchestra.agent)
      expect(chat.title).toBe("Общество")
    }),
  )
})
