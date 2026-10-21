import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer, Schedule, Schema, Scope, Stream } from "effect"
import { Mode } from "@opencode/schema/mode"
import { Money } from "@opencode/schema/money"
import { Event } from "@opencode/schema/event"
import { Form } from "@opencode/schema/form"
import { Tool } from "@opencode/schema/tool"
import { OrchestraTool } from "@opencode/core/tool/plugin/orchestra"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Agent } from "@opencode/core/agent"
import { Job } from "@opencode/core/job"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Orchestra } from "@opencode/core/orchestra"
import { Federation } from "@opencode/core/federation"
import { Dod } from "@opencode/core/dod"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionStore } from "@opencode/core/session/store"
import { KV } from "@opencode/core/kv"
import { Form as FormService } from "@opencode/core/form"
import { tmpdir } from "./fixture/tmpdir"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { TeamPlugin } from "@opencode/core/plugin/team"
import { SandboxPlugin } from "@opencode/core/plugin/sandbox"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import { agentHost, host } from "./plugin/host"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import type { SessionContext } from "@opencode/plugin/effect/session"

const model = Model.Ref.make({ id: Model.ID.make("member"), providerID: Provider.ID.make("test") })
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
// Test-only control for a worker run that finishes before its queued team task is promoted.
const deferTaskDelivery = new Set<Session.ID>()
// Simulates losing a terminal event while the worker answer remains durable.
const suppressTerminalEvent = new Set<Session.ID>()
// Adds a tool-heavy assistant turn to exercise report extraction beyond one message page.
const longTurnMessages = new Map<Session.ID, number>()
const deliverRegularInput = new Set<Session.ID>()

// Stands in for the runner: a woken team session answers with its title and ends
// its run the way the title asks ("fails", "stops at shutdown" or succeeds).
const executionNode = makeGlobalNode({
  service: SessionExecution.Service,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const store = yield* SessionStore.Service
      const inbox = yield* SessionInbox.Service
      const run = Effect.fn("OrchestraTeamTest.run")(function* (sessionID: Session.ID) {
        const session = yield* store.get(sessionID)
        if (!session) return
        const pending = yield* inbox.list(sessionID)
        const move = pending.find((item) => item.type === "move")
        if (move) {
          yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: move.id })
          yield* bus.publish(SessionEvent.Moved, { sessionID, ...move.payload })
          return
        }
        if (session.agent === Orchestra.agent) return
        const task = pending.find((item) => item.type === "user" && item.payload.metadata?.orchestra !== undefined)
        let taskDelivered = false
        if (task && !deferTaskDelivery.has(sessionID)) {
          yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: task.id })
          taskDelivered = true
        } else if (deliverRegularInput.has(sessionID)) {
          const item = pending.find((entry) => entry.type === "user")
          if (item) yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: item.id })
        }
        const assistantMessageID = SessionMessage.ID.create()
        yield* bus.publish(SessionEvent.Step.Started, {
          sessionID,
          assistantMessageID,
          agent: session.agent ?? Agent.ID.make("build"),
          model,
          started: 0,
        })
        yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID, ordinal: 0 })
        yield* bus.publish(SessionEvent.Text.Ended, {
          sessionID,
          assistantMessageID,
          ordinal: 0,
          text: `${session.title}: ${taskDelivered ? "task answer" : "unrelated answer"}`,
        })
        yield* bus.publish(SessionEvent.Step.Ended, {
          sessionID,
          assistantMessageID,
          finish: "stop",
          cost: Money.USD.zero,
          tokens,
        })
        const extraMessages = longTurnMessages.get(sessionID) ?? 0
        for (let index = 0; index < extraMessages; index++) {
          const extraID = SessionMessage.ID.create()
          yield* bus.publish(SessionEvent.Step.Started, {
            sessionID,
            assistantMessageID: extraID,
            agent: session.agent ?? Agent.ID.make("build"),
            model,
            started: index + 1,
          })
          yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID: extraID, ordinal: 0 })
          yield* bus.publish(SessionEvent.Text.Ended, {
            sessionID,
            assistantMessageID: extraID,
            ordinal: 0,
            text:
              index === extraMessages - 1
                ? `${session.title}: final long-turn answer`
                : `${session.title}: intermediate continuation ${index + 1}`,
          })
          yield* bus.publish(SessionEvent.Step.Ended, {
            sessionID,
            assistantMessageID: extraID,
            finish: "stop",
            cost: Money.USD.zero,
            tokens,
          })
        }
        if (suppressTerminalEvent.has(sessionID)) return
        if (session.title?.includes("fails"))
          return yield* bus.publish(SessionEvent.Execution.Failed, {
            sessionID,
            error: { type: "provider.transport", message: "Disconnected" },
          })
        if (session.title?.includes("shutdown"))
          return yield* bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason: "shutdown" })
        yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
      })
      return SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        isActive: () => Effect.succeed(false),
        resume: run,
        wake: (sessionID) => run(sessionID).pipe(Effect.ignore),
        interrupt: () => Effect.succeed(false),
        awaitIdle: () => Effect.void,
      })
    }),
  ),
  deps: [Bus.node, SessionStore.node, SessionInbox.node],
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Job.node,
      Session.node,
      SessionStore.node,
      KV.node,
      SessionInbox.node,
      SessionExecution.node,
      LocationServiceMap.node,
      Orchestra.node,
      Federation.node,
      Agent.node,
      FormService.node,
    ]),
    [
      // Keep durable event rows in this suite so recovery can prove whether the
      // terminal event committed even when the live subscriber never saw it.
      Bus.node.replace(Bus.configured({ persist: true })),
      SessionExecution.node.replace(executionNode),
      Global.node.replace(tempGlobalLayer),
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") }))),
      ),
      offlineModels,
    ],
  ),
)

// Reports are admitted to the orchestrator's inbox; the stub runner never delivers them.
const reports = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const inbox = yield* sessions.inbox(sessionID)
    return inbox.flatMap((item) =>
      item.type === "synthetic" && item.payload.text.startsWith("<team-report") ? [item.payload.text] : [],
    )
  })

describe("Orchestra sandbox project", () => {
  it.live("works in a new worktree of the repository and leaves the source checkout untouched", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-sandbox-")))
      yield* Effect.promise(async () => {
        await Bun.write(path.join(tmp.path, "README.md"), "source\n")
        await Bun.$`git init -q && git add . && git -c user.name=t -c user.email=t@t commit -qm init`.cwd(tmp.path)
      })
      const orchestra = yield* Orchestra.Service
      const project = yield* orchestra.create({ name: "Sandbox", directory: tmp.path, isolation: "environment" })

      expect(project.sandbox).toMatchObject({ source: tmp.path, isolation: "environment" })
      expect(project.directory).toBe(path.join(project.sandbox!.home, "repo"))
      // Git may check the file out with CRLF on Windows (core.autocrlf).
      const readme = yield* Effect.promise(() => Bun.file(path.join(project.directory, "README.md")).text())
      expect(readme.replaceAll("\r\n", "\n")).toBe("source\n")
      expect(yield* Effect.promise(() => Bun.file(path.join(project.directory, Dod.FILE)).exists())).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, Dod.FILE)).exists())).toBe(false)
      expect((yield* orchestra.projects()).find((item) => item.id === project.id)?.sandbox).toEqual(project.sandbox)
    }),
  )

  it.live("confines shell commands inside the sandbox and leaves other directories alone", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-sandbox-shell-")))
      yield* Effect.promise(() =>
        Bun.$`git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init`.cwd(tmp.path),
      )
      const orchestra = yield* Orchestra.Service
      const project = yield* orchestra.create({ name: "Shell", directory: tmp.path, isolation: "environment" })
      const hooks: Array<(event: ShellCreateBefore) => Effect.Effect<void>> = []
      yield* SandboxPlugin.Plugin.effect(
        host({
          shell: {
            hook: (_, callback) => Effect.sync(() => hooks.push(callback)).pipe(Effect.as({ dispose: Effect.void })),
          },
        }),
      )
      const run = (cwd: string) =>
        Effect.gen(function* () {
          const event: ShellCreateBefore = {
            command: "opencode",
            cwd,
            timeout: 0,
            shell: "sh",
            env: { HOME: "/home/user", OPENCODE_SERVER_PASSWORD: "secret" },
          }
          for (const hook of hooks) yield* hook(event)
          return event
        })

      const inside = yield* run(path.join(project.directory, "packages"))
      expect(inside.env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
      expect(inside.env.XDG_STATE_HOME).toBe(path.join(project.sandbox!.home, "state"))
      expect(inside.command).toBe("opencode")
      const source = yield* run(tmp.path)
      expect(source.env).toEqual({ HOME: "/home/user", OPENCODE_SERVER_PASSWORD: "secret" })
    }),
  )

  it.live("rejects a directory that is not a git repository", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-sandbox-plain-")))
      const orchestra = yield* Orchestra.Service
      const error = yield* orchestra
        .create({ name: "Plain", directory: tmp.path, isolation: "environment" })
        .pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "Orchestra.SandboxError", reason: "repository" })
      expect(yield* orchestra.projects()).toEqual([])
    }),
  )
})

