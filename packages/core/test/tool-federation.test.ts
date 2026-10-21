import path from "node:path"
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
import { FederationTool } from "@opencode/core/tool/plugin/federation"
import { AbsolutePath } from "@opencode/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"
import { permissionLayer } from "./lib/permission"

// Group configuration never runs a session, so every execution stays idle.
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
  name: "test/federation-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(FederationTool.Plugin)),
  deps: [Tool.node, Federation.node, Orchestra.node, Session.node, Permission.node, Database.node],
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
  const dirs = yield* Effect.all([
    Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-federation-tool-a-"))),
    Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-federation-tool-b-"))),
    Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-federation-tool-c-"))),
  ])
  const a = yield* orchestra.create({ name: "Frontend", directory: dirs[0].path })
  const b = yield* orchestra.create({ name: "Backend", directory: dirs[1].path })
  const c = yield* orchestra.create({ name: "Mobile", directory: dirs[2].path })
  return { a, b, c }
})

const run = (tools: Tool.Interface, sessionID: Session.ID, id: string, input: Record<string, unknown>) =>
  executeTool(tools, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call" as const, id, name: FederationTool.name, input },
  })

const text = (result: { readonly content?: ReadonlyArray<Tool.Content>; readonly error?: unknown }) => {
  const output = (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
  if (!output) throw new Error(`federation tool failed: ${JSON.stringify(result.error)}`)
  return output
}

describe("FederationTool group configuration", () => {
  it.live("lists projects with their Orchestrator and creates a President chat in the group's own directory", () =>
    Effect.gen(function* () {
      const { a, b } = yield* setup
      const tools = yield* Tool.Service

      const listed = text(yield* run(tools, a.main!, "projects", { action: "projects" }))
      expect(listed).toContain(a.id)
      expect(listed).toContain(b.id)
      expect(listed).toContain(`orchestrator session ${a.main}`)

      const created = text(
        yield* run(tools, a.main!, "create", {
          action: "group_create",
          name: "Shop",
          projects: [a.id, b.id],
          mode: "lead",
        }),
      )
      expect(created).toContain("Group Shop saved in lead mode")
      expect(created).toContain("group_chat")

      const chat = text(yield* run(tools, a.main!, "chat", { action: "group_chat", name: "Shop" }))
      expect(chat).toContain("Президент")

      // Re-running the same request keeps the existing group and its chat.
      const again = text(
        yield* run(tools, a.main!, "again", {
          action: "group_create",
          name: "Shop",
          projects: [a.id, b.id],
          mode: "lead",
        }),
      )
      expect(again).toContain("already exists")

      const federation = yield* Federation.Service
      const group = (yield* federation.groups()).find((item) => item.name === "Shop")
      expect(group?.supervisor).toBeDefined()
      const session = yield* (yield* Session.Service).get(group!.supervisor!)
      expect(session.agent).toBe(Orchestra.president)
      expect(path.basename(path.dirname(String(session.location.directory)))).toBe("group")
    }),
  )

  it.live("refuses federation outside an Orchestrator without sending the model hunting for tools", () =>
    Effect.gen(function* () {
      const { a } = yield* setup
      const tools = yield* Tool.Service
      const sessions = yield* Session.Service
      const plain = yield* sessions.create({
        title: "Plain session",
        agent: Agent.ID.make("build"),
        location: { directory: AbsolutePath.make(a.directory) },
      })

      const refused = yield* run(tools, plain.id, "plain", { action: "groups" })
      const reason = JSON.stringify(refused.error)
      expect(reason).toContain("not a project's main Orchestrator")
      expect(reason).toContain("Do not search the filesystem")
    }),
  )

  it.live("edits project membership without rebinding the chat and creates Общество for council mode", () =>
    Effect.gen(function* () {
      const { a, b, c } = yield* setup
      const tools = yield* Tool.Service
      const federation = yield* Federation.Service
      const sessions = yield* Session.Service

      yield* run(tools, a.main!, "create", {
        action: "group_create",
        name: "Shop",
        projects: [a.id, b.id],
        mode: "lead",
      })
      yield* run(tools, a.main!, "chat", { action: "group_chat", name: "Shop" })
      const president = (yield* federation.groups()).find((item) => item.name === "Shop")!.supervisor

      yield* run(tools, a.main!, "add", { action: "group_add", name: "Shop", projects: [c.id] })
      const added = (yield* federation.groups()).find((item) => item.name === "Shop")!
      expect(added.projects).toEqual([a.id, b.id, c.id])
      expect(added.supervisor).toBe(president)

      yield* run(tools, a.main!, "remove", { action: "group_remove", name: "Shop", projects: [c.id] })
      const removed = (yield* federation.groups()).find((item) => item.name === "Shop")!
      expect(removed.projects).toEqual([a.id, b.id])
      expect(removed.supervisor).toBe(president)

      const edited = text(yield* run(tools, a.main!, "edit", { action: "group_edit", name: "Shop", mode: "council" }))
      expect(edited).toContain("Общество")
      const council = (yield* federation.groups()).find((item) => item.name === "Shop")!
      expect(council.mode).toBe("council")
      expect(council.supervisor).toBeUndefined()

      const societyChat = text(yield* run(tools, a.main!, "society", { action: "group_chat", name: "Shop" }))
      expect(societyChat).toContain("Общество")
      const society = (yield* federation.groups()).find((item) => item.name === "Shop")!
      expect(society.supervisor).toBeDefined()
      expect(society.supervisor).not.toBe(president)
      const session = yield* sessions.get(society.supervisor!)
      expect(session.agent).toBe(Orchestra.agent)
      expect(session.title).toBe("Общество")

      yield* run(tools, a.main!, "delete", { action: "group_delete", name: "Shop" })
      expect((yield* federation.groups()).find((item) => item.name === "Shop")).toBeUndefined()
    }),
  )
})
