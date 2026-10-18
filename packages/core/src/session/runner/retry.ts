export * as SessionRunnerRetry from "./retry.js"

import { AIError, isRetryable } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { SessionError } from "@opencode/schema/session-error"
import { Clock, Duration, Effect, Pull, Schedule } from "effect"
import { Bus } from "../../bus.js"
import type { PluginHooks } from "../../plugin/hooks.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { randomUUID } from "node:crypto"
import { KV, type Interface as KVInterface } from "../../kv.js"
import { SessionSchema } from "../schema.js"

export { isRetryable }

interface Input {
  readonly cause: AIError
  readonly error: SessionError.Error
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly hook: (event: PluginHooks.Domains["session"]["retry"]) => Effect.Effect<void>
  readonly retry: boolean
}

export interface Decision {
  readonly retry: true
  readonly attempt: number
  readonly delay: number
}

/** Bound provider-requested delays so a hostile or buggy retry-after cannot stall a session for hours. */
const RETRY_AFTER_MAX = Duration.toMillis("15 minutes")

const retryAfter = (input: Input) => {
  if (input.cause.reason._tag === "RateLimit" || input.cause.reason._tag === "ProviderInternal")
    return input.cause.reason.retryAfterMs === undefined
      ? undefined
      : Math.min(input.cause.reason.retryAfterMs, RETRY_AFTER_MAX)
  return undefined
}

// Exponential from 2s capped at 10s per gap, for 10 retries: 2, 4, 8, then 10 × 7, about 84s of
// waiting when every attempt fails (67–101s with jitter). `min` takes the faster schedule, so the
// cap applies per gap; `max` with `recurs` bounds the count.
const schedule = Schedule.max([
  Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("10 seconds")]),
  Schedule.recurs(10),
]).pipe(
  Schedule.jittered,
  Schedule.setInputType<Input>(),
  Schedule.modifyDelay(({ input, duration: delay }) => {
    const minimum = retryAfter(input)
    const duration = minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum))
    return Effect.succeed(Duration.millis(Math.ceil(Duration.toMillis(duration))))
  }),
)

// A timed-out attempt already waited minutes before failing, so the general allowance would let a
// dead provider hold a step for most of an hour. Cap those attempts well below it.
const MAX_TIMEOUT_RETRIES = 3

const isTimeout = (error: AIError) => error.reason._tag === "Transport" && error.reason.code === "Timeout"

export const policy = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const step = yield* Schedule.toStep(schedule)
    let attempt = 1
    let timeouts = 0
    return (input: Input) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const next = yield* step(now, input).pipe(Pull.catchDone(() => Effect.succeed(undefined)))
        if (!next) return { retry: false as const }
        const [, duration] = next
        attempt++
        if (isTimeout(input.cause)) timeouts++
        const delay = Math.ceil(Duration.toMillis(duration))
        const event: PluginHooks.Domains["session"]["retry"] = {
          sessionID,
          agent: input.agent,
          model: input.model,
          error: input.error,
          attempt,
          decision: input.retry && timeouts <= MAX_TIMEOUT_RETRIES ? { retry: true, delay } : { retry: false },
        }
        yield* input.hook(event)
        if (!event.decision.retry) return event.decision
        const normalized =
          Number.isFinite(event.decision.delay) && event.decision.delay >= 0 ? Math.ceil(event.decision.delay) : delay
        return { retry: true as const, attempt, delay: normalized }
      })
  })

const GATE_PREFIX = "session-runner:rate-limit:v1:"
const RATE_LIMIT_COOLDOWN_MAX = Duration.toMillis("15 minutes")
const RATE_LIMIT_STREAK_WINDOW = Duration.toMillis("6 hours")

type SharedRateLimit = {
  readonly version: 1
  readonly providerID: string
  readonly sessionID: string
  readonly retryAt: number
  readonly updatedAt: number
  readonly consecutive: number
  readonly outcome: "rate-limit" | "success"
}

