import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
  OPENCODE_RELEASE: process.env["OPENCODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL
  if (env.OPENCODE_BUMP) return "latest"
  if (env.OPENCODE_VERSION && !env.OPENCODE_VERSION.startsWith("0.0.0-")) return "latest"
  const branch = await $`git branch --show-current`.text().then((x) => x.trim())
  if (!branch) return "detached"
  const channel = branch.replace(/[^a-zA-Z0-9._-]/g, "-")
  if (/^[a-zA-Z0-9]/.test(channel)) return channel
  return `branch-${channel}`
})()
const IS_PREVIEW = CHANNEL !== "latest"
// OpenCode Zen requires a recent semver in User-Agent. Preview/branch channels are not
// release channels, so never put their names in the version or claim the latest channel. Keep
// the nearest supported stable release as the base and append the exact source commit as build
// metadata; this is valid semver and lets the background service distinguish rebuilt checkouts.
const MINIMUM_ANNOUNCED_VERSION = "1.18.0"
const FALLBACK_VERSION =
  typeof rootPkg.version === "string" &&
  semver.valid(rootPkg.version) &&
  semver.gte(rootPkg.version, MINIMUM_ANNOUNCED_VERSION)
    ? rootPkg.version
    : "2.0.0"

const VERSION = await (async () => {
  if (!IS_PREVIEW) {
    if (env.OPENCODE_VERSION) return env.OPENCODE_VERSION
    const version = await fetch("https://registry.npmjs.org/@opencode%2fcli/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.version)
    if (semver.lt(version, "2.0.0")) return "2.0.0"
    const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
    const t = env.OPENCODE_BUMP?.toLowerCase()
    if (t === "major") return `${major + 1}.0.0`
    if (t === "minor") return `${major}.${minor + 1}.0`
    return `${major}.${minor}.${patch + 1}`
  }

  const requested = env.OPENCODE_VERSION?.split("+")[0]
  const tagged = await releaseTagVersion()
  const candidate = requested && semver.valid(requested) ? requested : tagged
  const base =
    candidate &&
    semver.prerelease(candidate) === null &&
    semver.gte(candidate, MINIMUM_ANNOUNCED_VERSION)
      ? candidate
      : FALLBACK_VERSION
  const commit = await gitCommit()
  return commit ? `${base}+${commit}` : base
})()

async function gitCommit() {
  return await $`git rev-parse --short=9 HEAD`
    .quiet()
    .text()
    .then((value) => value.trim() || undefined)
    .catch(() => undefined)
}

// Tags below the supported version floor and untagged checkouts use the fallback release version.

async function releaseTagVersion() {
  const tag = await $`git describe --tags --abbrev=0`
    .text()
    .then((x) => x.trim().replace(/^(?:v|release\/)/, ""))
    .catch(() => "")
  if (!semver.valid(tag)) return undefined
  return semver.lt(tag, MINIMUM_ANNOUNCED_VERSION) ? undefined : tag
}

const bot = ["actions-user", "opencode", "opencode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.OPENCODE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`opencode script`, JSON.stringify(Script, null, 2))
