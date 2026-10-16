export * as SourceRelease from "./source-release"

import { $ } from "bun"
import path from "node:path"
import { parseReleaseVersion } from "./updater-action"

// Opencode++ is shared as a git checkout pinned to a release tag (release/1.2.0),
// installed by opencode-pp-install.sh or .ps1. Such a checkout updates by moving to the
// newest release tag on its origin. Before the first release the installer checks out its
// branch detached instead (origin/lan-rooms), and that checkout follows the branch the
// same way. A checkout on a branch is a development tree: it only fast-forwards to its
// upstream, so local work is never rewritten or merged.

const PREFIX = "release/"
// The branch the installer falls back to, under the same override it reads.
const INSTALL_BRANCH = process.env.OPENCODE_PP_BRANCH || "lan-rooms"
const checkout = path.resolve(import.meta.dir, "../../../..")

// The release this checkout is pinned to, or undefined for a development tree.
export async function current(root = checkout) {
  // Installs sit on a detached tag; a branch is a development tree even right
  // after its commit was tagged for release.
  const branch = await $`git -C ${root} symbolic-ref -q HEAD`.quiet().nothrow()
  if (branch.exitCode === 0) return undefined
  const tag = await $`git -C ${root} describe --tags --exact-match --match ${PREFIX + "*"} HEAD`
    .quiet()
    .nothrow()
    .text()
  return version(tag.trim())
}

// Whether the checkout sits on a commit rather than a branch: an install, pinned to a
// release or following the installer's branch.
export async function detached(root = checkout) {
  return (await $`git -C ${root} symbolic-ref -q HEAD`.quiet().nothrow()).exitCode !== 0
}

// The newest release published on origin.
export async function latest(root = checkout) {
  const listing = await $`git -C ${root} ls-remote --tags --refs origin ${PREFIX + "*"}`.quiet().text()
  return newest(
    listing
      .split("\n")
      .map((line) => version(line.split("\t")[1]?.replace("refs/tags/", "") ?? ""))
      .filter((item): item is string => item !== undefined),
  )
}

// Moves the checkout to a release and installs its dependencies.
export async function apply(release: string, root = checkout) {
  // Without --force a release tag that moved on origin fails the fetch instead of
  // silently replacing the code this checkout already trusts.
  await $`git -C ${root} fetch --tags origin`.quiet()
  return keepingEdits(root, async () => {
    await $`git -C ${root} checkout --detach ${"refs/tags/" + PREFIX + release}`.quiet()
    // The running Bun, so the update works even when bun is not on PATH.
    // Only what the terminal app needs, as the installer does.
    await $`${process.execPath} install --frozen-lockfile --filter ./packages/cli`.cwd(root).quiet()
  })
}

// What became of the edits an install had when it updated: put back on top of the new code,
// or kept in the stash because they clash with it.
export type Kept = { readonly type: "restored" } | { readonly type: "stashed"; readonly files: readonly string[] }

