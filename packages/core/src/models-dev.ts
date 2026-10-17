import { Cause, Context, Duration, Effect, Layer, Option, Schedule, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ModelsDev } from "@opencode/schema/models-dev"
import { Money } from "@opencode/schema/money"
import { App } from "./app.js"
import { Hash } from "@opencode/util/hash"
import { FSUtil } from "@opencode/util/fs-util"
import { Bus } from "./bus.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Model } from "./model.js"
import { isRecord } from "@opencode/ai/utils/record"
import { AISDKNative } from "./aisdk-native.js"
import { Provider } from "./provider.js"
import { Variant } from "./variant.js"
import { KV } from "./kv.js"
import snapshotText from "./models-dev/snapshot.txt" with { type: "text" }

export const CatalogModelStatus = Schema.Literals(["alpha", "beta", "deprecated"])
export type CatalogModelStatus = typeof CatalogModelStatus.Type

type Cost = {
  readonly input: Money.USDPerMillionTokens
  readonly output: Money.USDPerMillionTokens
  readonly cache_read?: Money.USDPerMillionTokens
  readonly cache_write?: Money.USDPerMillionTokens
  readonly tiers?: readonly (Cost & { readonly tier: { readonly type: "context"; readonly size: number } })[]
}

type Modality = "text" | "audio" | "image" | "video" | "pdf"

type SourceModel = {
  readonly id: string
  readonly name: string
  readonly family?: string
  readonly release_date: string
  readonly attachment: boolean
  readonly reasoning: boolean
  readonly reasoning_options?: readonly (
    | { readonly type: "effort"; readonly values: readonly (string | null)[] }
    | Exclude<Variant.Support, { type: "effort" }>
  )[]
  readonly temperature?: boolean
  readonly tool_call: boolean
  readonly interleaved?: boolean | string | { readonly field: string }
  readonly cost?: Cost
  readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
  readonly modalities?: { readonly input: readonly Modality[]; readonly output: readonly Modality[] }
  readonly experimental?: {
    readonly modes?: Readonly<
      Record<
        string,
        {
          readonly cost?: Cost
          readonly provider?: {
            readonly body?: Provider.Settings
            readonly headers?: Readonly<Record<string, string>>
          }
        }
      >
    >
  }
  readonly status?: CatalogModelStatus
  readonly provider?: {
    readonly npm?: string
    readonly api?: string
    readonly shape?: "responses" | "completions"
  }
}

type SourceProvider = {
  readonly api?: string
  readonly name: string
  readonly env: readonly string[]
  readonly id: string
  readonly npm: string
  readonly models: Readonly<Record<string, SourceModel>>
}

export type Snapshot = {
  readonly info: Provider.Info
  readonly models: readonly Model.Info[]
  readonly environment: readonly string[]
}

/**
 * Public, no-account free routes. Kilo's `kilo-auto/free` is a stable dynamic route;
 * individual `:free` models are discovered from its public /models endpoint below.
 * Keep the static fallbacks here so the picker remains useful during network outages.
 */
function freeModel(id: string, name: string, contextLength = 32_000, outputLength = 4_096): SourceModel {
  return {
    id,
    name,
    release_date: "",
    attachment: false,
    reasoning: false,
    tool_call: true,
    limit: { context: contextLength, input: contextLength, output: outputLength },
    modalities: { input: ["text"], output: ["text"] },
  }
}

function zeroPrice(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return false
  const number = Number(value)
  return value !== "" && Number.isFinite(number) && number === 0
}

