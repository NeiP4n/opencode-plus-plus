import { describe, expect, test } from "bun:test"
import { isAutoRotationFailure, isRateLimitFailure, parseWarpStatus, warpCliUnavailable, warpStatusError } from "../../src/feature-plugins/system/warp-status"

describe("WARP status parsing", () => {
  test("recognizes a connected tunnel", () => {
    expect(parseWarpStatus("Status update: Connected")).toEqual({
      state: "connected",
      details: "Status update: Connected",
    })
  })

  test("recognizes a disconnected tunnel", () => {
    expect(parseWarpStatus("Status update: Disconnected").state).toBe("disconnected")
  })

  test("treats unrecognized output as unknown, not connected", () => {
    expect(parseWarpStatus("Registration is valid").state).toBe("unknown")
  })

  test("returns an error state for empty status output", () => {
    expect(parseWarpStatus("")).toEqual({
      state: "unknown",
      details: "WARP returned an empty status.",
    })
  })

  test("distinguishes a missing CLI from an unavailable status", () => {
    expect(warpCliUnavailable("spawn warp-cli ENOENT").state).toBe("unavailable")
    expect(warpStatusError("permission denied").state).toBe("unknown")
  })
})


describe("WARP automatic IP rotation trigger", () => {
  test("recognizes the structured provider RateLimit error", () => {
    expect(isRateLimitFailure({ type: "provider.rate-limit", message: "Request failed" })).toBe(true)
  })

  test("recognizes HTTP 429 and rate-limit messages", () => {
    expect(isRateLimitFailure({ type: "provider.internal", status: 429, message: "Request failed" })).toBe(true)
    expect(isRateLimitFailure("Too many requests: rate limit exceeded")).toBe(true)
  })

  test("does not rotate for unrelated quota or transport errors", () => {
    expect(isRateLimitFailure({ type: "provider.quota", message: "Quota exhausted" })).toBe(false)
    expect(isRateLimitFailure({ type: "provider.transport", message: "Connection reset" })).toBe(false)
  })
})


describe("WARP automatic IP rotation for network failures", () => {
  test("recognizes ECONNREFUSED provider errors", () => {
    expect(isAutoRotationFailure({
      type: "provider.transport",
      message: "ECONNREFUSED: Unable to connect. Is the computer able to access the url?",
    })).toBe(true)
  })

  test("recognizes network codes nested in Error.cause", () => {
    expect(isAutoRotationFailure({
      type: "provider.transport",
      message: "fetch failed",
      cause: Object.assign(new Error("connect failed"), { code: "ECONNRESET" }),
    })).toBe(true)
  })

  test("still ignores unrelated application failures", () => {
    expect(isAutoRotationFailure({ type: "provider.invalid-request", message: "Invalid model name" })).toBe(false)
    expect(isAutoRotationFailure({ type: "provider.quota", message: "Quota exhausted" })).toBe(false)
  })
})
