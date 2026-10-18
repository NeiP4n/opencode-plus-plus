import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "path"

declare const OPENCODE_VERSION: string
declare const OPENCODE_CHANNEL: string
declare const OPENCODE_ARTIFACT: string

// A dev checkout run straight from source (bun src/index.ts) has no compile-time define,
// so the version would fall back to "local" and the opencode.ai free tier would reject the
// client as below 1.18.0. Resolve the tagged release like the build script does, and fall
// back to a known-good floor when there is no tag or git is unavailable.
const MINIMUM_ANNOUNCED_VERSION = "1.18.0"
const FALLBACK_VERSION = "2.0.0"

// The tag describes the checkout these sources were cut from, not wherever the CLI happens
// to be started: a project directory is the cwd, so a lookup that follows cwd silently falls
// back for every project that is not this repository, and the announced version stops matching
// the build the free tier is asked to accept.
const REPO_ROOT = path.resolve(import.meta.dir, "../../..")

function gitTagVersion(): string | undefined {
  try {
    const out = spawnSync("git", ["describe", "--tags", "--abbrev=0"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })
    if (out.status !== 0) return undefined
    const tag = out.stdout.trim().replace(/^v/, "")
    const match = tag.match(/^\d+\.\d+\.\d+/)
    if (!match) return undefined
    return match[0]
  } catch {
    return undefined
  }
}

function gitCommit(): string | undefined {
  try {
    const out = spawnSync("git", ["rev-parse", "--short=9", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    })
    if (out.status !== 0) return undefined
    return out.stdout.trim() || undefined
  } catch {
    return undefined
  }
}

const [floorMajor, floorMinor] = MINIMUM_ANNOUNCED_VERSION.split(".").map(Number)

const release = releaseVersion()
const commit = gitCommit()

const version = (() => {
  if (typeof OPENCODE_VERSION === "string" && OPENCODE_VERSION !== "undefined") return OPENCODE_VERSION
  return commit ? `${release}+${commit}` : release
})()

function releaseVersion() {
  const tag = gitTagVersion()
  if (!tag) return FALLBACK_VERSION
  const [major, minor] = tag.split(".").map(Number)
  if (major > floorMajor || (major === floorMajor && minor >= floorMinor)) return tag
  return FALLBACK_VERSION
}

// An Opencode++ source install has its own updater: release/* tags and the lan-rooms
// development branch are managed by source-release.ts. Do not send these checkouts to the
// public opencode.ai updater, otherwise /upgrade offers an upstream OpenCode version.
// The marker is kept in the repository and is not shipped by normal package installations.
const OPENCODE_PLUS_PLUS_SOURCE = existsSync(path.join(REPO_ROOT, "script", "release-pp.ts"))

const rawChannel =
  typeof OPENCODE_CHANNEL === "string" && OPENCODE_CHANNEL !== "undefined"
    ? OPENCODE_CHANNEL
    : release !== FALLBACK_VERSION
      ? "latest"
      : "local"
const channel = OPENCODE_PLUS_PLUS_SOURCE ? "local" : rawChannel === "prod" ? "latest" : rawChannel
const artifact = typeof OPENCODE_ARTIFACT === "string" ? OPENCODE_ARTIFACT : "cli"

export { version as OPENCODE_VERSION, channel as OPENCODE_CHANNEL, artifact as OPENCODE_ARTIFACT }
export const OPENCODE_LOCAL = channel === "local"