function providerPrefix(providerID: string) {
  return GATE_PREFIX + encodeURIComponent(providerID) + ":"
}

type KVRecord = Extract<KV.Value, Readonly<Record<string, unknown>>>

function isKVRecord(value: KV.Value | undefined): value is KVRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function decodeSharedRateLimit(value: KV.Value | undefined): SharedRateLimit | undefined {
  if (!isKVRecord(value)) return
  if (
    value.version !== 1 ||
    typeof value.providerID !== "string" ||
    typeof value.sessionID !== "string" ||
    typeof value.retryAt !== "number" ||
    !Number.isFinite(value.retryAt) ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt) ||
    typeof value.consecutive !== "number" ||
    !Number.isInteger(value.consecutive) ||
    value.consecutive < 0 ||
    (value.outcome !== undefined && value.outcome !== "rate-limit" && value.outcome !== "success") ||
    (value.outcome === "success" && value.consecutive !== 0) ||
    (value.outcome !== "success" && value.consecutive < 1)
  )
    return
  return {
    version: 1,
    providerID: value.providerID,
    sessionID: value.sessionID,
    retryAt: value.retryAt,
    updatedAt: value.updatedAt,
    consecutive: value.consecutive,
    // Entries written before success markers were introduced are rate-limit events.
    outcome: value.outcome === "success" ? "success" : "rate-limit",
  }
}

function readSharedRateLimit(kv: KVInterface, providerID: string, now: number) {
  const prefix = providerPrefix(providerID)
  let retryAt: number | undefined
  let lastSuccessAt = Number.NEGATIVE_INFINITY
  const stale: string[] = []
  const streaks: { updatedAt: number; consecutive: number }[] = []
  const scan = Effect.gen(function* () {
    let after: string | undefined
    while (true) {
      const page = yield* kv.scan({ prefix, after, limit: 1000 })
      // Process each page before fetching the next. The previous implementation retained every
      // raw KV entry and then allocated a second array of decoded states for the whole prefix.
      for (const entry of page.entries) {
        const state = decodeSharedRateLimit(entry.value)
        if (!state || state.providerID !== providerID || now - state.updatedAt >= RATE_LIMIT_STREAK_WINDOW) {
          stale.push(entry.key)
          continue
        }
        if (state.outcome === "success") lastSuccessAt = Math.max(lastSuccessAt, state.updatedAt)
        if (state.outcome === "rate-limit") {
          if (state.retryAt > now) retryAt = Math.max(retryAt ?? 0, state.retryAt)
          streaks.push({ updatedAt: state.updatedAt, consecutive: state.consecutive })
        }
      }
      if (!page.next) break
      after = page.next
    }
  })
  return Effect.gen(function* () {
    yield* scan
    const consecutive = streaks.reduce(
      (max, state) => (state.updatedAt > lastSuccessAt ? Math.max(max, state.consecutive) : max),
      0,
    )
    // Each observation is independent and safe to remove after the streak window. New rate limits
    // write unique keys, so cleaning an old entry cannot erase a concurrent provider cooldown.
    // Bound cleanup concurrency to avoid creating an unbounded number of effects after a long outage.
    yield* Effect.forEach(stale, (key) => kv.remove(key), { concurrency: 32 })
    return { retryAt, consecutive }
  })
}

function rateLimitBackoff(consecutive: number) {
  return Math.min(RATE_LIMIT_COOLDOWN_MAX, 2_000 * 2 ** Math.min(Math.max(0, consecutive - 1), 10))
}

