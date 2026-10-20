import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/core/session"
import { FreebuffPlugin } from "@opencode/core/plugin/provider/freebuff"
import { expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("freebuff")
const methodID = Integration.MethodID.make("browser")
const providerID = Provider.ID.make("freebuff")
const loginUrl = "https://www.codebuff.com/login?auth_code=test-code"

const fixture = Effect.gen(function* () {
  const requests: Request[] = []
  const replies: Response[] = []
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      requests.push(yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie))
      const response = replies.shift()
      if (!response) throw new Error(`Unexpected request: ${request.url}`)
      return HttpClientResponse.fromWeb(request, response)
    }),
  )
  const integrations = yield* Integration.Service
  const credentials = yield* Credential.Service
  const providers = yield* Provider.Service
  const models = yield* Model.Service
  const hooks = yield* PluginHooks.Service
  const rpc = yield* Rpc.Service
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* FreebuffPlugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
  const status = (attempt: Integration.Attempt) =>
    integrations.oauth.status({ integrationID, attemptID: attempt.attemptID }).pipe(
      Effect.repeat({
        until: (value) => value.status !== "pending",
        schedule: Schedule.spaced("10 millis"),
      }),
      Effect.timeout("10 seconds"),
    )
  return { requests, replies, integrations, credentials, providers, models, hooks, rpc, status }
})

it.effect("registers the browser login without network traffic", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    expect(ProviderPlugins).toContain(FreebuffPlugin)
    expect((yield* test.integrations.get(integrationID))?.name).toBe("Freebuff")
    expect(yield* test.providers.get(providerID)).toMatchObject({
      id: "freebuff",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: "https://www.codebuff.com/api/v1", provider: "freebuff", apiKey: "" },
      integrationID,
    })
    expect((yield* test.integrations.get(integrationID))?.methods).toEqual([
      { id: methodID, type: "oauth", label: "Login with Freebuff" },
    ])
    expect(test.requests).toHaveLength(0)
  }),
)

it.live("starts the login code flow and polls until the account token is ready", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    const expiresAt = Date.now() + 3_600_000
    test.replies.push(
      Response.json({
        fingerprintId: "fp-test",
        fingerprintHash: "hash-test",
        loginUrl,
        expiresAt,
      }),
    )
    test.replies.push(Response.json({ error: "authorization_pending" }, { status: 401 }))
    test.replies.push(
      Response.json({ user: { authToken: "freebuff-token", email: "user@example.com", name: "Test User" } }),
    )

    const attempt = yield* test.integrations.oauth.connect({ integrationID, methodID, label: "Freebuff" })
    expect(attempt.mode).toBe("auto")
    expect(attempt.url).toBe(loginUrl)

    const codeRequest = test.requests[0]
    expect(codeRequest.method).toBe("POST")
    // Sign-in is issued on the Freebuff origin the browser page lives on; the
    // account/model API stays on the codebuff host.
    expect(new URL(codeRequest.url).origin + new URL(codeRequest.url).pathname).toBe(
      "https://freebuff.com/api/auth/cli/code",
    )
    const body = JSON.parse(yield* Effect.promise(() => codeRequest.text()))
    expect(body.fingerprintId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

    expect(yield* test.status(attempt)).toMatchObject({ status: "complete" })

    // Login traffic is the code request plus the status polls; the catalog load
    // that follows the credential is a separate, unsolicited request.
    const auth = test.requests.filter((request) => new URL(request.url).pathname.startsWith("/api/auth/"))
    expect(auth).toHaveLength(3)
    const statusUrl = new URL(auth[1].url)
    expect(statusUrl.origin + statusUrl.pathname).toBe("https://freebuff.com/api/auth/cli/status")
    expect(Object.fromEntries(statusUrl.searchParams)).toEqual({
      fingerprintId: "fp-test",
      fingerprintHash: "hash-test",
      expiresAt: String(expiresAt),
    })

    const saved = (yield* test.credentials.list(integrationID))[0]?.value
    if (saved?.type !== "oauth") throw new Error("Expected a stored OAuth credential")
    expect(saved).toMatchObject({ type: "oauth", methodID, access: "freebuff-token", refresh: "" })
    expect(saved.metadata).toMatchObject({
      fingerprintId: "fp-test",
      email: "user@example.com",
      name: "Test User",
    })
    expect(saved.expires).toBeGreaterThan(Date.now())
  }),
)

