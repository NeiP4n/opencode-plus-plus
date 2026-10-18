import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import * as Warp from "@opencode/core/warp"
import { Plugin } from "@opencode/plugin/tui"

type ProxyValue = { http?: string; https?: string; no_proxy?: string[] } | null

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
  const proxy = found?.info.proxy
  return {
    proxy: proxy && typeof proxy === "object" ? (proxy as ProxyValue) : null,
    path: found?.path ?? writable?.path,
  }
}

function skipSpace(text: string, index: number) {
  while (index < text.length && /\s/.test(text[index])) index++
  return index
}

function scanValueEnd(text: string, start: number) {
  let depth = 0
  let quote = false
  let lineComment = false
  let blockComment = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (lineComment) {
      if (ch === "\n") lineComment = false
      continue
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false
        i++
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') quote = false
      continue
    }
    if (ch === '"') {
      quote = true
      continue
    }
    if (ch === "/" && next === "/") {
      lineComment = true
      i++
      continue
    }
    if (ch === "/" && next === "*") {
      blockComment = true
      i++
      continue
    }
    if (ch === "{" || ch === "[") depth++
    if (ch === "}" || ch === "]") {
      depth--
      if (depth === 0) return i + 1
    }
    if (depth === 0 && (ch === "," || ch === "\n")) return i
  }
  return text.length
}

function findProxyProperty(text: string) {
  let quote = false
  let lineComment = false
  let blockComment = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (lineComment) {
      if (ch === "\n") lineComment = false
      continue
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false
        i++
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') quote = false
      continue
    }
    if (ch === '"') {
      const end = (() => {
        let j = i + 1
        let escapedKey = false
        for (; j < text.length; j++) {
          if (escapedKey) escapedKey = false
          else if (text[j] === "\\") escapedKey = true
          else if (text[j] === '"') break
        }
        return j
      })()
      const colon = skipSpace(text, end + 1)
      if (text.slice(i + 1, end) === "proxy" && text[colon] === ":") {
        const valueStart = skipSpace(text, colon + 1)
        return { keyStart: i, valueStart, valueEnd: scanValueEnd(text, valueStart) }
      }
      i = end
      continue
    }
    if (ch === "/" && next === "/") {
      lineComment = true
      i++
      continue
    }
    if (ch === "/" && next === "*") {
      blockComment = true
      i++
    }
  }
  return undefined
}

function restoreSync(file: string, proxy: ProxyValue) {
  try {
    const text = readFileSync(file, "utf8")
    if (!text.includes(Warp.proxyUrl())) return
    const property = findProxyProperty(text)
    if (!property) return
    if (proxy === null) {
      const after = skipSpace(text, property.valueEnd)
      if (text[after] === ",") {
        writeFileSync(file, text.slice(0, property.keyStart) + text.slice(after + 1), "utf8")
        return
      }
      const before = property.keyStart - 1
      let comma = before
      while (comma >= 0 && /\s/.test(text[comma])) comma--
      if (text[comma] === ",") {
        writeFileSync(file, text.slice(0, comma) + text.slice(property.valueEnd), "utf8")
        return
      }
      writeFileSync(file, text.slice(0, property.keyStart) + text.slice(property.valueEnd), "utf8")
      return
    }
    const serialized = JSON.stringify(proxy, null, 2)
    writeFileSync(file, text.slice(0, property.valueStart) + serialized + text.slice(property.valueEnd), "utf8")
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
        } else if (warpOwned) {
          snapshot = next
          targetPath = next.path ?? targetPath
          warpOwned = false
        } else {
          snapshot = next
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
    const onSignal = (code: number) => () => {
      restore()
      process.exit(code)
    }
    const onInt = onSignal(130)
    const onTerm = onSignal(143)
    const onHup = onSignal(129)
    const onQuit = onSignal(131)
    process.once("exit", onExit)
    process.once("SIGINT", onInt)
    process.once("SIGTERM", onTerm)
    process.once("SIGHUP", onHup)
    process.once("SIGQUIT", onQuit)

    void refresh()
    const timer = setInterval(() => void refresh(), 250)

    return () => {
      clearInterval(timer)
      process.off("exit", onExit)
      process.off("SIGINT", onInt)
      process.off("SIGTERM", onTerm)
      process.off("SIGHUP", onHup)
      process.off("SIGQUIT", onQuit)
    }
  },
})
