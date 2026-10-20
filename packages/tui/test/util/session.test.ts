import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { isRateLimitedTurnPending, lastAssistantWithUsage, sessionFamily } from "../../src/util/session"

const assistant = (id: string, input: number): Extract<SessionMessageInfo, { type: "assistant" }> => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [],
  tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0 },
})

describe("util.session", () => {
  test("only offers continuation for the latest unresolved rate-limit error", () => {
    const limited: SessionMessageInfo = {
      ...assistant("msg_limited", 0),
      error: { type: "provider.rate-limit", message: "Rate limit reached" },
    }
    const user: SessionMessageInfo = { id: "msg_user", type: "user", text: "Already continued", time: { created: 1 } }

    expect(isRateLimitedTurnPending([limited], "msg_limited")).toBe(true)
    expect(isRateLimitedTurnPending([limited, user], "msg_limited")).toBe(false)
    expect(isRateLimitedTurnPending([limited, assistant("msg_after", 1)], "msg_limited")).toBe(false)
    expect(isRateLimitedTurnPending([assistant("msg_other", 1)], "msg_other")).toBe(false)
    expect(isRateLimitedTurnPending([limited], "msg_missing")).toBe(false)
  })

  test("flattens nested subagents from any session in the family", () => {
    const sessions = [
      { id: "root" },
      { id: "child-a", parentID: "root" },
      { id: "grandchild-a", parentID: "child-a" },
      { id: "great-grandchild-a", parentID: "grandchild-a" },
      { id: "grandchild-a2", parentID: "child-a" },
      { id: "child-b", parentID: "root" },
      { id: "grandchild-b", parentID: "child-b" },
    ]

    expect(sessionFamily(sessions, "great-grandchild-a")).toEqual([
      { session: sessions[1], prefix: "" },
      { session: sessions[2], prefix: "├─ " },
      { session: sessions[3], prefix: "│  └─ " },
      { session: sessions[4], prefix: "└─ " },
      { session: sessions[5], prefix: "" },
      { session: sessions[6], prefix: "└─ " },
    ])
  })

  test("tracks usage across undo and redo boundaries", () => {
    const messages = [assistant("msg_z", 10), assistant("msg_a", 30)]

    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
    expect(lastAssistantWithUsage(messages, "msg_a")?.tokens.input).toBe(10)
    expect(lastAssistantWithUsage(messages, "msg_missing")).toBeUndefined()
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
  })

  test("resets usage at completed compaction until the next assistant reports it", () => {
    const compaction: SessionMessageInfo = {
      id: "msg_compaction",
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "Current state",
      recent: "",
      time: { created: 0 },
    }
    const messages = [assistant("msg_before", 30), compaction]

    expect(lastAssistantWithUsage(messages)).toBeUndefined()

    messages.push(assistant("msg_after", 5))
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(5)
  })
})