describe("Orchestra team", () => {
  it.live("creates the project DoD and main orchestrator even when no team is selected", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-project-")))
      const orchestra = yield* Orchestra.Service
      const project = yield* orchestra.create({ name: "No team", directory: tmp.path })

      const dodPath = path.join(tmp.path, Dod.FILE)
      expect(yield* Effect.promise(() => Bun.file(dodPath).exists())).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(dodPath).text())).toContain("task_id: PROJECT-BOARD")
      expect(yield* Dod.read(tmp.path)).toMatchObject({ status: "ready", items: [] })
      expect(project.main).toBeDefined()
      const main = yield* orchestra.main(project.id)
      expect(main.id).toBe(project.main!)
      expect(main.title).toBe("No team · Orchestrator")
      expect(main.agent).toBe(Orchestra.agent)
      expect(yield* orchestra.mainOf(main.id)).toMatchObject({ id: project.id })
    }),
  )

  it.live("gives the orchestrator the playbook of the team the project was opened with", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-playbook-")))
      const orchestra = yield* Orchestra.Service
      const mobile = yield* orchestra.create({ name: "Phone", directory: tmp.path, template: "mobile-app" })
      const plain = yield* orchestra.create({ name: "Plain", directory: tmp.path })

      const playbook = yield* orchestra.playbook(mobile.id)
      expect(playbook?.name).toBe("Mobile app")
      expect(playbook?.text).toContain("mobile-developer")
      expect(yield* orchestra.playbook(plain.id)).toBeUndefined()

      // An edited template's own playbook replaces the built-in one for projects opened from it.
      const template = (yield* orchestra.templates()).find((item) => item.id === "mobile-app")!
      yield* orchestra.saveTemplate("mobile-app", { ...template, playbook: "Ship the Flutter app only." })
      expect((yield* orchestra.playbook(mobile.id))?.text).toBe("Ship the Flutter app only.")

      yield* orchestra.remove(mobile.id)
      expect(yield* orchestra.playbook(mobile.id)).toBeUndefined()
    }),
  )

  it.live("reattaches a durable orphaned orchestrator instead of creating a duplicate", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-orphan-main-")))
      const orchestra = yield* Orchestra.Service
      const kv = yield* KV.Service
      const project = yield* orchestra.create({ name: "Orphan", directory: tmp.path })
      const originalID = project.main!

      // Simulate the old crash window: Session was stored, but Project.main was not.
      yield* kv.set(
        `orchestra/project/${project.id}`,
        Schema.encodeSync(Orchestra.Project)({
          id: project.id,
          name: project.name,
          directory: project.directory,
          created: project.created,
        }),
      )
      const main = yield* orchestra.main(project.id)
      expect(main.id).toBe(originalID)
      expect((yield* orchestra.projects()).find((item) => item.id === project.id)?.main).toBe(originalID)
      expect(yield* orchestra.mainOf(originalID)).toMatchObject({ id: project.id })
    }).pipe(Effect.scoped),
  )

  it.live("reuses the reserved main ID after interrupted initialization", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-main-reservation-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const kv = yield* KV.Service
      const project = yield* orchestra.create({ name: "Reservation", directory: tmp.path })
      yield* sessions.remove(project.main!)
      yield* kv.set(
        `orchestra/project/${project.id}`,
        Schema.encodeSync(Orchestra.Project)({
          id: project.id,
          name: project.name,
          directory: project.directory,
          created: project.created,
        }),
      )
      const reservedID = Session.ID.create()
      yield* kv.set(`orchestra/main-initializing/${project.id}`, reservedID)

      const main = yield* orchestra.main(project.id)
      expect(main.id).toBe(reservedID)
      expect(main.title).toBe("Reservation · Orchestrator")
      expect((yield* orchestra.projects()).find((item) => item.id === project.id)?.main).toBe(reservedID)
    }).pipe(Effect.scoped),
  )

  it.live("concurrent main repair creates one orchestrator for a legacy project", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-concurrent-main-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const kv = yield* KV.Service
      const project = yield* orchestra.create({ name: "Concurrent", directory: tmp.path })

      // Simulate an older project record whose main session was removed.
      yield* kv.set(
        `orchestra/project/${project.id}`,
        Schema.encodeSync(Orchestra.Project)({
          id: project.id,
          name: project.name,
          directory: project.directory,
          created: project.created,
        }),
      )
      yield* sessions.remove(project.main!)

      const repaired = yield* Effect.all(
        Array.from({ length: 8 }, () => orchestra.main(project.id)),
        { concurrency: "unbounded" },
      )
      expect(new Set(repaired.map((session) => session.id)).size).toBe(1)
      expect(repaired.every((session) => session.agent === Orchestra.agent)).toBe(true)
      expect((yield* orchestra.projects()).find((item) => item.id === project.id)?.main).toBe(repaired[0].id)
      expect(yield* orchestra.mainOf(repaired[0].id)).toMatchObject({ id: project.id })
    }).pipe(Effect.scoped),
  )

  it.live("serializes project deletion with team creation so no workers remain claimed to a removed project", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-create-delete-")))
      const orchestra = yield* Orchestra.Service
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const creating = yield* orchestra
        .create({ name: "Create race", directory: tmp.path, template: "feature" })
        .pipe(Effect.forkIn(scope, { startImmediately: true }))

      // A project becomes visible before its main Session finishes initialization. Remove it at
      // that boundary, which used to let template workers be created after their owner was gone.
      const project = yield* orchestra.projects().pipe(
        Effect.map((items) => items.find((item) => item.name === "Create race" && item.main !== undefined)),
        Effect.filterOrFail((item): item is Orchestra.Project => item !== undefined),
        Effect.retry(Schedule.spaced("1 millis")),
        Effect.timeout("2 seconds"),
      )
      yield* orchestra.remove(project.id)
      // Creation can either finish before removal acquires the lock, or observe that removal won.
      // In both cases, the owner record must not survive under a project that no longer exists.
      yield* Fiber.join(creating).pipe(Effect.ignore)

      expect((yield* orchestra.projects()).some((item) => item.id === project.id)).toBe(false)
      expect(Object.values(yield* orchestra.owners())).not.toContain(project.id)
    }).pipe(Effect.scoped),
  ),

  it.live("serializes owner claims with project deletion so no session stays claimed by a removed project", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-owner-claim-race-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Owner claim race", directory: tmp.path })
      const worker = yield* sessions.create({
        location: { directory: AbsolutePath.make(tmp.path) },
        title: "Claim candidate",
      })

      // The claim either commits before removal and gets cleaned up, or removal wins and
      // the claim sees ProjectNotFoundError. Neither schedule may leave a dangling owner key.
      yield* Effect.all(
        {
          claim: orchestra.claim(worker.id, project.id).pipe(Effect.orElseSucceed(() => undefined)),
          remove: orchestra.remove(project.id).pipe(Effect.orElseSucceed(() => undefined)),
        },
        { concurrency: "unbounded" },
      )

      expect((yield* orchestra.projects()).some((item) => item.id === project.id)).toBe(false)
      expect(yield* orchestra.owners()).not.toHaveProperty(worker.id)
    }).pipe(Effect.scoped),
  ),

  it.live("forgetting a project releases its task reservation and cancels only its queued input", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-forget-tasks-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Forgotten tasks", directory: tmp.path, template: "bugfix" })
      const other = yield* orchestra.create({ name: "Other project", directory: tmp.path, template: "bugfix" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      const otherWorker = (yield* orchestra.sessions(other.id)).find((session) => session.title === "Developer")!

      // Keep both prompts queued so the test exercises cancellation before worker delivery.
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          deferTaskDelivery.add(worker.id)
          deferTaskDelivery.add(otherWorker.id)
        }),
        () =>
          Effect.sync(() => {
            deferTaskDelivery.delete(worker.id)
            deferTaskDelivery.delete(otherWorker.id)
          }),
      )
      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Finish the forgotten project task" })
      yield* orchestra.dispatch({ project: other, sessionID: otherWorker.id, text: "Finish the other project task" })
      yield* Effect.sleep("50 millis")
      expect(yield* orchestra.pending(worker.id)).toBeNumber()
      expect(yield* orchestra.pending(otherWorker.id)).toBeNumber()
      expect((yield* sessions.inbox(worker.id)).some((item) => item.type === "user")).toBe(true)
      expect((yield* sessions.inbox(otherWorker.id)).some((item) => item.type === "user")).toBe(true)

      yield* orchestra.remove(project.id)

      // Forgetting coordination records does not delete the session or its persisted history.
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
      expect(yield* sessions.get(worker.id)).toMatchObject({ id: worker.id })
      expect(yield* sessions.get(project.main!)).toMatchObject({ id: project.main })
      expect(yield* orchestra.owners()).not.toHaveProperty(worker.id)
      expect((yield* sessions.inbox(worker.id)).some((item) => item.type === "user")).toBe(false)

      // Reservations and queued work belonging to a different project survive.
      expect(yield* orchestra.pending(otherWorker.id)).toBeNumber()
      expect(yield* sessions.get(other.main!)).toMatchObject({ id: other.main })
      expect((yield* sessions.inbox(otherWorker.id)).some((item) => item.type === "user")).toBe(true)
      expect((yield* orchestra.projects()).map((item) => item.id)).toContain(other.id)
      expect((yield* orchestra.projects()).map((item) => item.id)).not.toContain(project.id)
    }).pipe(Effect.scoped),
  ),

  it.live("does not resolve a removed project's main session as a live orchestrator", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-forgotten-main-")))
      const orchestra = yield* Orchestra.Service
      const project = yield* orchestra.create({ name: "Forgotten", directory: tmp.path })
      const mainID = project.main!
      expect(yield* orchestra.mainOf(mainID)).toMatchObject({ id: project.id })

      yield* orchestra.remove(project.id)

      expect(yield* orchestra.mainOf(mainID)).toBeUndefined()
      expect((yield* orchestra.projects()).some((item) => item.id === project.id)).toBe(false)
    }).pipe(Effect.scoped),
  ),

  it.live("serializes project deletion with main recovery so a removed project cannot reappear", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-delete-race-")))
      const orchestra = yield* Orchestra.Service
      const project = yield* orchestra.create({ name: "Delete race", directory: tmp.path })

      const result = yield* Effect.all(
        {
          removed: orchestra.remove(project.id),
          main: orchestra.main(project.id).pipe(Effect.orElseSucceed(() => undefined)),
        },
        { concurrency: "unbounded" },
      )
      if (result.main) expect(result.main.id === project.main).toBe(true)
      expect((yield* orchestra.projects()).some((item) => item.id === project.id)).toBe(false)
    }).pipe(Effect.scoped),
  )

  it.live("moves the main orchestrator and owned sessions with the project directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-move-")))
      const source = path.join(tmp.path, "source")
      const sourceNested = path.join(source, "src")
      const destination = path.join(tmp.path, "destination")
      const destinationNested = path.join(destination, "src")
      yield* Effect.promise(() =>
        Promise.all([
          mkdir(sourceNested, { recursive: true }),
          mkdir(destinationNested, { recursive: true }),
        ]),
      )
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Move", directory: source, template: "bugfix" })
      const nested = yield* sessions.create({
        location: { directory: AbsolutePath.make(sourceNested) },
        title: "Nested worker",
        agent: Orchestra.role("developer"),
      })
      yield* orchestra.claim(nested.id, project.id)
      yield* orchestra.setAccess(nested.id, "full")
      const originalMembers = yield* orchestra.sessions(project.id)

      const updated = yield* orchestra.update(project.id, { name: "Moved", directory: destination })
      expect(updated).toMatchObject({ name: "Moved", directory: destination, main: project.main })
      expect((yield* sessions.get(project.main!)).location.directory).toBe(AbsolutePath.make(destination))
      expect((yield* sessions.get(project.main!)).title).toBe("Moved · Orchestrator")
      for (const member of originalMembers) {
        // Sessions already nested beneath the project keep their relative path after migration.
        const expectedDirectory = member.id === nested.id ? destinationNested : destination
        expect((yield* sessions.get(member.id)).location.directory).toBe(AbsolutePath.make(expectedDirectory))
      }
      expect((yield* sessions.get(nested.id)).location.directory).toBe(AbsolutePath.make(destinationNested))
      const currentMembers = yield* orchestra.sessions(project.id)
      // The nested worker may already be in originalMembers; compare the expected roster as a set.
      expect(currentMembers.map((session) => session.id).toSorted()).toEqual(
        [...new Set([...originalMembers.map((session) => session.id), nested.id])].toSorted(),
      )
    }).pipe(Effect.scoped),
  ),
  it.live("continues a partially completed move toward a newly requested destination", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-move-recovery-")))
      const source = path.join(tmp.path, "source")
      const sourceNested = path.join(source, "src")
      const firstDestination = path.join(tmp.path, "destination-a")
      const firstDestinationNested = path.join(firstDestination, "src")
      const destination = path.join(tmp.path, "destination-b")
      const destinationNested = path.join(destination, "src")
      yield* Effect.promise(() =>
        Promise.all([
          mkdir(sourceNested, { recursive: true }),
          mkdir(firstDestinationNested, { recursive: true }),
          mkdir(destinationNested, { recursive: true }),
        ]),
      )
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const kv = yield* KV.Service
      const project = yield* orchestra.create({ name: "Move recovery", directory: source, template: "bugfix" })
      const members = yield* orchestra.sessions(project.id)
      const nested = yield* sessions.create({
        location: { directory: AbsolutePath.make(sourceNested) },
        title: "Nested worker",
        agent: Orchestra.role("developer"),
      })
      yield* orchestra.claim(nested.id, project.id)
      yield* orchestra.setAccess(nested.id, "full")

      const moveKey = "orchestra/move-plan/" + project.id
      // Simulate a crash after one session moved, while the project record still points at source.
      // Management lookups must not block while the move waits for the active main session.
      yield* kv.set(moveKey, {
        from: source,
        to: firstDestination,
        members: [
          ...members.map((member) => ({ id: member.id, relative: "", targetRelative: "", main: false })),
          { id: nested.id, relative: "src", targetRelative: "src", main: false },
          { id: project.main!, relative: "", targetRelative: "", main: true },
        ],
      })
      expect(yield* orchestra.mainOf(project.main!)).toBeUndefined()
      expect(yield* orchestra.sessions(project.id)).toHaveLength(0)
      const alreadyMoved = members[0]
      yield* sessions.move({
        sessionID: alreadyMoved.id,
        directory: AbsolutePath.make(firstDestination),
        delivery: "queue",
      })
      yield* sessions.wait(alreadyMoved.id)
      expect((yield* sessions.get(alreadyMoved.id)).location.directory).toBe(AbsolutePath.make(firstDestination))

      // Redirect the interrupted migration. Every session, including the one already moved to A,
      // must follow the original plan to destination B.
      const updated = yield* orchestra.update(project.id, { directory: destination })
      expect(updated.directory).toBe(destination)
      for (const member of members) {
        expect((yield* sessions.get(member.id)).location.directory).toBe(AbsolutePath.make(destination))
      }
      expect((yield* sessions.get(nested.id)).location.directory).toBe(AbsolutePath.make(destinationNested))
      expect((yield* sessions.get(project.main!)).location.directory).toBe(AbsolutePath.make(destination))
      expect(yield* kv.get(moveKey)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),
  it.live("rebuilds a partially created team from its durable roster plan", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-roster-recovery-")))
      const orchestra = yield* Orchestra.Service
      const sessionService = yield* Session.Service
      const kv = yield* KV.Service
      const project = yield* orchestra.create({ name: "Roster recovery", directory: tmp.path })
      const existingID = Session.ID.create()
      const missingID = Session.ID.create()
      const location = { directory: (yield* sessionService.get(project.main!)).location.directory }

      // The first worker made it to durable Session storage; the second never got created before the crash.
      yield* sessionService.create({
        id: existingID,
        location,
        title: "Recovered Architect",
        agent: Orchestra.role("architect"),
      })
      const key = `orchestra/team-plan/${project.id}`
      yield* kv.set(key, {
        created: Date.now(),
        members: [
          { id: existingID, agent: Orchestra.role("architect"), title: "Recovered Architect", category: "Planning" },
          { id: missingID, agent: Orchestra.role("developer"), title: "Recovered Developer", category: "Build" },
        ],
      })

      // Reopening the project's main session replays the same roster without duplicating the existing worker.
      const main = yield* orchestra.main(project.id)
      expect(main.id).toBe(project.main!)
      expect(yield* kv.get(key)).toBeUndefined()
      const members = yield* orchestra.sessions(project.id)
      expect(members.filter((item) => item.id === existingID)).toHaveLength(1)
      expect(members.filter((item) => item.id === missingID)).toHaveLength(1)
      expect(members.find((item) => item.id === existingID)).toMatchObject({
        title: "Recovered Architect",
        agent: Orchestra.role("architect"),
      })
      expect(members.find((item) => item.id === missingID)).toMatchObject({
        title: "Recovered Developer",
        agent: Orchestra.role("developer"),
      })
      expect((yield* orchestra.owners())[existingID]).toBe(project.id)
      expect((yield* orchestra.owners())[missingID]).toBe(project.id)
      expect(yield* orchestra.access(existingID)).toBe("full")
      expect(yield* orchestra.access(missingID)).toBe("full")
      expect(yield* orchestra.categories([existingID, missingID])).toEqual({
        [existingID]: "Planning",
        [missingID]: "Build",
      })

      // Reopening again is idempotent because the plan was cleared only after all writes succeeded.
      yield* orchestra.main(project.id)
      expect((yield* orchestra.sessions(project.id)).filter((item) => item.id === existingID)).toHaveLength(1)
      expect((yield* orchestra.sessions(project.id)).filter((item) => item.id === missingID)).toHaveLength(1)
    }).pipe(Effect.scoped),
  ),

  it.live("lists owned sessions even when hundreds of unrelated sessions are newer", () =>
    Effect.gen(function* () {
      const projectDir = yield* Effect.acquireDisposable(
        Effect.promise(() => tmpdir("opencode-orchestra-pagination-project-")),
      )
      const unrelatedDir = yield* Effect.acquireDisposable(
        Effect.promise(() => tmpdir("opencode-orchestra-pagination-unrelated-")),
      )
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Pagination", directory: projectDir.path })
      const originalMainID = project.main!
      const oldWorker = yield* sessions.create({
        location: { directory: AbsolutePath.make(projectDir.path) },
        title: "Older project worker",
      })
      // Separate update timestamps so all 501 unrelated chats sort strictly after the project sessions.
      yield* Effect.sleep("10 millis")
      yield* Effect.forEach(
        Array.from({ length: 501 }, (_, index) => index),
        (index) =>
          sessions.create({
            location: { directory: AbsolutePath.make(unrelatedDir.path) },
            title: `Unrelated ${index}`,
          }),
        { concurrency: 1, discard: true },
      )

      // Simulate the legacy crash window: the main session exists, but Project.main was not saved.
      const kv = yield* KV.Service
      yield* kv.set(
        `orchestra/project/${project.id}`,
        Schema.encodeSync(Orchestra.Project)({
          id: project.id,
          name: project.name,
          directory: project.directory,
          created: project.created,
        }),
      )
      const main = yield* orchestra.main(project.id)
      expect(main.id).toBe(originalMainID)
      expect((yield* orchestra.projects()).find((item) => item.id === project.id)?.main).toBe(originalMainID)
      expect(yield* orchestra.mainOf(originalMainID)).toMatchObject({ id: project.id })

      const listed = yield* orchestra.sessions(project.id)
      expect(listed.map((session) => session.id)).toContain(oldWorker.id)
    }).pipe(Effect.scoped),
  ),

  it.live("a dispatched task reports back to the orchestrator when its run ends", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-team-")))
      const orchestra = yield* Orchestra.Service
      const project = yield* orchestra.create({ name: "Team", directory: tmp.path, template: "bugfix" })
      const dodPath = path.join(tmp.path, Dod.FILE)
      expect(yield* Effect.promise(() => Bun.file(dodPath).exists())).toBe(true)
      expect(yield* Effect.promise(() => Bun.file(dodPath).text())).toContain("task_id: PROJECT-BOARD")
      const main = project.main!
      const members = yield* orchestra.sessions(project.id)
      const byTitle = (title: string) => members.find((session) => session.title === title)!

      expect(members.map((session) => session.agent)).toEqual([
        Orchestra.role("debugger"),
        Orchestra.role("developer"),
        Orchestra.role("tester"),
      ])
      expect(yield* orchestra.categories(members.map((session) => session.id))).toEqual({
        [byTitle("Debugger").id]: "Quality",
        [byTitle("Developer").id]: "Build",
        [byTitle("Tester").id]: "Quality",
      })

      const developer = byTitle("Developer")
      yield* orchestra.dispatch({ project, sessionID: developer.id, text: "Fix the bug" })
      const [report] = yield* reports(main).pipe(
        Effect.filterOrFail((found) => found.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(report).toContain(`session="${developer.id}"`)
      expect(report).toContain('state="done"')
      expect(report).toContain("Developer: task answer")
      expect(yield* orchestra.pending(developer.id)).toBeUndefined()

      // a second project in the same directory brings its own orchestrator, which joins neither team
      const neighbour = yield* orchestra.create({ name: "Neighbour", directory: tmp.path, template: "docs" })
      const ownIDs = (yield* orchestra.sessions(project.id)).map((session) => session.id)
      expect(ownIDs).not.toContain(neighbour.main)
      expect((yield* orchestra.sessions(neighbour.id)).map((session) => session.id)).not.toContain(main)
      // and neither team is copied into the other one
      expect(ownIDs.toSorted()).toEqual(members.map((session) => session.id).toSorted())
      const theirs = yield* orchestra.sessions(neighbour.id)
      expect(theirs.map((session) => session.agent).toSorted()).toEqual([
        Orchestra.role("reviewer"),
        Orchestra.role("writer"),
      ])
      expect(yield* orchestra.owns(project, theirs[0])).toBe(false)
      expect(yield* orchestra.owns(neighbour, theirs[0])).toBe(true)

      // a session no project opened goes to the oldest project in the directory until one claims it
      const sessions = yield* Session.Service
      const loose = yield* sessions.create({ location: { directory: developer.location.directory } })
      expect(yield* orchestra.owns(project, loose)).toBe(true)
      yield* orchestra.claim(loose.id, neighbour.id)
      expect(yield* orchestra.owns(project, loose)).toBe(false)
      expect((yield* orchestra.sessions(neighbour.id)).map((session) => session.id)).toContain(loose.id)
      // forgetting a project hands its sessions back to the directory rule
      yield* orchestra.remove(neighbour.id)
      expect(yield* orchestra.owners()).not.toHaveProperty(loose.id)
      expect(yield* orchestra.owns(project, loose)).toBe(true)

      // a run the operator started themselves is not reported
      yield* sessions.prompt({ sessionID: developer.id, text: "operator's own question" })
      yield* Effect.sleep("50 millis")
      expect(yield* reports(main)).toHaveLength(1)
    }).pipe(Effect.scoped),
  )

  it.live("forwards a worker's question during a dispatched task to the orchestrator", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-team-")))
      const orchestra = yield* Orchestra.Service
      const bus = yield* Bus.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Team", directory: tmp.path, template: "bugfix" })
      const members = yield* orchestra.sessions(project.id)
      const developer = members.find((session) => session.title === "Developer")!
      const tester = members.find((session) => session.title === "Tester")!
      // Keep the task outstanding, as it is while the worker waits for an answer.
      deferTaskDelivery.add(developer.id)
      yield* Effect.addFinalizer(() => Effect.sync(() => deferTaskDelivery.delete(developer.id)))
      yield* orchestra.dispatch({ project, sessionID: developer.id, text: "Fix the bug" })
      const ask = (sessionID: Session.ID) =>
        bus.publish(Form.Event.Created, {
          form: {
            id: Form.ID.create(),
            sessionID,
            title: "Questions",
            metadata: { kind: "question" },
            fields: [
              {
                key: "q0",
                type: "string",
                title: "Database",
                description: "Which database should the fix target?",
                options: [
                  { value: "Postgres", label: "Postgres", description: "Production" },
                  { value: "SQLite", label: "SQLite" },
                ],
                custom: true,
              },
            ],
          },
        })
      // A session without an outstanding task is the operator's own conversation.
      yield* ask(tester.id)
      yield* ask(developer.id)
      const questions = (sessionID: Session.ID) =>
        sessions
          .inbox(sessionID)
          .pipe(
            Effect.map((inbox) =>
              inbox.flatMap((item) =>
                item.type === "synthetic" && item.payload.text.startsWith("<team-question") ? [item.payload.text] : [],
              ),
            ),
          )
      const [question] = yield* questions(project.main!).pipe(
        Effect.filterOrFail((found) => found.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(question).toContain(`session="${developer.id}"`)
      expect(question).toContain("Which database should the fix target?")
      expect(question).toContain("- Postgres: Production")
      expect(question).toContain("- SQLite")
      expect(yield* questions(project.main!)).toHaveLength(1)
    }).pipe(Effect.scoped),
  )

  it.live("restores a delivered task report when the project's main session is deleted", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-report-ledger-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Report ledger", directory: tmp.path, template: "bugfix" })
      const oldMain = project.main!
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the bug" })
      const [original] = yield* reports(oldMain).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(original).toContain("Developer: task answer")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()

      // The worker reservation is gone, but the unacknowledged report is still project-owned.
      yield* sessions.remove(oldMain)
      yield* orchestra.recoverPendingTasks()
      const repaired = (yield* orchestra.projects()).find((item) => item.id === project.id)!
      expect(repaired.main).toBeDefined()
      expect(repaired.main).not.toBe(oldMain)
      const restored = yield* reports(repaired.main!).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(restored).toHaveLength(1)
      expect(restored[0]).toContain("Developer: task answer")

      // Re-running startup reconciliation does not duplicate a report already in the Inbox.
      yield* orchestra.recoverPendingTasks()
      expect(yield* reports(repaired.main!)).toHaveLength(1)
    }).pipe(Effect.scoped),
  ),

  it.live("does not acknowledge a report from an unrelated user turn before recovering it", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-report-ack-boundary-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const bus = yield* Bus.Service
      const kv = yield* KV.Service
      const project = yield* orchestra.create({ name: "Report acknowledgement", directory: tmp.path, template: "bugfix" })
      const oldMain = project.main!
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the bug" })
      const [pendingReport] = yield* reports(oldMain).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      const reportItem = (yield* sessions.inbox(oldMain)).find(
        (item) => item.type === "synthetic" && item.payload.text === pendingReport,
      )
      expect(reportItem).toBeDefined()
      if (!reportItem || reportItem.type !== "synthetic") throw new Error("Expected the worker report in the main inbox")

      // Make the report visible in history, then admit an unrelated user question after it.
      yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: oldMain, inboxID: reportItem.id })
      const unrelated = yield* sessions.prompt({
        sessionID: oldMain,
        text: "What is the current project name?",
        resume: false,
      })
      yield* bus.publish(SessionEvent.InboxDelivered, { sessionID: oldMain, inboxID: unrelated.id })

      // Simulate a successful assistant turn after the unrelated prompt, not a response to the report.
      const assistantMessageID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.Step.Started, {
        sessionID: oldMain,
        assistantMessageID,
        agent: Orchestra.agent,
        model,
        started: 0,
      })
      yield* bus.publish(SessionEvent.Text.Started, { sessionID: oldMain, assistantMessageID, ordinal: 0 })
      yield* bus.publish(SessionEvent.Text.Ended, {
        sessionID: oldMain,
        assistantMessageID,
        ordinal: 0,
        text: "The project is Report acknowledgement.",
      })
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID: oldMain,
        assistantMessageID,
        finish: "stop",
        cost: Money.USD.zero,
        tokens,
      })
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: oldMain })
      yield* Effect.sleep("50 millis")
      // Run the same durable reconciliation synchronously so the test does not depend on
      // when the live event subscriber gets scheduled.
      yield* orchestra.recoverPendingTasks()

      const ledger = yield* kv.get(`orchestra/report/${project.id}/${reportItem.id}`)
      expect(ledger).toBeDefined()
      expect((ledger as { acknowledged?: boolean }).acknowledged).not.toBe(true)

      // The unacknowledged report must survive deletion of the session it was originally sent to.
      yield* sessions.remove(oldMain)
      yield* orchestra.recoverPendingTasks()
      const repaired = (yield* orchestra.projects()).find((item) => item.id === project.id)!
      expect(repaired.main).toBeDefined()
      expect(repaired.main).not.toBe(oldMain)
      const restored = yield* reports(repaired.main!).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(restored).toHaveLength(1)
      expect(restored[0]).toContain("Developer: task answer")
    }).pipe(Effect.scoped),
  ),

  it.live("reattaches outstanding task reports when a deleted main session is recreated", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-main-recovery-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Main recovery", directory: tmp.path, template: "bugfix" })
      const oldMain = project.main!
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      yield* Effect.acquireRelease(
        Effect.sync(() => suppressTerminalEvent.add(worker.id)),
        () => Effect.sync(() => suppressTerminalEvent.delete(worker.id)),
      )

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the bug" })
      yield* Effect.sleep("50 millis")
      expect(yield* reports(oldMain)).toHaveLength(0)
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      // Simulate a legacy/manual deletion. The task still points to oldMain after it disappears.
      yield* sessions.remove(oldMain)
      suppressTerminalEvent.delete(worker.id)
      const main = yield* orchestra.main(project.id)
      expect(main.id).not.toBe(oldMain)

      const [report] = yield* reports(main.id).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(report).toContain('state="recovered"')
      expect(report).toContain("Developer: task answer")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),

  it.live("uses a durable terminal event when its live notification was missed", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-durable-terminal-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const bus = yield* Bus.Service
      const project = yield* orchestra.create({ name: "Durable terminal", directory: tmp.path, template: "bugfix" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      yield* Effect.acquireRelease(
        Effect.sync(() => suppressTerminalEvent.add(worker.id)),
        () => Effect.sync(() => suppressTerminalEvent.delete(worker.id)),
      )

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the bug" })
      yield* Effect.sleep("50 millis")
      expect(yield* reports(project.main!)).toHaveLength(0)
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      // Simulate the crash window: persist Execution.Succeeded without publishing a live
      // notification to the Orchestra subscriber. Recovery must trust the ordered durable log.
      const events = yield* Stream.runCollect(sessions.log({ sessionID: worker.id, follow: false }))
      const lastSequence = events.reduce(
        (last, item) =>
          item.type === "log.synced" ? Math.max(last, Number(item.seq ?? -1)) : Math.max(last, Number(item.durable.seq)),
        -1,
      )
      yield* bus.replay(
        {
          id: Event.ID.create(),
          type: Bus.versionedType(
            SessionEvent.Execution.Succeeded.type,
            SessionEvent.Execution.Succeeded.durable.version,
          ),
          created: Date.now(),
          seq: lastSequence + 1,
          aggregateID: worker.id,
          data: { sessionID: worker.id },
        },
        { publish: false },
      )

      yield* orchestra.recoverPendingTasks()
      const [report] = yield* reports(project.main!).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(report).toContain('state="done"')
      expect(report).not.toContain('state="recovered"')
      expect(report).toContain("Developer: task answer")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),

  it.live("recovers the final answer after a long tool-heavy worker turn", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-long-turn-")))
      const orchestra = yield* Orchestra.Service
      const project = yield* orchestra.create({ name: "Long turn", directory: tmp.path, template: "bugfix" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      const extraMessages = 65
      yield* Effect.acquireRelease(
        Effect.sync(() => suppressTerminalEvent.add(worker.id)),
        () => Effect.sync(() => suppressTerminalEvent.delete(worker.id)),
      )
      yield* Effect.acquireRelease(
        Effect.sync(() => longTurnMessages.set(worker.id, extraMessages)),
        () => Effect.sync(() => longTurnMessages.delete(worker.id)),
      )

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the bug" })
      expect(yield* reports(project.main!)).toHaveLength(0)
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      // The final answer is more than one 50-message page after the dispatched user message.
      yield* orchestra.recoverPendingTasks()
      const [report] = yield* reports(project.main!).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(report).toContain('state="recovered"')
      expect(report).toContain("Developer: final long-turn answer")
      expect(report).not.toContain("intermediate continuation")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),
  it.live("does not report a later user prompt as the assigned worker task's answer", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-answer-boundary-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Answer boundary", directory: tmp.path, template: "bugfix" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      yield* Effect.acquireRelease(
        Effect.sync(() => suppressTerminalEvent.add(worker.id)),
        () => Effect.sync(() => suppressTerminalEvent.delete(worker.id)),
      )

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the assigned bug" })
      yield* Effect.sleep("50 millis")
      expect(yield* reports(project.main!)).toHaveLength(0)
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      // A direct user prompt arrives before the missing terminal event is reconciled.
      // Its completion must not overwrite the answer to the task already assigned by the orchestrator.
      yield* Effect.acquireRelease(
        Effect.sync(() => deliverRegularInput.add(worker.id)),
        () => Effect.sync(() => deliverRegularInput.delete(worker.id)),
      )
      yield* sessions.prompt({ sessionID: worker.id, text: "Now answer an unrelated question" })
      yield* sessions.prompt({ sessionID: worker.id, text: "One more unrelated question" })
      expect(yield* reports(project.main!)).toHaveLength(0)
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      yield* orchestra.recoverPendingTasks()
      const [report] = yield* reports(project.main!).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(report).toContain('state="recovered"')
      expect(report).toContain("Developer: task answer")
      expect(report).not.toContain("Developer: unrelated answer")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),
  it.live("recovers a completed worker task when its terminal event was missed", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-recovery-")))
      const orchestra = yield* Orchestra.Service
      const sessionStore = yield* SessionStore.Service
      const project = yield* orchestra.create({ name: "Recovery", directory: tmp.path, template: "bugfix" })
      const unrelated = yield* orchestra.create({ name: "Unrelated", directory: tmp.path, template: "docs" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      yield* Effect.acquireRelease(
        Effect.sync(() => suppressTerminalEvent.add(worker.id)),
        () => Effect.sync(() => suppressTerminalEvent.delete(worker.id)),
      )

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the bug" })
      yield* Effect.sleep("50 millis")
      expect(yield* reports(project.main!)).toHaveLength(0)
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      // A persisted execution claim means a worker must resume; don't mistake its durable partial
      // transcript for a finished task merely because this process has no local active fiber.
      yield* sessionStore.claim(worker.id)
      suppressTerminalEvent.delete(worker.id)
      yield* orchestra.mainOf(project.main!)
      expect(yield* reports(project.main!)).toHaveLength(0)
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      // Opening another project's main session must not reconcile this project's task.
      yield* sessionStore.release(worker.id)
      yield* orchestra.mainOf(unrelated.main!)
      expect(yield* reports(project.main!)).toHaveLength(0)
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      // Once the owning orchestrator is activated, it reconciles only its own task.
      yield* orchestra.mainOf(project.main!)
      const recovered = yield* reports(project.main!).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(recovered).toHaveLength(1)
      expect(recovered[0]).toContain('state="recovered"')
      expect(recovered[0]).toContain("Developer: task answer")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()

      // Recovery is idempotent after the durable marker has been cleared.
      yield* orchestra.mainOf(project.main!)
      expect(yield* reports(project.main!)).toHaveLength(1)
    }).pipe(Effect.scoped),
  ),
  it.live("replaces provisional recovery content when the real terminal event arrives", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-provisional-report-")))
      const orchestra = yield* Orchestra.Service
      const kv = yield* KV.Service
      const bus = yield* Bus.Service
      const project = yield* orchestra.create({ name: "Provisional report", directory: tmp.path, template: "bugfix" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      yield* Effect.acquireRelease(
        Effect.sync(() => suppressTerminalEvent.add(worker.id)),
        () => Effect.sync(() => suppressTerminalEvent.delete(worker.id)),
      )

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the bug" })
      yield* Effect.sleep("50 millis")
      expect(yield* reports(project.main!)).toHaveLength(0)

      const taskKey = `orchestra/task/${worker.id}`
      const value = yield* kv.get(taskKey)
      expect(value).toBeDefined()
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing task marker")
      const original = value as Record<string, unknown>
      expect(original.reportID).toBeDefined()
      // A crash may leave a recovery draft durable without having admitted it to the inbox.
      yield* kv.set(taskKey, {
        ...original,
        reportPrepared: true,
        reportState: "recovered",
        reportDetail: "Provisional recovery notice",
        reportText: "Provisional recovery answer",
        reportOutcome: "unknown",
        reportTitle: "Developer",
        reportRole: Orchestra.role("developer"),
      })

      suppressTerminalEvent.delete(worker.id)
      yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID: worker.id })
      const [report] = yield* reports(project.main!).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(report).toContain('state="done"')
      expect(report).toContain("Developer: task answer")
      expect(report).not.toContain("Provisional recovery notice")
      expect(report).not.toContain("Provisional recovery answer")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),

  it.live("clears an orphaned task reservation when its prompt was never admitted", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-orphaned-task-")))
      const orchestra = yield* Orchestra.Service
      const kv = yield* KV.Service
      const project = yield* orchestra.create({ name: "Orphaned task", directory: tmp.path, template: "bugfix" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      const messageID = SessionMessage.ID.create()
      const reportID = SessionMessage.ID.create()
      const taskKey = `orchestra/task/${worker.id}`

      // Simulate a process crash after writing the reservation but before prompt admission.
      yield* kv.set(taskKey, { main: project.main!, sent: Date.now(), messageID, reportID })
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      yield* orchestra.mainOf(project.main!)
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
      expect(yield* reports(project.main!)).toHaveLength(0)

      // The stale marker no longer blocks the worker from accepting a fresh assignment.
      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Retry after recovery" })
      const [report] = yield* reports(project.main!).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(report).toContain("Developer: task answer")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),

  it.live("reports a failed task when its worker session is deleted", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-deleted-worker-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Deleted worker", directory: tmp.path, template: "bugfix" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      yield* Effect.acquireRelease(
        Effect.sync(() => suppressTerminalEvent.add(worker.id)),
        () => Effect.sync(() => suppressTerminalEvent.delete(worker.id)),
      )

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the bug" })
      yield* Effect.sleep("50 millis")
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      // Deleting a worker cannot silently discard the outstanding task.
      yield* sessions.remove(worker.id)
      suppressTerminalEvent.delete(worker.id)
      yield* orchestra.mainOf(project.main!)
      const [report] = yield* reports(project.main!).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(report).toContain('state="failed"')
      expect(report).toContain("Worker session")
      expect(report).toContain("was removed")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),
  it.live("clears the marker when a report was admitted just before a crash", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-report-retry-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const kv = yield* KV.Service
      const project = yield* orchestra.create({ name: "Report retry", directory: tmp.path, template: "bugfix" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      yield* Effect.acquireRelease(
        Effect.sync(() => suppressTerminalEvent.add(worker.id)),
        () => Effect.sync(() => suppressTerminalEvent.delete(worker.id)),
      )

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the bug" })
      yield* Effect.sleep("50 millis")
      const taskKey = `orchestra/task/${worker.id}`
      const value = yield* kv.get(taskKey)
      expect(value).toBeDefined()
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing task marker")
      const reportID = SessionMessage.ID.create()
      const original = value as Record<string, unknown>
      yield* kv.set(taskKey, { ...original, reportID })

      // Simulate the crash window: the report made it to the inbox, but the task marker wasn't cleared.
      const taskID = typeof original.messageID === "string" ? original.messageID : "legacy"
      const reportText = `<team-report session="${worker.id}" task="${taskID}" title="Developer" role="${Orchestra.role("developer")}" state="done" outcome="unknown">\nOriginal durable report\n</team-report>`
      yield* sessions
        .synthetic({
          id: reportID,
          sessionID: project.main!,
          description: "Developer: done",
          text: reportText,
          metadata: {
            source: "team",
            sessionID: worker.id,
            state: "done",
            outcome: "unknown",
            ...(taskID === "legacy" ? {} : { taskID }),
          },
        })
        .pipe(Effect.orDie)
      expect(yield* reports(project.main!)).toHaveLength(1)

      // Reconciliation must recognize the already-admitted ID, not retry with a conflicting body.
      yield* orchestra.mainOf(project.main!)
      expect(yield* reports(project.main!)).toHaveLength(1)
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),
  it.live("creates manual members through a recoverable roster plan and rejects stale or removed owners", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-member-lifecycle-")))
      const orchestra = yield* Orchestra.Service
      const kv = yield* KV.Service
      const project = yield* orchestra.create({ name: "Member lifecycle", directory: tmp.path })

      const member = yield* orchestra.createMember({
        project,
        title: "Manual worker",
        agent: Orchestra.role("developer"),
        category: "Build",
      })
      expect(member).toMatchObject({ title: "Manual worker", agent: Orchestra.role("developer") })
      expect((yield* orchestra.owners())[member.id]).toBe(project.id)
      expect(yield* orchestra.access(member.id)).toBe("full")
      expect(yield* orchestra.categories([member.id])).toEqual({ [member.id]: "Build" })
      expect((yield* orchestra.sessions(project.id)).map((item) => item.id)).toContain(member.id)
      expect(yield* kv.get(`orchestra/team-plan/${project.id}`)).toBeUndefined()

      // Simulate a process crash after the write-ahead plan is stored but before the worker
      // Session exists. Opening the owning orchestrator resumes that exact ID and policy.
      const recoveredID = Session.ID.create()
      const planKey = `orchestra/team-plan/${project.id}`
      yield* kv.set(planKey, {
        created: Date.now(),
        members: [
          {
            id: recoveredID,
            agent: Orchestra.role("tester"),
            title: "Recovered manual worker",
            category: "Quality",
          },
        ],
      })
      yield* orchestra.mainOf(project.main!)
      const recovered = (yield* orchestra.sessions(project.id)).find((item) => item.id === recoveredID)
      expect(recovered).toMatchObject({ title: "Recovered manual worker", agent: Orchestra.role("tester") })
      expect((yield* orchestra.owners())[recoveredID]).toBe(project.id)
      expect(yield* orchestra.access(recoveredID)).toBe("full")
      expect(yield* orchestra.categories([recoveredID])).toEqual({ [recoveredID]: "Quality" })
      expect(yield* kv.get(planKey)).toBeUndefined()

      const stale = { ...project, main: undefined }
      const staleError = yield* orchestra
        .createMember({ project: stale, title: "Stale worker", agent: Orchestra.role("developer") })
        .pipe(Effect.flip)
      expect(staleError.message).toContain("main session")
      expect((yield* orchestra.sessions(project.id)).map((item) => item.title)).not.toContain("Stale worker")

      yield* orchestra.remove(project.id)
      const removedError = yield* orchestra
        .createMember({ project, title: "Late worker", agent: Orchestra.role("developer") })
        .pipe(Effect.flip)
      expect(removedError.message).toContain("no longer exists")
      expect(Object.values(yield* orchestra.owners())).not.toContain(project.id)
    }).pipe(Effect.scoped),
  ),

  it.live("rejects dispatch to a worker owned by another project in the same directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-cross-project-dispatch-")))
      const orchestra = yield* Orchestra.Service
      const first = yield* orchestra.create({ name: "First", directory: tmp.path, template: "bugfix" })
      const second = yield* orchestra.create({ name: "Second", directory: tmp.path, template: "bugfix" })
      const foreign = (yield* orchestra.sessions(second.id)).find((session) => session.title === "Developer")!
      expect(yield* orchestra.owns(first, foreign)).toBe(false)

      const failure = yield* orchestra
        .dispatch({ project: first, sessionID: foreign.id, text: "Should never reach the second project" })
        .pipe(Effect.flip)
      expect(failure.message).toContain("does not belong to project")
      expect(yield* orchestra.pending(foreign.id)).toBeUndefined()
      expect(yield* reports(second.main!)).toHaveLength(0)
    }).pipe(Effect.scoped),
  ),

  it.live("rejects stale or removed projects instead of treating dispatch as success", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-stale-dispatch-")))
      const orchestra = yield* Orchestra.Service
      const project = yield* orchestra.create({ name: "Stale", directory: tmp.path, template: "bugfix" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!

      const stale = { ...project, main: undefined }
      const staleFailure = yield* orchestra
        .dispatch({ project: stale, sessionID: worker.id, text: "Stale caller" })
        .pipe(Effect.flip)
      expect(staleFailure.message).toContain("stale")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()

      yield* orchestra.remove(project.id)
      const removedFailure = yield* orchestra
        .dispatch({ project, sessionID: worker.id, text: "Removed project" })
        .pipe(Effect.flip)
      expect(removedFailure.message).toContain("no longer exists")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),

  it.live("does not report an unrelated completion for an undispatched queued task", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-task-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Task tracking", directory: tmp.path, template: "bugfix" })
      const worker = (yield* orchestra.sessions(project.id)).find((session) => session.title === "Developer")!
      yield* Effect.acquireRelease(
        Effect.sync(() => deferTaskDelivery.add(worker.id)),
        () => Effect.sync(() => deferTaskDelivery.delete(worker.id)),
      )

      yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Fix the bug" })
      yield* Effect.sleep("50 millis")
      expect(yield* reports(project.main!)).toHaveLength(0)
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      // A real queued Inbox item must survive recovery even though it is not in projected history yet.
      yield* orchestra.mainOf(project.main!)
      expect(yield* reports(project.main!)).toHaveLength(0)
      expect(yield* orchestra.pending(worker.id)).toBeNumber()

      const blocked = yield* orchestra.dispatch({ project, sessionID: worker.id, text: "Do another task" }).pipe(Effect.flip)
      expect(blocked.message).toContain("outstanding task")

      deferTaskDelivery.delete(worker.id)
      yield* sessions.resume(worker.id)
      const [report] = yield* reports(project.main!).pipe(
        Effect.filterOrFail((found) => found.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(report).toContain("Developer: task answer")
      expect(report).not.toContain("Developer: unrelated answer")
      expect(yield* orchestra.pending(worker.id)).toBeUndefined()
    }).pipe(Effect.scoped),
  ),
  it.live("failed runs are reported and shutdowns wait for the resumed run", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-team-")))
      const orchestra = yield* Orchestra.Service
      const sessions = yield* Session.Service
      const project = yield* orchestra.create({ name: "Team", directory: tmp.path, template: "docs" })
      const main = project.main!
      const location = { directory: (yield* sessions.get(main)).location.directory }
      const failing = yield* sessions.create({ location, title: "Writer fails", agent: Orchestra.role("writer") })
      const paused = yield* sessions.create({ location, title: "Reviewer shutdown", agent: Orchestra.role("reviewer") })

      yield* orchestra.dispatch({ project, sessionID: paused.id, text: "Review" })
      yield* orchestra.dispatch({ project, sessionID: failing.id, text: "Write" })
      const found = yield* reports(main).pipe(
        Effect.filterOrFail((items) => items.length > 0),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(found).toHaveLength(1)
      expect(found[0]).toContain('state="failed"')
      expect(found[0]).toContain("Run failed: Disconnected")
      // the shutdown left its task open for the run that resumes after restart
      expect(yield* orchestra.pending(paused.id)).toBeNumber()
    }).pipe(Effect.scoped),
  )

  it.live("operators add their own roles and teams and edit the built-in ones", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-team-")))
      const orchestra = yield* Orchestra.Service
      const auditor = yield* orchestra.saveRole(undefined, {
        name: " Code Auditor ",
        description: "Audits",
        rules: "Check licenses.",
        category: "",
        readOnly: true,
        model: "test/member",
      })
      expect(auditor).toMatchObject({ id: "code-auditor", name: "Code Auditor", category: "Team", origin: "custom" })
      expect(auditor.agent).toBe(Orchestra.role("code-auditor"))
      // a second role of the same name gets its own id
      const second = yield* orchestra.saveRole(undefined, { ...auditor, model: undefined })
      expect(second.id).toBe("code-auditor-2")

      const edited = yield* orchestra.saveRole("tester", { ...auditor, name: "QA", model: undefined })
      expect(edited.origin).toBe("edited")
      const roles = yield* orchestra.roles()
      expect(roles.find((role) => role.id === "tester")).toMatchObject({ name: "QA", origin: "edited" })
      expect(roles.slice(-2).map((role) => role.id)).toEqual(["code-auditor", "code-auditor-2"])

      const template = yield* orchestra.saveTemplate(undefined, {
        name: "Audit",
        description: "",
        members: [{ agent: auditor.agent, title: "", category: "" }],
      })
      expect(template).toMatchObject({ id: "audit", origin: "custom" })
      expect(template.members).toEqual([{ agent: auditor.agent, title: "Code Auditor", category: "Team" }])

      const deduplicated = yield* orchestra.saveTemplate(undefined, {
        name: "Duplicate roster",
        description: "",
        members: [
          { agent: auditor.agent, title: "President", category: "Team" },
          { agent: auditor.agent, title: "President", category: "Team" },
          { agent: auditor.agent, title: "President 2", category: "Team" },
        ],
      })
      expect(deduplicated.members).toEqual([
        { agent: auditor.agent, title: "President", category: "Team" },
        { agent: auditor.agent, title: "President 2", category: "Team" },
      ])

      const project = yield* orchestra.create({ name: "Audit", directory: tmp.path, template: "audit" })
      const [member] = yield* orchestra.sessions(project.id)
      expect(member.agent).toBe(auditor.agent)
      // the runner reads only the session's model, so the role's model is set on its session
      expect(member.model).toMatchObject({ providerID: "test", id: "member" })

      // a custom role a team uses cannot be removed; removing an edited built-in restores it
      const blocked = yield* orchestra.removeRole("code-auditor").pipe(Effect.flip)
      expect(blocked.message).toContain("Audit")
      yield* orchestra.removeRole("tester")
      expect((yield* orchestra.roles()).find((role) => role.id === "tester")).toMatchObject({
        name: "Tester",
        origin: "builtin",
      })
      yield* orchestra.removeTemplate("audit")
      yield* orchestra.removeRole("code-auditor")
      expect((yield* orchestra.templates()).some((item) => item.id === "audit")).toBe(false)
      expect((yield* orchestra.roles()).some((role) => role.id === "code-auditor")).toBe(false)

      const invalid = yield* orchestra.saveRole(undefined, { ...auditor, model: "no-slash" }).pipe(Effect.flip)
      expect(invalid.field).toBe("model")
      const unknown = yield* orchestra
        .saveTemplate(undefined, {
          name: "X",
          description: "",
          members: [{ agent: Orchestra.role("nobody"), title: "", category: "" }],
        })
        .pipe(Effect.flip)
      expect(unknown.field).toBe("members")
    }).pipe(Effect.scoped),
  )

  it.live("team roles are agents that follow the operator's edits", () =>
    Effect.gen(function* () {
      const orchestra = yield* Orchestra.Service
      const agents = yield* Agent.Service
      const hooks: Array<(event: PermissionEvaluation) => Effect.Effect<void>> = []
      const contexts: Array<(event: SessionContext) => Effect.Effect<void>> = []
      yield* TeamPlugin.Plugin.effect(
        host({
          agent: agentHost(agents),
          session: {
            hook: ((name: string, callback: (event: SessionContext) => Effect.Effect<void>) =>
              Effect.sync(() => {
                if (name === "context") contexts.push(callback)
              }).pipe(Effect.as({ dispose: Effect.void }))) as never,
          },
          permission: {
            hook: (_, callback) => Effect.sync(() => hooks.push(callback)).pipe(Effect.as({ dispose: Effect.void })),
            list: () => Effect.die("unused permission.list"),
            get: () => Effect.die("unused permission.get"),
            reply: () => Effect.die("unused permission.reply"),
          },
        }),
      )
      const tools = new Map<string, Tool.Info>()
      yield* OrchestraTool.Plugin.effect(
        host({
          session: { hook: () => Effect.succeed({ dispose: Effect.void }) },
          tool: {
            transform: (callback) =>
              Effect.sync(() => {
                callback({
                  list: () => [],
                  get: () => undefined,
                  namespace: () => {},
                  add: (tool) => {
                    tools.set(tool.name, tool)
                  },
                  update: () => {},
                  remove: () => {},
                })
              }).pipe(Effect.as({ dispose: Effect.void })),
            reload: () => Effect.void,
            list: () => Effect.succeed([]),
            hook: () => Effect.succeed({ dispose: Effect.void }),
          },
        }),
      )
      // What the permission service passes to plugins once every agent and config rule allowed the edit.
      const evaluate = (
        agent: Agent.ID,
        action: string,
        effect: PermissionEvaluation["effect"] = "allow",
        sessionID: Session.ID = Session.ID.create(),
      ) =>
        Effect.gen(function* () {
          const event: PermissionEvaluation = {
            sessionID,
            agent,
            action,
            resources: ["/project/file.txt"],
            effect,
          }
          yield* Effect.forEach(hooks, (hook) => hook(event), { discard: true })
          return event.effect
        })
      expect(String((yield* agents.get(Orchestra.role("developer")))?.name)).toBe("Developer")
      const availableRoles = yield* orchestra.roles()
      const counterexampleRole = availableRoles.find((item) => item.id === "counterexample-engineer")
      expect(counterexampleRole).toMatchObject({
        name: "Counterexample Engineer",
        readOnly: true,
        category: "Quality",
      })
      const counterexample = yield* agents.get(Orchestra.role("counterexample-engineer")).pipe(
        Effect.filterOrFail((item) => item !== undefined),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect((counterexample.system ?? "").toLowerCase()).toContain("trying to disprove")
      expect((counterexample.system ?? "").toLowerCase()).toContain("concrete counterexamples")
      expect(counterexample.permissions).toContainEqual({ action: "edit", resource: "*", effect: "deny" })
      const counterexampleEditEffect = yield* evaluate(Orchestra.role("counterexample-engineer"), "edit")
      expect(counterexampleEditEffect).toBe("deny")

      const role = yield* orchestra.saveRole(undefined, {
        name: "Translator",
        description: "Translates",
        rules: "Translate to Russian.",
        category: "Build",
        readOnly: true,
        model: "test/member",
      })
      const agent = yield* agents.get(role.agent).pipe(
        Effect.filterOrFail((item) => item !== undefined),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(agent.system).toEndWith("Translate to Russian.")
      expect(agent.model).toEqual(model)
      expect(agent.permissions).toContainEqual({ action: "edit", resource: "*", effect: "deny" })
      // a global `edit: allow` from config cannot reopen a read-only role
      expect(yield* evaluate(role.agent, "edit")).toBe("deny")
      expect(yield* evaluate(role.agent, "read")).toBe("allow")
      expect(yield* evaluate(Orchestra.role("developer"), "edit")).toBe("allow")
      expect(yield* evaluate(Orchestra.agent, "edit")).toBe("deny")
      expect(yield* evaluate(Orchestra.agent, "subagent")).toBe("deny")
      expect(yield* evaluate(Orchestra.role("developer"), "subagent")).toBe("deny")
      // the Orchestrator settles other-directory access for its team instead of prompting the operator
      expect(yield* evaluate(Orchestra.role("developer"), "external_directory", "ask")).toBe("allow")
      expect(yield* evaluate(Orchestra.agent, "external_directory", "ask")).toBe("allow")
      expect(yield* evaluate(Agent.defaultID, "external_directory", "ask")).toBe("ask")

      yield* orchestra.removeRole(role.id)
      yield* agents.get(role.agent).pipe(
        Effect.filterOrFail((item) => item === undefined),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )

      // A role limited to some tools keeps that limit even where config allows a tool for everyone.
      const scout = yield* orchestra.saveRole(undefined, {
        name: "Scout",
        description: "Looks around",
        rules: "",
        category: "Planning",
        readOnly: false,
        tools: ["read", "grep", " grep ", "context7_*"],
        hub: ["git"],
      })
      expect(scout.tools).toEqual(["read", "grep", "context7_*"])
      const scoutAgent = yield* agents.get(scout.agent).pipe(
        Effect.filterOrFail((item) => item !== undefined),
        Effect.retry(Schedule.spaced("10 millis")),
        Effect.timeout("2 seconds"),
      )
      expect(scoutAgent.permissions).toContainEqual({ action: "*", resource: "*", effect: "deny" })
      expect(scoutAgent.permissions).toContainEqual({ action: "grep", resource: "*", effect: "allow" })
      expect(yield* evaluate(scout.agent, "shell")).toBe("deny")
      expect(yield* evaluate(scout.agent, "edit")).toBe("deny")
      expect(yield* evaluate(scout.agent, "read")).toBe("allow")
      // other actions, such as asking the operator, are not tools and stay untouched
      expect(yield* evaluate(scout.agent, "question")).toBe("allow")
      yield* orchestra.removeRole(scout.id)

      // The Orchestrator and its team read the project's shared notes with every request.
      const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-orchestra-notes-")))
      const project = yield* orchestra.create({ name: "Notes", directory: tmp.path })
      const context = (agent: Agent.ID) =>
        Effect.gen(function* () {
          const event = { sessionID: project.main!, agent, system: [], tools: {} } as unknown as SessionContext
          yield* Effect.forEach(contexts, (hook) => hook(event), { discard: true })
          return event.system.map((part) => (part.type === "text" ? part.text : "")).join(" ")
        })
      expect(yield* context(Orchestra.agent)).toContain("The team has no notes yet")
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, ".opencode", "team-notes.md"), "Build: bun run build"))
      expect(yield* context(Orchestra.agent)).toContain("Build: bun run build")
      expect(yield* context(Agent.ID.make("build"))).toBe("")

      const sessionService = yield* Session.Service
      // The tool's own path: the orchestrator calls sessions set_mode on a worker, and the
      // worker's stored metadata changes for its next task.
      const modeWorker = yield* sessionService.create({
        location: { directory: AbsolutePath.make(project.directory) },
        title: "Mode worker",
      })
      yield* orchestra.claim(modeWorker.id, project.id)
      yield* orchestra.setAccess(modeWorker.id, "write")
      const sessionsTool = tools.get("sessions")
      if (!sessionsTool) return yield* Effect.die("sessions tool was not registered")
      const setModeResult = yield* sessionsTool.execute(
        { action: "set_mode", sessionID: modeWorker.id, mode: "planning" },
        {
          sessionID: project.main!,
          agent: Orchestra.agent,
          messageID: SessionMessage.ID.create(),
          id: Tool.CallID.make("call_set_mode"),
          progress: () => Effect.void,
        },
      )
      expect(setModeResult.content).toContain("Planning")
      expect((yield* sessionService.get(modeWorker.id))?.metadata?.[Mode.MetadataKey]).toBe("planning")

      // A mode narrows how a session works without changing its role. Planning removes the
      // editing tools from the request and still denies an edit that reaches the permission
      // hook; explicit `auto` restores the developer's normal working set.
      const modeSession = project.main!
      yield* sessionService.setMetadata({ sessionID: modeSession, metadata: { [Mode.MetadataKey]: "planning" } })
      const modeEvent = {
        sessionID: modeSession,
        agent: Orchestra.role("developer"),
        system: [],
        tools: { edit: {}, write: {}, patch: {} },
      } as unknown as SessionContext
      yield* Effect.forEach(contexts, (hook) => hook(modeEvent), { discard: true })
      const modeText = modeEvent.system.map((part) => (part.type === "text" ? part.text : "")).join(" ")
      expect(modeText).toContain("Work mode: Planning")
      expect(modeEvent.tools.edit).toBeUndefined()
      expect(modeEvent.tools.write).toBeUndefined()
      expect(modeEvent.tools.patch).toBeUndefined()
      expect(yield* evaluate(Orchestra.role("developer"), "edit", "allow", modeSession)).toBe("deny")

      yield* sessionService.setMetadata({ sessionID: modeSession, metadata: { [Mode.MetadataKey]: "auto" } })
      expect(yield* evaluate(Orchestra.role("developer"), "edit", "allow", modeSession)).toBe("allow")
    }).pipe(Effect.scoped),
  )
})
