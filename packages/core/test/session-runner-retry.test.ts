import { describe, expect } from "bun:test"
import { AIError, ProviderInternalError, RateLimitError, TransportError } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import type { Bus } from "@opencode/core/bus"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Duration, Effect } from "effect"
import { it } from "./lib/effect"

const timeout = new AIError({
  reason: new TransportError({ message: "Timed out", transport: "http", operation: "request", code: "Timeout" }),
})
const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })
const rateLimit = new AIError({ reason: new RateLimitError({ message: "Too many requests" }) })

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

// The decision-only tests never publish events; wait() has separate bus coverage.
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
const retryBus = { publish: () => Effect.void } as unknown as Bus.Interface

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

  it.effect("ignores invalid Retry-After values from provider metadata", () =>
    Effect.gen(function* () {
      for (const retryAfterMs of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
        const cause = new AIError({
          reason: new RateLimitError({ message: "Too many requests", retryAfterMs }),
        })
        const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_invalid_retry_after"))
        const decision = yield* policy(input(cause))
        expect(decision.retry).toBe(true)
        if (decision.retry) {
          expect(Number.isFinite(decision.delay)).toBe(true)
          expect(decision.delay).toBeGreaterThanOrEqual(0)
          expect(decision.delay).toBeLessThanOrEqual(Duration.toMillis("15 minutes"))
        }
      }
    }),
  )
})

describe("SessionRunnerRetry", () => {
  it.effect("treats a provider rate limit as an ordinary retryable failure", () =>
    Effect.gen(function* () {
      const retry = yield* SessionRunnerRetry.make(retryBus, SessionSchema.ID.make("ses_rate_limit"))
      const decision = yield* retry.decide(input(rateLimit))
      expect(decision.retry).toBe(true)
      if (!decision.retry) throw new Error("A rate limit must stay retryable")
      // Rate limits are per session now: the delay stays inside the ordinary retry schedule
      // instead of installing a provider-wide cooldown that sibling sessions would inherit.
      expect(decision.delay).toBeLessThanOrEqual(Duration.toMillis("10 seconds"))
    }),
  )
})