it.effect("exposes balance and account management over RPC", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    expect(yield* test.rpc.call("opencode.freebuff", "status", {})).toEqual({ loggedIn: false })
    expect(yield* test.rpc.call("opencode.freebuff", "accounts", {})).toEqual({ accounts: [] })
    expect(yield* test.rpc.call("opencode.freebuff", "use", { id: "unknown" })).toEqual({ ok: false })
  }),
)

it.live("returns the freebucks balance and timers over RPC", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    yield* test.credentials.create({
      integrationID,
      value: Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: "freebuff-token",
        refresh: "",
        expires: Date.now() + 3_600_000,
      }),
    })
    const resetAt = new Date(Date.now() + 2 * 3_600_000).toISOString()
    test.replies.push(
      Response.json({
        status: "none",
        freebucks: { balance: 25, daily: { spent: 3, limit: 25, resetAt } },
      }),
    )
    const status = (yield* test.rpc.call("opencode.freebuff", "status", {})) as {
      loggedIn: boolean
      balance?: number
      spent?: number
      limit?: number
      resetIn?: number
    }
    expect(status.loggedIn).toBe(true)
    expect(status.balance).toBe(25)
    expect(status.spent).toBe(3)
    expect(status.limit).toBe(25)
    expect(status.resetIn).toBeGreaterThan(0)
    // The balance read is a single GET and never touches the session endpoints.
    const balanceRequests = test.requests.filter((request) => request.url.includes("/freebuff/session"))
    expect(balanceRequests).toHaveLength(1)
    const url = new URL(balanceRequests[0]!.url)
    expect(url.origin + url.pathname).toBe("https://www.codebuff.com/api/v1/freebuff/session")
    expect(balanceRequests[0]!.headers.get("Authorization")).toBe("Bearer freebuff-token")
  }),
)

it.effect("lists and switches several accounts over RPC", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    const oauth = (email: string, access: string) =>
      Credential.OAuth.make({
        type: "oauth",
        methodID,
        access,
        refresh: "",
        expires: Date.now() + 3_600_000,
        metadata: { email },
      })
    const first = yield* test.credentials.create({ integrationID, value: oauth("one@example.com", "token-one") })
    const second = yield* test.credentials.create({ integrationID, value: oauth("two@example.com", "token-two") })
    const listed = (yield* test.rpc.call("opencode.freebuff", "accounts", {})) as {
      accounts: { id: string; label: string; active: boolean }[]
    }
    expect(listed.accounts).toHaveLength(2)
    expect(listed.accounts.map((account) => account.label)).toEqual(["one@example.com", "two@example.com"])
    expect(listed.accounts.find((account) => account.active)?.id).toBe(second.id)
    expect(yield* test.rpc.call("opencode.freebuff", "use", { id: first.id })).toEqual({ ok: true })
    const switched = (yield* test.rpc.call("opencode.freebuff", "accounts", {})) as typeof listed
    expect(switched.accounts.find((account) => account.active)?.id).toBe(first.id)
  }),
)

it.live("loads the account model catalog after login", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    test.replies.push(
      Response.json({
        rows: [
          {
            key: "m-open",
            handle: "fbm1-open",
            displayName: "Glyph Cluster",
            access: "open",
            multimodal: false,
            contextWindow: 200_000,
          },
          {
            key: "m-locked",
            handle: "fbm1-locked",
            displayName: "GPT-6 Luna",
            access: "locked",
            premium: true,
            multimodal: true,
            contextWindow: 400_000,
          },
        ],
      }),
    )
    yield* test.credentials.create({
      integrationID,
      value: Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: "catalog-token",
        refresh: "",
        expires: Date.now() + 3_600_000,
        metadata: { email: "user@example.com" },
      }),
    })
    // The credential event refreshes the catalog in the background.
    yield* Effect.sleep("200 millis")
    const models = (yield* test.models.all()).filter((model) => model.providerID === providerID)
    expect(models.map((model) => model.name).sort()).toEqual(["GPT-6 Luna", "Glyph Cluster"])
    expect(models.find((model) => model.name === "Glyph Cluster")).toMatchObject({
      enabled: true,
      limit: { context: 200_000 },
      // Free rows carry a zero price so the picker can badge them as free.
      cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    })
    expect(models.find((model) => model.name === "GPT-6 Luna")).toMatchObject({
      enabled: false,
      modelID: "fbm1-locked",
      // Subscription rows stay listed without a free badge.
      cost: [],
    })
    const request = test.requests.find((item) => item.url.includes("/freebuff/models"))
    expect(request).toBeDefined()
    expect(request?.headers.get("Authorization")).toBe("Bearer catalog-token")
  }),
)

