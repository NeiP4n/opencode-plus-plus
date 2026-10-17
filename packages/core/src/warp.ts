/**
 * Cloudflare WARP integration for the OpenCode process only.
 *
 * WARP is driven in "Local Proxy" mode (warp-cli mode proxy): it exposes an HTTP/SOCKS
 * endpoint on 127.0.0.1 and does NOT touch the system routing table or DNS, so only the
 * OpenCode process (which sends its traffic through `config.proxy`) leaves through WARP.
 * Every other program keeps using the normal connection. Works on Windows, Linux and macOS.
 *
 * Nothing here runs a shell: warp-cli is always spawned with a fixed argument vector.
 */
import { execFile, execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { Agent as HttpsAgent, request as httpsRequest } from "node:https"
import { createConnection } from "node:net"
import path from "node:path"
import { HttpsProxyAgent } from "https-proxy-agent"

export const DEFAULT_PORT = 40000
export const PROXY_BYPASS = ["localhost", "127.0.0.1", "::1"] as const
const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace"
const COMMAND_TIMEOUT_MS = 20_000

export type State = "connected" | "disconnected" | "unknown" | "unavailable"
export type Mode = "proxy" | "device" | "unknown"

export type Status = { state: State; details: string }
export type ExitIp = { ip: string; warp: boolean; colo?: string; loc?: string }

export class WarpError extends Error {
  constructor(
    readonly code:
      | "cli-missing"
      | "daemon-down"
      | "not-proxy-mode"
      | "device-in-use"
      | "proxy-unreachable"
      | "managed-registration"
      | "command-failed",
    message: string,
  ) {
    super(message)
    this.name = "WarpError"
  }
}

export function proxyUrl(port = DEFAULT_PORT) {
  return `http://127.0.0.1:${port}`
}

/** The `config.proxy` value that sends only OpenCode traffic through the local WARP endpoint. */
export function proxyConfig(port = DEFAULT_PORT) {
  const url = proxyUrl(port)
  return { http: url, https: url, no_proxy: [...PROXY_BYPASS] }
}

export function isWarpProxy(value: { http?: string; https?: string } | null | undefined, port = DEFAULT_PORT) {
  const url = proxyUrl(port)
  return value?.http === url && value?.https === url
}

// ---------- pure parsers ----------

export function parseStatus(output: string): Status {
  const details = output.trim().slice(0, 2_500)
  const normalized = details.toLowerCase()
  if (!details) return { state: "unknown", details: "WARP returned an empty status." }
  if (/\b(disconnected|not\s+connected|offline)\b/.test(normalized)) return { state: "disconnected", details }
  if (/\bconnected\b/.test(normalized)) return { state: "connected", details }
  return { state: "unknown", details }
}

export function unavailableStatus(message: string): Status {
  return { state: "unavailable", details: message.trim().slice(0, 2_500) || "Cloudflare WARP CLI was not found." }
}

export function errorStatus(message: string): Status {
  return { state: "unknown", details: message.trim().slice(0, 2_500) || "Could not read WARP status." }
}

/** `warp-cli settings` prints "Mode: WarpProxy on port 40000" in proxy mode and "Mode: Warp" otherwise. */
export function parseMode(settings: string): { mode: Mode; port?: number } {
  const line = settings.split(/\r?\n/).find((entry) => /\bmode\b/i.test(entry)) ?? settings
  if (/WarpProxy|proxy/i.test(line)) {
    const port = /port\D*(\d{2,5})/i.exec(line)?.[1] ?? /port\D*(\d{2,5})/i.exec(settings)?.[1]
    return { mode: "proxy", port: port ? Number(port) : undefined }
  }
  if (/\bwarp\b|doh|dot|tunnel/i.test(line)) return { mode: "device" }
  return { mode: "unknown" }
}

/** Local Proxy mode only works over MASQUE; consumer Linux clients default to WireGuard. */
export function usesWireGuard(settings: string) {
  return /tunnel protocol:\s*wireguard/i.test(settings)
}

export function parseTrace(body: string): ExitIp | undefined {
  const fields = new Map<string, string>()
  for (const line of body.split(/\r?\n/)) {
    const index = line.indexOf("=")
    if (index > 0) fields.set(line.slice(0, index).trim(), line.slice(index + 1).trim())
  }
  const ip = fields.get("ip")
  if (!ip) return undefined
  const warp = fields.get("warp")
  return { ip, warp: warp === "on" || warp === "plus", colo: fields.get("colo"), loc: fields.get("loc") }
}

/** Managed (Zero Trust / Teams) registrations must never be deleted or recreated from here. */
export function isManagedRegistration(registration: string) {
  return /\b(organi[sz]ation|zero\s*trust|teams?\b|team\s*name)/i.test(registration)
}

/** warp-cli cannot reach warp-svc: "Unable to connect to the CloudflareWARP daemon ... Maybe the daemon is not running?" */
export function isDaemonDown(message: string) {
  return /daemon is not running|unable to connect to the .*daemon|os error 2|connection refused/i.test(message)
}

export function isMissingCli(message: string) {
  return /\bENOENT\b|not recognized as an internal or external command|executable file not found|could not find.*warp-cli/i.test(
    message,
  )
}

// ---------- CLI discovery and execution ----------

function candidatePaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432, "C:\\Program Files"].filter(
      (root): root is string => Boolean(root),
    )
    return roots.map((root) => path.win32.join(root, "Cloudflare", "Cloudflare WARP", "warp-cli.exe"))
  }
  if (platform === "darwin") {
    return ["/Applications/Cloudflare WARP.app/Contents/Resources/warp-cli", "/usr/local/bin/warp-cli", "/opt/homebrew/bin/warp-cli"]
  }
  return ["/usr/bin/warp-cli", "/bin/warp-cli", "/usr/local/bin/warp-cli", "/opt/cloudflare-warp/warp-cli"]
}

