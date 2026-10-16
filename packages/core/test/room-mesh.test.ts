import { describe, expect, test } from "bun:test"
import { advanceCommitIndex, hasQuorum, quorumSize, requestVote } from "../src/room-mesh"

const voters = ["phone-1", "phone-2", "phone-3", "phone-4", "laptop-1", "laptop-2", "desktop"]

describe("mesh quorum", () => {
  test("seven enrolled devices require four acknowledgements", () => {
    expect(quorumSize(7)).toBe(4)
    expect(hasQuorum(voters, ["phone-1", "phone-2", "phone-3"])).toBe(false)
    expect(hasQuorum(voters, ["phone-1", "phone-2", "phone-3", "desktop"])).toBe(true)
  })

  test("duplicate acknowledgements and unknown nodes do not form a quorum", () => {
    expect(hasQuorum(voters, ["phone-1", "phone-1", "phone-1", "rogue-node"])).toBe(false)
  })

  test("a non-voting learner cannot change the active voter quorum", () => {
    const activeVoters = ["owner", "laptop", "phone"]
    // The learner is in the visible device roster but is deliberately not in activeVoters.
    expect(quorumSize(activeVoters.length)).toBe(2)
    expect(hasQuorum(activeVoters, ["owner", "worker"])).toBe(false)
    expect(hasQuorum(activeVoters, ["owner", "laptop", "worker"])).toBe(true)
  })

  test("rejects an empty or duplicated voter configuration", () => {
    expect(() => quorumSize(0)).toThrow(RangeError)
    expect(() => hasQuorum(["desktop", "desktop"], ["desktop"])).toThrow(RangeError)
    expect(hasQuorum([], ["desktop"])).toBe(false)
  })
})

describe("mesh election", () => {
  test("grants one vote to an up-to-date candidate", () => {
    expect(
      requestVote({
        state: { currentTerm: 3 },
        candidateID: "desktop",
        candidateTerm: 3,
        candidateLastLogIndex: 12,
        candidateLastLogTerm: 3,
        localLastLogIndex: 10,
        localLastLogTerm: 3,
      }),
    ).toEqual({ state: { currentTerm: 3, votedFor: "desktop" }, granted: true })
  })

  test("will not vote twice in the same term", () => {
    const result = requestVote({
      state: { currentTerm: 8, votedFor: "phone-1" },
      candidateID: "desktop",
      candidateTerm: 8,
      candidateLastLogIndex: 20,
      candidateLastLogTerm: 8,
      localLastLogIndex: 20,
      localLastLogTerm: 8,
    })
    expect(result).toEqual({ state: { currentTerm: 8, votedFor: "phone-1" }, granted: false })
  })

  test("allows an idempotent repeat request from the same candidate", () => {
    const result = requestVote({
      state: { currentTerm: 8, votedFor: "desktop" },
      candidateID: "desktop",
      candidateTerm: 8,
      candidateLastLogIndex: 20,
      candidateLastLogTerm: 8,
      localLastLogIndex: 20,
      localLastLogTerm: 8,
    })
    expect(result.granted).toBe(true)
  })

  test("adopts a newer term even when its candidate log is stale", () => {
    const result = requestVote({
      state: { currentTerm: 4, votedFor: "phone-1" },
      candidateID: "desktop",
      candidateTerm: 5,
      candidateLastLogIndex: 4,
      candidateLastLogTerm: 2,
      localLastLogIndex: 6,
      localLastLogTerm: 4,
    })
    expect(result).toEqual({ state: { currentTerm: 5 }, granted: false })
  })

  test("rejects a stale term without mutating the vote", () => {
    const state = { currentTerm: 5, votedFor: "phone-1" }
    const result = requestVote({
      state,
      candidateID: "desktop",
      candidateTerm: 4,
      candidateLastLogIndex: 99,
      candidateLastLogTerm: 99,
      localLastLogIndex: 1,
      localLastLogTerm: 1,
    })
    expect(result).toEqual({ state, granted: false })
  })

  test("rejects a log with an older last term", () => {
    const result = requestVote({
      state: { currentTerm: 6 },
      candidateID: "phone-2",
      candidateTerm: 6,
      candidateLastLogIndex: 100,
      candidateLastLogTerm: 5,
      localLastLogIndex: 1,
      localLastLogTerm: 6,
    })
    expect(result.granted).toBe(false)
  })
})

describe("mesh log commit", () => {
  const log = [
    { index: 1, term: 1 },
    { index: 2, term: 1 },
    { index: 3, term: 2 },
  ]

  test("commits a current-term entry replicated to a majority", () => {
    expect(
      advanceCommitIndex({
        currentTerm: 2,
        currentCommitIndex: 1,
        voters,
        replicatedIndex: {
          "phone-1": 3,
          "phone-2": 3,
          "phone-3": 3,
          "phone-4": 3,
          "laptop-1": 2,
          "laptop-2": 1,
          desktop: 3,
        },
        log,
      }),
    ).toBe(3)
  })

  test("does not commit with only three of seven devices", () => {
    expect(
      advanceCommitIndex({
        currentTerm: 2,
        currentCommitIndex: 1,
        voters,
        replicatedIndex: {
          "phone-1": 3,
          "phone-2": 3,
          "phone-3": 3,
          "phone-4": 1,
          "laptop-1": 1,
          "laptop-2": 1,
          desktop: 1,
        },
        log,
      }),
    ).toBe(1)
  })

  test("will not directly commit an old-term entry, even with a majority", () => {
    expect(
      advanceCommitIndex({
        currentTerm: 2,
        currentCommitIndex: 0,
        voters,
        replicatedIndex: Object.fromEntries(voters.map((nodeID) => [nodeID, 2])),
        log: [
          { index: 1, term: 1 },
          { index: 2, term: 1 },
        ],
      }),
    ).toBe(0)
  })
})
