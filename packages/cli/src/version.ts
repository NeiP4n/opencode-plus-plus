import { spawnSync } from "node:child_process"
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
      // The background service has no console, so a console program it starts unhidden flashes a window.
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

// The commit these sources are, as semver build metadata. The background service is replaced
// only when its version differs from the client's, and every commit of a checkout announced
// the same release, so after an update or a reinstall the old service kept serving the new
// client: missing fields in the API, fixes that never ran. Build metadata leaves the version's
// precedence alone, and the opencode.ai free tier accepts it.
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

// Keep an explicit build channel override when the release system supplies one. For a tagged
// release checkout, however, the source is a release build even when it is launched directly
// from the checkout rather than through the packaged binary. Leaving the channel as "local"
// makes the hosted free-tier gateway classify the otherwise valid OpenCode request as a dev
// checkout. Untagged development checkouts remain local and therefore keep the development
// semantics instead of pretending to be a release.
const channel =
  typeof OPENCODE_CHANNEL === "string" && OPENCODE_CHANNEL !== "undefined"
    ? OPENCODE_CHANNEL
    : release !== FALLBACK_VERSION
      ? "prod"
      : "local"
const artifact = typeof OPENCODE_ARTIFACT === "string" ? OPENCODE_ARTIFACT : "cli"

export { version as OPENCODE_VERSION, channel as OPENCODE_CHANNEL, artifact as OPENCODE_ARTIFACT }
export const OPENCODE_LOCAL = channel === "local"