let resolvedCli: string | undefined

/**
 * `warp-cli` is not on PATH after a default Windows install, so fall back to the install directory.
 * PATH is tried first so a user-provided binary always wins.
 */
export function resolveCli(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env) {
  if (resolvedCli && existsSync(resolvedCli)) return resolvedCli
  const names = platform === "win32" ? ["warp-cli.exe", "warp-cli.cmd"] : ["warp-cli"]
  const separator = platform === "win32" ? ";" : ":"
  const dirs = (env.PATH ?? env.Path ?? "").split(separator).filter(Boolean)
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = (platform === "win32" ? path.win32 : path.posix).join(dir, name)
      if (existsSync(candidate)) return (resolvedCli = candidate)
    }
  }
  const found = candidatePaths(platform, env).find((candidate) => existsSync(candidate))
  if (found) return (resolvedCli = found)
  return undefined
}

function execCli(cli: string, args: readonly string[], timeout = COMMAND_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cli,
      [...args],
      { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 128 * 1024 },
      (error, stdout, stderr) => {
        const output = [String(stdout ?? "").trim(), String(stderr ?? "").trim()].filter(Boolean).join("\n")
        if (error) reject(new Error(output || error.message))
        else resolve(output)
      },
    )
  })
}

/** Run warp-cli with a fixed argument vector. Throws WarpError("cli-missing") when WARP is not installed. */
export async function run(args: readonly string[]): Promise<string> {
  const cli = resolveCli()
  if (!cli) throw new WarpError("cli-missing", "Cloudflare WARP CLI (warp-cli) was not found. Install Cloudflare WARP first.")
  try {
    // Linux/macOS require accepting the terms once; the flag is harmless where it is not needed.
    return await execCli(cli, ["--accept-tos", ...args])
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (isMissingCli(message)) {
      resolvedCli = undefined
      throw new WarpError("cli-missing", message)
    }
    if (isDaemonDown(message)) throw new WarpError("daemon-down", message)
    throw new WarpError("command-failed", message)
  }
}

function startCommands(platform: NodeJS.Platform): Array<[string, string[]]> {
  if (platform === "win32") {
    return [
      ["sc.exe", ["start", "CloudflareWARP"]],
      // Elevated retry: shows the normal Windows UAC prompt for the service start only.
      [
        "powershell.exe",
        ["-NoProfile", "-WindowStyle", "Hidden", "-Command", "Start-Process sc.exe -ArgumentList 'start','CloudflareWARP' -Verb RunAs -WindowStyle Hidden -Wait"],
      ],
    ]
  }
  if (platform === "linux") {
    return [
      ["systemctl", ["start", "warp-svc"]],
      ["pkexec", ["systemctl", "start", "warp-svc"]],
    ]
  }
  return []
}

