import { describe, expect } from "bun:test"
import { AIError, ProviderInternalError, RateLimitError, TransportError } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import type { Bus } from "@opencode/core/bus"
import { KV } from "@opencode/core/kv"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Clock, Duration, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { it } from "./lib/effect"

const timeout = new AIError({
  reason: new TransportError({ message: "Timed out", transport: "http", operation: "request", code: "Timeout" }),
})
const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })

const input = (cause: AIError) => ({
  cause,
  error: toSessionError(cause),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }),
  hook: () => Effect.void,
  retry: SessionRunnerRetry.isRetryable(cause),
})

// Decisions for `count` consecutive failures of the same cause within one step.
const decisions = (cause: AIError, count: number) =>
  Effect.gen(function* () {
    const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
    const results: boolean[] = []
    for (let i = 0; i < count; i++) results.push((yield* policy(input(cause))).retry)
    return results
  })

describe("SessionRunnerRetry.policy", () => {
  it.effect("stops retrying transport timeouts after three attempts", () =>
    Effect.gen(function* () {
      expect(yield* decisions(timeout, 4)).toEqual([true, true, true, false])
    }),
  )

  it.effect("keeps the general allowance for other transient failures", () =>
    Effect.gen(function* () {
      expect(yield* decisions(internal, 10)).toEqual(Array(10).fill(true))
    }),
  )
})


const memoryKV = () => {
  const values = new Map<string, KV.Value>()
  const kv: KV.Interface = {
    get: (key) => Effect.succeed(values.get(key)),
    set: (key, value) => Effect.sync(() => void values.set(key, value)),
    remove: (key) => Effect.sync(() => void values.delete(key)),
    scan: (options) =>
      Effect.sync(() => {
        const limit = options.limit ?? 100
        const keys = [...values.keys()]
          .filter((key) => key.startsWith(options.prefix) && (options.after === undefined || key > options.after))
          .sort()
        const selected = keys.slice(0, limit)
        return {
          entries: selected.map((key) => ({ key, value: values.get(key)! })),
          ...(keys.length > limit && selected.length > 0 ? { next: selected[selected.length - 1] } : {}),
        }
      }),
  }
  return { kv, values }
}

function isJsonObject(value: KV.Value | undefined): value is Extract<KV.Value, Readonly<Record<string, unknown>>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const rateLimit = new AIError({
  reason: new RateLimitError({ message: "Too many requests" }),
})

// The decision-only tests never publish events; wait() has separate bus coverage.
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
const retryBus = { publish: () => Effect.void } as unknown as Bus.Interface

describe("SessionRunnerRetry shared rate-limit gate", () => {
  it.effect("keeps retrying RateLimit after the ordinary retry budget is exhausted", () =>
    Effect.gen(function* () {
      const sessionID = SessionSchema.ID.make("ses_rate_limit")
      const memory = memoryKV()
      const retry = yield* SessionRunnerRetry.make(retryBus, sessionID, memory.kv)
      const results = []
      for (let i = 0; i < 12; i++) results.push(yield* retry.decide(input(rateLimit)))

      expect(results.every((result) => result.retry)).toBe(true)
      const last = results[11]
      if (!last?.retry) throw new Error("Rate limits must remain retryable after the ordinary retry budget")
      expect(last.attempt).toBeGreaterThan(10)
      const gates = [...memory.values.entries()].filter(([key]) =>
        key.startsWith("session-runner:rate-limit:v1:provider:"),
      )
      expect(gates.length).toBe(12)
      const now = yield* Clock.currentTimeMillis
      const retryAt = gates.map(([, value]) => {
        if (!isJsonObject(value)) return 0
        return typeof value.retryAt === "number" ? value.retryAt : 0
      })
      expect(Math.max(...retryAt)).toBeGreaterThan(now)

      // The persisted provider gate caps the current pause; once it expires and a request
      // succeeds, old 429s must not leave the provider stuck at the maximum backoff.
      yield* TestClock.adjust(Duration.minutes(16))
      yield* retry.succeeded("provider")
      const recovered = yield* retry.decide(input(rateLimit))
      if (!recovered.retry) throw new Error("The provider should be eligible for another retry")
      expect(recovered.delay).toBe(2_000)
    }),
  )

  it.effect("does not delete the stable success marker while cleaning stale journal entries", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const memory = memoryKV()
      const key = "session-runner:rate-limit:v1:provider:last-success"
      memory.values.set(key, {
        version: 1,
        providerID: "provider",
        sessionID: "ses_old_success",
        retryAt: now - Duration.hours(7).pipe(Duration.toMillis),
        updatedAt: now - Duration.hours(7).pipe(Duration.toMillis),
        consecutive: 0,
        outcome: "success",
      })

      const retry = yield* SessionRunnerRetry.make(retryBus, SessionSchema.ID.make("ses_marker"), memory.kv)
      const result = yield* retry.decide(input(rateLimit))
      if (!result.retry) throw new Error("Rate limits must remain retryable")
      expect(memory.values.has(key)).toBe(true)
    }),
  )

  it.effect("scans large provider journals across KV pages", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const memory = memoryKV()
      for (let i = 0; i < 1_001; i++) {
        memory.values.set(`session-runner:rate-limit:v1:provider:${now}:seed-${i}`, {
          version: 1,
          providerID: "provider",
          sessionID: `ses_seed_${i}`,
          retryAt: now + 1_000,
          updatedAt: now,
          consecutive: 8,
          outcome: "rate-limit",
        })
      }

      const retry = yield* SessionRunnerRetry.make(retryBus, SessionSchema.ID.make("ses_paged"), memory.kv)
      const result = yield* retry.decide(input(rateLimit))
      if (!result.retry) throw new Error("Rate limits must remain retryable")
      expect(result.delay).toBeGreaterThanOrEqual(512_000)
    }),
  )

  it.effect("waits on a provider gate created by another agent session", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const memory = memoryKV()
      yield* memory.kv.set("session-runner:rate-limit:v1:provider:other-session", {
        version: 1,
        providerID: "provider",
        sessionID: "ses_other",
        retryAt: now + 1_000,
        updatedAt: now,
        consecutive: 2,
      })
      const retry = yield* SessionRunnerRetry.make(
        retryBus,
        SessionSchema.ID.make("ses_waiting"),
        memory.kv,
      )
      const waiting = yield* retry.waitForGate("provider").pipe(Effect.forkChild)
      yield* TestClock.adjust(Duration.millis(1_000))
      expect(yield* Fiber.join(waiting)).toBe(true)
    }),
  )
})
