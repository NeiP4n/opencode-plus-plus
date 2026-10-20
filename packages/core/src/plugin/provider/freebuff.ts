import { Money } from "@opencode/schema/money"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Clock, Effect, Ref, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"
import { FreebuffRpc } from "./freebuff-rpc.js"

const integrationID = Integration.ID.make("freebuff")
const methodID = Integration.MethodID.make("browser")
const providerID = Provider.ID.make("freebuff")

// Freebuff has no OAuth authorization server (`/oauth/authorize` returns 404),
// so the plugin implements the same device-code flow the CLI uses:
// 1. POST /api/auth/cli/code  ->  loginUrl + fingerprintId + fingerprintHash
// 2. poll GET /api/auth/cli/status (401 while pending)
// 3. on 200 with user.authToken -> store the account credential
// The product API moved to the codebuff host: freebuff.com only serves the
// website, and its /oauth/authorize page is gone (the old "Page not found"),
// while the official CLI itself talks to codebuff.com for models and sessions.
const apiBase = (process.env.FREEBUFF_API_BASE ?? "https://www.codebuff.com").replace(/\/+$/, "")
const v1Base = (process.env.FREEBUFF_V1_API_BASE ?? apiBase).replace(/\/+$/, "")
// The browser sign-in is the exception: Freebuff users sign in on freebuff.com,
// which is where the official CLI and Freebuff Desktop send them. A code issued
// on another origin is not recognised by that page, and the website answers with
// "Invalid auth code" before the poll ever sees the account.
const loginBase = (process.env.FREEBUFF_LOGIN_BASE ?? "https://freebuff.com").replace(/\/+$/, "")
const pollIntervalMs = 2_000
// The catalog announces its own next refresh (`refreshAt`); these bound how often
// the plugin trusts that hint.
const catalogRefreshMs = 30 * 60_000
const minRefreshMs = 60_000
const loginLifetimeMs = 60 * 60 * 1000
// The CLI stores the account token without an expiry and has no refresh flow, so
// the credential stays valid until the user disconnects or logs out.
const maxExpiry = 8_640_000_000_000_000

const CodeResponse = Schema.Struct({
  fingerprintId: Schema.String,
  fingerprintHash: Schema.String,
  loginUrl: Schema.String,
  expiresAt: Schema.Number,
})
const StatusUser = Schema.Struct({
  authToken: Schema.String,
  email: Schema.optional(Schema.String),
  name: Schema.optional(Schema.NullOr(Schema.String)),
})
const StatusResponse = Schema.Struct({
  user: Schema.optional(Schema.NullOr(StatusUser)),
})

// GET /api/v1/freebuff/session — read-only balance/status of the account. The
// fields are optional because the response also carries pricing metadata that
// the plugin does not care about.
const SessionResponse = Schema.Struct({
  status: Schema.optional(Schema.String),
  accessTier: Schema.optional(Schema.String),
  freebucks: Schema.optional(
    Schema.Struct({
      balance: Schema.optional(Schema.Number),
      daily: Schema.optional(
        Schema.Struct({
          spent: Schema.optional(Schema.Number),
          limit: Schema.optional(Schema.Number),
          remaining: Schema.optional(Schema.Number),
          resetAt: Schema.optional(Schema.String),
        }),
      ),
      wallet: Schema.optional(Schema.Struct({ balance: Schema.optional(Schema.Number) })),
      // Price per gateway model id (for example `deepseek/deepseek-v4-flash`): what a
      // session on that model costs in freebucks.
      prices: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
    }),
  ),
  expiresAt: Schema.optional(Schema.String),
  connection: Schema.optional(Schema.Struct({ expiresAt: Schema.optional(Schema.String) })),
})

