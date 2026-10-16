export * as PeerTool from "./peer.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { randomUUID } from "node:crypto"
import { Effect, Option, Schema } from "effect"
import { Peer } from "../../peer.js"
import { KV } from "../../kv.js"
import { Session } from "../../session.js"
import type { Room } from "@opencode/schema/room"
import { RoomMesh } from "@opencode/schema/room-mesh"
import { Permission } from "../../permission.js"

export const name = "peers"

const MESH_STATE_KEY = "room-mesh/state"
const MeshToolState = Schema.Struct({
  nodeID: Schema.String,
  status: RoomMesh.Status,
  clusterID: Schema.String,
  secret: Schema.String,
  ownerNodeID: Schema.String,
  members: Schema.Array(RoomMesh.Node),
  voters: Schema.Array(Schema.String).pipe(Schema.optional),
  currentTerm: Schema.Number,
  leaderID: Schema.String.pipe(Schema.optional),
})

const description = [
  "Work together with the AI on another computer: the rooms this computer joined over the network, each a project or session another person hosts with their own AI.",
  "Actions: list shows the rooms, what you may do in each and their sessions;",
  "read returns a room session's latest messages;",
  "send gives the AI in a room session a task or a question; its answer comes back to you automatically as a <peer-report> message, so end your turn instead of waiting;",
  "create starts a new session in a project room, optionally with a first task sent the same way;",
  "passport describes the other computer: its system, shells, installed tools, the project's branch and commit, and the plots (участки) teams hold there, so you know what it can check that this computer cannot;",
  "run executes one command on the other computer in the project; cohosts need host approval, while a Trusted member is allowed to run it without per-command confirmation.",
  "dod shows the host project's Definition of Done as the room's shared work queue: every item, its stage, state, checked steps, who in the room took it, what it waits for and its check;",
  "take claims a DoD item for you so nobody else in the room starts it: pass item, or omit it to get the first item that is free and whose dependencies are done; pass paths the work will change to hold them as a plot. The answer includes the item's handover note from whoever worked on it before. Then do it, yourself or through send to the AI there;",
  "submit hands an item you hold to the host's check: the host runs the item's verification.command in its project, and exit code 0 makes it DONE with evidence while anything else makes it FAILED with the output; pass text as a handover of what you did;",
  "release gives an item you took back when you stop working on it; pass text as a handover: what is done, the dead ends, the next step;",
  "feed shows what happened in the room lately: joins, items taken, given back, expired, passed or failed, commands run. If the host frees your item or someone takes it over, you hear of it as a <room-event>.",
  "Respect plots and owners: do not ask the other AI to change files inside a plot another team holds, and do not work on a DoD item someone else took.",
  "Pass room as the room ID from list, and sessionID to pick a session other than the room's own.",
  "Write to the other AI as to a capable colleague: say what you need, what you already know, and what the answer should contain.",
  "Mesh is a separate device-to-device AI network. mesh-list shows enrolled computers, node IDs, voter/worker roles and each computer\'s advertised project root.",
  "mesh-run starts a fresh AI session on the selected Mesh computer using that computer\'s own provider credentials and model configuration. Pass node as its name or ID from mesh-list and text as the task; directory overrides the advertised project root.",
  "Use mesh-run when another computer\'s OS, tools, files, GPU or AI credentials help. The destination AI can use the same peers tool to delegate further. Remote execution asks the operator for permission.",
  "Do not assume project paths are identical between computers. Prefer the path displayed by mesh-list; if a path is not advertised, establish it before dispatching work.",
].join("\\n")

export const Input = Schema.Struct({
  action: Schema.Literals([
    "list",
    "read",
    "send",
    "create",
    "passport",
    "run",
    "dod",
    "take",
    "submit",
    "release",
    "feed",
    "mesh-list",
    "mesh-run",
  ]),
  room: Schema.optionalKey(Schema.String).annotate({ description: "Room ID from list, for read, send and create" }),
  sessionID: Schema.optionalKey(Schema.String).annotate({
    description: "Session of the room for read and send; the room's own session when omitted",
  }),
  text: Schema.optionalKey(Schema.String).annotate({
    description:
      "Message for send, the first task for create, the command for run, or the handover for submit and release",
  }),
  title: Schema.optionalKey(Schema.String).annotate({ description: "Title of the session to create" }),
  item: Schema.optionalKey(Schema.String).annotate({
    description: "DoD item ID for take, submit and release, such as L-002; take without it picks the next ready item",
  }),
  paths: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "Project files or folders the item's work changes, held as a plot for take",
  }),
  limit: Schema.optionalKey(Schema.Int).annotate({ description: "How many recent messages read returns (default 10)" }),
  node: Schema.optionalKey(Schema.String).annotate({
    description: "Mesh computer name or node ID from mesh-list; required for mesh-run",
  }),
  directory: Schema.optionalKey(Schema.String).annotate({
    description: "Absolute project path on the remote computer; defaults to its advertised project directory",
  }),
  agent: Schema.optionalKey(Schema.String).annotate({ description: "Optional agent ID configured on the remote computer" }),
  providerID: Schema.optionalKey(Schema.String).annotate({ description: "Optional provider ID configured on the remote computer" }),
  modelID: Schema.optionalKey(Schema.String).annotate({ description: "Optional model ID configured on the remote computer" }),
})

