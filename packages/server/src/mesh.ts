export * as ServerMesh from "./mesh"

import { KeyedMutex } from "@opencode/core/effect/keyed-mutex"
import { KV } from "@opencode/core/kv"
import { Session } from "@opencode/core/session"
import { AbsolutePath } from "@opencode/core/schema"
import { advanceCommitIndex, hasQuorum, quorumSize, requestVote } from "@opencode/core/room-mesh"
import { RoomMesh } from "@opencode/schema/room-mesh"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto"

const STATE_KEY = "room-mesh/state"
const NODE_KEY = "room-mesh/node-id"
const HEARTBEAT_MS = 500
const LEASE_MS = 1800
const MAX_MEMBERS = 32
const MAX_ENTRY_BYTES = 128_000

const StoredState = Schema.Struct({
  nodeID: Schema.String,
  status: RoomMesh.Status,
  clusterID: Schema.String,
  secret: Schema.String,
  ownerNodeID: Schema.String,
  members: Schema.Array(RoomMesh.Node),
  voters: Schema.Array(Schema.String).pipe(Schema.optional),
  currentTerm: Schema.Number,
  votedFor: Schema.String.pipe(Schema.optional),
  leaderID: Schema.String.pipe(Schema.optional),
  log: Schema.Array(RoomMesh.Entry),
  commitIndex: Schema.Number,
  preparedHash: Schema.String.pipe(Schema.optional),
})
type StoredState = typeof StoredState.Type

export class MeshError extends Schema.TaggedError<MeshError>()("ServerMesh.Error", {
  message: Schema.String,
  status: Schema.Number,
}) {}

export interface Interface {
  readonly status: () => Effect.Effect<RoomMesh.Snapshot, MeshError>
  readonly invite: () => Effect.Effect<{ token: string }, MeshError>
  readonly create: (input: RoomMesh.CreateInput) => Effect.Effect<{ data: RoomMesh.Snapshot; token: string }, MeshError>
  readonly join: (input: RoomMesh.JoinInput) => Effect.Effect<RoomMesh.Snapshot, MeshError>
  readonly leave: () => Effect.Effect<RoomMesh.Snapshot, MeshError>
  readonly activate: () => Effect.Effect<RoomMesh.Snapshot, MeshError>
  readonly append: (input: RoomMesh.AppendInput) => Effect.Effect<RoomMesh.Entry, MeshError>
  readonly feed: (after?: number) => Effect.Effect<RoomMesh.Feed, MeshError>
  readonly rpc: (input: RoomMesh.RpcRequest, token: string) => Effect.Effect<RoomMesh.RpcResponse, MeshError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerMesh") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const sessions = yield* Session.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const enrollmentLocks = KeyedMutex.makeUnsafe<string>()
    const electionDeadline = new Map<string, number>()
    const nextIndex = new Map<string, number>()
    const matchIndex = new Map<string, number>()
    const acknowledgedAt = new Map<string, number>()

    const load = Effect.fn("ServerMesh.load")(function* () {
      const value = yield* kv.get(STATE_KEY)
      if (value === undefined) return undefined
      return Option.getOrUndefined(Schema.decodeUnknownOption(StoredState)(value))
    })

    const save = (state: StoredState) => kv.set(STATE_KEY, Schema.encodeSync(StoredState)(state))

    const localNodeID = Effect.fn("ServerMesh.localNodeID")(function* () {
      const existing = yield* kv.get(NODE_KEY)
      if (typeof existing === "string" && existing !== "") return existing
      const id = "node_" + randomBytes(12).toString("base64url")
      yield* kv.set(NODE_KEY, id)
      return id
    })

    const requireState = Effect.fn("ServerMesh.requireState")(function* () {
      const state = yield* load()
      if (!state)
        return yield* new MeshError({
          message: "This device has not created or joined a Mesh room",
          status: 404,
        })
      return state
    })

    const normalizedURL = (value: string) =>
      Effect.try({
        try: () => {
          const url = new URL(value)
          if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol")
          if (url.username || url.password) throw new Error("credentials in URL are not allowed")
          return url.origin
        },
        catch: () =>
          new MeshError({
            message: "Enter a reachable HTTP(S) server address, including its port",
            status: 400,
          }),
      })