// GET /api/v1/freebuff/models — the account's model catalog. `key` is stable
// across sessions, `handle` is the opaque id the gateway expects per request.
const CatalogRow = Schema.Struct({
  key: Schema.String,
  handle: Schema.optional(Schema.String),
  displayName: Schema.String,
  access: Schema.optional(Schema.String),
  premium: Schema.optional(Schema.Boolean),
  multimodal: Schema.optional(Schema.Boolean),
  contextWindow: Schema.optional(Schema.Number),
  compaction: Schema.optional(Schema.Struct({ maxContextLength: Schema.optional(Schema.Number) })),
  // Hashes of the gateway model ids this row serves; the only link between a
  // marketing name and the price table.
  legacyDigests: Schema.optional(Schema.Array(Schema.String)),
})
const CatalogResponse = Schema.Struct({
  rows: Schema.Array(CatalogRow),
  // Epoch millis at which the catalog should be re-fetched; absent on older servers.
  refreshAt: Schema.optional(Schema.Number),
  plansUrl: Schema.optional(Schema.String),
})

type CatalogRowInfo = Schema.Schema.Type<typeof CatalogRow>

// POST /api/v1/agent-runs — the gateway refuses chat bodies that are not
// attached to a run ("No runId found in request body"), so every session opens
// one before its first model call.
const RunResponse = Schema.Struct({ runId: Schema.String })
const agentID = "main-agent"
const clientID = "freebuff-opencode"
// The gateway has two billing lanes and picks one from this flag: without it a
// request is billed against paid credits, so a free-tier account that still has
// freebucks answers 402 "Out of credits". Freebuff's own client sends `free` for
// every request on the free tier, so the plugin does the same.
const costMode = "free"

