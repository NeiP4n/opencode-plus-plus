export * as LocalPage from "./page.js"

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Schema } from "effect"
import { Browser } from "../rpc.js"
import type { LocalCdp } from "./cdp.js"
import { createDiagnostics } from "./diagnostics.js"
import type { AXNode, Commands, Events, FrameTree } from "./protocol.js"

// Ported from the desktop page (gui-extensions/src/browser/chromium.ts) without Electron: every
// step is a CDP command with its own deadline, so a stalled renderer fails a call instead of
// holding it forever.

/** Page-scoped CDP: an omitted session ID is the page's own target, as in the desktop adapter. */
export type PageCdp = {
  send<Method extends keyof Commands>(
    method: Method,
    params: Commands[Method]["params"],
    sessionID?: string,
  ): Promise<Commands[Method]["result"]>
  on<Method extends keyof Events>(
    method: Method,
    callback: (params: Events[Method], sessionID?: string) => void,
  ): () => void
}

export type Page = Awaited<ReturnType<typeof open>>

type Element = { backendID: number; frameID: string; sessionID?: string }
type Capture = { id: Browser.FileID; name: string; mime: string; data: Uint8Array }

const NAVIGATION_TIMEOUT_MS = 30_000
const MAX_CAPTURES = 20

// Captures belong to the tab, not whichever document it now shows.
const retainedOperations: readonly Browser.Method[] = ["navigate", "files.list", "files.get"]

const desktopOnly: readonly Browser.Method[] = [
  "preview",
  "trace.start",
  "trace.stop",
  "trace.analyze",
  "cpu.start",
  "cpu.stop",
  "cpu.analyze",
  "heap.snapshot",
  "heap.summary",
  "heap.query",
  "heap.object",
  "heap.compare",
  "lighthouse",
]

