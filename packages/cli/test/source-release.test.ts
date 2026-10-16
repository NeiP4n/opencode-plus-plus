import { expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { SourceRelease } from "../src/services/source-release"

// A published repository with two releases and a friend's install pinned to the older one.
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-pp-release-"))
  const origin = path.join(root, "origin")
  const install = path.join(root, "install")
  const identity = {
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  }
  const git = (args: string[]) => $`git -C ${origin} ${args}`.env({ ...process.env, ...identity }).quiet()
  await $`git init -q -b main ${origin}`.quiet()
  await writeFile(path.join(origin, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }))
  await $`${process.execPath} install`.cwd(origin).quiet()
  await git(["add", "-A"])
  await git(["commit", "-qm", "one"])
  await git(["tag", "release/1.0.0"])
  await writeFile(path.join(origin, "notes.txt"), "two")
  await git(["add", "-A"])
  await git(["commit", "-qm", "two"])
  await git(["tag", "release/1.2.0"])
  await git(["tag", "release/not-a-version"])
  await $`git clone -q ${origin} ${install}`.quiet()
  await $`git -C ${install} checkout -q --detach release/1.0.0`.quiet()
  return { root, origin, install, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

test("a pinned install sees and moves to the newest release", async () => {
  await using repo = await setup()
  expect(await SourceRelease.current(repo.install)).toBe("1.0.0")
  expect(await SourceRelease.latest(repo.install)).toBe("1.2.0")

  await SourceRelease.apply("1.2.0", repo.install)
  expect(await SourceRelease.current(repo.install)).toBe("1.2.0")
  expect(await Bun.file(path.join(repo.install, "notes.txt")).text()).toBe("two")
})

test("a checkout on a branch is a development tree and never updates", async () => {
  await using repo = await setup()
  await $`git -C ${repo.install} checkout -q main`.quiet()
  expect(await SourceRelease.current(repo.install)).toBeUndefined()
})

test("a branch without an upstream follows the matching origin branch", async () => {
  await using repo = await setup()
  await $`git -C ${repo.install} checkout -q main`.quiet()
  await $`git -C ${repo.install} branch --unset-upstream`.quiet()
  const identity = {
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  }
  await writeFile(path.join(repo.origin, "notes.txt"), "three")
  await $`git -C ${repo.origin} add -A`.quiet()
  await $`git -C ${repo.origin} commit -qm three`.env({ ...process.env, ...identity }).quiet()

  expect(await SourceRelease.branch(repo.install)).toEqual({ type: "behind", name: "main", behind: 1 })
  await SourceRelease.pull(repo.install)
  expect(await Bun.file(path.join(repo.install, "notes.txt")).text()).toBe("three")
  expect(await SourceRelease.branch(repo.install)).toEqual({ type: "current" })
})
test("a branch with an upstream refreshes its exact ref despite a narrow fetch refspec", async () => {
  await using repo = await setup()
  await $`git -C ${repo.install} checkout -q main`.quiet()
  // Keep origin/main stale by telling plain git fetch origin to fetch only another branch.
  await $`git -C ${repo.install} config --unset-all remote.origin.fetch`.quiet()
  await $`git -C ${repo.install} config --add remote.origin.fetch +refs/heads/other:refs/remotes/origin/other`.quiet()

  await writeFile(path.join(repo.origin, "notes.txt"), "three")
  await $`git -C ${repo.origin} add -A`.quiet()
  await $`git -C ${repo.origin} commit -qm three`.env({
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  }).quiet()

  expect(await SourceRelease.branch(repo.install)).toEqual({ type: "behind", name: "main", behind: 1 })
  await SourceRelease.pull(repo.install)
  expect(await Bun.file(path.join(repo.install, "notes.txt")).text()).toBe("three")
  expect(await SourceRelease.branch(repo.install)).toEqual({ type: "current" })
})

test("the newest release is chosen by version, not by name order", () => {
  expect(SourceRelease.newest(["1.9.0", "1.10.0", "1.2.3"])).toBe("1.10.0")
})

// Before the first release the installer checks out its branch detached; that install
// follows the branch the way running the installer again would.
test("a detached install without releases follows the installer's branch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-pp-branch-"))
  try {
    const origin = path.join(root, "origin")
    const install = path.join(root, "install")
    const identity = {
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    }
    const git = (args: string[]) => $`git -C ${origin} ${args}`.env({ ...process.env, ...identity }).quiet()
    await $`git init -q -b lan-rooms ${origin}`.quiet()
    await writeFile(path.join(origin, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }))
    await $`${process.execPath} install`.cwd(origin).quiet()
    await git(["add", "-A"])
    await git(["commit", "-qm", "one"])
    await $`git clone -q ${origin} ${install}`.quiet()
    await $`git -C ${install} checkout -q --detach origin/lan-rooms`.quiet()
    // Simulate a narrow fetch refspec; update checks must refresh origin/lan-rooms itself.
    await $`git -C ${install} config --unset-all remote.origin.fetch`.quiet()
    await $`git -C ${install} config --add remote.origin.fetch +refs/heads/other:refs/remotes/origin/other`.quiet()
    expect(await SourceRelease.detached(install)).toBe(true)
    expect(await SourceRelease.current(install)).toBeUndefined()
    expect(await SourceRelease.install(install)).toEqual({ type: "current" })

    await writeFile(path.join(origin, "notes.txt"), "two")
    await git(["add", "-A"])
    await git(["commit", "-qm", "two"])
    expect(await SourceRelease.install(install)).toEqual({ type: "behind", branch: "lan-rooms", behind: 1 })

    await SourceRelease.follow(install)
    expect(await Bun.file(path.join(install, "notes.txt")).text()).toBe("two")
    expect(await SourceRelease.install(install)).toEqual({ type: "current" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// An install with a stray edit (an AI session, a hand fix) is moved to the newer commit
// `two`, where notes.txt changed upstream; only the move itself is stubbed out.
async function edited() {
  const repo = await setup()
  const move = () => $`git -C ${repo.install} checkout -q --detach release/1.2.0`.quiet().then(() => undefined)
  return { ...repo, move }
}

test("a clean install updates without touching the stash", async () => {
  await using repo = await edited()
  expect(await SourceRelease.keepingEdits(repo.install, repo.move)).toBeUndefined()
  expect((await $`git -C ${repo.install} stash list`.quiet().text()).trim()).toBe("")
})

test("an edit the update does not touch is put back on top of it", async () => {
  await using repo = await edited()
  await writeFile(path.join(repo.install, "package.json"), JSON.stringify({ name: "fixture", version: "9.9.9" }))
  await writeFile(path.join(repo.install, "scratch.txt"), "mine")
  expect(await SourceRelease.keepingEdits(repo.install, repo.move)).toEqual({ type: "restored" })
  expect(await SourceRelease.current(repo.install)).toBe("1.2.0")
  expect(await Bun.file(path.join(repo.install, "package.json")).text()).toContain("9.9.9")
  expect(await Bun.file(path.join(repo.install, "scratch.txt")).text()).toBe("mine")
  expect((await $`git -C ${repo.install} stash list`.quiet().text()).trim()).toBe("")
})

test("an edit that clashes with the update waits in the stash and the install stays clean", async () => {
  await using repo = await edited()
  await writeFile(path.join(repo.install, "notes.txt"), "my own notes")
  const kept = await SourceRelease.keepingEdits(repo.install, repo.move)
  expect(kept).toEqual({ type: "stashed", files: ["notes.txt"] })
  expect(await SourceRelease.current(repo.install)).toBe("1.2.0")
  expect(await Bun.file(path.join(repo.install, "notes.txt")).text()).toBe("two")
  expect((await $`git -C ${repo.install} status --porcelain`.quiet().text()).trim()).toBe("")
  // the edit is not lost: the stash brings it back
  expect(await $`git -C ${repo.install} stash show -p --include-untracked`.quiet().text()).toContain("my own notes")
})

test("an edit to a file the update also changes waits in the stash too", async () => {
  await using repo = await setup()
  const identity = {
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  }
  await writeFile(path.join(repo.origin, "notes.txt"), "three")
  await $`git -C ${repo.origin} commit -qam three`.env({ ...process.env, ...identity }).quiet()
  await $`git -C ${repo.origin} tag release/1.3.0`.quiet()
  await $`git -C ${repo.install} fetch -q --tags origin`.quiet()
  await $`git -C ${repo.install} checkout -q --detach release/1.2.0`.quiet()
  await writeFile(path.join(repo.install, "notes.txt"), "my own notes")
  const move = () => $`git -C ${repo.install} checkout -q --detach release/1.3.0`.quiet().then(() => undefined)
  expect(await SourceRelease.keepingEdits(repo.install, move)).toEqual({ type: "stashed", files: ["notes.txt"] })
  expect(await SourceRelease.current(repo.install)).toBe("1.3.0")
  expect(await Bun.file(path.join(repo.install, "notes.txt")).text()).toBe("three")
  expect((await $`git -C ${repo.install} status --porcelain`.quiet().text()).trim()).toBe("")
  expect(await $`git -C ${repo.install} stash show -p`.quiet().text()).toContain("my own notes")
})

test("an update that fails puts the edits back where they were", async () => {
  await using repo = await edited()
  await writeFile(path.join(repo.install, "notes.txt"), "my own notes")
  const failed = SourceRelease.keepingEdits(repo.install, () => Promise.reject(new Error("offline")))
  await expect(failed).rejects.toThrow("offline")
  expect(await SourceRelease.current(repo.install)).toBe("1.0.0")
  expect(await Bun.file(path.join(repo.install, "notes.txt")).text()).toBe("my own notes")
  expect((await $`git -C ${repo.install} stash list`.quiet().text()).trim()).toBe("")
})
