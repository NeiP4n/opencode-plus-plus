export * as Passport from "./passport.js"

import { arch, hostname, platform, release } from "node:os"
import path from "node:path"
import type { Room } from "@opencode/schema/room"
import { HubHost } from "./hub/host.js"
import { available } from "./hub/resolve.js"

// Output a run brings back; the rest stays on the host.
const OUTPUT_LIMIT = 20_000
// A run that outlasts this is stopped, so a guest cannot hold the host's shell forever.
const RUN_TIMEOUT_MS = 10 * 60_000

// This computer as another computer's AI sees it: system, shells, Registry tools and the
// project's git state. Plots are added by the caller, which owns that service.
export function read(directory: string): Omit<Room.Passport, "plots"> {
  return {
    machine: hostname(),
    os: platform(),
    release: release(),
    arch: arch(),
    shells: HubHost.backends(),
    tools: available(),
    project: { directory: path.basename(directory), ...git(directory) },
  }
}

// Runs one command in the project with this computer's own shell: PowerShell on Windows,
// bash elsewhere, falling back to whichever shell is installed.
export async function run(command: string, directory: string, signal?: AbortSignal): Promise<Room.RunResult> {
  const backend = HubHost.backends()[0] ?? "bash"
  const shell = HubHost.shellFor(backend) ?? (process.platform === "win32" ? "powershell" : "sh")
  const line = HubHost.executable(command, backend)
  const args = backend === "pwsh" ? ["-NoProfile", "-Command", line] : ["-c", line]
  // Tools the Registry installed into its own folders resolve the same as for the AI's commands.
  const searchPath = HubHost.spawnPath()
  const child = Bun.spawn([shell, ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...guestEnv(), [searchPath.key]: searchPath.value },
    // Runs inside the background service, which has no console: unhidden, each run flashes a window.
    windowsHide: true,
    // Its own process group, so stopping it also stops what it started in the background; a
    // leftover child would keep the output pipes open and the run would never finish.
    detached: process.platform !== "win32",
  })
  const stop = () => {
    if (process.platform === "win32") {
      Bun.spawn(["taskkill", "/pid", String(child.pid), "/t", "/f"], { stdout: "ignore", stderr: "ignore", windowsHide: true })
      return
    }
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      // The group already exited.
    }
  }
  const timer = setTimeout(stop, RUN_TIMEOUT_MS)
  signal?.addEventListener("abort", stop, { once: true })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    // A guest's run leaves nothing behind on the host once its shell exits.
    child.exited.finally(stop),
  ]).finally(() => {
    clearTimeout(timer)
    signal?.removeEventListener("abort", stop)
  })
  const output = [stdout, stderr].filter((part) => part.trim()).join("\n")
  return {
    shell: backend,
    exitCode,
    output: output.length > OUTPUT_LIMIT ? output.slice(-OUTPUT_LIMIT) : output,
    ...(output.length > OUTPUT_LIMIT ? { cut: true } : {}),
  }
}

// The output goes back to a guest, so the host's keys and tokens stay out of the command's environment.
const SECRET =
  /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|DATABASE|DB_URL|DSN|CONNECTION_STRING|REDIS_URL|MONGO_URL|MYSQL|POSTGRES|SIGNING|ENCRYPTION|CERTIFICATE|BEARER/i

function guestEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !SECRET.test(name)))
}

// Branch, commit and how many files are changed; absent outside a git checkout.
function git(directory: string) {
  const out = (args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "ignore", windowsHide: true })
    return result.exitCode === 0 ? result.stdout.toString().trim() : undefined
  }
  const branch = out(["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch === undefined) return {}
  const status = out(["status", "--porcelain"])
  return {
    branch,
    commit: out(["rev-parse", "--short", "HEAD"]),
    changed: status ? status.split("\n").length : 0,
  }
}