/** Parse Kilo models tagged :free or explicitly listed at zero input/output price. */
export function parseKiloFreeModels(input: unknown): Record<string, SourceModel> {
  if (!isRecord(input) || !Array.isArray(input.data)) return {}
  const models: Record<string, SourceModel> = {}
  for (const item of input.data) {
    if (!isRecord(item) || typeof item.id !== "string") continue
    const pricing = isRecord(item.pricing) ? item.pricing : undefined
    const freeByPrice = pricing && zeroPrice(pricing.prompt) && zeroPrice(pricing.completion)
    if (!item.id.endsWith(":free") && !freeByPrice) continue

    const id = item.id
    const contextLength =
      typeof item.context_length === "number" && Number.isFinite(item.context_length) && item.context_length > 0
        ? Math.floor(item.context_length)
        : 32_000
    const topProvider = isRecord(item.top_provider) ? item.top_provider : undefined
    const outputLength =
      typeof topProvider?.max_completion_tokens === "number" &&
      Number.isFinite(topProvider.max_completion_tokens) &&
      topProvider.max_completion_tokens > 0
        ? Math.floor(topProvider.max_completion_tokens)
        : 4_096
    const displayName = typeof item.name === "string" && item.name.trim() ? item.name.trim() : id
    const supported = Array.isArray(item.supported_parameters) ? item.supported_parameters : undefined
    models[id] = {
      ...freeModel(id, displayName.startsWith("[FREE]") ? displayName : `[FREE] ${displayName}`, contextLength, outputLength),
      ...(supported
        ? { tool_call: supported.some((value) => value === "tools" || value === "tool_choice" || value === "function_calling") }
        : {}),
    }
  }
  return models
}

export function parseKiloFreeModelsText(text: string): Record<string, SourceModel> | undefined {
  try {
    return parseKiloFreeModels(JSON.parse(text))
  } catch {
    return undefined
  }
}

const ANONYMOUS_FREE_PROVIDERS: readonly SourceProvider[] = [
  {
    id: "kilo-free",
    name: "Kilo Gateway [FREE · NO ACCOUNT]",
    env: [],
    npm: "@ai-sdk/openai-compatible",
    api: "https://ai-gateway.kilo.ai/api/v1",
    models: {
      "kilo-auto/free": freeModel("kilo-auto/free", "[FREE] Kilo Auto Free"),
      "minimax/minimax-m2.1:free": freeModel("minimax/minimax-m2.1:free", "[FREE] MiniMax M2.1"),
      "z-ai/glm-5:free": freeModel("z-ai/glm-5:free", "[FREE] GLM-5"),
      "google/gemma-4-26b-a4b-it:free": freeModel(
        "google/gemma-4-26b-a4b-it:free",
        "[FREE] Gemma 4 26B A4B",
      ),
    },
  },
]

function nativePackage(provider: SourceProvider, model?: SourceModel) {
  const npm = model?.provider?.npm ?? provider.npm
  return (
    AISDKNative.native(npm, {
      providerID: provider.id,
      modelID: model?.id,
      shape: model?.provider?.shape,
    }) ?? Provider.aisdk(npm)
  )
}

export function normalize(
  input: Record<string, SourceProvider>,
  kiloFreeModels: Record<string, SourceModel> = {},
): readonly Snapshot[] {
  const catalog = { ...input }
  for (const item of ANONYMOUS_FREE_PROVIDERS) {
    catalog[item.id] =
      item.id === "kilo-free" ? { ...item, models: { ...item.models, ...kiloFreeModels } } : item
  }

  const providers: Snapshot[] = []
  for (const item of Object.values(catalog)) {
    const providerID = Provider.ID.make(item.id)
    const packageName = nativePackage(item)
    const info = {
      id: providerID,
      name: item.name,
      activation: "auto",
      package: packageName,
      ...(item.api && packageName !== "@opencode/ai/providers/cloudflare-workers-ai"
        ? { settings: { baseURL: item.api } }
        : {}),
    } satisfies Provider.Info
    const models: Model.Info[] = []
    for (const model of Object.values(item.models)) {
      const baseCost = cost(model.cost)
      const id = Model.ID.make(model.id)
      const base = modelInfo(item, id, model, { cost: baseCost })
      const variants = Variant.resolve({ ...base, package: nativePackage(item, model) }, supports(model))
      models.push({ ...base, variants })
      for (const [mode, options] of Object.entries(model.experimental?.modes ?? {})) {
        const modeID = Model.ID.make(`${model.id}-${mode}`)
        models.push(
          modelInfo(item, modeID, model, {
            name: modeName(model, mode),
            cost: mergeCost(baseCost, options.cost),
            request: options.provider,
            variants,
          }),
        )
      }
    }
    providers.push({ info, models, environment: [...item.env] })
  }
  return providers
}

function released(date: string) {
  const time = Date.parse(date)
  return Number.isFinite(time) ? time : 0
}

