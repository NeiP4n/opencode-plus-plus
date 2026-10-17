import { describe, expect, test } from "bun:test"
import { Message, SystemPart } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Agent } from "@opencode/schema/agent"
import { Money } from "@opencode/schema/money"
import { Session } from "@opencode/schema/session"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionModelTransport } from "@opencode/core/session/model-transport"
import { SessionPrefixPin } from "@opencode/core/session/prefix-pin"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { DateTime, Effect } from "effect"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

const user = (id: string, text: string) => Message.make({ id, role: "user", content: text })
const assistant = (id: string, text: string) => Message.make({ id, role: "assistant", content: text })
const system = (...texts: string[]) => texts.map(SystemPart.make)
const texts = (messages: ReadonlyArray<Message>) =>
  messages.map(
    (message) => `${message.role}:${message.content.map((part) => (part.type === "text" ? part.text : "")).join("")}`,
  )

describe("SessionPrefixPin", () => {
  test("keeps the first system prompt and anchors later changes where they were first seen", () => {
    const pin = SessionPrefixPin.make()
    const first = [user("u1", "hi")]
    expect(pin({ sessionID: "s", key: "k", system: system("base", "lessons v1"), messages: first })).toEqual({
      system: system("base", "lessons v1"),
      messages: first,
    })

    const second = [...first, assistant("a1", "hello"), user("u2", "next")]
    const changed = pin({ sessionID: "s", key: "k", system: system("base", "lessons v2"), messages: second })
    expect(changed.system).toEqual(system("base", "lessons v1"))
    expect(changed.messages.slice(0, 3)).toEqual(second)
    expect(changed.messages[3]?.role).toBe("system")
    expect(texts(changed.messages)[3]).toContain("lessons v2")
    expect(texts(changed.messages)[3]).toContain("- lessons v1")

    // A later step keeps the update at its original position, so the earlier prefix stays identical.
    const third = [...second, assistant("a2", "done"), user("u3", "more")]
    const later = pin({ sessionID: "s", key: "k", system: system("base", "lessons v2"), messages: third })
    expect(later.system).toEqual(system("base", "lessons v1"))
    expect(later.messages.slice(0, 4)).toEqual([...changed.messages])
    expect(later.messages.slice(4)).toEqual(third.slice(3))
  })

  test("starts over when the agent or model changes", () => {
    const pin = SessionPrefixPin.make()
    const messages = [user("u1", "hi")]
    pin({ sessionID: "s", key: "build", system: system("v1"), messages })
    expect(pin({ sessionID: "s", key: "plan", system: system("v2"), messages })).toEqual({
      system: system("v2"),
      messages,
    })
  })

  test("starts over when history is rewritten under an update", () => {
    const pin = SessionPrefixPin.make()
    pin({ sessionID: "s", key: "k", system: system("v1"), messages: [user("u1", "hi")] })
    pin({ sessionID: "s", key: "k", system: system("v2"), messages: [user("u1", "hi"), user("u2", "next")] })
    const compacted = [user("c1", "summary"), user("u3", "again")]
    expect(pin({ sessionID: "s", key: "k", system: system("v2"), messages: compacted })).toEqual({
      system: system("v2"),
      messages: compacted,
    })
  })

  test("re-pins once the updates outgrow the pinned prompt", () => {
    const pin = SessionPrefixPin.make()
    const messages = [user("u1", "hi")]
    pin({ sessionID: "s", key: "k", system: system("short"), messages })
    const large = "x".repeat(10_000)
    expect(pin({ sessionID: "s", key: "k", system: system(large), messages })).toEqual({
      system: system(large),
      messages,
    })
  })

  test("tells the model when the original system prompt applies again", () => {
    const pin = SessionPrefixPin.make()
    pin({ sessionID: "s", key: "k", system: system("v1"), messages: [user("u1", "a")] })
    pin({ sessionID: "s", key: "k", system: system("v2"), messages: [user("u1", "a"), user("u2", "b")] })
    const back = pin({
      sessionID: "s",
      key: "k",
      system: system("v1"),
      messages: [user("u1", "a"), user("u2", "b"), user("u3", "c")],
    })
    expect(texts(back.messages).at(-1)).toContain("current again")
  })
})

const session = Session.Info.make({
  id: Session.ID.make("ses_prefix_pin"),
  projectID: Project.ID.global,
  cost: Money.USD.zero,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
})
const model = SessionRunnerModel.resolved(OpenAIChat.route.model({ id: "gpt-5.5", provider: "test" }), {
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  cost: [],
  limit: { context: 200_000, output: 32_000 },
})
const transport = SessionModelTransport.Service.of({
  bind: () => ({ execute: () => Effect.die("unused WebSocket execution") }),
  close: () => Effect.void,
  closeAll: Effect.void,
})

describe("SessionModelRequest prefix pinning", () => {
  it.effect("pins the agent loop's system prompt but leaves one-shot requests alone", () =>
    Effect.gen(function* () {
      const requests = yield* SessionModelRequest.Service.pipe(Effect.provide(SessionModelRequest.layer))
      const input = (text: string, messages: Array<Message>) => ({
        session,
        agent: Agent.ID.make("build"),
        model,
        system: system("base", text),
        messages,
      })
      const first = [user("u1", "hi")]
      yield* requests.primary(input("status 10%", first))
      const second = [...first, assistant("a1", "hello"), user("u2", "next")]
      const primary = yield* requests.primary(input("status 20%", second))
      expect(primary.request.system.map((part) => part.text)).toEqual(["base", "status 10%"])
      expect(texts(primary.request.messages).at(-1)).toContain("status 20%")

      const title = yield* requests.title(input("status 20%", second))
      expect(title.request.system.map((part) => part.text)).toContain("status 20%")
      expect(title.request.messages).toHaveLength(second.length)
    }).pipe(Effect.provideService(SessionModelTransport.Service, transport)),
  )
})
