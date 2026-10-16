export * as LocalBrowser from "./index.js"

import { spawn } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { Browser } from "../rpc.js"
import { LocalCdp } from "./cdp.js"
import { LocalPage } from "./page.js"

// A Chromium the server reaches over CDP, used when no desktop app is attached. Each Session owns
// its own tabs inside the shared browser, so cookies and logins are shared while work is not.

export const DEFAULT_ENDPOINT = "http://127.0.0.1:9222"
const LAUNCH_WAIT_MS = 20_000

export type Options = {
  /** CDP HTTP endpoint, for example http://127.0.0.1:9222. */
  endpoint: string
  /** Shell command that starts the browser when the endpoint does not answer. */
  launcher?: string
  /** Profile directory for the built-in launch when no launcher is configured. */
  profile: string
}

export function options(env: Record<string, string | undefined> = process.env): Options {
  return {
    endpoint: env.OPENCODE_BROWSER_CDP_URL || DEFAULT_ENDPOINT,
    launcher: env.OPENCODE_BROWSER_LAUNCHER || undefined,
    profile:
      env.OPENCODE_BROWSER_PROFILE ||
      path.join(env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"), "opencode", "browser-profile"),
  }
}

export type Manager = ReturnType<typeof make>

type Tabs = { pages: Map<Browser.TabID, LocalPage.Page>; focused: Browser.TabID | null }

export function make(config: Options) {
  const sessions = new Map<Session.ID, Tabs>()
  let connection: Promise<LocalCdp.Client> | undefined
  let sequence = 0
  const ref = () => `e${++sequence}`

  // One connection serves every Session; a dead browser drops it so the next call reconnects or relaunches.
  const client = () =>
    (connection ??= connect(config).then(
      (value) => {
        void value.closed.then(() => {
          connection = undefined
        })
        return value
      },
      (error: unknown) => {
        connection = undefined
        throw error
      },
    ))

  const tabs = (sessionID: Session.ID) => {
    const existing = sessions.get(sessionID)
    if (existing) return existing
    const created: Tabs = { pages: new Map(), focused: null }
    sessions.set(sessionID, created)
    return created
  }

  const listing = async (sessionID: Session.ID): Promise<Browser.State> => {
    const owned = tabs(sessionID)
    const states = await Promise.all(Array.from(owned.pages.values(), (page) => page.state()))
    return { tabs: states, focusedTabID: owned.focused && owned.pages.has(owned.focused) ? owned.focused : null }
  }

  return {
    /** The last known tab inventory, without waiting on the browser. */
    state(sessionID: Session.ID): Browser.State {
      const owned = sessions.get(sessionID)
      if (!owned) return { tabs: [], focusedTabID: null }
      return {
        tabs: Array.from(owned.pages.values(), (page) => page.known()),
        focusedTabID: owned.focused && owned.pages.has(owned.focused) ? owned.focused : null,
      }
    },
    async execute(sessionID: Session.ID, command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> {
      const action = command.action
      const owned = tabs(sessionID)
      const result = (value: unknown): Browser.Result => ({ value: Schema.decodeUnknownSync(Schema.Json)(value), files: [] })
      switch (action.type) {
        case "tabs.list":
          return result(await listing(sessionID))
        case "tabs.open": {
          const browser = await client()
          const focus = action.focus ?? true
          // The tab opens blank so its events are watched before the first document loads.
          const created = await browser.send("Target.createTarget", { url: "about:blank", background: !focus })
          const id = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
          const page = await LocalPage.open({
            client: browser,
            targetID: created.targetId,
            id,
            ref,
            onClose: () => {
              owned.pages.delete(id)
              if (owned.focused === id) owned.focused = null
            },
          }).catch(async (error: unknown) => {
            await browser.send("Target.closeTarget", { targetId: created.targetId }).catch(() => undefined)
            throw error
          })
          owned.pages.set(id, page)
          if (focus) owned.focused = id
          if (!action.url || action.url === "about:blank") return result(await page.state())
          const loaded = await page.execute({ action: { type: "navigate", tabID: id, url: action.url }, files: [] }, signal)
          return loaded
        }
        case "tabs.focus": {
          const page = owned.pages.get(action.tabID)
          if (!page) throw unavailable()
          await page.focus()
          owned.focused = action.tabID
          return result(await page.state())
        }
        case "tabs.close": {
          const page = owned.pages.get(action.tabID)
          if (!page) throw unavailable()
          await page.dispose()
          return result(await listing(sessionID))
        }
        default: {
          const page = "tabID" in action ? owned.pages.get(action.tabID) : undefined
          if (!page) throw unavailable()
          return page.execute(command, signal)
        }
      }
    },
    /** Closes a Session's tabs, for example when the Session is deleted. */
    async release(sessionID: Session.ID) {
      const owned = sessions.get(sessionID)
      sessions.delete(sessionID)
      if (owned) await Promise.all(Array.from(owned.pages.values(), (page) => page.dispose()))
    },
    /** Detaches from the browser and leaves its tabs open: the browser outlives this server. */
    dispose() {
      sessions.clear()
      const current = connection
      connection = undefined
      void current?.then((value) => value.close()).catch(() => undefined)
    },
  }
}

function unavailable() {
  return new Error(
    "This tab is closed or does not belong to this session. Call browser.tabs.list({}) and use an exact returned tabID, or browser.tabs.open({}) if no tabs exist.",
  )
}

async function connect(config: Options) {
  const existing = await debuggerURL(config.endpoint)
  if (existing) return LocalCdp.connect(existing)
  launch(config)
  const deadline = Date.now() + LAUNCH_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const url = await debuggerURL(config.endpoint)
    if (url) return LocalCdp.connect(url)
  }
  throw new Error(
    `No Chromium answered at ${config.endpoint} within ${LAUNCH_WAIT_MS / 1000} s. Start one with --remote-debugging-port, or set OPENCODE_BROWSER_LAUNCHER to a command that does.`,
  )
}

async function debuggerURL(endpoint: string) {
  const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(2_000) }).catch(() => undefined)
  if (!response?.ok) return
  const body = Schema.decodeUnknownOption(Schema.Struct({ webSocketDebuggerUrl: Schema.String }))(
    await response.json().catch(() => undefined),
  )
  return body._tag === "Some" ? body.value.webSocketDebuggerUrl : undefined
}

function launch(config: Options) {
  // Detached, so the browser and its logins outlive this server process.
  if (config.launcher) {
    spawn("sh", ["-c", config.launcher], { detached: true, stdio: "ignore" }).unref()
    return
  }
  const binary = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "chrome"]
    .flatMap((name) => (process.env.PATH ?? "").split(path.delimiter).map((directory) => path.join(directory, name)))
    .find(executable)
  if (!binary)
    throw new Error(
      "No Chromium or Chrome executable was found. Install one, or set OPENCODE_BROWSER_LAUNCHER to a command that starts a browser with --remote-debugging-port.",
    )
  const port = new URL(config.endpoint).port || "9222"
  spawn(
    binary,
    [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${config.profile}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    { detached: true, stdio: "ignore" },
  ).unref()
}

function executable(file: string) {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}