export const Output = Schema.Struct({ output: Schema.String })

export const Plugin = {
  id: "opencode.tool.peer",
  effect: Effect.fn("PeerTool.Plugin")(function* (ctx: Context) {
    const peers = yield* Peer.Service
    const permission = yield* Permission.Service
    const kv = yield* KV.Service
    const sessions = yield* Session.Service

    const meshState = Effect.fnUntraced(function* () {
      const value = yield* kv.get(MESH_STATE_KEY)
      if (value === undefined) return undefined
      return Option.getOrUndefined(Schema.decodeUnknownOption(MeshToolState)(value))
    })

    const linkOf = Effect.fnUntraced(function* (room: string | undefined) {
      if (!room) return yield* new ToolFailure({ message: "Pass room, the room ID from list" })
      const link = (yield* peers.links()).find((item) => item.roomID === room)
      if (!link) return yield* new ToolFailure({ message: `No joined room ${room}. List the rooms first.` })
      return link
    })

    const failed = (error: Peer.PeerError) => new ToolFailure({ message: error.message })

    const listMesh = Effect.fnUntraced(function* () {
      const state = yield* meshState()
      if (!state) return "This computer has not joined a Mesh. Create or join one from Multiplayer first."
      const voters = state.voters ?? state.members.map((member) => member.id)
      const quorum = Math.floor(voters.length / 2) + 1
      return [
        `Mesh ${state.clusterID} · ${state.status} · local node ${state.nodeID} · coordinator ${state.leaderID ?? "not elected"}`,
        `Voter quorum: ${quorum}/${voters.length}. Workers can run tasks but cannot vote or increase quorum.`,
        ...state.members.map((member) => {
          const role = voters.includes(member.id) ? "Voter" : "Worker"
          const local = member.id === state.nodeID ? " · this computer" : ""
          const directory = member.directory ? ` · project: ${member.directory}` : " · project path not advertised"
          return `- ${member.name} · node ${member.id} · ${role} · ${member.url}${directory}${local}`
        }),
        "To delegate AI work, call peers with action=mesh-run, node=<name or node ID>, and text=<task>. It runs on that computer with its own configured AI provider and returns the result.",
      ].join("\\n")
    })

    const list = Effect.fnUntraced(function* () {
      const links = yield* peers.links()
      if (links.length === 0) return "This computer has not joined any room. The operator joins one with Connect."
      const rooms = yield* Effect.forEach(links, (link) =>
        Effect.all([peers.joined(link), peers.sessions(link)]).pipe(
          Effect.map(([joined, sessions]) =>
            [
              `${link.name} · room ${link.roomID} · you are ${joined.role} as ${link.guest}${joined.room.directory ? " · whole project" : ""}`,
              ...sessions.map(
                (session) =>
                  `- ${session.title ?? "(untitled)"} ${session.id}${session.id === joined.session.id ? " (the room's own)" : ""}`,
              ),
            ].join("\n"),
          ),
          Effect.catch((error) => Effect.succeed(`${link.name} · room ${link.roomID} · unreachable: ${error.message}`)),
        ),
      )
      return rooms.join("\n\n")
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
              // Anything leaving for another computer asks the operator first.
              const ask = (resource: string, link?: Peer.Link) =>
                Effect.gen(function* () {
                  if (link) {
                    const joined = yield* peers.joined(link).pipe(
                      Effect.match({
                        onFailure: () => undefined,
                        onSuccess: (value) => value,
                      }),
                    )
                    // Trusted means the destination admitted this device for unattended delegation.
                    if (joined?.role === "trusted") return
                  }
                  yield* permission.assert({
                    action: name,
                    resources: [resource],
                    save: ["*"],
                    metadata: input,
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.messageID, id: context.id },
                  })
                })
              const send = (link: Peer.Link, text: string, sessionID?: string) =>
                peers
                  .send({ link, sessionID, text: wrap(link, text), from: context.sessionID })
                  .pipe(Effect.mapError(failed))

              switch (input.action) {
                case "list":
                  return { output: yield* list() }
                case "read": {
                  const link = yield* linkOf(input.room)
                  const chat = yield* peers.chat(link, input.sessionID).pipe(Effect.mapError(failed))
                  const lines = chat.data
                    .slice(-(input.limit ?? 10))
                    .map(
                      (message) =>
                        `[${message.role === "assistant" ? "AI" : (message.author ?? "host")}] ${message.text}`,
                    )
                  return {
                    output: [
                      ...(lines.length > 0 ? lines : ["The session has no messages yet."]),
                      ...(chat.running ? ["(the AI there is working right now)"] : []),
                    ].join("\n\n"),
                  }
                }
                case "send": {
                  const link = yield* linkOf(input.room)
                  if (!input.text?.trim()) return yield* new ToolFailure({ message: "Pass the message as text" })
                  yield* ask(link.name, link)
                  const session = yield* send(link, input.text, input.sessionID)
                  return {
                    output: `Sent to ${link.name} · ${session.title ?? session.id}. The answer will arrive here as a <peer-report> when that AI finishes.`,
                  }
                }
                case "passport": {
                  const link = yield* linkOf(input.room)
                  const passport = yield* peers.passport(link).pipe(Effect.mapError(failed))
                  return { output: describePassport(link, passport) }
                }
                case "run": {
                  const link = yield* linkOf(input.room)
                  if (!input.text?.trim()) return yield* new ToolFailure({ message: "Pass the command as text" })
                  yield* ask(link.name, link)
                  const result = yield* peers
                    .run({ link, command: input.text, sessionID: input.sessionID })
                    .pipe(Effect.mapError(failed))
                  return {
                    output: [
                      `Ran on ${link.name} with ${result.shell}, exit code ${result.exitCode}${result.cut ? " (output cut to its end)" : ""}:`,
                      result.output || "(no output)",
                    ].join("\n"),
                  }
                }
                case "dod": {
                  const link = yield* linkOf(input.room)
                  const dod = yield* peers.dod(link).pipe(Effect.mapError(failed))
                  return { output: describeDod(link, dod) }
                }
                case "take": {
                  const link = yield* linkOf(input.room)
                  yield* ask(link.name, link)
                  const item = input.item?.trim()
                  const dod = yield* peers
                    .claim({
                      link,
                      ...(item ? { id: item } : { next: true }),
                      take: true,
                      sessionID: input.sessionID,
                      paths: input.paths,
                      from: context.sessionID,
                    })
                    .pipe(Effect.mapError(failed))
                  const taken = dod.taken ?? item
                  return {
                    output: [
                      `${taken} is yours in ${link.name}${input.paths?.length ? `, with a plot over ${input.paths.join(", ")}` : ""}. Submit it when its check should pass; release it with a handover if you stop.`,
                      dod.note
                        ? `Handover note ${dod.note.name} from earlier work on it:\n${dod.note.text.trim()}`
                        : "Nobody left a handover note on it.",
                      describeDod(link, dod),
                    ].join("\n\n"),
                  }
                }
                case "submit": {
                  const link = yield* linkOf(input.room)
                  const item = input.item?.trim()
                  if (!item) return yield* new ToolFailure({ message: "Pass item, the DoD item ID you hold" })
                  yield* ask(link.name, link)
                  const dod = yield* peers
                    .submit({ link, id: item, handover: input.text?.trim() || undefined, from: context.sessionID })
                    .pipe(Effect.mapError(failed))
                  const check = dod.check
                  return {
                    output: [
                      check?.exitCode === 0
                        ? `${item} passed the host's check and is DONE in ${link.name}.`
                        : `${item} failed the host's check (exit code ${check?.exitCode}) and is FAILED; fix it and submit again.`,
                      check?.output.trim() || "(the check printed nothing)",
                    ].join("\n\n"),
                  }
                }
                case "release": {
                  const link = yield* linkOf(input.room)
                  const item = input.item?.trim()
                  if (!item) return yield* new ToolFailure({ message: "Pass item, the DoD item ID from dod" })
                  const dod = yield* peers
                    .claim({
                      link,
                      id: item,
                      take: false,
                      sessionID: input.sessionID,
                      handover: input.text?.trim() || undefined,
                      from: context.sessionID,
                    })
                    .pipe(Effect.mapError(failed))
                  return { output: [`${item} is free again in ${link.name}.`, describeDod(link, dod)].join("\n\n") }
                }
                case "feed": {
                  const link = yield* linkOf(input.room)
                  const feed = yield* peers.feed(link).pipe(Effect.mapError(failed))
                  return { output: describeFeed(link, feed, input.limit ?? 20) }
                }
                case "mesh-list": {
                  return { output: yield* listMesh() }
                }
                case "mesh-run": {
                  const state = yield* meshState()
                  if (!state || state.status !== "active")
                    return yield* new ToolFailure({ message: "Mesh is not active on this computer. Create or join a Mesh and activate it first." })
                  const selector = input.node?.trim()
                  if (!selector) return yield* new ToolFailure({ message: "Pass node, a computer name or node ID from mesh-list." })
                  const target = state.members.find(
                    (member) => member.id === selector || member.name.toLocaleLowerCase() === selector.toLocaleLowerCase(),
                  )
                  if (!target) return yield* new ToolFailure({ message: `No Mesh node named or identified as "${selector}". Run mesh-list first.` })
                  if (!input.text?.trim()) return yield* new ToolFailure({ message: "Pass text with the task for the remote AI." })
                  const session = yield* sessions.get(context.sessionID)
                  const directory = input.directory?.trim() || target.directory || session.location.directory
                  yield* ask(`mesh:${target.name}`)
                  const request: RoomMesh.RunAI = {
                    type: "run-ai",
                    clusterID: state.clusterID,
                    fromNodeID: state.nodeID,
                    targetNodeID: target.id,
                    requestID: randomUUID(),
                    prompt: input.text.trim(),
                    directory,
                    ...(input.agent?.trim() ? { agent: input.agent.trim() } : {}),
                    ...(input.providerID?.trim() ? { providerID: input.providerID.trim() } : {}),
                    ...(input.modelID?.trim() ? { modelID: input.modelID.trim() } : {}),
                  }
                  const remoteText = yield* Effect.tryPromise({
                    try: async (signal) => {
                      const result = await fetch(new URL("/api/room/mesh/rpc", target.url), {
                        method: "POST",
                        headers: {
                          authorization: "Bearer " + state.secret,
                          "content-type": "application/json",
                        },
                        body: JSON.stringify(request),
                        signal,
                      })
                      const body = await result.text()
                      let reply: RoomMesh.RpcResponse
                      try {
                        reply = body ? JSON.parse(body) as RoomMesh.RpcResponse : { ok: false }
                      } catch {
                        throw new Error(`Mesh worker ${target.name} returned invalid JSON (HTTP ${result.status})`)
                      }
                      if (!result.ok || !reply.ok)
                        throw new Error(reply.message ?? `Mesh worker ${target.name} failed with HTTP ${result.status}`)
                      if (typeof reply.text !== "string")
                        throw new Error(reply.message ?? `Mesh worker ${target.name} returned no AI text`)
                      return reply.text
                    },
                    catch: (error) => new ToolFailure({
                      message: error instanceof Error ? error.message : String(error),
                    }),
                  })
                  return {
                    output: [
                      `Remote AI result from ${target.name} (${target.id})`,
                      `Project: ${directory}`,
                      remoteText,
                    ].join("\\n\\n"),
                  }
                }
                case "create": {
                  const link = yield* linkOf(input.room)
                  yield* ask(link.name, link)
                  const created = yield* peers
                    .create(link, input.title?.trim() || undefined)
                    .pipe(Effect.mapError(failed))
                  if (input.text?.trim()) yield* send(link, input.text, created.id)
                  return {
                    output: `Created ${created.id} in ${link.name}${input.text?.trim() ? "; its answer will arrive here as a <peer-report>" : ""}.`,
                  }
                }
              }
            }).pipe(
              Effect.map((output) => ({ output, content: output.output })),
              // A declined permission ends the action like any other failure, with its reason.
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: error.message, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)

    // Sessions on a computer that joined no room never see the tool, and the rest learn
    // which rooms exist with every request; the roster is stable, so the prompt caches.
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (!event.tools[name]) return
        const links = yield* peers.links()
        const mesh = yield* meshState()
        if (links.length === 0 && !mesh) {
          delete event.tools[name]
          return
        }
        event.system.push({
          type: "text",
          text: [
            "# Other computers and Mesh",
            ...(links.length
              ? [
                  "Normal rooms reachable through the peers tool:",
                  ...links.map((link) => `- ${link.name} · room ${link.roomID} · you are ${link.guest} there`),
                ]
              : []),
            ...(mesh
              ? [
                  "Mesh is connected on this computer.",
                  `Mesh ID: ${mesh.clusterID}; state: ${mesh.status}; local node: ${mesh.nodeID}; coordinator: ${mesh.leaderID ?? "not elected"}.`,
                  "Use peers action=mesh-list to inspect the roster and project paths. Use peers action=mesh-run with node and text to delegate a task to that computer's local AI. Remote execution requires permission approval and uses credentials configured on the worker.",
                  ...mesh.members.map((member) =>
                    `- ${member.name} · ${member.id} · ${(mesh.voters ?? mesh.members.map((item) => item.id)).includes(member.id) ? "voter" : "worker"} · ${member.directory ?? "project path unknown"}`
                  ),
                ]
              : []),
          ].join("\n"),
        })
      }),
    )
    const hide = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        if (!event.tools[name]) return
        const links = yield* peers.links()
        const mesh = yield* meshState()
        if (links.length === 0 && !mesh) delete event.tools[name]
      })
    yield* ctx.session.hook("compaction", hide)
    yield* ctx.session.hook("generate", hide)
  }),
}