export const FreebuffPlugin = define({
  id: "opencode.provider.freebuff",
  effect: Effect.fn(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    const bus = yield* Bus.Service
    const credentials = yield* Credential.Service
    const runs = yield* Ref.make(new Map<string, string>())
    // The catalog rows are kept next to the provider models so the status lookup can
    // pair every row with the price the account's price table lists for it.
    const catalogRows = yield* Ref.make<readonly CatalogRowInfo[]>([])
    const agent = `freebuff-opencode/${ctx.app.version} opencode(++) integration`

    // The active credential (not the oldest row) carries the account token, so
    // switching accounts with /freebuff-use also switches the API token.
    const activeToken = Effect.gen(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      if (!connection) return undefined
      const credential = yield* ctx.integration.connection
        .resolve(connection)
        .pipe(Effect.orElseSucceed(() => undefined))
      return credential?.type === "oauth" ? credential.access : undefined
    })
    const oauth = {
      integrationID,
      method: {
        id: methodID,
        type: "oauth",
        label: "Login with Freebuff",
      },
      // Accounts are labeled by their email so several logins stay distinguishable.
      label: (credential: Credential.OAuth) => {
        const email = credential.metadata?.["email"]
        return typeof email === "string" && email.length > 0 ? email : undefined
      },
      authorize: () =>
        Effect.gen(function* () {
          const code = yield* loginCode(http, agent, crypto.randomUUID())
          const fallbackDeadline = (yield* Clock.currentTimeMillis) + loginLifetimeMs
          const expiresAt = code.expiresAt > 0 ? code.expiresAt : fallbackDeadline
          const statusUrl = `${loginBase}/api/auth/cli/status?${new URLSearchParams({
            fingerprintId: code.fingerprintId,
            fingerprintHash: code.fingerprintHash,
            expiresAt: String(expiresAt),
          }).toString()}`

          const poll = (): Effect.Effect<Credential.OAuth, Error> =>
            Effect.gen(function* () {
              if ((yield* Clock.currentTimeMillis) >= expiresAt)
                return yield* Effect.fail(new Error("Freebuff login timed out. Start the login again."))
              // Before the browser finishes, the status endpoint answers 401;
              // network hiccups are retried instead of failing the login.
              const status = yield* loginStatus(http, agent, statusUrl)
              // A refused code never becomes usable by waiting, so surface the
              // server's reason now instead of polling until the attempt expires.
              if (status.kind === "rejected")
                return yield* Effect.fail(new Error(`Freebuff rejected the authorization code: ${status.message}`))
              const user = status.kind === "ready" ? status.user : undefined
              if (!user) {
                yield* Effect.sleep(pollIntervalMs)
                return yield* poll()
              }
              return Credential.OAuth.make({
                type: "oauth",
                methodID,
                access: user.authToken,
                refresh: "",
                expires: maxExpiry,
                metadata: {
                  fingerprintId: code.fingerprintId,
                  ...(user.email ? { email: user.email } : {}),
                  ...(user.name ? { name: user.name } : {}),
                },
              })
            })

          return {
            mode: "auto" as const,
            url: code.loginUrl,
            instructions: "Complete authorization in your browser. This window will close automatically.",
            callback: poll(),
          }
        }),
    } satisfies IntegrationOAuthMethodRegistration

    yield* ctx.integration.transform((editor) => {
      // The registry names unknown integrations after their ID; show the product name instead.
      editor.update("freebuff", (integration) => {
        integration.name = "Freebuff"
      })
      editor.method.update(oauth)
    })
    yield* ctx.provider.transform((providers) => {
      // Seed the provider so the integration works without extra configuration.
      if (!providers.get(providerID))
        providers.add({
          info: {
            ...Provider.Info.empty(providerID),
            name: "Freebuff",
            package: "@opencode/ai/providers/openai-compatible",
            integrationID,
          },
          models: [],
        })
      providers.update(providerID, (provider) => {
        provider.package = "@opencode/ai/providers/openai-compatible"
        provider.settings = {
          baseURL: `${apiBase}/api/v1`,
          provider: "freebuff",
          apiKey: "",
        }
        provider.integrationID = integrationID
      })
    })
    // Runs are keyed by session and token, so switching accounts starts a fresh
    // run instead of reusing one that belongs to the previous account.
    const ensureRun = Effect.fnUntraced(function* (sessionID: string, token: string) {
      const key = `${sessionID}\u0000${token}`
      const existing = (yield* Ref.get(runs)).get(key)
      if (existing) return existing
      const runID = yield* startRun(http, agent, token).pipe(Effect.orElseSucceed(() => undefined))
      if (runID) yield* Ref.update(runs, (current) => new Map(current).set(key, runID))
      return runID
    })
    // The openai-compatible package goes through the native loadPackage path,
    // and every request passes this hook, which injects the account token.
    yield* ctx.session.hook(
      "http.request",
      (evt) =>
        Effect.gen(function* () {
          if (evt.model.providerID !== providerID) return
          const saved = yield* activeToken
          const token = saved ?? evt.request.headers.get("x-api-key")
          if (!token) return
          evt.request.headers.set("Authorization", `Bearer ${token}`)
          evt.request.headers.set("User-Agent", agent)
          // The gateway bills every completion against an agent run and rejects
          // bodies without one, so the first request of a session opens a run
          // and the rest of the session reuses it.
          const text = yield* Effect.promise(() =>
            evt.request
              .clone()
              .text()
              .catch(() => ""),
          )
          if (!text.includes("codebuff_metadata")) {
            const body = yield* Effect.sync(() => {
              try {
                return JSON.parse(text) as Record<string, unknown>
              } catch {
                return undefined
              }
            })
            if (body && typeof body === "object" && !Array.isArray(body) && !("codebuff_metadata" in body)) {
              const runID = yield* ensureRun(evt.sessionID, token)
              // The free cost mode rides along even when the run could not be opened:
              // it is what keeps the request on the free tier instead of paid credits.
              evt.request = new Request(evt.request.url, {
                method: evt.request.method,
                headers: evt.request.headers,
                body: JSON.stringify({
                  ...body,
                  codebuff_metadata: {
                    ...(runID ? { run_id: runID } : {}),
                    client_id: clientID,
                    cost_mode: costMode,
                  },
                }),
              })
            }
          }
        }),
      { providerID },
    )

    // The catalog is account specific, so it loads for the active credential and
    // reloads whenever accounts change (login, switch, disconnect) or the server
    // announces a newer one through `refreshAt`.
    const loadModels = Effect.gen(function* () {
      const access = yield* activeToken
      if (!access) return catalogRefreshMs
      const catalog = yield* fetchCatalog(http, agent, access).pipe(Effect.orElseSucceed(() => undefined))
      if (!catalog || catalog.rows.length === 0) return catalogRefreshMs
      yield* Ref.set(catalogRows, catalog.rows)
      yield* ctx.provider.transform((providers) => {
        providers.models.set(
          providerID,
          catalog.rows.map((row) => {
            // The account catalog can under-report the window a row really serves: free rows
            // often say 200k while the gateway accepts far more. OPENCODE_FREEBUFF_CONTEXT raises
            // the declared window without editing the catalog, so compaction and request sizing
            // stop trimming at a number the model does not actually have. It only ever raises the
            // value; a request the server will not take still fails on the server.
            const floor = Number(process.env.OPENCODE_FREEBUFF_CONTEXT)
            const context = Math.max(
              1,
              Math.floor(row.contextWindow ?? row.compaction?.maxContextLength ?? 200_000),
              Number.isFinite(floor) && floor > 0 ? Math.floor(floor) : 0,
            )
            // Rows are split by what the account can use: `open` rows are free on
            // any plan, everything else needs a paid plan. Free rows carry a zero
            // price so the model picker can show its "Free" badge next to them.
            const free = row.access === "open"
            return {
              ...Model.Info.default(providerID, Model.ID.make(row.key)),
              // Requests carry the handle the gateway issued for this account.
              modelID: Model.ID.make(row.handle ?? row.key),
              name: row.displayName,
              // Subscription rows stay listed (and selectable once the plan exists)
              // but are marked unavailable so the picker can label them.
              enabled: free,
              status: "active" as const,
              cost: free
                ? [
                    {
                      input: Money.USDPerMillionTokens.zero,
                      output: Money.USDPerMillionTokens.zero,
                      cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
                    },
                  ]
                : [],
              capabilities: {
                tools: true,
                input: row.multimodal ? ["text", "image"] : ["text"],
                output: ["text"],
              },
              limit: { context, output: Math.min(context, 32_000) },
            }
          }),
        )
      })
      // The provider state is not watched by the model service on its own, so the
      // UI only sees a refreshed catalog after this event is published.
      yield* bus.publish(
        Provider.Event.Updated,
        {},
        { location: { directory: ctx.location.directory, workspaceID: ctx.location.workspaceID } },
      )
      yield* ctx.provider.reload()
      const hinted = catalog.refreshAt === undefined ? NaN : catalog.refreshAt - (yield* Clock.currentTimeMillis)
      if (!Number.isFinite(hinted)) return catalogRefreshMs
      return Math.min(Math.max(hinted, minRefreshMs), catalogRefreshMs)
    })
    yield* loadModels
    yield* bus.subscribe([Credential.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.runForEach(() => loadModels),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Keep the catalog in step with the account plan without a manual restart.
    yield* Effect.gen(function* () {
      while (true) {
        const wait = yield* loadModels
        yield* Effect.sleep(wait)
      }
    }).pipe(Effect.forkScoped)

    // Freebucks balance and timers; read-only, so it can never take over or
    // disturb a session opened by the official Freebuff CLI.
    const status = Effect.gen(function* () {
      const access = yield* activeToken
      if (!access) return { loggedIn: false }
      const session = yield* fetchSession(http, agent, access).pipe(Effect.orElseSucceed(() => undefined))
      if (!session) return { loggedIn: true }
      const now = yield* Clock.currentTimeMillis
      const daily = session.freebucks?.daily
      const balance = session.freebucks?.balance ?? session.freebucks?.wallet?.balance
      const reset = daily?.resetAt ? Date.parse(daily.resetAt) : NaN
      const expires = Date.parse(session.expiresAt ?? session.connection?.expiresAt ?? "")
      const rows = yield* Ref.get(catalogRows)
      return {
        loggedIn: true,
        ...(typeof balance === "number" ? { balance } : {}),
        ...(typeof daily?.spent === "number" ? { spent: daily.spent } : {}),
        ...(typeof daily?.limit === "number" ? { limit: daily.limit } : {}),
        ...(reset > now ? { resetIn: reset - now } : {}),
        ...(expires > now ? { sessionEndsIn: expires - now } : {}),
        ...(session.accessTier ? { tier: session.accessTier } : {}),
        prices: resolvePrices(rows, session.freebucks?.prices),
      }
    })
    const listAccounts = Effect.gen(function* () {
      const accounts = yield* credentials.list(integrationID)
      const active = yield* ctx.integration.connection.active(integrationID)
      return {
        accounts: accounts.map((account) => ({
          id: account.id as string,
          label: accountLabel(account),
          active: active?.type === "credential" && active.id === account.id,
        })),
      }
    })
    const useAccount = (id: string) =>
      Effect.gen(function* () {
        const accounts = yield* credentials.list(integrationID)
        const found = accounts.find((account) => account.id === id)
        if (!found) return { ok: false as const }
        yield* credentials.activate(found.id)
        return { ok: true as const }
      })
    // Starts a login for one more account; the settlement runs in the background
    // and appends the new credential without touching the others.
    const addAccount = Effect.gen(function* () {
      const attempt = yield* ctx.integration.oauth.connect({ integrationID, methodID })
      return { url: attempt.data?.url }
    })

    // The TUI companion plugin (`opencode.freebuff`) renders dialogs on top of
    // these methods; nothing is fetched in the background, so the plugin never
    // interferes with the official CLI session on the server.
    yield* ctx.rpc
      .register(FreebuffRpc, {
        status: () => status,
        accounts: () => listAccounts,
        use: (input) => useAccount(input.id),
        // The login start can fail on transport errors; the RPC surfaces them as system errors.
        add: () => addAccount.pipe(Effect.orDie),
      })
      .pipe(Effect.orDie)
  }),
} satisfies PluginInternal.InternalPlugin)