export async function open(input: {
  client: LocalCdp.Client
  targetID: string
  id: Browser.TabID
  ref: () => string
  onClose: () => void
}) {
  const client = input.client
  const main = (await client.send("Target.attachToTarget", { targetId: input.targetID, flatten: true })).sessionId
  // Out-of-process iframes attach as child sessions of this page; events from anything else are another tab's.
  const children = new Set<string>()
  const cdp: PageCdp = {
    send: (method, params, sessionID) => client.send(method, params, sessionID ?? main),
    on: (method, callback) =>
      client.on(method, (params, sessionID) => {
        if (sessionID === main) return callback(params, undefined)
        if (sessionID && children.has(sessionID)) callback(params, sessionID)
      }),
  }

  const diagnostics = createDiagnostics(cdp)
  const refs = new Map<string, Element>()
  const sessions = new Map<string, string>()
  const parents = new Map<string, string>()
  const contexts = new Map<string, { id: number; sessionID?: string }>()
  const documents = new Map<string, string>()
  const dialogs = new Set<() => void>()
  const captures = new Map<Browser.FileID, Capture>()
  const unsubscribe: (() => void)[] = []
  let dialog: { type: string; message: string; defaultValue: string } | null = null
  let dialogURL = ""
  let dialogRevision = 0
  let generation = 0
  let revision = 0
  let mainFrame = ""
  let loading = false
  let url = "about:blank"
  let title = ""
  let closed = false
  let snapshot: Browser.Tab | undefined

  const close = () => {
    if (closed) return
    closed = true
    unsubscribe.forEach((off) => off())
    refs.clear()
    captures.clear()
    dialogs.forEach((reject) => reject())
    input.onClose()
  }

  unsubscribe.push(
    client.on("Target.targetDestroyed", (event) => {
      if (event.targetId === input.targetID) close()
    }),
    client.on("Target.targetCrashed", (event) => {
      if (event.targetId === input.targetID) close()
    }),
    client.on("Target.detachedFromTarget", (event) => {
      if (event.sessionId === main) return close()
      children.delete(event.sessionId)
      sessions.forEach((id, frameID) => {
        if (id !== event.sessionId) return
        sessions.delete(frameID)
        parents.delete(frameID)
      })
    }),
    cdp.on("Target.attachedToTarget", ({ sessionId, targetInfo }, parentSessionID) => {
      if (targetInfo.type !== "iframe") return
      children.add(sessionId)
      const parentID = targetInfo.parentFrameId ?? Array.from(sessions).find(([, id]) => id === parentSessionID)?.[0]
      if (parentID) parents.set(targetInfo.targetId, parentID)
      sessions.set(targetInfo.targetId, sessionId)
      void Promise.all([
        diagnostics.enable(sessionId),
        cdp.send("Page.enable", {}, sessionId),
        cdp.send("Target.setAutoAttach", autoAttach, sessionId),
        cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId),
      ]).catch(() => undefined)
    }),
    cdp.on("Page.frameNavigated", ({ frame }, sessionID) => {
      documents.set(frame.id, frame.url)
      revision++
      if (sessionID || frame.parentId) return
      // A new main-frame document invalidates every ref and diagnostic collected for the previous one.
      mainFrame = frame.id
      url = frame.url
      generation++
      documents.clear()
      documents.set(frame.id, frame.url)
      refs.clear()
      diagnostics.clear()
    }),
    cdp.on("Page.frameDetached", ({ frameId }) => {
      documents.delete(frameId)
      revision++
    }),
    cdp.on("Page.frameStartedLoading", ({ frameId }, sessionID) => {
      if (!sessionID && frameId === mainFrame) loading = true
    }),
    cdp.on("Page.frameStoppedLoading", ({ frameId }, sessionID) => {
      if (!sessionID && frameId === mainFrame) loading = false
    }),
    cdp.on("Page.javascriptDialogOpening", (event) => {
      dialogURL = event.url
      dialogRevision++
      dialog = { type: event.type, message: event.message.slice(0, Browser.MAX_TEXT), defaultValue: event.defaultPrompt ?? "" }
      dialogs.forEach((reject) => reject())
    }),
    cdp.on("Page.javascriptDialogClosed", () => {
      dialogRevision++
      dialog = null
    }),
    cdp.on("Runtime.executionContextCreated", ({ context }, sessionID) => {
      if (context.auxData?.frameId && context.auxData.isDefault)
        contexts.set(context.auxData.frameId, { id: context.id, sessionID })
    }),
    cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }, sessionID) => {
      contexts.forEach((context, key) => {
        if (context.id === executionContextId && context.sessionID === sessionID) contexts.delete(key)
      })
    }),
  )
  void client.closed.then(close)

  await Promise.all([
    cdp.send("Page.enable", {}),
    cdp.send("DOM.enable", {}),
    diagnostics.enable(),
    // A background tab still reports focus, so focus-dependent forms and menus behave as in the foreground.
    cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }),
    cdp.send("Target.setAutoAttach", autoAttach),
  ])
  const tree = await cdp.send("Page.getFrameTree", {})
  mainFrame = tree.frameTree.frame.id
  url = tree.frameTree.frame.url

  return {
    targetID: input.targetID,
    get closed() {
      return closed
    },
    state,
    /** Synchronous last-known state, for listings that must not wait on a busy renderer. */
    known: () => snapshot ?? fallbackState(),
    async execute(command: Browser.Command, signal: AbortSignal): Promise<Browser.Result> {
      abortError(signal)
      if (closed)
        throw new Error(
          "Browser tab was closed. Call browser.tabs.list({}) and choose an existing tabID; do not reuse the closed tab's refs.",
        )
      if (desktopOnly.includes(command.action.type))
        throw new Error(
          `browser.${command.action.type} needs the desktop app's browser. The local Chromium browser supports navigation, snapshots, input, screenshots, console and network inspection.`,
        )
      if (dialog && command.action.type !== "dialog")
        throw new Error(
          'A JavaScript dialog is open. Inspect it with browser.dialog({tabID,action:"get"}), then explicitly accept or dismiss it before continuing.',
        )
      if (command.inspect) return { value: await inspect(command.action), files: [] }
      if (command.target && JSON.stringify(await inspect(command.action)) !== JSON.stringify(command.target))
        throw new Error(
          "Browser target changed while permission was pending. Take a fresh snapshot or listing and request the action again; it was not executed.",
        )
      if (
        command.generation !== undefined &&
        command.generation !== generation &&
        !retainedOperations.includes(command.action.type)
      )
        throw new Error(
          "The document changed before this operation ran. Call browser.tabs.list({}) to check its current URL, then browser.snapshot({tabID}) for fresh refs. Reconsider the action before retrying on the new page.",
        )
      const modal = Promise.withResolvers<never>()
      const cancelled = Promise.withResolvers<never>()
      // The action underneath the race keeps running after a dialog wins it; it checks this
      // signal before each further step, so a validation alert on one field stops the rest.
      const run = new AbortController()
      const cancel = () => {
        run.abort()
        cancelled.reject(
          new Error(
            "Browser operation was cancelled. Inspect the tab before deciding to repeat an action; cancellation does not undo changes already made.",
          ),
        )
      }
      const reject = () => {
        if (command.action.type !== "navigate") run.abort()
        modal.reject(
          new Error(
            'A JavaScript dialog opened while the action was running. Inspect it with browser.dialog({tabID,action:"get"}) and accept or dismiss it. Do not repeat the original action just to close the dialog.',
          ),
        )
      }
      signal.addEventListener("abort", cancel, { once: true })
      if (command.action.type !== "dialog") dialogs.add(reject)
      try {
        return await Promise.race([execute(command.action, command.files, run.signal), modal.promise, cancelled.promise])
      } finally {
        signal.removeEventListener("abort", cancel)
        dialogs.delete(reject)
      }
    },
    async focus() {
      await client.send("Target.activateTarget", { targetId: input.targetID })
    },
    async dispose() {
      const target = input.targetID
      close()
      await client.send("Target.closeTarget", { targetId: target }).catch(() => undefined)
    },
  }

  function fallbackState(): Browser.Tab {
    return {
      id: input.id,
      url: url.slice(0, 16_384),
      title: title.slice(0, 2_048),
      loading,
      canGoBack: false,
      canGoForward: false,
      generation,
    }
  }

  // Both answers come from the browser process, so they arrive even while a dialog blocks the renderer.
  async function state(): Promise<Browser.Tab> {
    if (closed) return fallbackState()
    const [info, history] = await Promise.all([
      client.send("Target.getTargetInfo", { targetId: input.targetID }).catch(() => undefined),
      cdp.send("Page.getNavigationHistory", {}).catch(() => undefined),
    ])
    if (info) {
      url = info.targetInfo.url
      title = info.targetInfo.title
    }
    snapshot = {
      ...fallbackState(),
      canGoBack: history ? history.currentIndex > 0 : (snapshot?.canGoBack ?? false),
      canGoForward: history ? history.currentIndex < history.entries.length - 1 : (snapshot?.canGoForward ?? false),
    }
    return snapshot
  }

  async function execute(action: Browser.Action, transfers: readonly Browser.File[], signal: AbortSignal) {
    const result = <T>(value: T, attached: Browser.File[] = []): Browser.Result => {
      const json = Schema.decodeUnknownSync(Schema.Json)(value)
      if (JSON.stringify(json).length > 512_000)
        throw new Error(
          "Browser result exceeds 512000 JSON characters. Request fewer entries, reduce snapshot depth, or return only selected fields from the evaluation script. Repeating the same request will not reduce its output.",
        )
      return { value: json, files: attached }
    }

    switch (action.type) {
      case "navigate": {
        const before = generation
        const response = await cdp.send("Page.navigate", { url: action.url })
        if (response.errorText) throw new Error(`Navigation failed: ${response.errorText}`)
        // A same-document navigation has no loader and no load to wait for.
        if (response.loaderId) await settled(before, signal)
        return result(await state())
      }

      case "back":
      case "forward": {
        const history = await cdp.send("Page.getNavigationHistory", {})
        const entry = history.entries[history.currentIndex + (action.type === "back" ? -1 : 1)]
        if (entry) {
          const before = generation
          await cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id })
          await settled(before, signal)
        }
        return result(await state())
      }

      case "reload": {
        const before = generation
        await cdp.send("Page.reload", {})
        await settled(before, signal)
        return result(await state())
      }

      case "stop":
        await cdp.send("Page.stopLoading", {})
        return result(await state())
      case "frames":
        return result({ tab: await state(), frames: await frames() })
      case "snapshot":
      case "find":
        return result({ tab: await state(), ...(await accessibilitySnapshot(action)) })
      case "evaluate": {
        if (action.ref && action.frameID)
          throw new Error(
            "Pass either ref or frameID to browser.evaluate, not both. A ref already runs in its element's frame.",
          )
        const context = action.frameID ? contexts.get(action.frameID) : undefined
        if (action.frameID && !context)
          throw new Error(
            "Frame context is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab, or omit frameID to target the main frame.",
          )
        const element = action.ref ? target(action.ref) : undefined
        const objectId = element ? await resolve(element) : undefined
        // With a ref, the script is a function that receives the element as its argument and as `this`.
        const value = await (element && objectId
          ? cdp
              .send(
                "Runtime.callFunctionOn",
                {
                  objectId,
                  functionDeclaration: action.script,
                  arguments: [{ objectId }],
                  awaitPromise: true,
                  returnByValue: true,
                  userGesture: true,
                },
                element.sessionID,
              )
              .finally(() => cdp.send("Runtime.releaseObject", { objectId }, element.sessionID).catch(() => undefined))
          : cdp.send(
              "Runtime.evaluate",
              { expression: action.script, contextId: context?.id, awaitPromise: true, returnByValue: true, userGesture: true },
              context?.sessionID,
            ))
        if (value.exceptionDetails)
          throw new Error(
            `Page JavaScript threw an exception. Check the script and ${action.ref ? "ref" : "frameID"}; inspect the page before repeating code with side effects. Details: ${(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text).slice(0, 800)}`,
          )
        abortError(signal)
        return result({ tab: await state(), value: value.result.value ?? null })
      }

      case "click":
        await click(target(action.ref), action.button ?? "left", action.count ?? 1, action.modifiers)
        break
      case "hover":
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...(await point(target(action.ref))) })
        break
      case "drag": {
        const from = await point(target(action.from))
        const box = await rect(target(action.to), true)
        const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from })
        await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 })
        try {
          for (let i = 1; i <= 10; i++) {
            abortError(signal)
            await cdp.send("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              x: from.x + ((to.x - from.x) * i) / 10,
              y: from.y + ((to.y - from.y) * i) / 10,
              button: "left",
              buttons: 1,
            })
          }
        } finally {
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1 })
        }
        break
      }

      case "fill":
        await fill(target(action.ref), action.text, signal)
        break
      case "fill_form":
        for (const field of action.fields) {
          abortError(signal)
          if (field.type === "text") await fill(target(field.ref), field.value, signal)
          if (field.type === "select") await select(target(field.ref), field.values)
          if (field.type === "check") await check(target(field.ref), field.checked)
        }
        break
      case "select":
        await select(target(action.ref), action.values)
        break
      case "check":
        await check(target(action.ref), action.checked)
        break
      case "press":
        await key(action.key)
        break
      case "scroll": {
        const metrics = await cdp.send("Page.getLayoutMetrics", {})
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: metrics.cssVisualViewport.clientWidth / 2,
          y: metrics.cssVisualViewport.clientHeight / 2,
          deltaX: action.deltaX ?? 0,
          deltaY: action.deltaY,
        })
        break
      }

      case "wait": {
        if (action.condition !== "load" && !action.text)
          throw new Error(
            'browser.wait requires non-empty text for condition "text" or "textGone". Use condition "load" without text to wait for loading.',
          )
        await waitFor(
          async () => {
            if (action.condition === "load") return !loading
            const context = action.frameID ? contexts.get(action.frameID) : undefined
            if (action.frameID && !context)
              throw new Error("Frame context is unavailable. Call browser.frames({tabID}) and use a frameID from this tab.")
            const value = await cdp.send(
              "Runtime.evaluate",
              {
                expression: `document.body?.innerText.includes(${JSON.stringify(action.text)}) ?? false`,
                returnByValue: true,
                contextId: context?.id,
              },
              context?.sessionID,
            )
            return Boolean(value.result.value) === (action.condition === "text")
          },
          signal,
          action.timeoutMs,
        ).catch((error: unknown) => {
          if (signal.aborted) throw error
          throw new Error(
            `browser.wait failed for condition ${JSON.stringify(action.condition)} (timeoutMs: ${action.timeoutMs ?? 10_000}). Inspect browser.snapshot({tabID}) and check text/frameID before retrying; timeoutMs can be increased up to 30000 for a genuinely slow page. Details: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
        break
      }

      case "screenshot": {
        if (action.ref && action.fullPage)
          throw new Error(
            "Choose either ref for an element screenshot or fullPage:true for the whole page. Remove the other argument before retrying.",
          )
        // Chromium paints no frames for a hidden tab, so capturing one would wait for a frame that never comes.
        const visible = await cdp.send("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true })
        if (visible.result.value !== "visible") await cdp.send("Page.bringToFront", {})
        const element = action.ref ? await rect(target(action.ref), true) : undefined
        const metrics = await cdp.send("Page.getLayoutMetrics", {})
        const bounds = element
          ? { ...element, x: element.x + metrics.cssVisualViewport.pageX, y: element.y + metrics.cssVisualViewport.pageY }
          : action.fullPage
            ? metrics.cssContentSize
            : {
                x: metrics.cssVisualViewport.pageX,
                y: metrics.cssVisualViewport.pageY,
                width: metrics.cssVisualViewport.clientWidth,
                height: metrics.cssVisualViewport.clientHeight,
              }
        if (bounds.width <= 0 || bounds.height <= 0)
          throw new Error(
            "Element or page has no visible screenshot area. Take a fresh snapshot and choose a visible element, or omit ref to capture the viewport.",
          )
        const ratio = Number(
          (await cdp.send("Runtime.evaluate", { expression: "window.devicePixelRatio", returnByValue: true })).result
            .value ?? 1,
        )
        const scale = Math.min(1, (action.maxWidth ?? 2000) / (bounds.width * ratio))
        if (bounds.width * bounds.height * (scale * ratio) ** 2 > 16_000_000)
          throw new Error("Screenshot exceeds 16 megapixels; capture an element or use a smaller maxWidth.")
        const format = action.format ?? "png"
        const capture = await cdp.send("Page.captureScreenshot", {
          format,
          quality: format === "png" ? undefined : (action.quality ?? 80),
          captureBeyondViewport: true,
          clip: { ...bounds, scale },
        })
        const file = retain(`screenshot.${format}`, `image/${format}`, Buffer.from(capture.data, "base64"))
        return result({ tab: await state() }, [file])
      }

      case "dialog": {
        if (action.action !== "get") {
          if (!dialog)
            throw new Error(
              'This tab has no JavaScript dialog to handle. browser.dialog({tabID,action:"get"}) returns null when none is open; continue without accepting or dismissing one.',
            )
          await cdp.send("Page.handleJavaScriptDialog", { accept: action.action === "accept", promptText: action.promptText })
          dialog = null
        }
        return result({ tab: await state(), dialog })
      }

      case "files.upload":
      case "files.drop": {
        if (!transfers.length)
          throw new Error(
            "Upload command has no file bytes. Supply server-local paths to browser.files.upload/drop. If paths were supplied, report a transfer mismatch.",
          )
        // The browser reads uploads from disk; each call gets a private directory removed afterwards.
        const directory = await mkdtemp(path.join(tmpdir(), "opencode-browser-upload-"))
        try {
          const local = await Promise.all(
            transfers.map(async (file, index) => {
              const name = path.join(directory, String(index), path.basename(file.name) || "file")
              await mkdir(path.dirname(name), { recursive: true })
              await writeFile(name, file.data)
              return name
            }),
          )
          const element = target(action.ref)
          if (action.type === "files.upload")
            await cdp.send("DOM.setFileInputFiles", { files: local, backendNodeId: element.backendID }, element.sessionID)
          if (action.type === "files.drop") {
            const position = await point(element)
            for (const type of ["dragEnter", "dragOver", "drop"])
              await cdp.send("Input.dispatchDragEvent", {
                type,
                ...position,
                data: { items: [], files: local, dragOperationsMask: 1 },
              })
          }
        } finally {
          // Chromium has read the files once the input or drop event was dispatched.
          await rm(directory, { recursive: true, force: true })
        }
        break
      }

      case "files.list":
        return result({
          tab: await state(),
          files: Array.from(captures.values(), (file) => ({
            id: file.id,
            name: file.name,
            mime: file.mime,
            bytes: file.data.byteLength,
            state: "completed" as const,
          })),
        })
      case "files.get": {
        const file = captures.get(action.fileID)
        if (!file)
          throw new Error(
            "File ID is not retained in this tab. Call browser.files.list({tabID}) and use an exact returned fileID from the same tab, not a server path or request ID.",
          )
        return result({ tab: await state() }, [file])
      }

      case "console":
        return result({ tab: await state(), ...diagnostics.console(action) })
      case "network.list":
        return result({ tab: await state(), ...diagnostics.list(action) })
      case "network.get":
        return result({ tab: await state(), ...(await diagnostics.get(action)) })
      default:
        throw new Error(
          `browser.${action.type} is not supported by the local browser. Report the routing mismatch; repeating the operation will not fix it.`,
        )
    }

    abortError(signal)
    return result(await state())
  }

  /** Waits for the document a navigation started; a page that keeps loading returns its loading state, never hangs. */
  async function settled(before: number, signal: AbortSignal) {
    await waitFor(() => generation !== before && !loading, signal, NAVIGATION_TIMEOUT_MS).catch((error: unknown) => {
      if (signal.aborted) throw error
    })
  }

  function retain(name: string, mime: string, data: Uint8Array): Browser.File {
    if (data.byteLength > Browser.MAX_FILE_BYTES)
      throw new Error(
        "Capture exceeds the 5 MiB transfer limit. Reduce screenshot maxWidth/quality or capture an element. Do not retry an identical capture.",
      )
    const file = { id: Browser.FileID.make(`file_${crypto.randomUUID()}`), name, mime, data }
    captures.set(file.id, file)
    // Captures live in memory; the oldest go first so a long session does not grow without bound.
    if (captures.size > MAX_CAPTURES) captures.delete(captures.keys().next().value!)
    return file
  }

  async function inspect(action: Browser.Action): Promise<Browser.Target> {
    // Most CDP queries cannot run while a JavaScript dialog blocks the renderer.
    if (action.type === "dialog")
      return { resources: [dialog ? dialogURL : url], key: `${generation}:${dialogRevision}:${Boolean(dialog)}` }
    if (action.type === "files.get") return { resources: [url], key: action.fileID }
    if (action.type === "network.get") return { resources: [diagnostics.info(action.id).url], key: action.id }
    const tree = await frames()
    tree.forEach((frame) => documents.set(frame.id, frame.url))
    const selectedRefs =
      action.type === "drag"
        ? [action.from, action.to]
        : action.type === "fill_form"
          ? action.fields.map((field) => field.ref)
          : "ref" in action && action.ref
            ? [action.ref]
            : []
    const selected = selectedRefs.map(target)
    const frameIDs = selected.length
      ? selected.map((element) => element.frameID)
      : "frameID" in action && action.frameID
        ? [action.frameID]
        : []
    const urls = frameIDs.map((id) => {
      const frame = tree.find((frame) => frame.id === id)
      if (!frame) throw new Error("Frame is unavailable. Call browser.frames({tabID}) and use a current frameID.")
      return frame.url
    })
    return {
      resources: [
        ...new Set(
          action.type === "navigate"
            ? [new URL(action.url).href]
            : action.type === "screenshot"
              ? [...documents.values()]
              : urls.length
                ? urls
                : [url],
        ),
      ].sort(),
      key: JSON.stringify([generation, revision, selected]),
    }
  }

  function target(ref: Browser.Ref): Element {
    const value = refs.get(ref.replace(/^@/, ""))
    if (!value)
      throw new Error(
        "Element ref is stale or belongs to another tab. Call browser.snapshot({tabID}) and use a ref from that tab's newest snapshot. Do not reuse refs after navigation or a newer snapshot.",
      )
    return value
  }

  async function frames() {
    const root = await cdp.send("Page.getFrameTree", {})
    const result: { id: string; parentID?: string; url: string; name: string }[] = []
    const walk = (tree: FrameTree, parentID?: string) => {
      if (!result.some((frame) => frame.id === tree.frame.id))
        result.push(
          tree.frame.parentId || parentID
            ? { id: tree.frame.id, parentID: tree.frame.parentId ?? parentID, url: tree.frame.url, name: tree.frame.name ?? "" }
            : { id: tree.frame.id, url: tree.frame.url, name: tree.frame.name ?? "" },
        )
      tree.childFrames?.forEach((child) => walk(child, tree.frame.id))
    }
    walk(root.frameTree)
    const nested = await Promise.all(
      Array.from(sessions, async ([id, sessionID]) => ({
        id,
        tree: await cdp.send("Page.getFrameTree", {}, sessionID).catch(() => undefined),
      })),
    )
    nested.forEach(({ id, tree }) => {
      if (tree) walk(tree.frameTree, parents.get(id) ?? root.frameTree.frame.id)
    })
    return result
  }

  async function call(element: Element, functionDeclaration: string, args: unknown[] = []) {
    const objectId = await resolve(element)
    try {
      const result = await cdp.send(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration,
          arguments: args.map((value) => ({ value })),
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        },
        element.sessionID,
      )
      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value
    } finally {
      await cdp.send("Runtime.releaseObject", { objectId }, element.sessionID).catch(() => undefined)
    }
  }

  async function resolve(element: Element) {
    const object = await cdp.send("DOM.resolveNode", { backendNodeId: element.backendID }, element.sessionID)
    if (!object.object.objectId)
      throw new Error(
        "Element is no longer available. Call browser.snapshot({tabID}) and use a fresh ref; the page may have replaced the element.",
      )
    return object.object.objectId
  }

  async function rect(element: Element, scroll = false) {
    if (scroll) {
      await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendID }, element.sessionID)
      await painted(element.sessionID)
    }
    const bounds = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite })
    const value = {
      ...Schema.decodeUnknownSync(bounds)(
        await call(
          element,
          "function() { const r = this.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; }",
        ),
      ),
    }
    const tree = await frames()
    let frame = tree.find((frame) => frame.id === element.frameID)
    while (frame?.parentID) {
      const parent = { frameID: frame.parentID, sessionID: sessionFor(frame.parentID, tree) }
      const owner = await cdp.send("DOM.getFrameOwner", { frameId: frame.id }, parent.sessionID)
      // A CSS transform on the iframe scales its content box; the child's own coordinates are unscaled.
      const box = Schema.decodeUnknownSync(Schema.Struct({ ...bounds.fields, scaleX: Schema.Finite, scaleY: Schema.Finite }))(
        await call(
          { backendID: owner.backendNodeId, ...parent },
          "function() { const r = this.getBoundingClientRect(); const sx = this.offsetWidth ? r.width / this.offsetWidth : 1; const sy = this.offsetHeight ? r.height / this.offsetHeight : 1; return {x:r.x+this.clientLeft*sx,y:r.y+this.clientTop*sy,width:r.width,height:r.height,scaleX:sx,scaleY:sy}; }",
        ),
      )
      value.x = box.x + value.x * box.scaleX
      value.y = box.y + value.y * box.scaleY
      value.width *= box.scaleX
      value.height *= box.scaleY
      frame = tree.find((item) => item.id === frame?.parentID)
    }
    return value
  }

  // Same-process child frames have no CDP target of their own; the nearest ancestor with one owns them.
  function sessionFor(frameID: string, tree: { id: string; parentID?: string }[]) {
    let id: string | undefined = frameID
    while (id && !sessions.has(id)) id = tree.find((frame) => frame.id === id)?.parentID
    return id ? sessions.get(id) : undefined
  }

  async function point(element: Element) {
    const box = await rect(element, true)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  async function click(element: Element, button = "left", count = 1, modifiers: readonly string[] = []) {
    const position = await point(element)
    const flags = modifiers.reduce((mask, key) => mask | (modifierBits[key] ?? 0), 0)
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...position, modifiers: flags })
    for (let clickCount = 1; clickCount <= count; clickCount++) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...position, button, clickCount, modifiers: flags })
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...position, button, clickCount, modifiers: flags })
    }
  }

  async function fill(element: Element, value: string, signal: AbortSignal) {
    const kind = await call(
      element,
      "function() { if (this.disabled || this.readOnly) return; if (this instanceof HTMLTextAreaElement || this.isContentEditable) return 'text'; if (!(this instanceof HTMLInputElement)) return; if (['date','time','datetime-local','month','week'].includes(this.type)) return 'structured'; if (!['file','checkbox','radio','button','submit','reset','image','hidden','range','color'].includes(this.type)) return 'text'; }",
    )
    if (!kind)
      throw new Error(
        "Target is not an enabled editable text field. Take a fresh snapshot and choose a textbox; use browser.select for dropdowns, browser.check for checkboxes/radios, or browser.files.upload for file inputs.",
      )
    // Keyboard input cannot compose a date or time control's value; Chromium clears a malformed one.
    if (kind === "structured") {
      await call(
        element,
        "function(value) { const previous = this.value; this.focus(); this.value = value; if (this.value !== value) { this.value = previous; throw new Error('The ' + this.type + ' input rejected this value and keeps its previous one. Use its required format, for example 2026-09-07 for date, 14:45 for time, 2026-09-07T14:45 for datetime-local, 2026-09 for month, or 2026-W37 for week.'); } this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }",
        [value],
      )
      return
    }
    await cdp.send("DOM.focus", { backendNodeId: element.backendID }, element.sessionID)
    // Focusing this field blurs the previous one; a validation dialog from that blur must stop here.
    abortError(signal)
    await key(process.platform === "darwin" ? "Meta+A" : "Control+A")
    await key("Backspace")
    abortError(signal)
    await cdp.send("Input.insertText", { text: value })
  }

  async function select(element: Element, values: readonly string[]) {
    await call(
      element,
      `function(values) { if (!(this instanceof HTMLSelectElement) || this.disabled) throw new Error('Target is not an enabled HTML select. Take a fresh snapshot and choose an enabled dropdown ref.'); if (!this.multiple && values.length !== 1) throw new Error('This dropdown accepts exactly one value; pass a one-item values array.'); for (const value of values) if (!Array.from(this.options).some(option => option.value === value && !option.disabled)) throw new Error('Option value was not found or is disabled. Inspect option values with browser.evaluate before retrying browser.select; values are not visible labels.'); for (const option of this.options) option.selected = values.includes(option.value); this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true})); }`,
      [values],
    )
  }

  async function check(element: Element, checked: boolean) {
    const current = await call(
      element,
      "function(checked) { if (!(this instanceof HTMLInputElement) || !['checkbox','radio'].includes(this.type) || this.disabled) throw new Error('Target is not an enabled checkbox or radio. Take a fresh snapshot and choose the correct ref.'); if (this.type === 'radio' && this.checked && !checked) throw new Error('A selected radio cannot be cleared by clicking it. Select a different radio in its group instead.'); return this.checked; }",
      [checked],
    )
    if (current !== checked) await click(element)
    if ((await call(element, "function() { return this.checked; }")) !== checked)
      throw new Error(
        "The page did not keep the requested checked state. Inspect the current snapshot and page validation before retrying; do not blindly toggle the control again.",
      )
  }

  async function key(chord: string) {
    if (!chord)
      throw new Error(
        "A key is required. Use a named key such as Enter or ArrowDown, a single character, or a chord such as Control+A.",
      )
    const parts = (chord.endsWith("+") ? chord.slice(0, -1) : chord).split("+")
    const name = parts.pop() || "+"
    const modifiers = parts.reduce((mask, part) => {
      const bit = modifierBits[part]
      if (!bit)
        throw new Error(
          `Unknown key modifier ${JSON.stringify(part)}. Supported modifiers are Alt, Control, Meta, and Shift; for example Control+A. Use Meta for macOS command shortcuts.`,
        )
      return mask | bit
    }, 0)
    const code =
      keyCodes[name] ??
      (name.length === 1 ? name.toUpperCase().charCodeAt(0) : /^F([1-9]|1[0-2])$/.test(name) ? 111 + Number(name.slice(1)) : undefined)
    if (code === undefined)
      throw new Error(
        `Unknown key ${JSON.stringify(name)}. Use Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, PageUp/Down, Home, End, Space, F1–F12, or one character. Use browser.fill for text.`,
      )
    // Named keys need their character data too: Enter submits forms and inserts newlines only with "\r".
    const text = name === "Enter" ? "\r" : name === "Space" ? " " : name.length === 1 ? name : undefined
    const event = { key: name === "Space" ? " " : name, windowsVirtualKeyCode: code, modifiers }
    const params = text !== undefined && !(modifiers & 6) ? { ...event, text } : event
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...params })
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...params })
  }

  async function accessibilitySnapshot(action: Extract<Browser.Action, { type: "snapshot" | "find" }>) {
    const tree = await frames()
    const selected = action.type === "snapshot" && action.ref ? target(action.ref) : undefined
    const frameID = selected?.frameID ?? action.frameID ?? tree[0]?.id
    if (!frameID || !tree.some((frame) => frame.id === frameID))
      throw new Error(
        "Frame is unavailable. Call browser.frames({tabID}) and use a current frameID from this tab; omit frameID for the main frame.",
      )
    const sessionID = sessionFor(frameID, tree)
    const depth = action.type === "snapshot" ? (action.depth ?? 8) : 8
    const ax = await cdp.send("Accessibility.getFullAXTree", { frameId: frameID, depth }, sessionID)
    const nodes = new Map(ax.nodes.map((node) => [node.nodeId, node]))
    const root = selected ? ax.nodes.find((node) => node.backendDOMNodeId === selected.backendID) : ax.nodes[0]
    if (!root)
      throw new Error(
        "Element is absent from this frame's accessibility snapshot. Retry browser.snapshot with the same tabID and no ref to refresh the frame, then choose a returned ref.",
      )
    refs.clear()
    const lines: string[] = []
    let truncated = false
    const walk = async (node: AXNode, level: number): Promise<void> => {
      if (level > depth || lines.length >= 500) {
        truncated = true
        return
      }
      const role = String(node.role?.value ?? "node")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 40)
      const properties = new Map(node.properties?.map((property) => [property.name, property.value.value]) ?? [])
      // Inline text boxes repeat their parent StaticText line by line and only cost tokens.
      if (role === "InlineTextBox") return
      if (!node.ignored) {
        const actionable =
          role !== "RootWebArea" &&
          (properties.get("focusable") || /^(button|link|textbox|combobox|checkbox|radio|option)$/.test(role))
        const ref = actionable && node.backendDOMNodeId ? input.ref() : ""
        const element = node.backendDOMNodeId ? { backendID: node.backendDOMNodeId, frameID, sessionID } : undefined
        if (ref && element) refs.set(ref, element)
        const flags = (["checked", "disabled", "expanded", "selected"] as const).flatMap((name) =>
          properties.has(name) ? [`${name}=${properties.get(name)}`] : [],
        )
        const box =
          action.type === "snapshot" && action.boxes && ref && element ? await rect(element).catch(() => undefined) : undefined
        lines.push(
          `${"  ".repeat(level)}${ref ? `@${ref} ` : ""}[${role}] ${JSON.stringify(
            String(node.name?.value ?? "")
              .replace(/\s+/g, " ")
              .slice(0, 300),
          )} ${flags.join(" ")}${box ? ` box=${JSON.stringify(box)}` : ""}`,
        )
      }
      if (["textbox", "searchbox"].includes(role) || properties.get("editable")) return
      for (const childID of node.childIds ?? []) {
        const child = nodes.get(childID)
        if (child) await walk(child, level + 1)
      }
    }
    await walk(root, 0)
    const content = (
      action.type === "find" ? lines.filter((line) => line.toLowerCase().includes(action.text.toLowerCase())) : lines
    ).join("\n")
    return { content: content.slice(0, Browser.MAX_TEXT), truncated: truncated || content.length > Browser.MAX_TEXT }
  }

  // Let the compositor apply a scroll before measuring; a background tab may never run animation frames.
  async function painted(sessionID?: string) {
    await Promise.race([
      cdp
        .send(
          "Runtime.evaluate",
          {
            expression: "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
            awaitPromise: true,
          },
          sessionID,
        )
        .catch(() => undefined),
      sleep(150),
    ])
  }
}

const autoAttach = {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true,
  filter: [{ type: "iframe", exclude: false }, { exclude: true }],
}

const modifierBits: Readonly<Record<string, number>> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }

const keyCodes: Readonly<Record<string, number>> = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  Delete: 46,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  PageUp: 33,
  PageDown: 34,
  Home: 36,
  End: 35,
  Space: 32,
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function abortError(signal: AbortSignal) {
  if (signal.aborted)
    throw new Error(
      "Browser operation was cancelled. Inspect the tab before deciding to repeat an action; cancellation does not undo changes already made.",
    )
}

async function waitFor(check: () => boolean | Promise<boolean>, signal: AbortSignal, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  const timeout = () => new Error(`Condition was not met within ${timeoutMs} ms.`)
  // A busy renderer can hold one check past the deadline, so each check races the remaining time.
  while (true) {
    abortError(signal)
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw timeout()
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(timeout()), remaining)
    })
    if (await Promise.race([check(), expired]).finally(() => clearTimeout(timer))) return
    await sleep(50)
  }
}
