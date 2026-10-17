import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { chatTurns, outlinePrompt, parseTopics, topicOutline, turnOutline } from "../../../src/routes/session/outline"

function assistant(id: string, content: SessionMessageAssistant["content"]) {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "test", id: "test" },
    time: { created: 0, completed: 1 },
    content,
  } as SessionMessageAssistant
}

const user = (id: string, text: string): SessionMessageInfo => ({ id, type: "user", text, time: { created: 0 } })

const messages: SessionMessageInfo[] = [
  user("u1", "Привет"),
  assistant("a1", [{ type: "text", text: "Привет! Чем помочь?" }]),
  user("u2", "почини логин"),
  assistant("a2", [
    {
      type: "tool",
      id: "t1",
      name: "bash",
      time: { created: 0 },
      state: { status: "completed", input: { command: "bun test" }, content: [{ type: "text", text: "" }] },
    },
    { type: "text", text: "Исправил токен." },
  ]),
  user("u3", "а тесты?"),
  assistant("a3", [{ type: "text", text: "Добавил." }]),
  user("u4", "теперь сделай тёмную тему"),
]

test("collects each request with its final answer and tools", () => {
  const turns = chatTurns(messages)
  expect(turns.map((turn) => turn.messageIDs)).toEqual([["u1", "a1"], ["u2", "a2"], ["u3", "a3"], ["u4"]])
  expect(turns[1]).toMatchObject({ user: "почини логин", answer: "Исправил токен.", tools: ["shell"] })
  const prompt = outlinePrompt(turns, [], "ru")
  expect(prompt).toContain("Russian")
  expect(prompt).toContain("2. User: почини логин")
  expect(prompt).toContain("   Tools: shell")
})

test("groups turns into the model's topics and keeps new turns in the last topic", () => {
  const turns = chatTurns(messages)
  const topics = parseTopics(
    'Here: ```json\n[{"title":"Починка логина","from":2,"sections":[{"title":"Тесты","at":3},{"title":"Чужой","at":9}]},{"title":"","from":3}]\n```',
    3,
  )
  expect(topics).toEqual([{ title: "Починка логина", from: 1, sections: [{ title: "Тесты", at: 3 }] }])

  const outline = topicOutline(topics, turns)
  expect(outline).toHaveLength(1)
  expect(outline[0]).toMatchObject({ title: "Починка логина", ref: { messageID: "u1", partID: "message" } })
  expect(outline[0].messageIDs).toEqual(["u1", "a1", "u2", "a2", "u3", "a3", "u4"])
  expect(outline[0].entries).toMatchObject([{ title: "Тесты", ref: { messageID: "u3" } }])
})

test("rejects replies without a usable table of contents", () => {
  expect(parseTopics("Sorry, I can't.", 3)).toEqual([])
  expect(parseTopics('[{"title":"X","from":7}]', 3)).toEqual([])
  expect(turnOutline(chatTurns(messages)).map((category) => category.title)).toHaveLength(4)
})