function loginCode(http: HttpClient.HttpClient, agent: string, fingerprintId: string) {
  return HttpClientRequest.post(`${loginBase}/api/auth/cli/code`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bodyJsonUnsafe({ fingerprintId }),
    HttpClientRequest.setHeader("User-Agent", agent),
    http.execute,
    Effect.mapError((cause) => new Error(`Freebuff login request failed: ${cause}`)),
    Effect.flatMap((response) =>
      response.status >= 200 && response.status < 300
        ? Effect.succeed(response)
        : Effect.fail(new Error(`Freebuff login failed: HTTP ${response.status}`)),
    ),
    Effect.flatMap((response) =>
      HttpClientResponse.schemaBodyJson(CodeResponse)(response).pipe(
        Effect.mapError(() => new Error("Freebuff returned an unexpected login response")),
      ),
    ),
  )
}

// Read-only balance lookup; it sends no instance or session headers, so it
// cannot take over or disturb a session opened by the official Freebuff CLI.
function fetchSession(http: HttpClient.HttpClient, agent: string, token: string) {
  return HttpClientRequest.get(`${v1Base}/api/v1/freebuff/session`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.setHeader("User-Agent", agent),
    http.execute,
    Effect.flatMap((response) =>
      response.status >= 200 && response.status < 300
        ? HttpClientResponse.schemaBodyJson(SessionResponse)(response)
        : Effect.fail(new Error(`Freebuff status failed: HTTP ${response.status}`)),
    ),
  )
}

