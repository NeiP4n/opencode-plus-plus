import { describe, expect, test } from "bun:test"
import { parseWarpStatus, warpCliUnavailable, warpStatusError } from "../../src/feature-plugins/system/warp-status"

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
