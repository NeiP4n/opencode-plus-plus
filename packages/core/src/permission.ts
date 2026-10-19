export * as Permission from "./permission.js"

import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Deferred, Effect, Layer, Schema } from "effect"
import { Permission } from "@opencode/schema/permission"
import { contains as containsDirectory } from "@opencode/schema/orchestra"
import { RoomRules } from "@opencode/schema/room-rules"
import { Bus } from "./bus.js"
import { Location } from "./location.js"
import { Agent } from "./agent.js"
import { SessionErrors } from "./session/error.js"
import { SessionSchema } from "./session/schema.js"
import { SessionStore } from "./session/store.js"
import { Wildcard } from "./util/wildcard.js"
import { PermissionSaved } from "./permission/saved.js"
import { PluginHooks } from "./plugin/hooks.js"
import { Room } from "./room.js"

const PermissionEffect = Permission.Effect
export { PermissionEffect as Effect }
export { Rule, Ruleset } from "@opencode/schema/permission"
const missingAgentPermissions: Permission.Ruleset = [{ action: "*", resource: "*", effect: "deny" }]

export const ID = Permission.ID
export type ID = typeof ID.Type

export const Source = Permission.Source
export type Source = typeof Source.Type

const RequestFields = {
  sessionID: Permission.Request.fields.sessionID,
  action: Permission.Request.fields.action,
  resources: Permission.Request.fields.resources,
  save: Permission.Request.fields.save,
  metadata: Permission.Request.fields.metadata,
  source: Permission.Request.fields.source,
}

export const Request = Permission.Request
export type Request = typeof Request.Type

export const Reply = Permission.Reply
export type Reply = typeof Reply.Type

export const AssertInput = Schema.Struct({
  id: ID.pipe(Schema.optional),
  ...RequestFields,
  agent: Agent.ID.pipe(Schema.optional),
}).annotate({ identifier: "Permission.AssertInput" })
export type AssertInput = typeof AssertInput.Type

export const ReplyInput = Schema.Struct({
  requestID: ID,
  reply: Reply,
  message: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Permission.ReplyInput" })
export type ReplyInput = typeof ReplyInput.Type

export const AskResult = Schema.Struct({
  id: ID,
  effect: Permission.Effect,
}).annotate({ identifier: "Permission.AskResult" })
export type AskResult = typeof AskResult.Type

export type DelegateDecision = {
  readonly effect: "allow" | "deny"
  readonly message?: string
}
export type Delegate = (request: Request) => Effect.Effect<DelegateDecision | undefined>

export interface DelegateRegistry {
  readonly get: Effect.Effect<Delegate | undefined>
  readonly set: (delegate: Delegate) => Effect.Effect<void>
}
export class DelegateRegistryService extends Context.Service<DelegateRegistryService, DelegateRegistry>()(
  "@opencode/PermissionDelegateRegistry",
) {}

const delegateRegistryLayer = Layer.effect(
  DelegateRegistryService,
  Effect.gen(function* () {
    let current: Delegate | undefined
    return DelegateRegistryService.of({
      get: Effect.sync(() => current),
      set: (delegate) =>
        Effect.sync(() => {
          current = delegate
        }),
    })
  }),
)
export const delegateNode = makeGlobalNode({
  service: DelegateRegistryService,
  layer: delegateRegistryLayer,
  deps: [],
})

export { Event } from "@opencode/schema/permission"

export class DeclinedError extends Schema.TaggedError<DeclinedError>()("Permission.DeclinedError", {}) {}

export class CorrectedError extends Schema.TaggedError<CorrectedError>()("Permission.CorrectedError", {
  feedback: Schema.String,
}) {}

export class BlockedError extends Schema.TaggedError<BlockedError>()("Permission.BlockedError", {
  rules: Permission.Ruleset,
  permission: Schema.String,
  resources: Schema.Array(Schema.String),
  reason: Schema.String.pipe(Schema.optional),
}) {
  override get message() {
    return this.reason ?? `Permission denied: ${this.permission}`
  }
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Permission.NotFoundError", {
  requestID: ID,
}) {}

export type Error = BlockedError | CorrectedError

export function evaluate(action: string, resource: string, ...rulesets: Permission.Ruleset[]): Permission.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource)) ?? {
      action,
      resource: "*",
      effect: "ask",
    }
  )
}

export function merge(...rulesets: Permission.Ruleset[]): Permission.Ruleset {
  return rulesets.flat()
}