function describePassport(link: Peer.Link, passport: Room.Passport) {
  return [
    `${link.name}: ${passport.machine} · ${passport.os} ${passport.release} ${passport.arch}`,
    `Shells: ${passport.shells.join(", ") || "none found"}`,
    `Tools: ${passport.tools.join(", ") || "none from the Registry"}`,
    `Project ${passport.project.directory}${passport.project.branch ? ` on ${passport.project.branch} at ${passport.project.commit}` : ""}${passport.project.changed ? `, ${passport.project.changed} file(s) changed and not committed` : ""}`,
    passport.plots.length === 0
      ? "No plots are taken there."
      : [
          "Plots taken there:",
          ...passport.plots.map(
            (plot) =>
              `- ${plot.paths.join(", ")} · ${plot.team} on ${plot.machine} · ${plot.purpose} · until ${new Date(plot.expires).toLocaleTimeString()}`,
          ),
        ].join("\n"),
  ].join("\n")
}

const DOD_MARK: Record<string, string> = {
  DONE: "✓",
  IN_PROGRESS: "●",
  BLOCKED: "!",
  FAILED: "✗",
  OUT_OF_SCOPE: "–",
}

function describeDod(link: Peer.Link, dod: Room.Dod) {
  if (dod.items.length === 0) return `${link.name} has no DoD (.opencode/dod.yaml) in its project.`
  const done = dod.items.filter((item) => item.state === "DONE" || item.state === "OUT_OF_SCOPE").length
  const stages = [...new Set(dod.items.map((item) => item.stage))]
  return [
    `DoD of ${link.name}: ${done}/${dod.items.length} done. Free items have no owner; yours say "you".`,
    ...stages.flatMap((stage) => [
      `## ${stage}`,
      ...dod.items
        .filter((item) => item.stage === stage)
        .map(
          (item) =>
            `${DOD_MARK[item.state] ?? "·"} ${item.id} [${item.state}${item.total > 0 ? ` ${item.done}/${item.total}` : ""}] ${item.what}${item.owner ? ` — ${item.mine ? "you" : item.owner}${item.stale ? " (lease ran out, free to take)" : ""}` : ""}${item.waits ? ` · waits for ${item.waits.join(", ")}` : ""}${item.verify ? ` · check: ${item.verify}` : ""}`,
        ),
    ]),
  ].join("\n")
}

const FEED_VERB: Record<Room.EventKind, string> = {
  join: "joined",
  leave: "left",
  remove: "was removed",
  ban: "was banned",
  take: "took",
  release: "gave back",
  expire: "lost by lease",
  pass: "passed the check of",
  fail: "failed the check of",
  run: "ran",
}

function describeFeed(link: Peer.Link, feed: Room.Feed, limit: number) {
  if (feed.events.length === 0) return `Nothing has happened in ${link.name} since its host started.`
  return [
    `Latest in ${link.name}:`,
    ...feed.events
      .slice(-limit)
      .map(
        (event) =>
          `${new Date(event.at).toLocaleTimeString()} ${event.who === link.guest ? "you" : event.who} ${FEED_VERB[event.kind]}${event.item ? ` ${event.item}` : ""}${event.detail ? `: ${event.detail}` : ""}`,
      ),
  ].join("\n")
}

// The AI on the other side learns who writes and that its final answer travels back.
function wrap(link: Peer.Link, text: string) {
  return [
    `<peer-message from="${link.guest}'s AI">`,
    text,
    "</peer-message>",
    "This comes from the AI of another computer working with you through this shared room. Do the task or answer it; your final answer is sent back to that AI automatically.",
  ].join("\n")
}