it.live("raises a row's declared window when OPENCODE_FREEBUFF_CONTEXT is set", () =>
  Effect.gen(function* () {
    const previous = process.env.OPENCODE_FREEBUFF_CONTEXT
    process.env.OPENCODE_FREEBUFF_CONTEXT = "1000000"
    yield* Effect.ensuring(
      Effect.gen(function* () {
        const test = yield* fixture
        test.replies.push(
          Response.json({
            rows: [
              {
                key: "m-open",
                handle: "fbm1-open",
                displayName: "Glyph Cluster",
                access: "open",
                multimodal: false,
                contextWindow: 200_000,
              },
            ],
          }),
        )
        yield* test.credentials.create({
          integrationID,
          value: Credential.OAuth.make({
            type: "oauth",
            methodID,
            access: "catalog-token",
            refresh: "",
            expires: Date.now() + 3_600_000,
            metadata: { email: "user@example.com" },
          }),
        })
        yield* Effect.sleep("200 millis")
        const model = (yield* test.models.all()).find(
          (item) => item.providerID === providerID && item.name === "Glyph Cluster",
        )
        // The catalog said 200k; the floor wins, and the output cap follows the window.
        expect(model?.limit.context).toBe(1_000_000)
        expect(model?.limit.output).toBe(32_000)
      }),
      Effect.sync(() => {
        if (previous === undefined) delete process.env.OPENCODE_FREEBUFF_CONTEXT
        else process.env.OPENCODE_FREEBUFF_CONTEXT = previous
      }),
    )
  }),
)

it.live("attaches an agent run to the chat body and reuses it per session", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    test.replies.push(Response.json({ runId: "run-1" }))
    const chat = () =>
      test.hooks.trigger("session", "http.request", {
        sessionID: Session.ID.make("ses_test"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID, id: Model.ID.make("m-1") }),
        kind: "primary",
        request: new Request("https://www.codebuff.com/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": "run-token" },
          body: JSON.stringify({ model: "fbm1-handle", messages: [{ role: "user", content: "hi" }] }),
        }),
      })
    const first = yield* chat()
    expect(JSON.parse(yield* Effect.promise(() => first.request.text()))).toMatchObject({
      model: "fbm1-handle",
      // `cost_mode` is what keeps the request on the free tier; without it the
      // gateway bills paid credits and answers 402 "Out of credits".
      codebuff_metadata: { run_id: "run-1", client_id: "freebuff-opencode", cost_mode: "free" },
    })
    expect(first.request.headers.get("authorization")).toBe("Bearer run-token")
    const started = test.requests.filter((request) => request.url.endsWith("/api/v1/agent-runs"))
    expect(started).toHaveLength(1)
    expect(started[0]?.method).toBe("POST")
    // The next call in the same session reuses the run instead of opening another.
    const second = yield* chat()
    expect(JSON.parse(yield* Effect.promise(() => second.request.text()))).toMatchObject({
      codebuff_metadata: { run_id: "run-1", cost_mode: "free" },
    })
    expect(test.requests.filter((request) => request.url.endsWith("/api/v1/agent-runs"))).toHaveLength(1)
  }),
)

