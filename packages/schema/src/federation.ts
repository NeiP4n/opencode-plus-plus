export * as Federation from "./federation.js"

import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { ProjectID } from "./orchestra.js"
import { statics } from "./schema.js"

// A federation is a room whose members are projects. Each project keeps its own rules and
// access; projects never touch each other's sessions or files. They only exchange tickets,
// from the sending project's orchestrator to the receiving project's orchestrator.

// What a project shows to the other projects of the room.
//   hidden  — it is not listed
//   summary — name and progress of its definition of done
//   read    — also its public notes and contracts
export const Visibility = Schema.Literals(["hidden", "summary", "read"]).annotate({
  identifier: "Federation.Visibility",
})
export type Visibility = typeof Visibility.Type

// What one project may ask of another.
//   question — read-only: answered from what the receiver exposes
//   request  — asks the receiver to change something; always waits for a human on the receiving side
//   contract — publishes an agreed interface (API shape, schema) for the receiver to store as a note
export const Kind = Schema.Literals(["question", "request", "contract"]).annotate({ identifier: "Federation.Kind" })
export type Kind = typeof Kind.Type

export const Status = Schema.Literals(["pending", "accepted", "rejected", "answered", "done", "expired"]).annotate({
  identifier: "Federation.Status",
})
export type Status = typeof Status.Type

// One rule on the receiving side: a peer project and the kinds of ticket it may send.
// Only questions can be answered without a human; see `autoAnswers`.
export const Grant = Schema.Struct({
  peer: ProjectID,
  allow: Schema.Array(Kind),
  autoAnswer: Schema.Boolean.pipe(Schema.optional),
}).annotate({ identifier: "Federation.Grant" })
export interface Grant extends Schema.Schema.Type<typeof Grant> {}

// A project's side of the agreement. A peer without a grant may do nothing.
export const Policy = Schema.Struct({
  project: ProjectID,
  visibility: Visibility,
  grants: Schema.Array(Grant),
  // Tickets a peer may keep open at once, so one project cannot flood another's orchestrator.
  maxOpen: Schema.Number.pipe(Schema.optional),
}).annotate({ identifier: "Federation.Policy" })
export interface Policy extends Schema.Schema.Type<typeof Policy> {}

// A named set of projects the operator keeps together, such as "Shop" for its web, API and
// mobile projects. Linking a group links every pair in it.
export const Group = Schema.Struct({
  name: Schema.String,
  projects: Schema.Array(ProjectID),
}).annotate({ identifier: "Federation.Group" })
export interface Group extends Schema.Schema.Type<typeof Group> {}

// Every unordered pair of a group's projects.
export function pairs<T>(items: ReadonlyArray<T>): ReadonlyArray<readonly [T, T]> {
  return items.flatMap((first, index) => items.slice(index + 1).map((second) => [first, second] as const))
}

// What linking two projects grants each other: they appear to each other, and may ask
// questions. Anything beyond that stays the operator's explicit choice.
export function linkPolicy(policy: Policy, peer: ProjectID): Policy {
  const grant = grantOf(policy, peer)
  return {
    ...policy,
    visibility: policy.visibility === "hidden" ? "summary" : policy.visibility,
    grants: [
      ...policy.grants.filter((item) => item.peer !== peer),
      grant ? { ...grant, allow: [...new Set([...grant.allow, "question" as const])] } : { peer, allow: ["question"] },
    ],
  }
}

// Takes back everything linking gave and everything granted since: the peer is no longer known to this project.
export function unlinkPolicy(policy: Policy, peer: ProjectID): Policy {
  return { ...policy, grants: policy.grants.filter((item) => item.peer !== peer) }
}

export const TicketID =Schema.String.check(Schema.isStartsWith("tkt_")).pipe(
  Schema.brand("FederationTicketID"),
  statics((schema) => ({ create: () => schema.make("tkt_" + ascending()) })),
)
export type TicketID = typeof TicketID.Type

export const Ticket = Schema.Struct({
  id: TicketID,
  from: ProjectID,
  to: ProjectID,
  kind: Kind,
  subject: Schema.String,
  body: Schema.String,
  status: Status,
  // Projects this ticket already passed through, oldest first. A receiver that finds itself
  // here must not forward it again, which ends A → B → A loops.
  chain: Schema.Array(ProjectID),
  answer: Schema.String.pipe(Schema.optional),
  created: Schema.Number,
  updated: Schema.Number,
}).annotate({ identifier: "Federation.Ticket" })
export interface Ticket extends Schema.Schema.Type<typeof Ticket> {}

export const defaultMaxOpen = 5
// A ticket may be forwarded this many times; longer chains are almost always a loop.
export const maxChain = 3

export const defaultPolicy = (project: ProjectID): Policy => ({ project, visibility: "hidden", grants: [] })

export function grantOf(policy: Policy, peer: ProjectID) {
  return policy.grants.find((grant) => grant.peer === peer)
}

export function allows(policy: Policy, peer: ProjectID, kind: Kind) {
  return grantOf(policy, peer)?.allow.includes(kind) ?? false
}

// Whether the receiver may answer or act without asking its human first. Only questions
// qualify, and only when the receiver granted it: a request or contract changes the
// receiving project, so a person there always decides.
export function autoAnswers(policy: Policy, peer: ProjectID, kind: Kind) {
  return kind === "question" && grantOf(policy, peer)?.autoAnswer === true && allows(policy, peer, kind)
}

export type Refusal = "no-grant" | "kind-not-allowed" | "too-many-open" | "loop" | "chain-too-long" | "self"

// The receiver's policy decides, not the sender's claim about itself: this runs on the
// receiving side before a ticket reaches its orchestrator.
export function admit(
  policy: Policy,
  ticket: Pick<Ticket, "from" | "to" | "kind" | "chain">,
  openFromPeer: number,
): Refusal | undefined {
  if (ticket.from === ticket.to) return "self"
  if (!grantOf(policy, ticket.from)) return "no-grant"
  if (!allows(policy, ticket.from, ticket.kind)) return "kind-not-allowed"
  if (ticket.chain.includes(ticket.to)) return "loop"
  if (ticket.chain.length > maxChain) return "chain-too-long"
  if (openFromPeer >= (policy.maxOpen ?? defaultMaxOpen)) return "too-many-open"
  return undefined
}