export const make = (bus: Bus.Interface, sessionID: SessionSchema.ID, kv: KVInterface) =>
  Effect.gen(function* () {
    const scheduledDecision = yield* policy(sessionID)
    const decide = (input: Parameters<typeof scheduledDecision>[0]) =>
      Effect.gen(function* () {
        let hookRejected = false
        const decision = yield* scheduledDecision({
          ...input,
          hook: (event) =>
            Effect.gen(function* () {
              const proposed = event.decision.retry
              yield* input.hook(event)
              if (proposed && !event.decision.retry) hookRejected = true
            }),
        })
        if (input.cause.reason._tag !== "RateLimit") return decision

        const now = yield* Clock.currentTimeMillis
        const providerID = String(input.model.providerID)
        const previous = yield* readSharedRateLimit(kv, providerID, now)
        const consecutive = previous.consecutive + 1
        const retryAfterMs = input.cause.reason.retryAfterMs
        const hintedDelay =
          retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0
            ? Math.min(retryAfterMs, RATE_LIMIT_COOLDOWN_MAX)
            : 0
        const policyDelay = decision.retry ? decision.delay : 0
        const delay = Math.max(rateLimitBackoff(consecutive), hintedDelay, policyDelay)
        const retryAt = Math.max(now + delay, previous.retryAt ?? 0)
        const effectiveDelay = Math.min(RATE_LIMIT_COOLDOWN_MAX, Math.max(0, retryAt - now))
        const state: SharedRateLimit = {
          version: 1,
          providerID,
          sessionID: String(sessionID),
          retryAt: now + effectiveDelay,
          updatedAt: now,
          consecutive,
          outcome: "rate-limit",
        }
        const key = providerPrefix(providerID) + now + ":" + encodeURIComponent(String(sessionID)) + ":" + randomUUID()
        yield* kv.set(key, state)
        // Persist the shared cooldown even if a hook vetoes this session's retry: sibling agents
        // must still stop spending requests against a provider that has returned 429.
        if (hookRejected || !input.retry) return decision
        // A rate limit is a durable pause, not a finite retry budget. Once the short generic
        // schedule is exhausted, the session keeps its recorded history and retries with capped
        // exponential cooldown instead of reporting the whole task as failed.
        return {
          retry: true as const,
          attempt: decision.retry ? decision.attempt : Math.max(11, consecutive + 1),
          delay: effectiveDelay,
        }
      })

    const succeeded = (providerID: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        // One overwritten success marker resets the backoff without growing the journal per
        // successful turn. Existing future retry deadlines remain independent and are not cleared.
        yield* kv.set(providerPrefix(providerID) + "last-success", {
          version: 1,
          providerID,
          sessionID: String(sessionID),
          retryAt: now,
          updatedAt: now,
          consecutive: 0,
          outcome: "success",
        })
      })

    const gateUntil = (providerID: string) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        return (yield* readSharedRateLimit(kv, providerID, now)).retryAt
      })

    const waitForGate = (providerID: string) =>
      Effect.gen(function* () {
        let waited = false
        while (true) {
          const retryAt = yield* gateUntil(providerID)
          const now = yield* Clock.currentTimeMillis
          if (retryAt === undefined || retryAt <= now) return waited
          waited = true
          yield* Effect.sleep(Duration.millis(retryAt - now))
        }
      })

    const wait = (input: {
      readonly decision: Decision
      readonly assistantMessageID: SessionMessage.ID
      readonly error: SessionError.Error
      readonly providerID: string
    }) =>
      Effect.gen(function* () {
        const scheduled = yield* Clock.currentTimeMillis
        const sharedUntil = yield* gateUntil(input.providerID)
        const at = Math.max(scheduled + input.decision.delay, sharedUntil ?? 0)
        yield* bus.publish(SessionEvent.RetryScheduled, {
          sessionID,
          assistantMessageID: input.assistantMessageID,
          attempt: input.decision.attempt,
          at,
          error: input.error,
        })
        const remaining = Math.max(0, at - (yield* Clock.currentTimeMillis))
        yield* Effect.sleep(Duration.millis(remaining))
        // A concurrent agent may have extended the shared cooldown while we slept.
        yield* waitForGate(input.providerID)
      })
    return { decide, wait, waitForGate, succeeded }
  })
