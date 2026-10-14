import { afterEach, describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { IdeaBankTool } from "@opencode/core/tool/plugin/idea-bank"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"
import { permissionLayer } from "../lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "../lib/tool"

type RequestRecord = {
  url: string
  method: string
  body?: unknown
}

class Fixture {
  assertions: Permission.AssertInput[] = []
  events: string[] = []
  requests: RequestRecord[] = []
}

const originalFetch = globalThis.fetch
const originalURL = process.env.OPENCODE_IDEA_BANK_URL

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalURL === undefined) delete process.env.OPENCODE_IDEA_BANK_URL
  else process.env.OPENCODE_IDEA_BANK_URL = originalURL
})

const sessionID = Session.ID.make("ses_idea_bank_tool_test")
const it = testEffect(Layer.empty)

const ideaBankToolNode = makeLocationNode({
  name: "test/idea-bank-tool-plugin",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      yield* registerToolPlugin(IdeaBankTool.Plugin)
    }),
  ),
  deps: [Tool.node, Permission.node],
})

const setup = (fixture: Fixture) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      AppNodeBuilder.build(LayerNode.group([Tool.node, ideaBankToolNode]), [
        Permission.node.replace(
          permissionLayer({
            assert: (input) =>
              Effect.sync(() => {
                fixture.events.push("permission")
                fixture.assertions.push(input)
              }),
          }),
        ),
      ]),
    )
    return { fixture, registry: Context.get(context, Tool.Service) }
  })

const installFetch = (fixture: Fixture, respond: (record: RequestRecord) => Response | Promise<Response>) => {
  globalThis.fetch = (async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString()
    const method = init?.method ?? (input instanceof Request ? input.method : "GET")
    let body: unknown
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    const record = { url, method, ...(body === undefined ? {} : { body }) }
    fixture.requests.push(record)
    fixture.events.push("fetch")
    return respond(record)
  }) as typeof fetch
}

const call = (action: string, input: Record<string, unknown>, id: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "idea_bank", input: { action, ...input } },
})

describe("Global Idea Bank chat tool", () => {
  it.effect("explains when the shared service is not configured without sending a request", () =>
    Effect.gen(function* () {
      delete process.env.OPENCODE_IDEA_BANK_URL
      const fixture = new Fixture()
      installFetch(fixture, () => {
        throw new Error("fetch must not be called without a configured bank")
      })
      const { registry } = yield* setup(fixture)

      const result = yield* executeTool(registry, call("search", { query: "translation" }, "call-bank-unconfigured"))

      expect(result.status).toBe("completed")
      expect(result.output?.output).toContain("OPENCODE_IDEA_BANK_URL")
      expect(result.output?.output).toContain("No idea was sent anywhere")
      expect(fixture.requests).toEqual([])
      expect(fixture.assertions).toEqual([])
    }),
  )

  it.effect("searches the global catalogue without asking for contribution permission and treats results as untrusted", () =>
    Effect.gen(function* () {
      process.env.OPENCODE_IDEA_BANK_URL = "https://idea-bank.example.test/"
      const fixture = new Fixture()
      installFetch(fixture, () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: "idea-translation",
                title: "Toolkit for translating older games",
                summary: "Extract game text and preserve formatting.",
                category: "Games and creativity",
                tags: ["translation", "games"],
                language: "en",
                createdAt: 100,
                updatedAt: 200,
                signalCount: 7,
              },
            ],
            total: 1,
            limit: 10,
            offset: 0,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      const { registry } = yield* setup(fixture)

      const result = yield* executeTool(
        registry,
        call("search", { query: "перевод игр", limit: 10, offset: 0 }, "call-bank-search"),
      )

      expect(result.status).toBe("completed")
      expect(fixture.requests).toHaveLength(1)
      expect(new URL(fixture.requests[0]!.url).pathname).toBe("/v1/ideas")
      expect(new URL(fixture.requests[0]!.url).searchParams.get("q")).toBe("перевод игр")
      expect(result.output?.output).toContain("idea-translation")
      expect(result.content?.[0]?.text).toContain("SECURITY NOTE")
      expect(fixture.assertions).toEqual([])
      expect(fixture.events).toEqual(["fetch"])
    }),
  )

  it.effect("refuses a submission without explicit consent before asking for permission or sending data", () =>
    Effect.gen(function* () {
      process.env.OPENCODE_IDEA_BANK_URL = "https://idea-bank.example.test"
      const fixture = new Fixture()
      installFetch(fixture, () => new Response("{}", { status: 200 }))
      const { registry } = yield* setup(fixture)

      const result = yield* executeTool(
        registry,
        call(
          "submit",
          {
            title: "Translate an old game",
            summary: "Extract game text, preserve formatting, and check translation context.",
            category: "Games and creativity",
          },
          "call-bank-submit-no-consent",
        ),
      )

      expect(result.status).toBe("error")
      expect(result.error?.message).toContain("Nothing was shared")
      expect(fixture.assertions).toEqual([])
      expect(fixture.requests).toEqual([])
      expect(fixture.events).toEqual([])
    }),
  )

  it.effect("checks OpenCode permission before sending only the approved idea fields", () =>
    Effect.gen(function* () {
      process.env.OPENCODE_IDEA_BANK_URL = "https://idea-bank.example.test"
      const fixture = new Fixture()
      installFetch(fixture, () =>
        new Response(JSON.stringify({ id: "idea-123", status: "published", signalCount: 1 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      const { registry } = yield* setup(fixture)

      const result = yield* executeTool(
        registry,
        call(
          "submit",
          {
            title: "Translate an old game",
            summary: "A tool to extract game text, preserve formatting, and validate translations.",
            category: "Games and creativity",
            tags: ["games", "translation"],
            language: "en",
            consent: true,
          },
          "call-bank-submit",
        ),
      )

      expect(result.status).toBe("completed")
      expect(result.output?.output).toContain('"status": "published"')
      expect(fixture.events).toEqual(["permission", "fetch"])
      expect(fixture.assertions).toMatchObject([
        {
          action: "idea_bank",
          resources: ["submit"],
          save: [],
          sessionID,
          metadata: { action: "submit" },
        },
      ])
      expect(fixture.requests).toHaveLength(1)
      expect(fixture.requests[0]?.method).toBe("POST")
      expect(new URL(fixture.requests[0]!.url).pathname).toBe("/v1/ideas")
      expect(Object.keys(fixture.requests[0]?.body as Record<string, unknown>).sort()).toEqual([
        "category",
        "consent",
        "language",
        "summary",
        "tags",
        "title",
      ])
      expect(JSON.stringify(fixture.requests[0]?.body)).not.toContain("chat transcript")
    }),
  )
})