export interface Interface {
  readonly close: Effect.Effect<void>
  readonly ask: (input: AssertInput) => Effect.Effect<AskResult, SessionErrors.NotFoundError>
  readonly assert: (input: AssertInput) => Effect.Effect<void, Error | SessionErrors.NotFoundError>
  // Asks the operator whatever the agent's rules say, for requests that come from outside
  // the model, such as a room guest's command; an earlier "always" still counts. A decline
  // is an ordinary failure here, not the defect assert raises to stop a model's tool.
  readonly confirm: (
    input: AssertInput & {
      readonly force?: boolean
      readonly scoped?: boolean
      readonly onAlways?: () => Effect.Effect<void>
    },
  ) => Effect.Effect<void, DeclinedError | CorrectedError>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly get: (id: ID) => Effect.Effect<Request | undefined>
  readonly forSession: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Request>>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

interface Pending {
  readonly request: Request
  readonly agent?: Agent.ID
  readonly deferred: Deferred.Deferred<void, DeclinedError | CorrectedError>
  // Room-member grants are stored on that member, never in project-wide PermissionSaved.
  readonly saveGlobally: boolean
  readonly onAlways?: () => Effect.Effect<void>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    const agents = yield* Agent.Service
    const sessions = yield* SessionStore.Service
    const saved = yield* PermissionSaved.Service
    const hooks = yield* PluginHooks.Service
    const rooms = yield* Room.Service
    const delegates = yield* DelegateRegistryService
    const pending = new Map<ID, Pending>()
    let closed = false

    const close = Effect.gen(function* () {
      closed = true
      yield* Effect.forEach(Array.from(pending.values()), (item) =>
        bus
          .publish(Permission.Event.Replied, {
            sessionID: item.request.sessionID,
            requestID: item.request.id,
            reply: "reject",
          })
          .pipe(Effect.ensuring(Deferred.fail(item.deferred, new DeclinedError()))),
      )
      pending.clear()
    }).pipe(Effect.uninterruptible)
    yield* Effect.addFinalizer(() => close)

    const savedRules = Effect.fnUntraced(function* () {
      return (yield* saved.list({ projectID: location.project.id })).map(
        (item): Permission.Rule => ({
          action: item.action,
          resource: item.resource,
          effect: "allow",
        }),
      )
    })