it.live("keeps the free cost mode when the run cannot be opened", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    // A failed run start must not drop the request back onto paid credits.
    test.replies.push(Response.json({ error: "unavailable" }, { status: 503 }))
    const event = yield* test.hooks.trigger("session", "http.request", {
      sessionID: Session.ID.make("ses_no_run"),
      agent: Agent.ID.make("build"),
      model: Model.Ref.make({ providerID, id: Model.ID.make("m-1") }),
      kind: "primary",
      request: new Request("https://www.codebuff.com/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "run-token" },
        body: JSON.stringify({ model: "fbm1-handle", messages: [{ role: "user", content: "hi" }] }),
      }),
    })
    expect(JSON.parse(yield* Effect.promise(() => event.request.text()))).toMatchObject({
      codebuff_metadata: { client_id: "freebuff-opencode", cost_mode: "free" },
    })
  }),
)

it.live("pairs catalog rows with the account price table over RPC", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    test.replies.push(
      Response.json({
        rows: [
          {
            key: "m-deepseek",
            handle: "fbm1-deepseek",
            displayName: "DeepSeek V4.1 Flash 10/17",
            access: "open",
            // The digest Freebuff hashes `deepseek/deepseek-v4-flash` into.
            legacyDigests: ["1e303ac563a6f9cc"],
          },
          {
            key: "m-ambiguous",
            handle: "fbm1-ambiguous",
            displayName: "Mystery Model",
            access: "open",
            legacyDigests: ["1e303ac563a6f9cc", "82cc5b2c01633de9"],
          },
          {
            key: "m-unpriced",
            handle: "fbm1-unpriced",
            displayName: "Unpriced Model",
            access: "open",
            legacyDigests: ["0000000000000000"],
          },
        ],
      }),
    )
    yield* test.credentials.create({
      integrationID,
      value: Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: "catalog-token",
        refresh: "",
        expires: Date.now() + 3_600_000,
        metadata: { email: "user@example.com" },
      }),
    })
    // The credential event refreshes the catalog in the background.
    yield* Effect.sleep("200 millis")
    test.replies.push(
      Response.json({
        freebucks: {
          balance: 10,
          daily: { spent: 15, limit: 25 },
          prices: { "deepseek/deepseek-v4-flash": 15, "other/model": 99 },
        },
      }),
    )
    const status = (yield* test.rpc.call("opencode.freebuff", "status", {})) as {
      balance?: number
      prices?: {
        key: string
        name: string
        price?: number
        modelID?: string
        access?: string
      }[]
    }
    expect(status.balance).toBe(10)
    // The row whose digest names a priced model gets that price and the model it
    // belongs to; a row that matches several prices, or none, keeps no price at all
    // rather than a guessed one.
    expect(status.prices).toEqual([
      {
        key: "m-deepseek",
        name: "DeepSeek V4.1 Flash 10/17",
        price: 15,
        modelID: "deepseek/deepseek-v4-flash",
        access: "open",
      },
      { key: "m-ambiguous", name: "Mystery Model", access: "open" },
      { key: "m-unpriced", name: "Unpriced Model", access: "open" },
    ])
  }),
)

it.effect("reports a failed login code request", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    test.replies.push(Response.json({ error: "boom" }, { status: 500 }))
    const error = yield* test.integrations.oauth.connect({ integrationID, methodID }).pipe(Effect.flip)
    expect(error.message).toBe("Freebuff login failed: HTTP 500")
    expect(test.requests).toHaveLength(1)
  }),
)

it.effect("reports an unexpected login code response", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    test.replies.push(Response.json({ fingerprintId: "fp-test" }))
    const error = yield* test.integrations.oauth.connect({ integrationID, methodID }).pipe(Effect.flip)
    expect(error.message).toBe("Freebuff returned an unexpected login response")
  }),
)

it.live("fails the login when the server refuses the authorization code", () =>
  Effect.gen(function* () {
    const test = yield* fixture
    test.replies.push(
      Response.json({
        fingerprintId: "fp-test",
        fingerprintHash: "hash-test",
        loginUrl,
        expiresAt: Date.now() + 3_600_000,
      }),
    )
    // The sign-in page answers with the same refusal it renders to the user.
    test.replies.push(Response.json({ error: "Invalid auth code" }, { status: 400 }))

    const attempt = yield* test.integrations.oauth.connect({ integrationID, methodID })
    expect(yield* test.status(attempt)).toMatchObject({ status: "failed" })
    // The attempt fails at once instead of polling a dead code until it expires.
    expect(test.requests).toHaveLength(2)
  }),
)
