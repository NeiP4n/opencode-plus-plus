import * as Warp from "@opencode/core/warp"

export type WarpConnectionState = Warp.State | "checking"
export type WarpStatus = { state: WarpConnectionState; details: string }

export const parseWarpStatus = Warp.parseStatus
export const warpCliUnavailable = Warp.unavailableStatus
export const warpStatusError = Warp.errorStatus


/** Detect a provider rate limit from the structured session error, with HTTP 429/text fallbacks. */
export function isRateLimitFailure(error: unknown): boolean {
  if (typeof error === "string") return /\brate[\s_-]*limit\b|\btoo many requests\b|\b429\b/i.test(error)
  if (!error || typeof error !== "object") return false
  const value = error as { type?: unknown; message?: unknown; status?: unknown; response?: { body?: unknown } }
  if (value.type === "provider.rate-limit") return true
  const responseBody = value.response && typeof value.response === "object" ? value.response.body : undefined
  const details = [value.type, value.message, value.status, responseBody].filter((part) => part !== undefined).join(" ")
  return /\brate[\s_-]*limit\b|\btoo many requests\b|\b429\b/i.test(details)
}
