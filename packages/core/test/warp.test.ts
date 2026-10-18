import { describe, expect, test } from "bun:test"
import {
  isManagedRegistration,
  isMissingCli,
  isWarpProxy,
  parseMode,
  parseStatus,
  parseTrace,
  proxyConfig,
  proxyUrl,
} from "@opencode/core/warp"

describe("WARP status", () => {
  test("recognizes connected and disconnected", () => {
    expect(parseStatus("Status update: Connected").state).toBe("connected")
    expect(parseStatus("Status update: Disconnected").state).toBe("disconnected")
    expect(parseStatus("Disconnected. Reason: Manual Disconnection").state).toBe("disconnected")
  })

  test("unrecognized or empty output is never reported as connected", () => {
    expect(parseStatus("Registration is valid").state).toBe("unknown")
    expect(parseStatus("   ").state).toBe("unknown")
  })
})

describe("WARP mode", () => {
  test("detects local proxy mode and its port", () => {
    expect(parseMode("Mode: WarpProxy on port 40000")).toEqual({ mode: "proxy", port: 40000 })
    expect(parseMode("(user set)\tMode: WarpProxy on port 1080\n")).toEqual({ mode: "proxy", port: 1080 })
  })

  test("full-device mode is not proxy mode", () => {
    expect(parseMode("Mode: Warp").mode).toBe("device")
    expect(parseMode("garbage").mode).toBe("unknown")
  })
})

describe("exit IP trace", () => {
  test("parses cloudflare trace output", () => {
    expect(parseTrace("fl=1\nip=104.28.1.2\ncolo=FRA\nloc=DE\nwarp=on\n")).toEqual({
      ip: "104.28.1.2",
      warp: true,
      colo: "FRA",
      loc: "DE",
    })
    expect(parseTrace("ip=1.2.3.4\nwarp=off")?.warp).toBe(false)
    expect(parseTrace("<html>blocked</html>")).toBeUndefined()
  })
})

describe("OpenCode-only proxy", () => {
  test("only points at loopback and bypasses local endpoints", () => {
    const config = proxyConfig()
    expect(config.http).toBe("http://127.0.0.1:40001")
    expect(config.no_proxy).toEqual(["localhost", "127.0.0.1", "::1"])
    expect(isWarpProxy(config)).toBe(true)
    expect(proxyConfig(40000).http).toBe("http://127.0.0.1:40000")
    expect(isWarpProxy({ http: "http://corp:8080", https: "http://corp:8080" })).toBe(false)
    expect(proxyUrl(1080)).toBe("http://127.0.0.1:1080")
  })

  test("managed registrations are protected", () => {
    expect(isManagedRegistration("Organization: acme\nTeam name: acme")).toBe(true)
    expect(isManagedRegistration("Account type: Free\nDevice ID: abc")).toBe(false)
  })

  test("detects a missing CLI on every platform", () => {
    expect(isMissingCli("spawn warp-cli ENOENT")).toBe(true)
    expect(isMissingCli("'warp-cli' is not recognized as an internal or external command")).toBe(true)
    expect(isMissingCli("Error: daemon not running")).toBe(false)
  })
})

describe("WARP daemon", () => {
  test("recognizes a stopped service", async () => {
    const { isDaemonDown } = await import("@opencode/core/warp")
    expect(isDaemonDown("Unable to connect to the CloudflareWARP daemon: os error 2\nMaybe the daemon is not running?")).toBe(true)
    expect(isDaemonDown("Status update: Connected")).toBe(false)
  })
})

describe("WARP tunnel protocol", () => {
  test("detects the WireGuard default that breaks proxy mode", async () => {
    const { usesWireGuard } = await import("@opencode/core/warp")
    expect(usesWireGuard("(consumer overrides)	WARP tunnel protocol: WireGuard")).toBe(true)
    expect(usesWireGuard("(network policy)	WARP tunnel protocol: MASQUE")).toBe(false)
  })
})

describe("config keeps the OpenCode proxy", () => {
  test("normalizing a config does not drop the proxy block", async () => {
    const { ConfigNormalize } = await import("@opencode/core/config/normalize")
    const result = ConfigNormalize.normalize({ proxy: { http: "http://127.0.0.1:40000", https: "http://127.0.0.1:40000", no_proxy: ["localhost"] } })
    expect(result.type).toBe("normalized")
    if (result.type === "normalized") expect(result.encoded.proxy).toEqual({ http: "http://127.0.0.1:40000", https: "http://127.0.0.1:40000", no_proxy: ["localhost"] })
  })
})
