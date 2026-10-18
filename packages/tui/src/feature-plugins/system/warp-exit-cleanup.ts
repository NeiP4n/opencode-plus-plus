import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { applyEdits, modify, parse } from "jsonc-parser"
import * as Warp from "@opencode/core/warp"
import { Plugin } from "@opencode/plugin/tui"

type ProxyValue = Record<string, unknown> | null

type Snapshot = {
  proxy: ProxyValue
  path: string | undefined
}

const USERS_DIR = () => path.join(tmpdir(), "opencode-warp-users")

function hasOtherLiveOpenCodeUsers() {
  try {
    for (const name of readdirSync(USERS_DIR())) {
      const pid = Number(name)
      if (!Number.isInteger(pid) || pid === process.pid) continue
      try {
        process.kill(pid, 0)
        return true
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ESRCH") return true
      }
    }
  } catch {}
  return false
}

function isDocument(entry: unknown): entry is { type: "document"; path?: string; info: { proxy?: unknown } } {
  return typeof entry === "object" && entry !== null && (entry as { type?: unknown }).type === "document"
}

function currentSnapshot(entries: readonly unknown[]): Snapshot {
  const documents = entries.filter(isDocument)
  const found = documents.findLast((entry) => entry.info.proxy !== undefined)
  const writable = documents.findLast((entry) => entry.path !== undefined)
  return {
    proxy: found?.info.proxy && typeof found.info.proxy === "object" ? (found.info.proxy as ProxyValue) : null,
    path: found?.path ?? writable?.path,
  }
}

function restoreSync(file: string, proxy: ProxyValue) {
  try {
    const text = readFileSync(file, "utf8")
    const root = parse(text) as { proxy?: unknown }
    if (!Warp.isWarpProxy(root.proxy)) return
    const edits = modify(text, ["proxy"], proxy, { formattingOptions: { insertSpaces: true, tabSize: 2 } })
    writeFileSync(file, applyEdits(text, edits), "utf8")
  } catch {}
}

export default Plugin.define({
  id: "opencode.warp.exit-cleanup",
  setup(context) {
    let snapshot: Snapshot = { proxy: null, path: undefined }
    let warpOwned = false
    let targetPath: string | undefined
    let refreshing = false

    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const entries = await context.client.config.get()
        const next = currentSnapshot(entries)
        if (Warp.isWarpProxy(next.proxy)) {
          if (!warpOwned) {
            targetPath = next.path ?? targetPath
            warpOwned = true
          }
        } else {
          if (warpOwned) {
            snapshot = next
            targetPath = next.path ?? targetPath
            warpOwned = false
          } else {
            snapshot = next
          }
        }
      } catch {}
      finally {
        refreshing = false
      }
    }

    const restore = () => {
      if (!warpOwned || hasOtherLiveOpenCodeUsers() || !targetPath) return
      restoreSync(targetPath, snapshot.proxy)
    }

    const onExit = () => restore()
    process.once("exit", onExit)
    process.once("SIGINT", onExit)
    process.once("SIGTERM", onExit)
    process.once("SIGHUP", onExit)

    void refresh()
    const timer = setInterval(() => void refresh(), 250)

    return () => {
      clearInterval(timer)
      process.off("exit", onExit)
      process.off("SIGINT", onExit)
      process.off("SIGTERM", onExit)
      process.off("SIGHUP", onExit)
    }
  },
})