function cost(input: SourceModel["cost"]): Model.Info["cost"] {
  const base = {
    input: input?.input ?? Money.USDPerMillionTokens.zero,
    output: input?.output ?? Money.USDPerMillionTokens.zero,
    cache: {
      read: input?.cache_read ?? Money.USDPerMillionTokens.zero,
      write: input?.cache_write ?? Money.USDPerMillionTokens.zero,
    },
  }
  return [
    base,
    ...(input?.tiers?.map((item) => ({
      tier: item.tier,
      input: item.input,
      output: item.output,
      cache: {
        read: item.cache_read ?? Money.USDPerMillionTokens.zero,
        write: item.cache_write ?? Money.USDPerMillionTokens.zero,
      },
    })) ?? []),
  ]
}

function mergeCost(base: Model.Info["cost"], override: SourceModel["cost"] | undefined) {
  if (!override) return base
  const next = cost(override)
  const [baseDefault, ...baseTiers] = base
  const [nextDefault, ...nextTiers] = next
  const tierKey = (item: Model.Info["cost"][number]) => `${item.tier?.type ?? "base"}:${item.tier?.size ?? 0}`
  const merge = (left: Model.Info["cost"][number], right: Model.Info["cost"][number]) => ({
    ...left,
    ...right,
    tier: right.tier ?? left.tier,
    cache: { ...left.cache, ...right.cache },
  })
  const tiers = new Map(baseTiers.map((item) => [tierKey(item), item]))
  for (const item of nextTiers) {
    const current = tiers.get(tierKey(item))
    tiers.set(tierKey(item), current ? merge(current, item) : item)
  }
  return [
    merge(
      baseDefault ?? {
        input: Money.USDPerMillionTokens.zero,
        output: Money.USDPerMillionTokens.zero,
        cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
      },
      nextDefault,
    ),
    ...tiers.values(),
  ]
}

function modeName(model: SourceModel, mode: string) {
  return `${model.name} ${mode.charAt(0).toUpperCase()}${mode.slice(1)}`
}

function supports(model: SourceModel): readonly Variant.Support[] {
  return (model.reasoning_options ?? []).map((option) =>
    option.type === "effort"
      ? { type: "effort", values: option.values.filter((value): value is string => value !== null && value !== "null") }
      : option,
  )
}

function modelInfo(
  provider: SourceProvider,
  id: Model.ID,
  model: SourceModel,
  input: {
    readonly name?: string
    readonly cost?: Model.Info["cost"]
    readonly request?: NonNullable<NonNullable<SourceModel["experimental"]>["modes"]>[string]["provider"]
    readonly variants?: NonNullable<Model.Info["variants"]>
  } = {},
): Model.Info {
  const providerID = Provider.ID.make(provider.id)
  const resolved = nativePackage(provider, model)
  const pkg = model.provider?.npm || resolved !== nativePackage(provider) ? resolved : undefined
  // Per model, so it never merges into a model that overrides to a different package.
  const settings = {
    ...(model.provider?.api ? { baseURL: model.provider.api } : {}),
    ...(resolved === "@opencode/ai/providers/openai-compatible" ? { provider: providerID } : {}),
  }
  return {
    id,
    modelID: Model.ID.make(model.id),
    providerID,
    name: input.name ?? model.name,
    compatibility: Model.compatibility(model.interleaved),
    family: model.family ? Model.Family.make(model.family) : undefined,
    package: pkg,
    settings: Object.keys(settings).length === 0 ? undefined : settings,
    capabilities: {
      tools: model.tool_call,
      input: [...(model.modalities?.input ?? [])],
      output: [...(model.modalities?.output ?? [])],
    },
    variants: [...(input.variants ?? [])],
    time: { released: released(model.release_date) },
    cost: (input.cost ?? cost(model.cost)).map((item) => ({
      ...item,
      tier: item.tier && { ...item.tier },
      cache: { ...item.cache },
    })),
    status: model.status ?? "active",
    enabled: true,
    limit: { context: model.limit.context, input: model.limit.input, output: model.limit.output },
    headers: input.request?.headers ? { ...input.request.headers } : undefined,
    body: input.request?.body ? { ...input.request.body } : undefined,
  }
}