function fetchCatalog(http: HttpClient.HttpClient, agent: string, token: string) {
  return HttpClientRequest.get(`${v1Base}/api/v1/freebuff/models`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.setHeader("User-Agent", agent),
    http.execute,
    Effect.flatMap((response) =>
      response.status >= 200 && response.status < 300
        ? HttpClientResponse.schemaBodyJson(CatalogResponse)(response)
        : Effect.fail(new Error(`Freebuff model catalog failed: HTTP ${response.status}`)),
    ),
  )
}

// Opens an agent run so the gateway accepts the chat body that follows it.
function startRun(http: HttpClient.HttpClient, agent: string, token: string) {
  return HttpClientRequest.post(`${v1Base}/api/v1/agent-runs`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bodyJsonUnsafe({ action: "START", agentId: agentID, ancestorRunIds: [] }),
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.setHeader("User-Agent", agent),
    http.execute,
    Effect.flatMap((response) =>
      response.status >= 200 && response.status < 300
        ? HttpClientResponse.schemaBodyJson(RunResponse)(response)
        : Effect.fail(new Error(`Freebuff run failed: HTTP ${response.status}`)),
    ),
    Effect.map((value) => value.runId),
  )
}

function accountLabel(account: Credential.Info): string {
  if (account.value.type === "oauth") {
    const email = account.value.metadata?.["email"]
    if (typeof email === "string" && email.length > 0) return email
    const name = account.value.metadata?.["name"]
    if (typeof name === "string" && name.length > 0) return name
  }
  return account.label
}

