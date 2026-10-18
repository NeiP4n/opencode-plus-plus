export * as SourceRelease from "./source-release"

import { $ } from "bun"
import path from "node:path"
import { parseReleaseVersion } from "./updater-action"

const PREFIX = "release/"
const INSTALL_BRANCH = process.env.OPENCODE_PP_BRANCH || "lan-rooms"
const checkout = path.resolve(import.meta.dir, "../../../..")
const DEPENDENCY_TIMEOUT_MS = 5 * 60 * 1000
const VALIDATION_TIMEOUT_MS = 2 * 60 * 1000

export async function current(root = checkout) {
  const branch = await $`git -C ${root} symbolic-ref -q HEAD`.quiet().nothrow()
  if (branch.exitCode === 0) return undefined
  const tag = await $`git -C ${root} describe --tags --exact-match --match ${PREFIX + "*"} HEAD`.quiet().nothrow().text()
  return version(tag.trim())
}

export async function detached(root = checkout) {
  return (await $`git -C ${root} symbolic-ref -q HEAD`.quiet().nothrow()).exitCode !== 0
}

export async function latest(root = checkout) {
  const listing = await $`git -C ${root} ls-remote --tags --refs origin ${PREFIX + "*"}`.quiet().text()
  return newest(
    listing.split("\n").map((line) => version(line.split("\t")[1]?.replace("refs/tags/", "") ?? "")).filter((item): item is string => item !== undefined),
  )
}

export async function apply(release: string, root = checkout) {
  await $`git -C ${root} fetch --tags origin`.quiet()
  return keepingEdits(root, async () => {
    const previous = (await $`git -C ${root} rev-parse HEAD`.quiet().text()).trim()
    try {
      if (parseReleaseVersion(release)) {
        await $`git -C ${root} checkout --detach ${"refs/tags/" + PREFIX + release}`.quiet()
      } else {
        await checkoutDevelopmentBranch(root)
      }
      await installDependencies(root)
      await validateServer(root)
    } catch (error) {
      await $`git -C ${root} reset --hard --quiet ${previous}`.quiet().nothrow()
      throw error
    }
  })
}

export type Kept = { readonly type: "restored" } | { readonly type: "stashed"; readonly files: readonly string[] }

/**
 * Preserve tracked source edits while updating, but never stash untracked runtime state.
 * .opencode/index, caches, leases, failed batches and similar files are intentionally
 * local runtime data and must survive an update in place rather than being replayed by
 * `git stash pop`. Replaying those files is what caused /upgrade to report a huge list of
 * conflicts after a successful update.
 */