// An install is not a workspace, yet an AI session or a hand edit may leave changes in it, and
// git then refuses every checkout that touches those files, so updates stop for good. The edits
// are set aside for the move and put back after it; when they clash with the new code the
// install stays on the clean update and the edits wait in the stash. A move that fails puts
// the edits back where they were.
export async function keepingEdits(root: string, move: () => Promise<void>): Promise<Kept | undefined> {
  if (!(await $`git -C ${root} status --porcelain`.quiet().text()).trim()) {
    await move()
    return undefined
  }
  const label = `opencode-pp update ${new Date().toISOString()}`
  await $`git -C ${root} stash push --include-untracked --message ${label}`.quiet()
  await move().catch(async (error) => {
    await $`git -C ${root} stash pop`.quiet().nothrow()
    throw error
  })
  if ((await $`git -C ${root} stash pop`.quiet().nothrow()).exitCode === 0) return { type: "restored" }
  // A clashing pop leaves conflict markers in the code that is about to run and keeps the
  // stash, so the half-applied edits are dropped and the stash still holds all of them.
  const files = (
    await $`git -C ${root} stash show --include-untracked --name-only ${"stash@{0}"}`.quiet().nothrow().text()
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  await $`git -C ${root} reset --hard --quiet`.quiet()
  return { type: "stashed", files }
}

export function newest(versions: readonly string[]) {
  return versions.toSorted((a, b) => Bun.semver.order(b, a))[0]
}

function version(tag: string) {
  if (!tag.startsWith(PREFIX)) return undefined
  const value = tag.slice(PREFIX.length)
  return parseReleaseVersion(value) ? value : undefined
}

// Refresh the exact remote-tracking ref used by the branch. A plain fetch from a remote
// follows remote.<name>.fetch; custom/narrow refspecs can omit this branch and leave a stale
// refs/remotes/<remote>/<branch>, making /update falsely report that the checkout is current.
async function refreshTracking(root: string, target: string) {
  const slash = target.indexOf("/")
  if (slash <= 0) throw new Error(`Unsupported upstream reference: ${target}`)
  const remote = target.slice(0, slash)
  const branch = target.slice(slash + 1)
  const refspec = `+refs/heads/${branch}:refs/remotes/${target}`
  await `git -C ${root} fetch --quiet ${remote} ${refspec}`.quiet()
}

export type Branch =
  | { readonly type: "behind"; readonly name: string; readonly behind: number }
  | { readonly type: "current" }
  | { readonly type: "diverged" }
  | { readonly type: "no-upstream" }

// Where the development branch stands against its upstream after a fetch, or
// undefined when the checkout is not on a branch.
export async function branch(root = checkout): Promise<Branch | undefined> {
  const name = (await $`git -C ${root} symbolic-ref -q --short HEAD`.quiet().nothrow().text()).trim()
  if (!name) return undefined
  const upstream = await $`git -C ${root} rev-parse --abbrev-ref --symbolic-full-name @{u}`.quiet().nothrow()
  let target: string
  if (upstream.exitCode === 0) {
    target = upstream.text().trim()
    await refreshTracking(root, target)
  } else {
    // Some source installs have the right branch checked out but no upstream configured.
    // If origin carries the same branch, use it for update checks without requiring a reinstall.
    target = `origin/${name}`
    const fetched = await refreshTracking(root, target).then(
      () => true,
      () => false,
    )
    if (!fetched) return { type: "no-upstream" }
  }
  const comparison = await $`git -C ${root} rev-list --left-right --count ${"HEAD..." + target}`.quiet().nothrow()
  if (comparison.exitCode !== 0) return { type: "no-upstream" }
  const [ahead, behind] = comparison.text().trim().split(/\s+/).map(Number)
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return { type: "no-upstream" }
  if (!behind) return { type: "current" }
  if (ahead) return { type: "diverged" }
  return { type: "behind", name, behind }
}

export type Install =
  | { readonly type: "behind"; readonly branch: string; readonly behind: number }
  | { readonly type: "current" }
  | { readonly type: "ahead" }

// Where a detached install that follows the installer's branch stands against origin, after
// a fetch: the same state running the installer again would move it to.
export async function install(root = checkout): Promise<Install> {
  // Name the destination ref explicitly. Fetching a branch by name alone can update
  // FETCH_HEAD without refreshing origin/<branch> when the clone has a narrow/custom
  // remote.origin.fetch refspec. Comparing HEAD with that stale tracking ref then falsely
  // reports "current" on installs that are actually behind.
  const refspec = `+refs/heads/${INSTALL_BRANCH}:refs/remotes/origin/${INSTALL_BRANCH}`
  await $`git -C ${root} fetch --quiet origin ${refspec}`.quiet()
  const [ahead, behind] = (
    await $`git -C ${root} rev-list --left-right --count ${"HEAD...origin/" + INSTALL_BRANCH}`.quiet().text()
  )
    .trim()
    .split(/\s+/)
    .map(Number)
  if (ahead) return { type: "ahead" }
  if (!behind) return { type: "current" }
  return { type: "behind", branch: INSTALL_BRANCH, behind }
}

// What the installer does without a release: the branch's newest commit, detached, and the
// dependencies the terminal app needs. Local edits are set aside for the move (see keepingEdits).
export async function follow(root = checkout) {
  return keepingEdits(root, async () => {
    await $`git -C ${root} checkout --quiet --detach ${"origin/" + INSTALL_BRANCH}`.quiet()
    await $`${process.execPath} install --frozen-lockfile --filter ./packages/cli`.cwd(root).quiet()
  })
}

// Fast-forwards the branch to its upstream and installs what the new code needs.
// Uncommitted edits stay; git refuses the merge if the incoming commits touch them.
export async function pull(root = checkout) {
  const upstream = await `git -C ${root} rev-parse --abbrev-ref --symbolic-full-name @{u}`.quiet().nothrow()
  if (upstream.exitCode === 0) {
    await refreshTracking(root, upstream.text().trim())
    await `git -C ${root} merge --ff-only @{u}`.quiet()
  } else {
    // Match branch() fallback: update from origin/<current branch> when no upstream is configured.
    const name = (await `git -C ${root} symbolic-ref -q --short HEAD`.quiet().nothrow().text()).trim()
    if (!name) throw new Error("Cannot update a detached checkout without a release version")
    const target = `origin/${name}`
    await refreshTracking(root, target)
    await `git -C ${root} merge --ff-only ${target}`.quiet()
  }
  await $`${process.execPath} install`.cwd(root).quiet()
}