// Freebuff's own digest of a gateway model id: `freebuff-legacy-model:<id>` hashed with
// two FNV-1a variants, eight hex digits each. The product's web client resolves catalog
// rows and prices with this exact function, and the catalog rows carry the resulting
// hashes in `legacyDigests`, which makes it the only reliable link between a row's
// marketing name and the price table.
function legacyModelDigest(modelID: string) {
  const input = `freebuff-legacy-model:${modelID}`
  let a = 0x811c9dc5
  let b = 0x5ad1e806
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    a = Math.imul(a ^ code, 0x1000193) >>> 0
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
}

// The catalog lists marketing names ("DeepSeek V4.1 Flash 10/17") while the price table
// is keyed by the gateway model id ("deepseek/deepseek-v4-flash"), and the two do not
// line up by name. A row that matches exactly one priced model gets that price; a row
// that matches none, or more than one, keeps an unknown price instead of a guessed one.
function resolvePrices(rows: readonly CatalogRowInfo[], prices: Record<string, number> | undefined) {
  return rows.map((row) => {
    const matches = Object.entries(prices ?? {}).filter(([modelID]) =>
      row.legacyDigests?.includes(legacyModelDigest(modelID)),
    )
    const match = matches.length === 1 ? matches[0] : undefined
    return {
      key: row.key,
      name: row.displayName,
      ...(match ? { price: match[1], modelID: match[0] } : {}),
      ...(row.access ? { access: row.access } : {}),
    }
  })
}

type LoginStatus =
  | { readonly kind: "ready"; readonly user: Schema.Schema.Type<typeof StatusUser> }
  | { readonly kind: "pending" }
  | { readonly kind: "rejected"; readonly message: string }

// 401 means the browser has not finished the sign-in yet. Any other 4xx means the
// code itself is gone (expired or already used): the sign-in page shows its own
// "Invalid auth code" error in that case, so waiting cannot help.
function loginStatus(http: HttpClient.HttpClient, agent: string, url: string): Effect.Effect<LoginStatus> {
  return HttpClientRequest.get(url).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.setHeader("User-Agent", agent),
    http.execute,
    Effect.flatMap((response) =>
      Effect.gen(function* () {
        if (response.status === 200) {
          const body = yield* HttpClientResponse.schemaBodyJson(StatusResponse)(response).pipe(
            Effect.orElseSucceed((): Schema.Schema.Type<typeof StatusResponse> => ({})),
          )
          return body.user ? ({ kind: "ready", user: body.user } as const) : ({ kind: "pending" } as const)
        }
        // Drain every response body so the connection is released while polling.
        const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
        if (response.status >= 400 && response.status < 500 && response.status !== 401)
          return { kind: "rejected", message: errorMessage(text) ?? `HTTP ${response.status}` } as const
        return { kind: "pending" } as const
      }),
    ),
    Effect.orElseSucceed((): LoginStatus => ({ kind: "pending" })),
  )
}

// API errors arrive as `{ error }` or `{ message }`; anything else is reported raw.
function errorMessage(body: string) {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const message = parsed["error"] ?? parsed["message"]
    if (typeof message === "string" && message.length > 0) return message
  } catch {
    // Not JSON; fall through to the trimmed body.
  }
  const text = body.trim()
  return text.length > 0 ? text.slice(0, 200) : undefined
}
