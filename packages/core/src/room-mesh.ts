// Pure consensus primitives for the multi-device room control plane.
//
// These functions deliberately do not perform networking or persistence. A server
// integration must persist term/vote/log state before acknowledging RPCs and must
// use hasQuorum/advanceCommitIndex with the same fixed voter set for a term.

export type VoteState = {
  readonly currentTerm: number
  readonly votedFor?: string
}

export type VoteDecision = {
  readonly state: VoteState
  readonly granted: boolean
}

export type LogPosition = {
  readonly index: number
  readonly term: number
}

export function quorumSize(memberCount: number) {
  if (!Number.isSafeInteger(memberCount) || memberCount < 1) {
    throw new RangeError("A mesh voter set must contain at least one member")
  }
  return Math.floor(memberCount / 2) + 1
}

// Count each known voter once. Duplicate ACKs and acknowledgements from unknown
// devices never increase the quorum count.
export function hasQuorum(voters: readonly string[], acknowledgements: readonly string[]) {
  if (voters.length === 0) return false
  const members = new Set(voters)
  if (members.size !== voters.length) {
    throw new RangeError("A mesh voter set cannot contain duplicate node IDs")
  }
  const acknowledged = new Set(acknowledgements.filter((id) => members.has(id)))
  return acknowledged.size >= quorumSize(members.size)
}

// A Raft-style vote decision. A higher term is adopted even when the candidate's
// log is stale; a node may grant at most one vote per term, and only to a candidate
// whose log is at least as up to date as its own.
export function requestVote(input: {
  readonly state: VoteState
  readonly candidateID: string
  readonly candidateTerm: number
  readonly candidateLastLogIndex: number
  readonly candidateLastLogTerm: number
  readonly localLastLogIndex: number
  readonly localLastLogTerm: number
}): VoteDecision {
  if (input.candidateTerm < input.state.currentTerm) {
    return { state: input.state, granted: false }
  }

  const state: VoteState =
    input.candidateTerm > input.state.currentTerm
      ? { currentTerm: input.candidateTerm }
      : input.state

  const upToDate =
    input.candidateLastLogTerm > input.localLastLogTerm ||
    (input.candidateLastLogTerm === input.localLastLogTerm &&
      input.candidateLastLogIndex >= input.localLastLogIndex)
  const mayVote = state.votedFor === undefined || state.votedFor === input.candidateID

  if (!upToDate || !mayVote) return { state, granted: false }

  return {
    state: { currentTerm: input.candidateTerm, votedFor: input.candidateID },
    granted: true,
  }
}

// Advance a leader's committed index using the Raft majority rule. A leader may
// advance to an index only when a majority has replicated it AND that entry belongs
// to the current term. Committing that current-term entry also commits earlier log
// entries in the same contiguous log.
export function advanceCommitIndex(input: {
  readonly currentTerm: number
  readonly currentCommitIndex: number
  readonly voters: readonly string[]
  readonly replicatedIndex: Readonly<Record<string, number>>
  readonly log: readonly LogPosition[]
}) {
  if (input.voters.length === 0) return input.currentCommitIndex

  const maxIndex = input.log.reduce((max, entry) => Math.max(max, entry.index), input.currentCommitIndex)
  for (let index = maxIndex; index > input.currentCommitIndex; index--) {
    const entry = input.log.find((candidate) => candidate.index === index)
    if (!entry || entry.term !== input.currentTerm) continue

    const acknowledgements = input.voters.filter(
      (nodeID) => (input.replicatedIndex[nodeID] ?? 0) >= index,
    )
    if (hasQuorum(input.voters, acknowledgements)) return index
  }

  return input.currentCommitIndex
}
