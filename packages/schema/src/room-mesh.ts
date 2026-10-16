export * as RoomMesh from "./room-mesh.js"

import { Schema } from "effect"

export const Node = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  name: Schema.String,
  joined: Schema.Number,
  // The project root this device has opened in OpenCode++; used as the default remote-worker workspace.
  directory: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "RoomMesh.Node" })
export interface Node extends Schema.Schema.Type<typeof Node> {}

export const Status = Schema.Literals(["unconfigured", "forming", "active"])
export type Status = typeof Status.Type

export const Entry = Schema.Struct({
  id: Schema.String,
  index: Schema.Number,
  term: Schema.Number,
  kind: Schema.Literals(["message", "task"]),
  payload: Schema.Json,
  originID: Schema.String,
  created: Schema.Number,
}).annotate({ identifier: "RoomMesh.Entry" })
export interface Entry extends Schema.Schema.Type<typeof Entry> {}

export const Snapshot = Schema.Struct({
  nodeID: Schema.String,
  status: Status,
  clusterID: Schema.String.pipe(Schema.optional),
  ownerNodeID: Schema.String.pipe(Schema.optional),
  currentTerm: Schema.Number,
  leaderID: Schema.String.pipe(Schema.optional),
  members: Schema.Array(Node),
  // The active voting set stays fixed while newly joined workers are learners.
  voters: Schema.Array(Schema.String),
  voter: Schema.Boolean,
  logIndex: Schema.Number,
  commitIndex: Schema.Number,
  quorum: Schema.Number,
  leader: Schema.Boolean,
  writable: Schema.Boolean,
}).annotate({ identifier: "RoomMesh.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

export const CreateInput = Schema.Struct({
  url: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  directory: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "RoomMesh.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}

export const JoinInput = Schema.Struct({
  seedURL: Schema.String,
  token: Schema.String,
  url: Schema.String,
  name: Schema.String.pipe(Schema.optional),
  directory: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "RoomMesh.JoinInput" })
export interface JoinInput extends Schema.Schema.Type<typeof JoinInput> {}

export const AppendInput = Schema.Struct({
  id: Schema.String.pipe(Schema.optional),
  kind: Schema.Literals(["message", "task"]),
  payload: Schema.Json,
}).annotate({ identifier: "RoomMesh.AppendInput" })
export interface AppendInput extends Schema.Schema.Type<typeof AppendInput> {}

export const Feed = Schema.Struct({
  data: Schema.Array(Entry),
  commitIndex: Schema.Number,
}).annotate({ identifier: "RoomMesh.Feed" })
export interface Feed extends Schema.Schema.Type<typeof Feed> {}

export const RunAI = Schema.Struct({
  type: Schema.Literal("run-ai"),
  clusterID: Schema.String,
  fromNodeID: Schema.String,
  targetNodeID: Schema.String,
  requestID: Schema.String,
  prompt: Schema.String,
  directory: Schema.String,
  agent: Schema.String.pipe(Schema.optional),
  providerID: Schema.String.pipe(Schema.optional),
  modelID: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "RoomMesh.RunAI" })
export interface RunAI extends Schema.Schema.Type<typeof RunAI> {}

export const RpcRequest = Schema.Union([
  Schema.Struct({ type: Schema.Literal("enroll"), node: Node }),
  Schema.Struct({ type: Schema.Literal("add-learner"), clusterID: Schema.String, fromNodeID: Schema.String, node: Node }),
  Schema.Struct({ type: Schema.Literal("remove-learner"), clusterID: Schema.String, fromNodeID: Schema.String, nodeID: Schema.String }),
  Schema.Struct({ type: Schema.Literal("prepare"), clusterID: Schema.String, fromNodeID: Schema.String, members: Schema.Array(Node) }),
  Schema.Struct({ type: Schema.Literal("activate"), clusterID: Schema.String, fromNodeID: Schema.String, members: Schema.Array(Node) }),
  Schema.Struct({ type: Schema.Literal("request-vote"), clusterID: Schema.String, fromNodeID: Schema.String, term: Schema.Number, lastLogIndex: Schema.Number, lastLogTerm: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("append-entries"), clusterID: Schema.String, fromNodeID: Schema.String, term: Schema.Number, leaderID: Schema.String, prevLogIndex: Schema.Number, prevLogTerm: Schema.Number, entries: Schema.Array(Entry), leaderCommit: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("propose"), clusterID: Schema.String, fromNodeID: Schema.String, entry: Schema.Struct({ id: Schema.String, kind: Schema.Literals(["message", "task"]), payload: Schema.Json }) }),
  RunAI,
]).annotate({ identifier: "RoomMesh.RpcRequest" })
export type RpcRequest = typeof RpcRequest.Type

export const RpcResponse = Schema.Struct({
  ok: Schema.Boolean,
  currentTerm: Schema.Number.pipe(Schema.optional),
  granted: Schema.Boolean.pipe(Schema.optional),
  success: Schema.Boolean.pipe(Schema.optional),
  matchIndex: Schema.Number.pipe(Schema.optional),
  clusterID: Schema.String.pipe(Schema.optional),
  ownerNodeID: Schema.String.pipe(Schema.optional),
  leaderID: Schema.String.pipe(Schema.optional),
  status: Status.pipe(Schema.optional),
  voters: Schema.Array(Schema.String).pipe(Schema.optional),
  members: Schema.Array(Node).pipe(Schema.optional),
  entry: Entry.pipe(Schema.optional),
  commitIndex: Schema.Number.pipe(Schema.optional),
  text: Schema.String.pipe(Schema.optional),
  message: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "RoomMesh.RpcResponse" })
export interface RpcResponse extends Schema.Schema.Type<typeof RpcResponse> {}