    const configured = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, agentID?: Agent.ID) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionErrors.NotFoundError({ sessionID })
      const agent = yield* agents.resolve(agentID ?? session.agent)
      return merge(agent?.permissions ?? missingAgentPermissions, session.permissions ?? [])
    })

    const roomRulesForSession = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
      const lineage = new Set<string>()
      let current = yield* sessions.get(sessionID).pipe(Effect.orElseSucceed(() => undefined))
      while (current && !lineage.has(current.id)) {
        lineage.add(current.id)
        if (!current.parentID) break
        const parent = yield* sessions.get(current.parentID).pipe(Effect.orElseSucceed(() => undefined))
        if (!parent) break
        current = parent
      }
      const directory = current?.location.directory
      if (!directory) return undefined
      return RoomRules.merge(
        (yield* rooms.list()).flatMap((room) =>
          lineage.has(room.sessionID) ||
          (room.directory !== undefined && containsDirectory(room.directory, directory))
            ? [room.rules ?? {}]
            : [],
        ),
      )
    })

    // Attribute tool permissions to the guest prompt that led to the assistant tool call.
    // The room shares one host session, so session-level "Always allow" grants would leak
    // permissions between guests. The source points at the assistant message containing the tool.
    const roomMemberForSource = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      source?: Permission.Source,
    ) {
      if (!source) return undefined
      const messages = yield* sessions.messages({ sessionID, limit: 100, order: "desc" }).pipe(
        Effect.orElseSucceed(() => []),
      )
      const sourceIndex = messages.findIndex((message) => message.id === source.messageID)
      if (sourceIndex < 0) return undefined
      // Do not skip a newer non-room user prompt and accidentally attribute a subagent
      // tool call to an older guest who happened to use the same shared session.
      const prompt = messages.slice(sourceIndex).find((message) => message.type === "user")
      if (!prompt || prompt.type !== "user" || !prompt.metadata || typeof prompt.metadata !== "object") return undefined
      const roomInfo = (prompt.metadata as Record<string, unknown>).room
      if (!roomInfo || typeof roomInfo !== "object") return undefined
      const roomRecord = roomInfo as Record<string, unknown>
      const guest = roomRecord.guest
      if (
        typeof roomRecord.id !== "string" ||
        guest === null ||
        typeof guest !== "object" ||
        typeof (guest as Record<string, unknown>).id !== "string"
      ) return undefined
      const room = yield* rooms.get(roomRecord.id as Room.ID).pipe(Effect.orElseSucceed(() => undefined))
      if (!room) return undefined
      const member = yield* rooms.member(room.id, (guest as Record<string, unknown>).id as string)
      if (!member) return undefined
      return { roomID: room.id, member }
    })

    function denied(input: Pick<Request, "action" | "resources">, rules: Permission.Ruleset) {
      return input.resources.some((resource) => evaluate(input.action, resource, rules).effect === "deny")
    }

    function relevant(input: AssertInput, rules: Permission.Ruleset) {
      return rules.filter((rule) => Wildcard.match(input.action, rule.action))
    }

    const evaluateInput = Effect.fnUntraced(function* (input: AssertInput) {
      const rules = yield* configured(input.sessionID, input.agent)
      if (denied(input, rules)) {
        return {
          effect: "deny" as const,
          rules,
          message: undefined,
          save: undefined,
          scoped: false,
          onAlways: undefined,
          requestAction: undefined,
          requestResources: undefined,
          requestMetadata: undefined,
          roomPrograms: undefined,
          roomID: undefined,
          memberID: undefined,
        }
      }
      const all = [...rules, ...(yield* savedRules())]
      // Freeze the policy inputs before plugins run: hooks may customize normal permissions,
      // but cannot mutate the command, resources or transport used for room security checks.
      const policyInput = {
        action: input.action,
        resources: [...input.resources],
        metadata: input.metadata ? { ...input.metadata } : undefined,
      }
      const effects = input.resources.map((resource) => evaluate(input.action, resource, all).effect)
      const effect: Permission.Effect = effects.includes("ask") ? "ask" : "allow"
      const event = yield* hooks.trigger("permission", "evaluate", {
        sessionID: input.sessionID,
        agent: input.agent,
        action: input.action,
        resources: input.resources,
        metadata: input.metadata,
        source: input.source,
        effect,
      })
      // Room rules are authoritative and must run after all plugin hooks. Otherwise a later
      // extension could change a hard deny to allow, or suppress a required program prompt.
      const activeRoomRules = yield* roomRulesForSession(input.sessionID)
      const roomPolicy = RoomRules.policy(activeRoomRules, policyInput)
      const roomCommands = RoomRules.commandActions.includes(input.action)
      const memberContext =
        roomCommands && input.source
          ? yield* roomMemberForSource(input.sessionID, input.source)
          : undefined

      if (roomPolicy?.effect === "deny") {
        return {
          effect: "deny" as const,
          message: roomPolicy.message,
          rules: [...all, { action: input.action, resource: "*", effect: "deny" as const }],
          save: undefined,
          scoped: false,
          onAlways: undefined,
          requestAction: undefined,
          requestResources: undefined,
          requestMetadata: undefined,
          roomPrograms: undefined,
          roomID: undefined,
          memberID: undefined,
        }
      }
      // Guest-only restrictions apply to AI tools too, and cannot be bypassed by Trusted.
      if (roomCommands && memberContext && activeRoomRules?.denyGuestCommands) {
        return {
          effect: "deny" as const,
          message: "This room does not allow guests to execute commands",
          rules: [...all, { action: input.action, resource: "*", effect: "deny" as const }],
          save: undefined,
          scoped: false,
          onAlways: undefined,
          requestAction: undefined,
          requestResources: undefined,
          requestMetadata: undefined,
          roomPrograms: undefined,
          roomID: undefined,
          memberID: undefined,
        }
      }
      if (roomCommands && memberContext?.member.role === "viewer") {
        return {
          effect: "deny" as const,
          message: "View-only members cannot trigger command execution in this room",
          rules: [...all, { action: input.action, resource: "*", effect: "deny" as const }],
          save: undefined,
          scoped: false,
          onAlways: undefined,
          requestAction: undefined,
          requestResources: undefined,
          requestMetadata: undefined,
          roomPrograms: undefined,
          roomID: undefined,
          memberID: undefined,
        }
      }
      if (roomCommands && memberContext?.member.role === "trusted" && event.effect !== "deny") {
        return {
          effect: "allow" as const,
          message: undefined,
          rules: all,
          save: undefined,
          scoped: false,
          onAlways: undefined,
          requestAction: undefined,
          requestResources: undefined,
          requestMetadata: undefined,
          roomPrograms: undefined,
          roomID: undefined,
          memberID: undefined,
        }
      }
      if (roomPolicy?.effect === "ask" && event.effect !== "deny") {
        const programs = [...new Set(input.resources.flatMap((command) =>
          RoomRules.programsRequiringApproval(activeRoomRules, command),
        ))]
        const approved = new Set(memberContext?.member.approvedPrograms ?? [])
        const requestPrograms = memberContext
          ? programs.filter((program) => !approved.has(program))
          : programs
        // A previous per-member "Always allow" satisfies only this guest's program request.
        if (memberContext && requestPrograms.length === 0) {
          return {
            effect: "allow" as const,
            message: undefined,
            rules: all,
            save: undefined,
            scoped: false,
            onAlways: undefined,
            requestAction: undefined,
            requestResources: undefined,
            requestMetadata: undefined,
            roomPrograms: undefined,
            roomID: undefined,
            memberID: undefined,
          }
        }
        const guestName = memberContext?.member.name
        const metadata = {
          ...(input.metadata ?? {}),
          scope: memberContext ? "room-member-program" : "one-time-room-program",
          ...(memberContext
            ? { roomID: memberContext.roomID, memberID: memberContext.member.id, guest: guestName }
            : {}),
          programs: requestPrograms,
          command: input.resources.join(" && "),
        }
        const onAlways = memberContext
          ? () =>
              Effect.gen(function* () {
                const current = yield* rooms.member(memberContext.roomID, memberContext.member.id)
                if (!current) return
                yield* rooms.saveMember(memberContext.roomID, {
                  ...current,
                  approvedPrograms: [...new Set([...(current.approvedPrograms ?? []), ...requestPrograms])],
                })
                return
              })
          : undefined
        return {
          effect: "ask" as const,
          message: memberContext
            ? "Allow " + guestName + " to use " + requestPrograms.join(", ") + '? "Always allow" applies only to this room member.'
            : "This room requires host approval to use " + programs.join(", ") + ". Without a room-member identity, approval is one-time only.",
          rules: all,
          save: memberContext ? requestPrograms : [],
          scoped: true,
          onAlways,
          requestAction: "room.program",
          requestResources: requestPrograms.length ? requestPrograms : programs,
          requestMetadata: metadata,
          roomPrograms: programs,
          roomID: memberContext?.roomID,
          memberID: memberContext?.member.id,
        }
      }
      return {
        effect: event.effect,
        message: event.message,
        rules: all,
        save: undefined,
        scoped: false,
        onAlways: undefined,
        requestAction: undefined,
        requestResources: undefined,
        requestMetadata: undefined,
        roomPrograms: undefined,
        roomID: undefined,
        memberID: undefined,
      }
    })

    function request(input: AssertInput, message?: string): Request {
      return {
        id: input.id ?? ID.create(),
        sessionID: input.sessionID,
        action: input.action,
        resources: input.resources,
        save: input.save,
        metadata: input.metadata,
        source: input.source,
        message,
      }
    }

    const create = (
      request: Request,
      agent?: Agent.ID,
      options?: { readonly saveGlobally?: boolean; readonly onAlways?: () => Effect.Effect<void> },
    ) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<void, DeclinedError | CorrectedError>()
          const item: Pending = {
            request,
            agent,
            deferred,
            saveGlobally: options?.saveGlobally ?? true,
            onAlways: options?.onAlways,
          }
          if (closed) {
            yield* Deferred.fail(deferred, new DeclinedError())
            return item
          }
          if (pending.has(request.id))
            return yield* Effect.die(new Error(`Duplicate pending permission ID: ${request.id}`))
          pending.set(request.id, item)
          yield* bus
            .publish(Permission.Event.Asked, request)
            .pipe(Effect.onError(() => Effect.sync(() => pending.delete(request.id))))
          return item
        }),
      )

    const ask = Effect.fn("Permission.ask")(function* (input: AssertInput) {
      if (closed) return { id: input.id ?? ID.create(), effect: "deny" as const }
      const result = yield* evaluateInput(input)
      const promptInput = {
        ...input,
        action: result.requestAction ?? input.action,
        resources: result.requestResources ? [...result.requestResources] : input.resources,
        metadata: result.requestMetadata ?? input.metadata,
        save: result.save === undefined ? input.save : [...result.save],
      }
      const value = request(promptInput, result.message)
      if (result.effect === "ask") {
        yield* create(value, input.agent, { saveGlobally: !result.scoped, onAlways: result.onAlways })
      }
      return { id: value.id, effect: result.effect }
    })

    const assert = Effect.fn("Permission.assert")((input: AssertInput) =>
      Effect.gen(function* () {
        if (closed) return yield* Effect.die(new DeclinedError())
        const result = yield* evaluateInput(input)
        const value = request(input, result.message)
        const delegate = yield* delegates.get

        if (result.effect === "ask" && delegate) {
          const decision = yield* delegate(value).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Permission delegate failed; denying the agent request", {
                sessionID: input.sessionID,
                requestID: value.id,
                action: input.action,
                cause,
              }).pipe(
                Effect.as({
                  effect: "deny" as const,
                  message: "The project orchestrator could not safely evaluate this permission; denied by default.",
                }),
              ),
            ),
          )
          if (decision?.effect === "allow") return
          if (decision?.effect === "deny") {
            return yield* new BlockedError({
              rules: relevant(input, result.rules),
              permission: input.action,
              resources: input.resources,
              reason: decision.message ?? "The project orchestrator denied this permission.",
            })
          }
        }

        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            if (result.effect === "deny") {
              return yield* new BlockedError({
                rules: relevant(input, result.rules),
                permission: input.action,
                resources: input.resources,
                reason: result.message,
              })
            }
            if (result.effect === "allow") return
            const promptInput = {
              ...input,
              action: result.requestAction ?? input.action,
              resources: result.requestResources ? [...result.requestResources] : input.resources,
              metadata: result.requestMetadata ?? input.metadata,
              save: result.save ?? input.save,
            }
            const item = yield* create(request(promptInput, result.message), input.agent, {
              saveGlobally: !result.scoped,
              onAlways: result.onAlways,
            })
            yield* restore(Deferred.await(item.deferred)).pipe(
              // Deliberate defect tunnel: leaves wrap execution in blanket `mapError`, which
              // must not convert a user's decline into model-facing tool output. The decline
              // resurfaces as a typed failure at SessionModelRequest.executeTool. A decline
              // WITH feedback (CorrectedError) intentionally stays typed so the leaf can turn
              // it into ToolFailure and the model continues.
              Effect.catchTag("Permission.DeclinedError", (error) => Effect.die(error)),
              Effect.ensuring(
                Effect.sync(() => {
                  pending.delete(item.request.id)
                }),
              ),
            )
            // A host may tighten room rules or demote/remove the requesting member while the
            // program approval is open. Re-check before allowing the tool invocation to proceed.
            if (RoomRules.commandActions.includes(input.action)) {
              const currentRules = yield* roomRulesForSession(input.sessionID)
              const currentPolicy = RoomRules.policy(currentRules, {
                action: input.action,
                resources: [...input.resources],
                metadata: input.metadata ? { ...input.metadata } : undefined,
              })
              if (currentPolicy?.effect === "deny") {
                return yield* new BlockedError({
                  rules: [...result.rules, { action: input.action, resource: "*", effect: "deny" as const }],
                  permission: input.action,
                  resources: input.resources,
                  reason: currentPolicy.message,
                })
              }
              const currentMemberContext = yield* roomMemberForSource(input.sessionID, input.source)
              if (result.roomID !== undefined) {
                if (
                  !currentMemberContext ||
                  currentMemberContext.roomID !== result.roomID ||
                  currentMemberContext.member.id !== result.memberID ||
                  currentMemberContext.member.role === "viewer"
                ) {
                  return yield* new BlockedError({
                    rules: [...result.rules, { action: input.action, resource: "*", effect: "deny" as const }],
                    permission: input.action,
                    resources: input.resources,
                    reason: "The host changed or removed this room member while program approval was pending",
                  })
                }
              }
              if (currentRules?.denyGuestCommands && currentMemberContext) {
                return yield* new BlockedError({
                  rules: [...result.rules, { action: input.action, resource: "*", effect: "deny" as const }],
                  permission: input.action,
                  resources: input.resources,
                  reason: "The room no longer permits guest command execution",
                })
              }
              if (currentMemberContext?.member.role === "viewer") {
                return yield* new BlockedError({
                  rules: [...result.rules, { action: input.action, resource: "*", effect: "deny" as const }],
                  permission: input.action,
                  resources: input.resources,
                  reason: "View-only members cannot trigger command execution in this room",
                })
              }
              const currentPrograms = [...new Set(input.resources.flatMap((command) =>
                RoomRules.programsRequiringApproval(currentRules, command),
              ))]
              const currentApproved = new Set(currentMemberContext?.member.approvedPrograms ?? [])
              const previouslyRequired = new Set(result.roomPrograms ?? [])
              const newlyRequired = currentMemberContext?.member.role === "trusted"
                ? []
                : currentPrograms.filter(
                    (program) => !previouslyRequired.has(program) && !currentApproved.has(program),
                  )
              if (newlyRequired.length) {
                return yield* new BlockedError({
                  rules: [...result.rules, { action: input.action, resource: "*", effect: "deny" as const }],
                  permission: input.action,
                  resources: input.resources,
                  reason: "Room rules changed and now require approval for " + newlyRequired.join(", ") + ". Run the command again.",
                })
              }
            }
          }),
        )
      }),
    )

    const reply = Effect.fn("Permission.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(input.requestID)
          if (!existing) return yield* new NotFoundError({ requestID: input.requestID })
          yield* bus.publish(Permission.Event.Replied, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
            reply: input.reply,
          })

          if (input.reply === "reject") {
            yield* Deferred.fail(
              existing.deferred,
              input.message ? new CorrectedError({ feedback: input.message }) : new DeclinedError(),
            )
            pending.delete(input.requestID)
            // A scoped room-member denial must not reject another participant's queued request
            // just because everyone shares one host session.
            if (!existing.saveGlobally) return
            for (const [id, item] of pending) {
              if (item.request.sessionID !== existing.request.sessionID) continue
              yield* bus.publish(Permission.Event.Replied, {
                sessionID: item.request.sessionID,
                requestID: item.request.id,
                reply: "reject",
              })
              // Feedback applies to the whole batch, so parallel asks don't end the step.
              yield* Deferred.fail(
                item.deferred,
                input.message ? new CorrectedError({ feedback: input.message }) : new DeclinedError(),
              )
              pending.delete(id)
            }
            return
          }

          if (input.reply === "always" && existing.request.save?.length) {
            if (existing.saveGlobally) {
              yield* saved.add({
                projectID: location.project.id,
                action: existing.request.action,
                resources: existing.request.save,
              })
            }
            if (existing.onAlways) yield* existing.onAlways()
          }
          yield* Deferred.succeed(existing.deferred, undefined)
          pending.delete(input.requestID)
          // Scoped grants are deliberately not propagated to other requests or persisted globally.
          if (input.reply !== "always" || !existing.request.save?.length || !existing.saveGlobally) return

          for (const [id, item] of pending) {
            const result = yield* evaluateInput({ ...item.request, agent: item.agent }).pipe(
              Effect.catchTag("Session.NotFoundError", () => Effect.undefined),
            )
            if (result?.effect !== "allow") continue
            yield* bus.publish(Permission.Event.Replied, {
              sessionID: item.request.sessionID,
              requestID: item.request.id,
              reply: "always",
            })
            yield* Deferred.succeed(item.deferred, undefined)
            pending.delete(id)
          }
        }),
      ),
    )

    const list = Effect.fn("Permission.list")(function* () {
      return Array.from(pending.values(), (item) => item.request)
    })

    const get = Effect.fn("Permission.get")(function* (id: ID) {
      return pending.get(id)?.request
    })

    const forSession = Effect.fn("Permission.forSession")(function* (sessionID: SessionSchema.ID) {
      return Array.from(pending.values(), (item) => item.request).filter((request) => request.sessionID === sessionID)
    })

    const confirm = Effect.fn("Permission.confirm")(
      function* (input: AssertInput & {
        readonly force?: boolean
        readonly scoped?: boolean
        readonly onAlways?: () => Effect.Effect<void>
      }) {
        if (closed) return yield* new DeclinedError()
        const saved = yield* savedRules()
        if (!input.force && input.resources.every((resource) => evaluate(input.action, resource, saved).effect === "allow")) return
        const item = yield* create(request(input), input.agent, {
          saveGlobally: !input.scoped,
          onAlways: input.onAlways,
        })
        return yield* Deferred.await(item.deferred)
      },
    )

    return Service.of({ ask, assert, confirm, reply, get, forSession, list, close })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Bus.node,
    Location.node,
    Agent.node,
    SessionStore.node,
    PermissionSaved.node,
    PluginHooks.node,
    Room.node,
    delegateNode,
  ],
})