export async function keepingEdits(root: string, move: () => Promise<void>): Promise<Kept | undefined> {
  const trackedChanges = (await $`git -C ${root} status --porcelain --untracked-files=no`.quiet().text()).trim()
  if (!trackedChanges) {
    await move()
    return undefined
  }

  const label = `opencode-pp update ${new Date().toISOString()}`
  await $`git -C ${root} stash push --message ${label}`.quiet()
  try {
    await move()
  } catch (error) {
    await $`git -C ${root} stash pop`.quiet().nothrow()
    throw error
  }

  if ((await $`git -C ${root} stash pop`.quiet().nothrow()).exitCode === 0) return { type: "restored" }

  const files = (
    await $`git -C ${root} stash show --name-only ${"stash@{0}"}`.quiet().nothrow().text()
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

async function refreshTracking(root: string, target: string) {
  const slash = target.indexOf("/")
  if (slash <= 0) throw new Error(`Unsupported upstream reference: ${target}`)
  const remote = target.slice(0, slash)
  const branch = target.slice(slash + 1)
  const refspec = `+refs/heads/${branch}:refs/remotes/${target}`
  await $`git -C ${root} fetch --quiet ${remote} ${refspec}`.quiet()
}

async function checkoutDevelopmentBranch(root: string) {
  const target = `origin/${INSTALL_BRANCH}`
  await refreshTracking(root, target)
  await $`git -C ${root} checkout --quiet --detach ${target}`.quiet()
}

export type Branch =
  | { readonly type: "behind"; readonly name: string; readonly behind: number }
  | { readonly type: "current" }
  | { readonly type: "diverged" }
  | { readonly type: "no-upstream" }

export async function branch(root = checkout): Promise<Branch | undefined> {
  const name = (await $`git -C ${root} symbolic-ref -q --short HEAD`.quiet().nothrow().text()).trim()
  if (!name) return undefined
  const upstream = await $`git -C ${root} rev-parse --abbrev-ref --symbolic-full-name @{u}`.quiet().nothrow()
  let target: string
  if (upstream.exitCode === 0) {
    target = upstream.text().trim()
    await refreshTracking(root, target)
  } else {
    target = `origin/${name}`
    const fetched = await refreshTracking(root, target).then(() => true, () => false)
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

export async function install(root = checkout): Promise<Install> {
  const refspec = `+refs/heads/${INSTALL_BRANCH}:refs/remotes/origin/${INSTALL_BRANCH}`
  await $`git -C ${root} fetch --quiet origin ${refspec}`.quiet()
  const [ahead, behind] = (await $`git -C ${root} rev-list --left-right --count ${"HEAD...origin/" + INSTALL_BRANCH}`.quiet().text()).trim().split(/\s+/).map(Number)
  if (ahead) return { type: "ahead" }
  if (!behind) return { type: "current" }
  return { type: "behind", branch: INSTALL_BRANCH, behind }
}

export async function follow(root = checkout) {
  return keepingEdits(root, async () => {
    const previous = (await $`git -C ${root} rev-parse HEAD`.quiet().text()).trim()
    try {
      await checkoutDevelopmentBranch(root)
      await installDependencies(root)
      await validateServer(root)
    } catch (error) {
      await $`git -C ${root} reset --hard --quiet ${previous}`.quiet().nothrow()
      throw error
    }
  })
}

async function installDependencies(root: string) {
  const result = await $`${process.execPath} install --frozen-lockfile`.cwd(root).nothrow().quiet().timeout(DEPENDENCY_TIMEOUT_MS)
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim() || result.stdout.toString().trim()
    throw new Error(detail || `Dependency installation failed with exit code ${result.exitCode}`)
  }
}

async function validateServer(root: string) {
  const result = await $`${process.execPath} --cwd packages/server run typecheck`.cwd(root).nothrow().timeout(VALIDATION_TIMEOUT_MS)
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim() || result.stdout.toString().trim() || `Server typecheck exited with code ${result.exitCode}`
    throw new Error(`OpenCode++ update validation failed:\n${detail}`)
  }
}

export async function pull(root = checkout) {
  const previous = (await $`git -C ${root} rev-parse HEAD`.quiet().text()).trim()
  if (!previous) throw new Error("Cannot determine the current checkout revision")

  return keepingEdits(root, async () => {
    let moved = false
    try {
      const upstream = await $`git -C ${root} rev-parse --abbrev-ref --symbolic-full-name @{u}`.quiet().nothrow()
      if (upstream.exitCode === 0) {
        const target = upstream.text().trim()
        await refreshTracking(root, target)
        await $`git -C ${root} merge --ff-only @{u}`.quiet()
      } else {
        const name = (await $`git -C ${root} symbolic-ref -q --short HEAD`.quiet().nothrow().text()).trim()
        if (!name) throw new Error("Cannot update a detached checkout without a release version")
        const target = `origin/${name}`
        await refreshTracking(root, target)
        await $`git -C ${root} merge --ff-only ${target}`.quiet()
      }
      moved = true
      await installDependencies(root)
      await validateServer(root)
    } catch (error) {
      if (moved) await $`git -C ${root} reset --hard --quiet ${previous}`.quiet().nothrow()
      throw error
    }
  })
}