export { Event } from "@opencode/schema/models-dev"

export interface Interface {
  readonly get: () => Effect.Effect<readonly Snapshot[]>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export const Options = Schema.Struct({
  url: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  fetch: Schema.optional(Schema.Boolean),
  snapshot: Schema.optional(Schema.Boolean),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

const CatalogJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const decodeCatalog = (text: string) =>
  Schema.decodeUnknownEffect(CatalogJson)(text).pipe(Effect.map((catalog) => catalog as Record<string, SourceProvider>))
const Cache = Schema.Struct({
  updatedAt: Schema.Number,
  // Digest of the raw body, persisted so refresh() can skip republishing a
  // byte-identical catalog. Optional for entries written before it existed.
  digest: Schema.optional(Schema.String),
  body: CatalogJson,
})
const defaultSource = "https://models.opencode.ai"

// Bundled snapshot of https://models.opencode.ai/api.json, committed at
// packages/core/src/models-dev/snapshot.txt and refreshed via
// `bun run script/update-models-snapshot.ts`. Decoded once per isolate: the snapshot
// is a multi-MB module-level constant and one isolate can host many runtimes
// (Cloudflare colocates Durable Object instances), so per-runtime decoding would
// multiply the cost.
let bundledCache: Record<string, SourceProvider> | undefined
const bundledSnapshot = Effect.suspend(() =>
  bundledCache
    ? Effect.succeed(bundledCache)
    : decodeCatalog(snapshotText).pipe(
        Effect.map((catalog) => {
          bundledCache = catalog
          return bundledCache
        }),
      ),
)

function cacheKey(source: string) {
  if (source === defaultSource) return "models-dev:catalog"
  return `models-dev:catalog:${Hash.fast(source)}`
}

export function bodyDigest(text: string) {
  return Hash.sha256(text)
}

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const bus = yield* Bus.Service
      const app = yield* App.Metadata
      const kv = yield* KV.Service
      const http = HttpClient.filterStatusOk(
        (yield* HttpClient.HttpClient).pipe(
          HttpClient.retryTransient({
            retryOn: "errors-and-responses",
            times: 2,
            schedule: Schedule.exponential(200).pipe(Schedule.jittered),
          }),
        ),
      )

      const source = options?.url || defaultSource
      const fetch = options?.fetch ?? true
      const userAgent = App.useragent(app)
      const key = cacheKey(source)
      const kiloSource = "https://ai-gateway.kilo.ai/api/v1"
      const kiloTTL = Duration.minutes(5)
      let kiloFreeModels: Record<string, SourceModel> = {}
      let kiloUpdatedAt = 0

      const fetchKiloModels = Effect.fn("ModelsDev.fetchKiloFreeModels")(function* () {
        return yield* HttpClientRequest.get(`${kiloSource}/models`).pipe(
          HttpClientRequest.setHeader("User-Agent", userAgent),
          http.execute,
          Effect.flatMap((res) => res.text),
          Effect.timeout("5 seconds"),
          Effect.map((text) => parseKiloFreeModelsText(text)),
          Effect.catchCause((cause) =>
            Effect.logWarning("Failed to refresh Kilo's public free-model catalog", { cause }).pipe(
              Effect.as(undefined),
            ),
          ),
        )
      })
      const ttl = Duration.minutes(5)
      const lock = Semaphore.makeUnsafe(1)

      const loadFromCache = Effect.fnUntraced(function* () {
        const value = yield* kv.get(key)
        const cached = Schema.decodeUnknownOption(Cache)(value)
        if (Option.isSome(cached))
          return {
            catalog: cached.value.body as Record<string, SourceProvider>,
            updatedAt: cached.value.updatedAt,
            digest: cached.value.digest,
          }
        if (value !== undefined) yield* kv.remove(key)
      })

      const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
        return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
          HttpClientRequest.setHeader("User-Agent", userAgent),
          http.execute,
          Effect.flatMap((res) => res.text),
          Effect.timeout("10 seconds"),
        )
      })

      const loadFromFile = options?.file
        ? fs.readJson(options.file).pipe(
            Effect.map((input) => input as Record<string, SourceProvider>),
            Effect.orElseSucceed(() => undefined),
          )
        : Effect.undefined

      // The bundled snapshot is the boot-time floor for the catalog; the
      // periodic fetch below still refreshes on top.
      const loadSnapshot = options?.snapshot === false ? Effect.undefined : bundledSnapshot

      // Best-effort: a cache-write failure must never kill catalog
      // population. The payload has outgrown some KV backends' per-value
      // limits (Durable Object SQLite caps values at 2 MB and api.json
      // passed it in Aug 2026); a boot without a cache hit just refetches.
      const writeCache = Effect.fn("ModelsDev.writeCache")(function* (text: string, digest = bodyDigest(text)) {
        yield* kv.set(key, { updatedAt: Date.now(), digest, body: text }).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            (cause) => Effect.logWarning("Failed to cache models.dev catalog", { cause }),
          ),
        )
      })

      const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
        const text = yield* fetchApi()
        const catalog = yield* decodeCatalog(text)
        yield* writeCache(text)
        return catalog
      })

      const populate = Effect.gen(function* () {
        const fromFile = yield* loadFromFile
        if (fromFile) return normalize(fromFile, kiloFreeModels)
        const cached = options?.file ? undefined : yield* loadFromCache()
        if (cached) return normalize(cached.catalog, kiloFreeModels)
        const bundled = yield* loadSnapshot
        if (bundled) return normalize(bundled, kiloFreeModels)
        if (!fetch) return []
        const catalog = yield* lock.withPermit(
          Effect.gen(function* () {
            const stored = options?.file ? undefined : yield* loadFromCache()
            if (stored) return stored.catalog
            return yield* fetchAndWrite()
          }),
        )
        return normalize(catalog, kiloFreeModels)
      }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

      const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

      const get = (): Effect.Effect<readonly Snapshot[]> => cachedGet

      const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
        yield* lock
          .withPermit(
            Effect.gen(function* () {
              const stored = yield* loadFromCache()
              const now = Date.now()
              const shouldRefreshModelsDev = force || !stored || now - stored.updatedAt >= Duration.toMillis(ttl)
              const shouldRefreshKilo = force || now - kiloUpdatedAt >= Duration.toMillis(kiloTTL)
              if (!shouldRefreshModelsDev && !shouldRefreshKilo) return

              let catalogChanged = false
              if (shouldRefreshModelsDev) {
                // Model discovery is best-effort: a models.dev outage must not stop
                // the independent anonymous Kilo catalog from refreshing.
                const text = yield* fetchApi().pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("Failed to refresh models.dev catalog", { cause }).pipe(Effect.as(undefined)),
                  ),
                )
                if (text !== undefined) {
                  const digest = bodyDigest(text)
                  // models.dev rarely changes between polls; skip its cache write
                  // when the raw catalog is byte-identical.
                  if (force || stored?.digest !== digest) {
                    yield* decodeCatalog(text)
                    yield* writeCache(text, digest)
                    catalogChanged = true
                  }
                }
              }

              let kiloChanged = false
              if (shouldRefreshKilo) {
                const liveModels = yield* fetchKiloModels()
                // Keep the last known-good model list when Kilo is temporarily unavailable.
                if (liveModels !== undefined) {
                  kiloUpdatedAt = now
                  if (JSON.stringify(liveModels) !== JSON.stringify(kiloFreeModels)) {
                    kiloFreeModels = liveModels
                    kiloChanged = true
                  }
                }
              }

              if (catalogChanged || kiloChanged || force) {
                yield* invalidate
                yield* bus.publish(ModelsDev.Event.Refreshed, {})
              }
            }),
          )
          .pipe(
            Effect.tapCause((cause) => Effect.logError("Failed to refresh model catalogs", { cause: cause })),
            Effect.ignore,
          )
      })

      if (fetch && !process.argv.includes("--get-yargs-completions")) {
        // Schedule.spaced runs the effect once, then waits between completions.
        yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced(ttl)), Effect.ignore))
      }

      return Service.of({ get, refresh })
    }),
  )

export function configured(options?: Options) {
  return makeGlobalNode({
    service: Service,
    layer: layer(options),
    deps: [FSUtil.node, Bus.node, App.node, KV.node, httpClient],
  })
}

export const node = configured()

export * as ModelsDev from "./models-dev.js"
