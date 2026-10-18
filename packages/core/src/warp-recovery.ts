/**
 * Recovery layer for the WARP Local Proxy integration.
 *
 * Cloudflare reports `connect: Success` before the tunnel is actually usable on some Linux
 * clients. When the daemon then reports `Failed to perform happy eyeballs`, the old integration
 * stopped after one attempt and OpenCode never got a local proxy. This wrapper keeps the
 * OpenCode-only routing model, forces the protocol required by Local Proxy (MASQUE), restarts
 * the Linux daemon when necessary, and retries the connection before surfacing the error.
 */
import { execFile } from "node:child_process"
import * as Base from "./warp.ts"

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function isHappyEyeballsFailure(cause: unknown) {
  return /happy\s+eyeballs|unable to connect/i.test(messageOf(cause))
}

async function setMasque() {
  try {
    await Base.run(["tunnel", "protocol", "set", "MASQUE"])
  } catch {
    await Base.run(["set-tunnel-protocol", "masque"])
  }
}

function quiet(command: string, args: readonly string[], timeout = 8_000) {
  return new Promise<void>((resolve) => {
    execFile(command, [...args], { windowsHide: true, timeout }, () => resolve())
  })
}

async function restartDaemon() {
  if (process.platform === "linux") {
    await quiet("systemctl", ["restart", "warp-svc"])
    await wait(1_000)
    try {
      await Base.run(["status"])
      return
    } catch {}
    await quiet("pkexec", ["systemctl", "restart", "warp-svc"])
    await wait(1_000)
    return
  }

  if (process.platform === "win32") {
    await quiet("sc.exe", ["stop", "CloudflareWARP"])
    await wait(1_000)
    await quiet("sc.exe", ["start", "CloudflareWARP"])
    await wait(1_500)
    return
  }

  if (process.platform === "darwin") {
    await quiet("pkill", ["-x", "CloudflareWARP"])
    await wait(1_000)
  }
}

async function diagnosticStatus() {
  try {
    return await Base.run(["-l", "status"])
  } catch {
    return ""
  }
}

async function recover() {
  // Local Proxy is MASQUE-only. Do this unconditionally instead of relying on parsing the
  // settings output, whose wording changed between WARP releases.
  await setMasque()
  await Base.run(["disconnect"]).catch(() => undefined)
  await restartDaemon()
  await Base.run(["status"]).catch(() => undefined)
  await wait(1_000)
  return Base.connect()
}

export * from "./warp.ts"

/** Connect WARP for OpenCode only, with recovery for the Linux Happy Eyeballs failure. */
export async function connect(): Promise<Base.Status> {
  try {
    return await Base.connect()
  } catch (cause) {
    if (!isHappyEyeballsFailure(cause)) throw cause
    try {
      return await recover()
    } catch (recoveryCause) {
      const diagnostic = await diagnosticStatus()
      const original = messageOf(recoveryCause)
      const suffix = diagnostic.trim() ? ` Diagnostic: ${diagnostic.trim().slice(0, 900)}` : ""
      throw new Base.WarpError("proxy-unreachable", `${original}${suffix}`)
    }
  }
}

/** Reconnect WARP for OpenCode only, with the same recovery path. */
export async function reconnect(): Promise<Base.Status> {
  try {
    return await Base.reconnect()
  } catch (cause) {
    if (!isHappyEyeballsFailure(cause)) throw cause
    try {
      return await recover()
    } catch (recoveryCause) {
      const diagnostic = await diagnosticStatus()
      const original = messageOf(recoveryCause)
      const suffix = diagnostic.trim() ? ` Diagnostic: ${diagnostic.trim().slice(0, 900)}` : ""
      throw new Base.WarpError("proxy-unreachable", `${original}${suffix}`)
    }
  }
}