    const normalizedMembers = (members: readonly RoomMesh.Node[]) =>
      Effect.try({
        try: () => {
          if (members.length < 1 || members.length > MAX_MEMBERS) throw new Error("member limit")
          const result = members
            .map((member) => {
              const url = new URL(member.url)
              if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password)
                throw new Error("bad member URL")
              return { ...member, url: url.origin, name: member.name.trim() || member.id }
            })
            .toSorted((a, b) => a.id.localeCompare(b.id))
          if (new Set(result.map((member) => member.id)).size !== result.length) throw new Error("duplicate ID")
          if (new Set(result.map((member) => member.url)).size !== result.length) throw new Error("duplicate URL")
          return result
        },
        catch: () =>
          new MeshError({
            message: "Mesh membership has invalid or duplicate node IDs/URLs",
            status: 400,
          }),
      })

    const membersHash = (members: readonly RoomMesh.Node[]) =>
      createHash("sha256").update(JSON.stringify(members)).digest("hex")

    const lastIndex = (state: StoredState) => state.log.at(-1)?.index ?? 0
    const lastTerm = (state: StoredState) => state.log.at(-1)?.term ?? 0
    const termAt = (state: StoredState, index: number) => (index === 0 ? 0 : state.log[index - 1]?.term ?? -1)
    const secretMatches = (actual: string, expected: string) => {
      const a = Buffer.from(actual)
      const b = Buffer.from(expected)
      return a.length === b.length && timingSafeEqual(a, b)
    }
    const resetElection = (clusterID: string) => void electionDeadline.set(clusterID, Date.now() + randomInt(1400, 3000))

    const response = (input: Partial<RoomMesh.RpcResponse> = {}): RoomMesh.RpcResponse => ({
      ok: input.ok ?? true,
      ...(input.currentTerm !== undefined ? { currentTerm: input.currentTerm } : {}),
      ...(input.granted !== undefined ? { granted: input.granted } : {}),
      ...(input.success !== undefined ? { success: input.success } : {}),
      ...(input.matchIndex !== undefined ? { matchIndex: input.matchIndex } : {}),
      ...(input.clusterID !== undefined ? { clusterID: input.clusterID } : {}),
      ...(input.ownerNodeID !== undefined ? { ownerNodeID: input.ownerNodeID } : {}),
      ...(input.leaderID !== undefined ? { leaderID: input.leaderID } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.voters !== undefined ? { voters: input.voters } : {}),
      ...(input.members !== undefined ? { members: input.members } : {}),
      ...(input.entry !== undefined ? { entry: input.entry } : {}),
      ...(input.commitIndex !== undefined ? { commitIndex: input.commitIndex } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
    })

    const callRPC = (
      url: string,
      token: string,
      input: RoomMesh.RpcRequest,
    ): Effect.Effect<RoomMesh.RpcResponse, MeshError> =>
      Effect.tryPromise({
        try: async (signal) => {
          const result = await fetch(new URL("/api/room/mesh/rpc", url), {
            method: "POST",
            headers: { authorization: "Bearer " + token, "content-type": "application/json" },
            body: JSON.stringify(input),
            signal,
          })
          const body = await result.text()
          if (!result.ok) {
            let message = "Peer answered HTTP " + result.status
            try {
              const parsed = JSON.parse(body)
              if (typeof parsed.message === "string") message = parsed.message
            } catch {}
            throw new MeshError({ message, status: result.status })
          }
          return body ? JSON.parse(body) : { ok: true }
        },
        catch: (error) =>
          error instanceof MeshError
            ? error
            : new MeshError({ message: error instanceof Error ? error.message : String(error), status: 503 }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.seconds(2),
          orElse: () => Effect.fail(new MeshError({ message: "A Mesh peer did not answer in time", status: 503 })),
        }),
        Effect.flatMap((value) =>
          Schema.decodeUnknownEffect(RoomMesh.RpcResponse)(value).pipe(
            Effect.mapError(() => new MeshError({ message: "A Mesh peer returned an invalid response", status: 502 })),
          ),
        ),
      )

    const memberFor = (state: StoredState, id: string) => state.members.find((member) => member.id === id)
    // During formation all enrolled peers will vote. Once active, later devices are learners.
    const voterIDs = (state: StoredState) =>
      state.status === "forming" ? state.members.map((member) => member.id) : (state.voters ?? state.members.map((member) => member.id))

    const snapshot = Effect.fn("ServerMesh.snapshot")(function* (state?: StoredState) {
      const localID = state?.nodeID ?? (yield* localNodeID())
      const members = state?.members ?? []
      const ids = state ? voterIDs(state) : []
      const required = ids.length ? quorumSize(ids.length) : 0
      const recent = ids.filter((id) => id === localID || Date.now() - (acknowledgedAt.get(id) ?? 0) <= LEASE_MS)
      const writable = state?.status === "active" && state.leaderID === localID && hasQuorum(ids, recent)
      return {
        nodeID: localID,
        status: state?.status ?? "unconfigured",
        ...(state?.clusterID ? { clusterID: state.clusterID } : {}),
        ...(state?.ownerNodeID ? { ownerNodeID: state.ownerNodeID } : {}),
        currentTerm: state?.currentTerm ?? 0,
        ...(state?.leaderID ? { leaderID: state.leaderID } : {}),
        members,
        voters: ids,
        voter: state ? ids.includes(localID) : false,
        logIndex: state ? lastIndex(state) : 0,
        commitIndex: state?.commitIndex ?? 0,
        quorum: required,
        leader: state?.leaderID === localID && state?.status === "active",
        writable,
      } satisfies RoomMesh.Snapshot
    })

    // Remote AI is deliberately a peer capability, not an SSH shell. The request
    // contains only prompt + project location; provider credentials remain on the worker.
    const runAI = Effect.fn("ServerMesh.runAI")(function* (state: StoredState, input: RoomMesh.RunAI) {
      if (state.status !== "active")
        return yield* new MeshError({ message: "Mesh has not been activated", status: 409 })
      if (!memberFor(state, input.fromNodeID))
        return yield* new MeshError({ message: "The requesting device is not enrolled in the Mesh", status: 403 })
      if (input.clusterID !== state.clusterID)
        return yield* new MeshError({ message: "This RPC belongs to another Mesh room", status: 403 })
      const directory = yield* Schema.decodeUnknownEffect(AbsolutePath)(input.directory).pipe(
        Effect.mapError(() => new MeshError({ message: "The worker project directory is invalid", status: 400 })),
      )
      const created = yield* sessions.create({ location: { directory } }).pipe(
        Effect.mapError((error) =>
          new MeshError({ message: `Could not create a worker session: ${error.message}`, status: 503 }),
        ),
      )
      return yield* sessions.generate({ sessionID: created.id, prompt: input.prompt }).pipe(
        Effect.mapError((error) =>
          new MeshError({ message: `Remote AI generation failed: ${error.message}`, status: 503 }),
        ),
      )
    })

    // The remaining consensus implementation is unchanged: replicate committed log
    // entries, elect a coordinator on majority vote, and keep writes read-only without quorum.
    const replicate = Effect.fn("ServerMesh.replicate")(function* (state: StoredState) {
      const peers = state.members.filter((member) => member.id !== state.nodeID)
      const results = yield* Effect.all(
        peers.map((member) => {
          const next = Math.max(1, Math.min(nextIndex.get(member.id) ?? 1, lastIndex(state) + 1))
          const previousIndex = next - 1
          const entries = state.log.filter((entry) => entry.index >= next)
          const request: RoomMesh.RpcRequest = {
            type: "append-entries",
            clusterID: state.clusterID,
            fromNodeID: state.nodeID,
            term: state.currentTerm,
            leaderID: state.nodeID,
            prevLogIndex: previousIndex,
            prevLogTerm: termAt(state, previousIndex),
            entries,
            leaderCommit: state.commitIndex,
          }
          return callRPC(member.url, state.secret, request).pipe(
            Effect.match({ onFailure: () => ({ member, reply: undefined }), onSuccess: (reply) => ({ member, reply }) }),
          )
        }),
        { concurrency: "unbounded" },
      )
      const higherTerm = results.map((result) => result.reply?.currentTerm).find((term) => term !== undefined && term > state.currentTerm)
      if (higherTerm !== undefined) {
        const steppedDown: StoredState = { ...state, currentTerm: higherTerm, leaderID: undefined, votedFor: undefined }
        yield* save(steppedDown)
        resetElection(state.clusterID)
        return steppedDown
      }
      results.forEach(({ member, reply }) => {
        if (!reply) return
        if (reply.success) {
          const matched = reply.matchIndex ?? 0
          matchIndex.set(member.id, matched)
          nextIndex.set(member.id, matched + 1)
          acknowledgedAt.set(member.id, Date.now())
          return
        }
        const current = nextIndex.get(member.id) ?? Math.max(1, lastIndex(state))
        nextIndex.set(member.id, Math.max(1, Math.min(current - 1, (reply.matchIndex ?? 0) + 1)))
      })
      const replicatedIndex = Object.fromEntries(
        state.members.map((member) => [
          member.id,
          member.id === state.nodeID
            ? lastIndex(state)
            : Date.now() - (acknowledgedAt.get(member.id) ?? 0) <= LEASE_MS
              ? matchIndex.get(member.id) ?? 0
              : 0,
        ]),
      )
      const commitIndex = advanceCommitIndex({
        currentTerm: state.currentTerm,
        currentCommitIndex: state.commitIndex,
        voters: voterIDs(state),
        replicatedIndex,
        log: state.log,
      })
      const saved = commitIndex > state.commitIndex ? { ...state, commitIndex } : state
      if (saved !== state) yield* save(saved)
      return saved
    })

    const appendLeader = Effect.fn("ServerMesh.appendLeader")(function* (
      state: StoredState,
      input: { id: string; kind: "message" | "task"; payload: Schema.Json },
      originID: string,
    ) {
      if (state.status !== "active" || state.leaderID !== state.nodeID)
        return yield* new MeshError({ message: "This device is not the elected Mesh coordinator", status: 409 })
      const old = state.log.find((entry) => entry.id === input.id)
      if (old) {
        if (old.kind !== input.kind || JSON.stringify(old.payload) !== JSON.stringify(input.payload))
          return yield* new MeshError({ message: "This Mesh event ID already exists with a different payload", status: 409 })
        if (old.index <= state.commitIndex) return old
        const updated = yield* replicate(state)
        if (old.index <= updated.commitIndex) return old
        return yield* new MeshError({ message: "The event is saved locally but has not reached a Mesh majority; retry with the same event ID", status: 503 })
      }
      if (Buffer.byteLength(JSON.stringify(input.payload), "utf8") > MAX_ENTRY_BYTES)
        return yield* new MeshError({ message: "Mesh event payload exceeds 128 KB", status: 413 })
      const entry: RoomMesh.Entry = {
        id: input.id,
        index: lastIndex(state) + 1,
        term: state.currentTerm,
        kind: input.kind,
        payload: input.payload,
        originID,
        created: Date.now(),
      }
      const appended: StoredState = { ...state, log: [...state.log, entry] }
      matchIndex.set(state.nodeID, lastIndex(appended))
      state.members.filter((member) => member.id !== state.nodeID).forEach((member) => {
        if (!nextIndex.has(member.id)) nextIndex.set(member.id, Math.max(1, entry.index))
      })
      yield* save(appended)
      const updated = yield* replicate(appended)
      if (updated.leaderID !== updated.nodeID)
        return yield* new MeshError({ message: "The Mesh leadership changed while writing", status: 503 })
      if (entry.index <= updated.commitIndex) return entry
      return yield* new MeshError({ message: "The event is saved locally but has not reached a Mesh majority; retry with the same event ID", status: 503 })
    })

    const vote = Effect.fn("ServerMesh.vote")(function* (state: StoredState, input: Extract<RoomMesh.RpcRequest, { type: "request-vote" }>) {
      if (state.status !== "active" || !voterIDs(state).includes(state.nodeID) || !voterIDs(state).includes(input.fromNodeID))
        return response({ ok: false, currentTerm: state.currentTerm, message: "Unknown Mesh voter" })
      const decision = requestVote({
        state: { currentTerm: state.currentTerm, votedFor: state.votedFor },
        candidateID: input.fromNodeID,
        candidateTerm: input.term,
        candidateLastLogIndex: input.lastLogIndex,
        candidateLastLogTerm: input.lastLogTerm,
        localLastLogIndex: lastIndex(state),
        localLastLogTerm: lastTerm(state),
      })
      const changed = decision.state.currentTerm !== state.currentTerm || decision.state.votedFor !== state.votedFor
      const saved: StoredState = {
        ...state,
        currentTerm: decision.state.currentTerm,
        votedFor: decision.state.votedFor,
        ...(decision.state.currentTerm > state.currentTerm ? { leaderID: undefined } : {}),
      }
      if (changed) yield* save(saved)
      if (decision.granted) resetElection(state.clusterID)
      return response({ currentTerm: saved.currentTerm, granted: decision.granted })
    })

    const appendEntries = Effect.fn("ServerMesh.appendEntries")(function* (state: StoredState, input: Extract<RoomMesh.RpcRequest, { type: "append-entries" }>) {
      if (!voterIDs(state).includes(input.fromNodeID) || input.leaderID !== input.fromNodeID)
        return response({ ok: false, currentTerm: state.currentTerm, success: false, matchIndex: lastIndex(state) })
      if (input.term < state.currentTerm)
        return response({ currentTerm: state.currentTerm, success: false, matchIndex: lastIndex(state) })
      let next: StoredState = {
        ...state,
        ...(input.term > state.currentTerm ? { currentTerm: input.term, votedFor: undefined } : {}),
        ...(state.status === "forming" && state.preparedHash === membersHash(state.members) ? { status: "active" as const } : {}),
        leaderID: input.leaderID,
      }
      if (input.prevLogIndex > lastIndex(next) || termAt(next, input.prevLogIndex) !== input.prevLogTerm) {
        if (next !== state) yield* save(next)
        resetElection(state.clusterID)
        return response({ currentTerm: next.currentTerm, success: false, matchIndex: lastIndex(next) })
      }
      const log = [...next.log]
      for (let i = 0; i < input.entries.length; i++) {
        const incoming = input.entries[i]
        if (incoming.index !== input.prevLogIndex + i + 1)
          return response({ ok: false, currentTerm: next.currentTerm, success: false, matchIndex: lastIndex(next) })
        const local = log[incoming.index - 1]
        if (local && (local.term !== incoming.term || local.id !== incoming.id)) {
          if (incoming.index <= next.commitIndex)
            return response({ ok: false, currentTerm: next.currentTerm, success: false, matchIndex: lastIndex(next) })
          log.splice(incoming.index - 1)
        }
        if (!log[incoming.index - 1]) log.push(incoming)
      }
      const commitIndex = Math.max(next.commitIndex, Math.min(input.leaderCommit, log.length))
      next = { ...next, log, commitIndex }
      yield* save(next)
      resetElection(next.clusterID)
      return response({ currentTerm: next.currentTerm, success: true, matchIndex: lastIndex(next) })
    })

    const create = Effect.fn("ServerMesh.create")(function* (input: RoomMesh.CreateInput) {
      return yield* locks.withLock("state")(Effect.gen(function* () {
        const current = yield* load()
        if (current) return yield* new MeshError({ message: "Leave or reset the existing Mesh before creating another", status: 409 })
        const nodeID = yield* localNodeID()
        const url = yield* normalizedURL(input.url)
        const token = randomBytes(32).toString("base64url")
        const state: StoredState = {
          nodeID,
          status: "forming",
          clusterID: "mesh_" + randomBytes(12).toString("base64url"),
          secret: token,
          ownerNodeID: nodeID,
          members: [{ id: nodeID, url, name: input.name?.trim() || nodeID, joined: Date.now(), ...(input.directory?.trim() ? { directory: input.directory.trim() } : {}) }],
          currentTerm: 0,
          log: [],
          commitIndex: 0,
        }
        yield* save(state)
        return { data: yield* snapshot(state), token }
      }))
    })

    const join = Effect.fn("ServerMesh.join")(function* (input: RoomMesh.JoinInput) {
      if (yield* load()) return yield* new MeshError({ message: "Leave or reset the existing Mesh before joining another", status: 409 })
      const nodeID = yield* localNodeID()
      const seedURL = yield* normalizedURL(input.seedURL)
      const url = yield* normalizedURL(input.url)
      // Base64url invitation tokens contain no whitespace; remove spaces and line breaks from terminal paste.
      const token = input.token.replace(/\s+/g, "")
      if (token.length < 24) return yield* new MeshError({ message: "The Mesh invitation token is incomplete", status: 400 })
      const node: RoomMesh.Node = { id: nodeID, url, name: input.name?.trim() || nodeID, joined: Date.now(), ...(input.directory?.trim() ? { directory: input.directory.trim() } : {}) }
      const invite = yield* callRPC(seedURL, token, { type: "enroll", node })
      if (
        !invite.ok ||
        typeof invite.clusterID !== "string" ||
        typeof invite.ownerNodeID !== "string" ||
        !invite.members ||
        (invite.status !== "forming" && invite.status !== "active")
      )
        return yield* new MeshError({ message: invite.message ?? "The seed did not accept this device", status: 403 })

      // Copy the validated fields to locals before entering a deferred Effect closure.
      const clusterID = invite.clusterID
      const ownerNodeID = invite.ownerNodeID
      const status = invite.status
      const receivedMembers = yield* normalizedMembers(invite.members)
      if (!receivedMembers.some((member) => member.id === nodeID))
        return yield* new MeshError({ message: "The seed response did not include this device", status: 502 })
      // The owner's stored URL can be a virtual adapter (e.g. 198.18.x.x). Use the
      // address that this client actually reached for its local copy of the owner node.
      const members = receivedMembers.map((member) =>
        member.id === ownerNodeID ? { ...member, url: seedURL } : member,
      )
      const voters =
        invite.voters ?? (status === "forming" ? members.map((member) => member.id) : members.filter((member) => member.id !== nodeID).map((member) => member.id))
      return yield* locks.withLock("state")(Effect.gen(function* () {
        if (yield* load()) return yield* new MeshError({ message: "A Mesh was created or joined while this device was connecting", status: 409 })
        const state: StoredState = {
          nodeID,
          status,
          clusterID,
          secret: token,
          ownerNodeID,
          members,
          voters,
          currentTerm: invite.currentTerm ?? 0,
          leaderID: invite.leaderID,
          log: [],
          commitIndex: 0,
        }
        yield* save(state)
        return yield* snapshot(state)
      }))
    })

    // Forget the local Mesh enrollment so the user can join a different room.
    // Membership changes are not yet replicated; peers keep their fixed voter set.
    const leave = Effect.fn("ServerMesh.leave")(function* () {
      return yield* locks.withLock("state")(Effect.gen(function* () {
        const state = yield* load()
        if (state) {
          yield* kv.remove(STATE_KEY)
          electionDeadline.delete(state.clusterID)
          for (const member of state.members) {
            nextIndex.delete(member.id)
            matchIndex.delete(member.id)
            acknowledgedAt.delete(member.id)
          }
        }
        return yield* snapshot()
      }))
    })

    const invite = Effect.fn("ServerMesh.invite")(function* () {
      const state = yield* requireState()
      if (state.nodeID !== state.ownerNodeID)
        return yield* new MeshError({ message: "Only the device that created this Mesh can view its invitation token", status: 403 })
      return { token: state.secret }
    })

    const activate = Effect.fn("ServerMesh.activate")(function* () {
      const prepared = yield* locks.withLock("state")(Effect.gen(function* () {
        const state = yield* requireState()
        if (state.status === "active") return state
        if (state.nodeID !== state.ownerNodeID) return yield* new MeshError({ message: "Only the device that created the Mesh may activate it", status: 403 })
        const members = yield* normalizedMembers(state.members)
        const request: RoomMesh.RpcRequest = { type: "prepare", clusterID: state.clusterID, fromNodeID: state.nodeID, members }
        const results = yield* Effect.all(
          members.filter((member) => member.id !== state.nodeID).map((member) =>
            callRPC(member.url, state.secret, request).pipe(Effect.match({ onFailure: () => ({ member, ok: false }), onSuccess: (reply) => ({ member, ok: reply.ok }) })),
          ),
          { concurrency: "unbounded" },
        )
        if (results.some((result) => !result.ok)) return yield* new MeshError({ message: "Every enrolled device must be online and agree on membership before activation", status: 503 })
        const next: StoredState = { ...state, members, voters: members.map((member) => member.id), preparedHash: membersHash(members) }
        yield* save(next)
        return next
      }))
      if (prepared.status === "active") return yield* snapshot(prepared)
      const request: RoomMesh.RpcRequest = { type: "activate", clusterID: prepared.clusterID, fromNodeID: prepared.nodeID, members: prepared.members }
      const results = yield* Effect.all(
        prepared.members.filter((member) => member.id !== prepared.nodeID).map((member) =>
          callRPC(member.url, prepared.secret, request).pipe(Effect.match({ onFailure: () => ({ member, ok: false }), onSuccess: (reply) => ({ member, ok: reply.ok }) })),
        ),
        { concurrency: "unbounded" },
      )
      const active: StoredState = { ...prepared, voters: prepared.members.map((member) => member.id), status: "active" }
      yield* save(active)
      resetElection(active.clusterID)
      if (results.some((result) => !result.ok)) return yield* new MeshError({ message: "Mesh activation started but not every device confirmed it; reconnect the missing devices and retry activation", status: 503 })
      return yield* snapshot(active)
    })

    const append = Effect.fn("ServerMesh.append")(function* (input: RoomMesh.AppendInput) {
      const event = { id: input.id?.trim() || "evt_" + randomBytes(16).toString("base64url"), kind: input.kind, payload: input.payload }
      if (Buffer.byteLength(JSON.stringify(event.payload), "utf8") > MAX_ENTRY_BYTES) return yield* new MeshError({ message: "Mesh event payload exceeds 128 KB", status: 413 })
      const routed = yield* locks.withLock("state")(Effect.gen(function* () {
        const state = yield* requireState()
        if (state.status !== "active") return yield* new MeshError({ message: "Activate the Mesh after all devices have joined", status: 409 })
        if (state.leaderID === state.nodeID) {
          const entry = yield* appendLeader(state, event, state.nodeID)
          return { kind: "local" as const, entry }
        }
        const leader = state.leaderID ? memberFor(state, state.leaderID) : undefined
        if (!leader) return yield* new MeshError({ message: "The Mesh is electing a coordinator; retry shortly", status: 503 })
        return { kind: "remote" as const, leader, state }
      }))
      if (routed.kind === "local") return routed.entry
      const reply = yield* callRPC(routed.leader.url, routed.state.secret, { type: "propose", clusterID: routed.state.clusterID, fromNodeID: routed.state.nodeID, entry: event })
      if (!reply.ok || !reply.entry) return yield* new MeshError({ message: reply.message ?? "The coordinator did not commit the event; retry with the same event ID", status: 503 })
      return reply.entry
    })

    const feed = Effect.fn("ServerMesh.feed")(function* (after = 0) {
      const state = yield* requireState()
      return { data: state.log.filter((entry) => entry.index > after && entry.index <= state.commitIndex), commitIndex: state.commitIndex }
    })

    // Enrollment is split into a locked planning/persist phase, an unlocked
    // network fan-out, and a locked commit phase. Never hold the local state lock
    // while waiting for another peer: the elected leader may be sending us heartbeats.
    const enrollPeer = Effect.fn("ServerMesh.enrollPeer")(function* (token: string, input: RoomMesh.Node) {
      return yield* enrollmentLocks.withLock("membership")(Effect.gen(function* () {
        const plan = yield* locks.withLock("state")(Effect.gen(function* () {
          const current = yield* requireState()
          if (!secretMatches(token.replace(/\s+/g, ""), current.secret))
            return yield* new MeshError({
              message: "Mesh invitation token does not match this room. Copy the current token from the owner of the selected Mesh.",
              status: 401,
            })
          if (current.nodeID !== current.ownerNodeID || current.status === "unconfigured")
            return yield* new MeshError({ message: "Only the Mesh owner can enroll devices", status: 409 })
          const url = yield* normalizedURL(input.url)
          const node = { ...input, url, name: input.name.trim() || input.id }
          const sameID = current.members.find((member) => member.id === node.id)
          if (sameID && sameID.url !== node.url)
            return yield* new MeshError({ message: "That node ID is already enrolled at another address", status: 409 })
          if (!sameID && (current.members.length >= MAX_MEMBERS || current.members.some((member) => member.url === node.url)))
            return yield* new MeshError({ message: "Mesh already contains this address or has reached its 32-device limit", status: 409 })

          if (current.status === "forming") {
            const members = sameID ? current.members : [...current.members, node].toSorted((a, b) => a.id.localeCompare(b.id))
            const next = members.length === current.members.length ? current : { ...current, members, preparedHash: undefined }
            if (next !== current) yield* save(next)
            return {
              kind: "ready" as const,
              reply: response({
                clusterID: next.clusterID,
                ownerNodeID: next.ownerNodeID,
                status: next.status,
                currentTerm: next.currentTerm,
                leaderID: next.leaderID,
                voters: members.map((member) => member.id),
                members,
              }),
            }
          }

          const voters = voterIDs(current)
          if (!voters.includes(current.nodeID))
            return yield* new MeshError({ message: "Only an existing voter may invite a Mesh learner", status: 403 })
          return {
            kind: "active" as const,
            clusterID: current.clusterID,
            secret: current.secret,
            nodeID: current.nodeID,
            node,
            members: current.members,
            voters,
          }
        }))
        if (plan.kind === "ready") return plan.reply

        const request: RoomMesh.RpcRequest = {
          type: "add-learner",
          clusterID: plan.clusterID,
          fromNodeID: plan.nodeID,
          node: plan.node,
        }
        const peers = plan.members.filter((member) => member.id !== plan.nodeID)
        const results = yield* Effect.all(
          peers.map((member) =>
            callRPC(member.url, plan.secret, request).pipe(
              Effect.match({
                onFailure: () => ({ member, ok: false }),
                onSuccess: (reply) => ({ member, ok: reply.ok }),
              }),
            ),
          ),
          { concurrency: "unbounded" },
        )
        if (results.some((result) => !result.ok)) {
          // Roll back learner entries on peers that accepted before another peer failed.
          // A silent partial roster is not useful, even though learners do not affect quorum.
          const rollback: RoomMesh.RpcRequest = {
            type: "remove-learner",
            clusterID: plan.clusterID,
            fromNodeID: plan.nodeID,
            nodeID: plan.node.id,
          }
          yield* Effect.all(
            peers.map((member) =>
              callRPC(member.url, plan.secret, rollback).pipe(
                Effect.match({ onFailure: () => false, onSuccess: () => true }),
              ),
            ),
            { concurrency: "unbounded" },
          )
          return yield* new MeshError({
            message: "Could not confirm the new worker on every current Mesh device. The owner rolled back reachable peers; keep the invitation token and retry when every existing device is online.",
            status: 503,
          })
        }

        return yield* locks.withLock("state")(Effect.gen(function* () {
          const current = yield* requireState()
          if (
            current.clusterID !== plan.clusterID ||
            current.secret !== plan.secret ||
            current.nodeID !== current.ownerNodeID ||
            current.status !== "active"
          )
            return yield* new MeshError({ message: "The Mesh changed while the device was being invited; retry from the current owner", status: 409 })
          const sameID = current.members.find((member) => member.id === plan.node.id)
          const members = sameID ? current.members : [...current.members, plan.node].toSorted((a, b) => a.id.localeCompare(b.id))
          const next: StoredState = { ...current, members, voters: voterIDs(current) }
          yield* save(next)
          if (next.leaderID === next.nodeID && !sameID) {
            nextIndex.set(plan.node.id, 1)
            matchIndex.delete(plan.node.id)
            acknowledgedAt.delete(plan.node.id)
          }
          return response({
            clusterID: next.clusterID,
            ownerNodeID: next.ownerNodeID,
            status: next.status,
            currentTerm: next.currentTerm,
            leaderID: next.leaderID,
            voters: voterIDs(next),
            members: next.members,
          })
        }))
      }))
    })

    const tick = Effect.fn("ServerMesh.tick")(function* () {
      yield* locks.withLock("state")(Effect.gen(function* () {
        let state = yield* load()
        if (!state || state.status !== "active") return
        if (!voterIDs(state).includes(state.nodeID)) return
        const deadline = electionDeadline.get(state.clusterID)
        if (state.leaderID === state.nodeID) {
          yield* replicate(state)
          return
        }
        if (deadline === undefined) {
          resetElection(state.clusterID)
          return
        }
        if (Date.now() < deadline) return
        const term = state.currentTerm + 1
        state = { ...state, currentTerm: term, votedFor: state.nodeID, leaderID: undefined }
        yield* save(state)
        resetElection(state.clusterID)
        // The callbacks below run after `state` was reassigned, so they read this snapshot instead.
        const candidate = state
        const requests = yield* Effect.all(
          candidate.members.filter((member) => member.id !== candidate.nodeID).map((member) =>
            callRPC(member.url, candidate.secret, { type: "request-vote", clusterID: candidate.clusterID, fromNodeID: candidate.nodeID, term, lastLogIndex: lastIndex(candidate), lastLogTerm: lastTerm(candidate) }).pipe(
              Effect.match({ onFailure: () => ({ member, reply: undefined }), onSuccess: (reply) => ({ member, reply }) }),
            ),
          ),
          { concurrency: "unbounded" },
        )
        const higherTerm = requests.map((result) => result.reply?.currentTerm).find((candidateTerm) => candidateTerm !== undefined && candidateTerm > term)
        if (higherTerm !== undefined) {
          yield* save({ ...state, currentTerm: higherTerm, votedFor: undefined, leaderID: undefined })
          resetElection(state.clusterID)
          return
        }
        const granted = [state.nodeID, ...requests.flatMap((result) => result.reply?.granted && result.reply.currentTerm === term ? [result.member.id] : [])]
        if (!hasQuorum(voterIDs(state), granted)) return
        state = { ...state, leaderID: state.nodeID }
        yield* save(state)
        const now = Date.now()
        matchIndex.set(state.nodeID, lastIndex(state))
        acknowledgedAt.set(state.nodeID, now)
        state.members.filter((member) => member.id !== state.nodeID).forEach((member) => nextIndex.set(member.id, voterIDs(state).includes(member.id) ? lastIndex(state) + 1 : 1))
        yield* replicate(state)
      }))
    })

    yield* tick().pipe(Effect.catch(() => Effect.void), Effect.repeat(Schedule.spaced(Duration.millis(HEARTBEAT_MS))), Effect.forkScoped({ startImmediately: true }))

    return Service.of({
      status: () => load().pipe(Effect.flatMap((state) => snapshot(state))),
      invite,
      create,
      join,
      leave,
      activate,
      append,
      feed,
      rpc: (input, token) =>
        input.type === "enroll"
          ? enrollPeer(token, input.node)
          : locks.withLock("state")(
              Effect.gen(function* () {
                let state = yield* requireState()
                if (!secretMatches(token, state.secret)) return yield* new MeshError({ message: "Mesh credential is invalid", status: 401 })
            if (input.clusterID !== state.clusterID)
              return yield* new MeshError({ message: "This RPC belongs to another Mesh room", status: 403 })
            if (!memberFor(state, input.fromNodeID))
              return yield* new MeshError({ message: "This node is not enrolled in the Mesh", status: 403 })
            if (input.type === "add-learner") {
              if (state.status !== "active" || input.fromNodeID !== state.ownerNodeID || !voterIDs(state).includes(input.fromNodeID))
                return response({ ok: false, message: "Only the active Mesh owner may add a learner" })
              const url = yield* normalizedURL(input.node.url)
              const node = { ...input.node, url, name: input.node.name.trim() || input.node.id }
              const sameID = state.members.find((member) => member.id === node.id)
              if (sameID && sameID.url !== node.url)
                return response({ ok: false, message: "That node ID is already enrolled at another address" })
              if (!sameID && (state.members.length >= MAX_MEMBERS || state.members.some((member) => member.url === node.url)))
                return response({ ok: false, message: "Mesh already contains this address or has reached its 32-device limit" })
              const voters = voterIDs(state)
              const members = sameID ? state.members : [...state.members, node].toSorted((a, b) => a.id.localeCompare(b.id))
              state = { ...state, members, voters }
              yield* save(state)
              if (state.leaderID === state.nodeID && !sameID) {
                nextIndex.set(node.id, 1)
                matchIndex.delete(node.id)
                acknowledgedAt.delete(node.id)
              }
              return response({
                status: state.status,
                currentTerm: state.currentTerm,
                leaderID: state.leaderID,
                voters,
                members,
              })
            }
            if (input.type === "remove-learner") {
              if (state.status !== "active" || input.fromNodeID !== state.ownerNodeID || !voterIDs(state).includes(input.fromNodeID))
                return response({ ok: false, message: "Only the active Mesh owner may remove a learner" })
              if (voterIDs(state).includes(input.nodeID))
                return response({ ok: false, message: "A voting member cannot be removed as a learner" })
              const members = state.members.filter((member) => member.id !== input.nodeID)
              if (members.length !== state.members.length) {
                state = { ...state, members, voters: voterIDs(state) }
                yield* save(state)
              }
              nextIndex.delete(input.nodeID)
              matchIndex.delete(input.nodeID)
              acknowledgedAt.delete(input.nodeID)
              return response({ status: state.status, currentTerm: state.currentTerm, leaderID: state.leaderID, voters: voterIDs(state), members })
            }
            if (input.type === "prepare") {
              if (state.status === "active") {
                const incoming = yield* normalizedMembers(input.members)
                // A joined peer may keep a locally reachable URL for the owner, while
                // preparedHash remains the canonical shared voter-set hash.
                if ((state.preparedHash ?? membersHash(state.members)) !== membersHash(incoming))
                  return response({ ok: false, message: "Active Mesh membership is immutable in this version" })
                return response()
              }
              if (input.fromNodeID !== state.ownerNodeID) return response({ ok: false, message: "Only the Mesh owner may prepare the initial voter set" })
              const incoming = yield* normalizedMembers(input.members)
              if (!incoming.some((member) => member.id === state.nodeID) || !incoming.some((member) => member.id === state.ownerNodeID)) return yield* new MeshError({ message: "Prepared membership must include this node and the owner", status: 400 })
              const reachableOwnerURL = state.members.find((member) => member.id === state.ownerNodeID)?.url
              const members = incoming.map((member) =>
                member.id === state.ownerNodeID && reachableOwnerURL ? { ...member, url: reachableOwnerURL } : member,
              )
              state = { ...state, members, voters: incoming.map((member) => member.id), preparedHash: membersHash(incoming) }
              yield* save(state)
              return response()
            }
            if (input.type === "activate") {
              const incoming = yield* normalizedMembers(input.members)
              if (membersHash(incoming) !== state.preparedHash) return response({ ok: false, message: "Mesh membership was not prepared on this node" })
              const reachableOwnerURL = state.members.find((member) => member.id === state.ownerNodeID)?.url
              const members = incoming.map((member) =>
                member.id === state.ownerNodeID && reachableOwnerURL ? { ...member, url: reachableOwnerURL } : member,
              )
              state = { ...state, members, voters: incoming.map((member) => member.id), status: "active" }
              yield* save(state)
              resetElection(state.clusterID)
              return response()
            }
            if (input.type === "run-ai") {
              const target = memberFor(state, input.targetNodeID)
              if (!target) return yield* new MeshError({ message: "The selected AI worker is not enrolled in the Mesh", status: 404 })
              if (target.id !== state.nodeID) {
                const reply = yield* callRPC(target.url, state.secret, input)
                return reply
              }
              const text = yield* runAI(state, input)
              return response({ text, message: "AI request executed on this Mesh worker" })
            }
            if (input.type === "request-vote") return yield* vote(state, input)
            if (input.type === "append-entries") return yield* appendEntries(state, input)
            if (state.status !== "active") return response({ ok: false, message: "Mesh has not been activated" })
            if (state.leaderID !== state.nodeID) return response({ ok: false, currentTerm: state.currentTerm, message: "This peer is not the current coordinator" })
            const entry = yield* appendLeader(state, input.entry, input.fromNodeID)
            return response({ entry, commitIndex: (yield* load())?.commitIndex ?? state.commitIndex })
          }),
        ),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [KV.node, Session.node] })