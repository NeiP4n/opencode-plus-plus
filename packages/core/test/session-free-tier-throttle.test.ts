import { describe, expect, test } from "bun:test"
import { AIError, HttpContext, QuotaExceededError } from "@opencode/ai"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { asRateLimit, toSessionError } from "@opencode/core/session/to-session-error"

const zen = (type: string, message: string) =>
  new AIError({
    reason: new QuotaExceededError({
      message,
      body: JSON.stringify({ type: "error", error: { type, message } }),
      http: new HttpContext({ url: "https://opencode.ai/zen/v1/messages", status: 429, headers: {} }),
    }),
  })

// The Zen console counts free-tier requests per address and answers its own daily cap with this.
const freeTierCap = () => zen("FreeUsageLimitError", "Rate limit exceeded. Please try again later.")
// A plan window or a spent balance is a limit of the account itself.
const accountCap = () => zen("GoUsageLimitError", "Go usage limit exceeded")

describe("free tier throttle", () => {
  test("reports the per-address free tier cap as a rate limit", () => {
    const error = toSessionError(freeTierCap())
    expect(error.type).toBe("provider.rate-limit")
    expect(error.status).toBe(429)
    // The message names the real cause and the two ways out, instead of repeating the provider's
    // own "try again later".
    expect(error.message).toContain("per IP address")
    expect(error.message).toContain("Auto IP")
  })

  test("retries the per-address free tier cap", () => {
    expect(SessionRunnerRetry.isRetryable(asRateLimit(freeTierCap()))).toBe(true)
  })

  test("keeps account limits under the quota", () => {
    expect(toSessionError(accountCap()).type).toBe("provider.quota")
    expect(SessionRunnerRetry.isRetryable(asRateLimit(accountCap()))).toBe(false)
  })

  test("honors a provider that refuses the retry", () => {
    const refused = new AIError({
      reason: new QuotaExceededError({
        message: "Rate limit exceeded. Please try again later.",
        body: JSON.stringify({
          type: "error",
          error: { type: "FreeUsageLimitError", message: "Rate limit exceeded. Please try again later." },
        }),
        http: new HttpContext({
          url: "https://opencode.ai/zen/v1/messages",
          status: 429,
          headers: { "x-should-retry": "false" },
        }),
      }),
    })
    expect(SessionRunnerRetry.isRetryable(asRateLimit(refused))).toBe(false)
  })
})