/** Start the WARP background service (warp-svc) when it is stopped. Resolves true once warp-cli can talk to it. */
export async function startDaemon(platform: NodeJS.Platform = process.platform): Promise<boolean> {
  for (const [command, args] of startCommands(platform)) {
    await quiet(command, args)
    for (let index = 0; index < 15; index++) {
      try {
        await run(["status"])
        return true
      } catch (cause) {
        if (!(cause instanceof WarpError && cause.code === "daemon-down")) return true
        await wait(500)
      }
    }
  }
  return false
}

async function ensureDaemon() {
  try {
    await run(["status"])
  } catch (cause) {
    if (!(cause instanceof WarpError && cause.code === "daemon-down")) return
    if (!(await startDaemon())) {
      throw new WarpError(
        "daemon-down",
        "The WARP background service is not running and could not be started. Start the \"Cloudflare WARP\" service (or reinstall WARP) and retry.",
      )
    }
  }
}

/** Try the current CLI syntax first, then the legacy one used by older WARP releases. */
async function runAny(...variants: Array<readonly string[]>) {
  const failures: unknown[] = []
  for (const args of variants) {
    try {
      return await run(args)
    } catch (cause) {
      if (cause instanceof WarpError && (cause.code === "cli-missing" || cause.code === "daemon-down")) throw cause
      failures.push(cause)
    }
  }
  // A later variant often fails only because its syntax does not exist in this WARP version; the
  // earlier failure is the real one.
  const syntax = /unrecognized subcommand|unexpected argument|invalid value|unknown command/i
  throw failures.find((cause) => !syntax.test(cause instanceof Error ? cause.message : String(cause))) ?? failures.at(-1)
}

/** Linux/macOS clients start without a registration; settings cannot be changed until one exists. */
async function ensureRegistration() {
  const shown = await runAny(["registration", "show"], ["account"]).catch(() => "")
  if (shown && !/missing|not registered|no registration/i.test(shown)) return
  await runAny(["registration", "new"], ["register"])
}

// ---------- keep the WARP GUI out of the way ----------

function quiet(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(command, [...args], { windowsHide: true, timeout: 5_000 }, () => resolve())
  })
}

/**
 * Everything is driven through warp-cli, so the tray/desktop app is never needed. Close it if it is
 * running and stop it from starting at login. The background service (and the local proxy) keep running.
 * Only the current user's autostart is changed.
 */
export async function hideGui(platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") {
    await quiet("taskkill.exe", ["/F", "/IM", "Cloudflare WARP.exe"])
    await quiet("reg.exe", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "Cloudflare WARP", "/f"])
    // The installer registers "CloudflareWARP" under HKLM\Run, which needs admin to delete. Marking it
    // disabled in the per-user StartupApproved key stops it from starting for this user without admin.
    await quiet("reg.exe", [
      "add",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
      "/v",
      "CloudflareWARP",
      "/t",
      "REG_BINARY",
      "/d",
      "030000000000000000000000",
      "/f",
    ])
    return
  }
  if (platform === "linux") {
    await quiet("pkill", ["-x", "warp-taskbar"])
    try {
      const dir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "autostart")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        path.join(dir, "warp-taskbar.desktop"),
        ["[Desktop Entry]", "Type=Application", "Name=Cloudflare WARP", "Hidden=true", "X-GNOME-Autostart-enabled=false", ""].join("\n"),
      )
    } catch {}
    return
  }
  if (platform === "darwin") await quiet("osascript", ["-e", 'tell application "Cloudflare WARP" to quit'])
}

// ---------- state ----------

export async function status(): Promise<Status> {
  try {
    return parseStatus(await run(["status"]))
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (cause instanceof WarpError && cause.code === "cli-missing") return unavailableStatus(message)
    return errorStatus(message)
  }
}

export async function mode(): Promise<{ mode: Mode; port?: number }> {
  try {
    return parseMode(await run(["settings"]))
  } catch {
    return { mode: "unknown" }
  }
}

export function portOpen(port = DEFAULT_PORT, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const done = (value: boolean) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(800, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitForPort(port: number, attempts = 15) {
  for (let index = 0; index < attempts; index++) {
    if (await portOpen(port)) return true
    await wait(400)
  }
  return false
}

async function waitForState(target: State, attempts = 20): Promise<Status> {
  let current = await status()
  for (let index = 0; index < attempts && current.state !== target; index++) {
    await wait(400)
    current = await status()
  }
  return current
}

/** Trace the exit IP. With `port` the request goes through the local WARP proxy, without it directly. */
export function exitIp(port?: number, timeout = 8_000): Promise<ExitIp | undefined> {
  return new Promise((resolve) => {
    const request = httpsRequest(
      TRACE_URL,
      { method: "GET", timeout, // An explicit agent keeps the direct probe off any proxy inherited from the environment.
      agent: port ? new HttpsProxyAgent(proxyUrl(port)) : new HttpsAgent() },
      (response) => {
        let body = ""
        response.setEncoding("utf8")
        response.on("data", (chunk: string) => {
          if (body.length < 8_192) body += chunk
        })
        response.on("end", () => resolve(parseTrace(body)))
        response.on("error", () => resolve(undefined))
      },
    )
    request.once("timeout", () => {
      request.destroy()
      resolve(undefined)
    })
    request.once("error", () => resolve(undefined))
    request.end()
  })
}

// ---------- actions ----------

/**
 * `warp-cli connect` can return before the daemon acts on it, and switching mode or registering right
 * before it may leave the client at "Disconnected: Manual Disconnection". Ask again until it reports Connected.
 */
let lastConnectOutput = ""

async function connectUntilUp(attempts = 3): Promise<Status> {
  let current = await status()
  for (let attempt = 0; attempt < attempts && current.state !== "connected"; attempt++) {
    lastConnectOutput = (await run(["connect"])).replace(/\s+/g, " ").slice(0, 160)
    current = await waitForState("connected", 15)
    if (current.state !== "connected") await wait(1_000)
  }
  return current
}

/**
 * Put WARP into Local Proxy mode and connect it. A full-device WARP connection that is currently
 * connected is left alone: switching it would cut other applications off their tunnel.
 */
export async function ensureProxy(port = DEFAULT_PORT, options: { takeOverDevice?: boolean } = {}): Promise<Status> {
  await ensureDaemon()
  await ensureRegistration()
  const current = await mode()
  if (current.mode === "device") {
    const state = await status()
    if (state.state === "connected" && options.takeOverDevice) {
      // The user agreed: drop the device-wide tunnel so only the local proxy remains.
      await run(["disconnect"])
      await waitForState("disconnected", 10)
    } else if (state.state === "connected") {
      throw new WarpError(
        "device-in-use",
        "WARP is currently connected for the whole device. OpenCode will not switch it to Local Proxy mode because other applications would lose their tunnel. Disconnect WARP (or enable Local Proxy yourself) and retry.",
      )
    }
  }
  if (current.mode !== "proxy") await runAny(["mode", "proxy"], ["set-mode", "proxy"])
  if (current.port !== port) await runAny(["proxy", "port", String(port)], ["set-proxy-port", String(port)]).catch(() => undefined)

  const confirmed = await mode()
  if (confirmed.mode !== "proxy") {
    throw new WarpError(
      "not-proxy-mode",
      "WARP did not confirm Local Proxy mode. Enable it in Preferences > Advanced > Configure Proxy and retry. OpenCode's proxy settings were not changed.",
    )
  }
  const effectivePort = confirmed.port ?? port
  // "Proxy mode only supports MASQUE": with WireGuard, connect says Success and the tunnel silently fails.
  const settings = await run(["settings"]).catch(() => "")
  if (usesWireGuard(settings)) {
    await runAny(["tunnel", "protocol", "set", "MASQUE"], ["set-tunnel-protocol", "masque"])
  }
  await hideGui()
  // A first connection after registering can take several seconds before the proxy starts listening.
  const connected = await connectUntilUp()
  if (!(await waitForPort(effectivePort, 25))) {
    throw new WarpError(
      "proxy-unreachable",
      `The WARP local proxy is not listening on 127.0.0.1:${effectivePort}. WARP says: ${connected.details.replace(/\s+/g, " ").slice(0, 160)}. connect said: ${lastConnectOutput || "(nothing)"}`,
    )
  }
  return status()
}

async function requireProxyMode() {
  if ((await mode()).mode !== "proxy") {
    throw new WarpError(
      "not-proxy-mode",
      "WARP is not in Local Proxy mode, so it would affect the whole device. Enable the OpenCode WARP proxy first.",
    )
  }
}

export async function connect(): Promise<Status> {
  await requireProxyMode()
  return connectUntilUp()
}

export async function disconnect(): Promise<Status> {
  await requireProxyMode()
  await run(["disconnect"])
  return waitForState("disconnected")
}

export async function reconnect(): Promise<Status> {
  await requireProxyMode()
  await run(["disconnect"]).catch(() => undefined)
  await waitForState("disconnected", 10)
  return connectUntilUp()
}

/** Recreate the personal registration. Refuses Zero Trust / organization-managed devices. */
export async function resetRegistration(): Promise<Status> {
  await requireProxyMode()
  const registration = await runAny(["registration", "show"], ["account"]).catch(() => "")
  if (isManagedRegistration(registration)) {
    throw new WarpError(
      "managed-registration",
      "This WARP client is managed by an organization (Zero Trust). Its registration cannot be reset from OpenCode.",
    )
  }
  await run(["disconnect"]).catch(() => undefined)
  await wait(900)
  await runAny(["registration", "delete"], ["delete"]).catch(() => undefined)
  await runAny(["registration", "new"], ["register"])
  return connectUntilUp()
}

export type Rotation = { before?: ExitIp; after?: ExitIp; changed: boolean; usedNewRegistration: boolean; status: Status }

/**
 * Change the exit IP seen by OpenCode. A plain reconnect is tried first; when WARP hands back the
 * same address, a fresh personal registration is created. Only the Local Proxy endpoint is used to
 * verify the result, so nothing outside OpenCode is touched.
 */
export async function rotate(port = DEFAULT_PORT): Promise<Rotation> {
  await requireProxyMode()
  const effectivePort = (await mode()).port ?? port
  const before = await exitIp(effectivePort)

  let state = await reconnect()
  let after = await waitForExit(effectivePort)
  let usedNewRegistration = false

  if (before && after && before.ip === after.ip) {
    try {
      state = await resetRegistration()
      usedNewRegistration = true
      after = await waitForExit(effectivePort)
    } catch (cause) {
      if (!(cause instanceof WarpError && cause.code === "managed-registration")) throw cause
    }
  }
  return { before, after, changed: Boolean(before && after && before.ip !== after.ip), usedNewRegistration, status: state }
}

async function waitForExit(port: number, attempts = 6) {
  for (let index = 0; index < attempts; index++) {
    const result = await exitIp(port)
    if (result) return result
    await wait(700)
  }
  return undefined
}

// ---------- shut WARP down with the last OpenCode ----------

const usersDir = () => path.join(tmpdir(), "opencode-warp-users")

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    // EPERM still means the process exists.
    return (cause as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** Record that this OpenCode process relies on the local WARP proxy. */
export function markInUse() {
  try {
    mkdirSync(usersDir(), { recursive: true })
    writeFileSync(path.join(usersDir(), String(process.pid)), "")
  } catch {}
}

/**
 * Called when this OpenCode process stops using WARP (exit or proxy turned off). Synchronous so it can run in
 * an `exit` handler. WARP is disconnected only when no other live OpenCode still depends on it and it is in
 * Local Proxy mode, so a device-wide WARP connection or another app's proxy is never touched.
 */
export function releaseSync(options: { disconnect: boolean } = { disconnect: true }) {
  try {
    rmSync(path.join(usersDir(), String(process.pid)), { force: true })
  } catch {}
  if (!options.disconnect) return
  let others = 0
  try {
    for (const name of readdirSync(usersDir())) {
      const pid = Number(name)
      if (!Number.isInteger(pid) || pid === process.pid) continue
      if (alive(pid)) others++
      else rmSync(path.join(usersDir(), name), { force: true })
    }
  } catch {}
  if (others > 0) return
  const cli = resolveCli()
  if (!cli) return
  try {
    const settings = execFileSync(cli, ["--accept-tos", "settings"], { encoding: "utf8", windowsHide: true, timeout: 5_000 })
    if (parseMode(settings).mode !== "proxy") return
    execFileSync(cli, ["--accept-tos", "disconnect"], { windowsHide: true, timeout: 8_000, stdio: "ignore" })
  } catch {}
}
