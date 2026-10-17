export * as PlaytestTool from "./playtest.js"

import { spawn, type ChildProcess } from "node:child_process"
import { closeSync, existsSync, openSync, readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { makeHost } from "./desktop.js"

export const name = "playtest"

export const DIRECTORY = path.join(".opencode", "playtest")

const description = [
  "Test a game or any windowed app with a virtual mouse and keyboard, without touching the real ones.",
  "mode on launch/attach: auto (default) starts the app hidden and, only if it draws nothing there, moves it behind the user's windows invisibly, then on screen under them, then on top, never taking the user's keyboard. hidden keeps it invisible, behind runs it invisible behind the user's windows, visible shows it normally.",
  "Input goes straight into the app's window as messages, so it runs at full speed and works while the window is off-screen or in the background.",
  "Screenshots are taken from the window itself and show the virtual cursor; x/y are pixels of the latest screenshot of that app (client pixels before the first one).",
  "Steps run in order in one call. A failing step (an app that does not start, a pixel that does not match, wait_change that sees nothing) stops the run and reports FAIL.",
  "Fast checks without images: pixel (optionally asserted with color), diff and wait_change compare frames; frames films a burst into one contact sheet.",
  `Every screenshot, the app's stdout/stderr (log) and last-steps.json land in ${DIRECTORY}/<app>/; pass script to replay a saved steps file.`,
  "Input modes, set on launch: message (default) is background and instant, for engines that read window messages (Godot, SDL, GameMaker, Unity's old Input, web and UI apps).",
  "input: real feeds hardware-level input (scan codes, raw mouse) that every game reads, including DirectInput, Raw Input, Unreal and Unity's Input System; it brings the game forward for each call and gives the user's focus and cursor back after. If a game ignores message input, relaunch it with input: real.",
  "Hold keys with key press: down / up around other steps; look moves the camera by dx/dy.",
  "Fast navigation without images: read lists the text on screen with x/y; click_text clicks a button or menu item by its text; wait_text waits until text appears (a menu, a level name, Game Over).",
  "skip gets past logos, intros, cutscenes and dialogs by trying click, space, enter and esc until nothing reacts; wait_stable waits until loading or a transition ends.",
  "screenshot with region [x, y, w, h] zooms into part of the window to read small details.",
].join("\n")

const Step = Schema.Struct({
  action: Schema.Literals([
    "launch",
    "attach",
    "screenshot",
    "frames",
    "move",
    "click",
    "down",
    "up",
    "drag",
    "look",
    "scroll",
    "key",
    "type",
    "wait",
    "wait_change",
    "pixel",
    "diff",
    "resize",
    "log",
    "close",
    "read",
    "click_text",
    "wait_text",
    "skip",
    "wait_stable",
  ]),
  path: Schema.optionalKey(Schema.String).annotate({ description: "launch: program, .bat/.cmd or file to run" }),
  args: Schema.optionalKey(Schema.Array(Schema.String)).annotate({ description: "launch: arguments" }),
  cwd: Schema.optionalKey(Schema.String).annotate({ description: "launch: working directory, default the project" }),
  title: Schema.optionalKey(Schema.String).annotate({
    description: "launch/attach: part of the window title to pick, needed when a launcher opens the window",
  }),
  mode: Schema.optionalKey(Schema.Literals(["auto", "hidden", "behind", "visible"])).annotate({
    description:
      "launch/attach: auto (launch default) hides the app and shows it only as far as it needs to draw; hidden, behind (invisible behind the user's windows) or visible (attach default) fix it",
  }),
  hidden: Schema.optionalKey(Schema.Boolean).annotate({ description: "launch/attach: true is mode hidden, false is mode visible" }),
  input: Schema.optionalKey(Schema.Literals(["message", "real"])).annotate({
    description:
      "launch/attach: message (default) sends input to the window in the background; real uses the hardware path (scan codes, raw mouse) that every game reads, but takes the user's mouse and keyboard during each call",
  }),
  x: Schema.optionalKey(Schema.Number),
  y: Schema.optionalKey(Schema.Number),
  dx: Schema.optionalKey(Schema.Number).annotate({ description: "look: relative mouse movement, for game cameras" }),
  dy: Schema.optionalKey(Schema.Number),
  to_x: Schema.optionalKey(Schema.Number).annotate({ description: "drag: end x" }),
  to_y: Schema.optionalKey(Schema.Number).annotate({ description: "drag: end y" }),
  button: Schema.optionalKey(Schema.Literals(["left", "right", "middle"])),
  double: Schema.optionalKey(Schema.Boolean),
  amount: Schema.optionalKey(Schema.Number).annotate({ description: "scroll: notches, positive scrolls down" }),
  keys: Schema.optionalKey(Schema.String).annotate({ description: "key: a key or combination such as space, w, ctrl+s, shift+f5" }),
  press: Schema.optionalKey(Schema.Literals(["tap", "down", "up"])).annotate({
    description: "key: tap (default), or down to keep holding (walk while looking or clicking) until a later up",
  }),
  text: Schema.optionalKey(Schema.String).annotate({
    description: "type: text sent as characters; click_text/wait_text: text to find on screen (case and punctuation ignored)",
  }),
  region: Schema.optionalKey(Schema.Array(Schema.Number)).annotate({
    description: "screenshot: [x, y, w, h] in screenshot pixels to zoom into; read: only this part",
  }),
  ms: Schema.optionalKey(Schema.Number).annotate({
    description:
      "wait: milliseconds; key: how long to hold; drag: duration; launch, wait_change, wait_text, wait_stable, skip: timeout",
  }),
  count: Schema.optionalKey(Schema.Number).annotate({
    description: "frames: how many (default 9, max 64); drag: move steps; skip: most screens to skip (default 6)",
  }),
  interval: Schema.optionalKey(Schema.Number).annotate({ description: "frames: milliseconds between frames (default 100)" }),
  width: Schema.optionalKey(Schema.Number).annotate({
    description: "screenshot: image width (default the window's, at most 1280); resize: client width",
  }),
  height: Schema.optionalKey(Schema.Number).annotate({ description: "resize: client height" }),
  see: Schema.optionalKey(Schema.Boolean).annotate({
    description: "screenshot/frames: show the image to you (default true); false only saves it, faster",
  }),
  color: Schema.optionalKey(Schema.String).annotate({ description: "pixel: expected #rrggbb; a mismatch fails the run" }),
  tolerance: Schema.optionalKey(Schema.Number).annotate({ description: "pixel: allowed difference per channel (default 16)" }),
  threshold: Schema.optionalKey(Schema.Number).annotate({
    description:
      "wait_change: percent of the frame that must change (default 0.5); wait_stable: change still counted as calm (default 2)",
  }),
})
type Step = typeof Step.Type

export const Input = Schema.Struct({
  steps: Schema.optionalKey(Schema.Array(Step)).annotate({ description: "Actions to run in order" }),
  script: Schema.optionalKey(Schema.String).annotate({
    description: "A JSON file of steps (an array, or { steps }) to run before steps, relative to the project",
  }),
  app: Schema.optionalKey(Schema.String).annotate({ description: "Which launched app to drive, default the latest" }),
})
export type Input = typeof Input.Type

export const Output = Schema.Struct({ output: Schema.String })

const Script = Schema.Union([Schema.Array(Step), Schema.Struct({ steps: Schema.Array(Step) })])

const GUIDE = [
  "# Playtesting",
  "The playtest tool runs a game or app and drives it with its own virtual mouse and keyboard, so the user keeps their computer. Use it, not shell scripts, to run and test games and apps. Leave mode at auto: it hides the app when it can and shows it only as far as the app needs to draw; pass mode: visible when the user wants to watch.",
  "Play like a fast human tester:",
  "- Get to what you are testing quickly: launch, wait_stable (loading), skip (logos, intros, cutscenes, tutorials, dialogs), then click_text on menu items (Play, New Game, Continue, OK). Skip whatever is not under test.",
  "- Put a whole scenario in one call and check with read, wait_text, pixel, diff and wait_change. Take a screenshot only on a new screen, when a check fails, or to judge visuals; use see: false to keep one on disk.",
  "- Wait on what you expect (wait_text, wait_change, wait_stable), never on fixed sleeps.",
  "- Input that changes nothing: the game may ignore message input; relaunch with input: real. A black frame that auto mode could not fix (it tries the app's other windows and showing it step by step): the game is still loading (wait_stable) or fullscreen-exclusive (start it windowed).",
  "- Report what you checked, what failed and the saved screenshot paths.",
  `Save a scenario that works as a JSON file and replay it with script; each run's files are in ${DIRECTORY}/<app>/.`,
].join("\n")

// Chromium and Electron stop drawing a window they consider covered, which an off-screen window is.
const CHROMIUM_FLAGS = [
  "--disable-features=CalculateNativeWinOcclusion",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
]

const BLACK_HINT =
  "the frame is black: the app may still be loading (wait_stable or wait_text), run fullscreen-exclusive (start it windowed: Unity -screen-fullscreen 0, Unreal -windowed, Godot --windowed); mode auto shows a window as far as it needs to draw"

const MAX_IMAGES = 8

type App = {
  id: string
  hwnd: string
  pid?: number
  child?: ChildProcess
  owned: boolean
  real: boolean
  // Where the window is now, and how far auto mode may still show it to get a picture.
  placement: Placement
  limit: Placement
  size: { width: number; height: number }
  title: string
  user: string
  // The input that last skipped a screen, tried first next time.
  skipWith?: string
  dir: string
  log?: string
  // Image pixels to the window's own client pixels, from the latest screenshot.
  scale: { x: number; y: number }
  cursor: { x: number; y: number }
  shots: number
}

type Shot = { file: string; mime: string; text: string }

// From least to most visible: off-screen, invisible behind the user's windows, on screen under
// them, on top of them. A window only moves up this ladder.
const PLACEMENTS = ["hidden", "behind", "under", "visible"] as const
type Placement = (typeof PLACEMENTS)[number]

const RAISE: Record<Exclude<Placement, "hidden">, { script: (hwnd: string) => string; note: string }> = {
  behind: {
    script: (hwnd) => `[OcPlay]::Behind(${hwnd})`,
    note: "it drew nothing off-screen, so it now runs behind your windows, invisible and click-through",
  },
  under: {
    script: (hwnd) => `[OcPlay]::Place(${hwnd}, $false)`,
    note: "it drew nothing while invisible, so it is now on screen under your windows, without your keyboard",
  },
  visible: {
    script: (hwnd) => `[OcPlay]::Place(${hwnd}, $true)`,
    note: "it draws only when seen, so it is now on top of your windows, without taking your keyboard",
  },
}

export const Plugin = {
  id: "opencode.tool.playtest",
  effect: Effect.fn("PlaytestTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    const permission = yield* Permission.Service
    const root = location.project.directory
    const apps = new Map<string, App>()
    const latest = new Map<string, string>()
    let counter = 0
    let warm = false
    // Read from stdin, PowerShell ends a block at a blank line, which would cut the C# source short.
    const host = makeHost(HOST_PRELUDE.replace(/\n\s*\n/g, "\n"), "playtest")
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const app of apps.values()) if (app.owned) kill(app)
        host.close()
      }),
    )

    const perform = Effect.fnUntraced(function* (input: Input, context: Tool.Context) {
      if (process.platform !== "win32") return yield* new ToolFailure({ message: "playtest works on Windows for now" })
      const loaded = input.script ? yield* loadScript(root, input.script) : []
      const steps = [...loaded, ...(input.steps ?? [])]
      if (steps.length === 0) return yield* new ToolFailure({ message: "Pass steps or a script" })
      yield* permission
        .assert({
          action: name,
          resources: [
            ...new Set(steps.map((step) => (step.action === "launch" && step.path ? `launch ${step.path}` : step.action))),
          ],
          save: ["*"],
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
        })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied: playtest", error })))

      const started = Date.now()
      const lines: string[] = []
      const images: Shot[] = []
      let current = input.app ?? latest.get(context.sessionID)
      let failed = false
      for (const [index, step] of steps.entries()) {
        const begun = Date.now()
        const result = yield* Effect.promise(() =>
          execute(step, current).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
        )
        // Each step's time, so slow steps are visible to whoever tunes the scenario.
        const label = `${index + 1}. ${step.action} [${Date.now() - begun} ms]`
        if (!result.ok) {
          lines.push(`${label}: FAIL: ${result.error instanceof Error ? result.error.message : String(result.error)}`)
          const before = steps[index - 1]?.action
          const app = current ? apps.get(current) : undefined
          if (
            step.action === "wait_change" &&
            app &&
            !app.real &&
            ["click", "key", "type", "drag", "scroll", "look", "down", "up"].includes(before ?? "")
          )
            lines.push(
              "Hint: the input changed nothing. If the game should have reacted, it may read only hardware input: relaunch with input: real.",
            )
          failed = true
          break
        }
        const value = result.value
        if (value.app) {
          current = value.app
          latest.set(context.sessionID, value.app)
        }
        if (value.shot) {
          if (step.see !== false && images.length < MAX_IMAGES) images.push(value.shot)
          lines.push(`${label}: ${value.shot.text}`)
          continue
        }
        lines.push(value.text ? `${label}: ${value.text}` : `${label}: ok`)
      }
      // Real input borrowed the user's focus and cursor; give them back once per call, not per step.
      if ([...apps.values()].some((app) => app.real))
        yield* Effect.promise(() => call("[OcPlay]::Release()").catch(() => ""))
      const app = current ? apps.get(current) : undefined
      if (app) yield* Effect.promise(() => writeFile(path.join(app.dir, "last-steps.json"), JSON.stringify({ steps }, null, 2)))
      lines.push(
        failed
          ? `FAIL after ${Date.now() - started} ms; the remaining steps were skipped.`
          : `PASS: ${steps.length} steps in ${Date.now() - started} ms.`,
      )
      const output = lines.join("\n")
      const files = yield* Effect.promise(() =>
        Promise.all(
          images.map(async (shot, index) => ({
            type: "file" as const,
            uri: `data:${shot.mime};base64,${(await readFile(shot.file)).toString("base64")}`,
            mime: shot.mime,
            name: `playtest-${index + 1}`,
          })),
        ),
      )
      return { output: { output }, content: [{ type: "text" as const, text: output }, ...files] }
    })

    const call = (script: string) => host.call(script)

    const need = (id: string | undefined) => {
      const app = id ? apps.get(id) : undefined
      if (!app) throw new Error(id ? `No app ${id}; launch or attach one first` : "Launch or attach an app first")
      return app
    }

    // x/y of the latest screenshot to the window's client pixels.
    const point = (app: App, x: number | undefined, y: number | undefined) => {
      if (x === undefined || y === undefined) return app.cursor
      return { x: Math.round(x * app.scale.x), y: Math.round(y * app.scale.y) }
    }

    async function shoot(app: App, width: number | undefined, region?: readonly number[]) {
      app.shots += 1
      const file = path.join(app.dir, `shot-${String(app.shots).padStart(3, "0")}.jpg`)
      // A region is given in screenshot pixels and cut from the window's own pixels.
      const [rx = 0, ry = 0, rw = 0, rh = 0] = (region ?? []).map((value, index) =>
        Math.round(value * (index % 2 === 0 ? app.scale.x : app.scale.y)),
      )
      const capture = async () => {
        const reply = await call(
          `[OcPlay]::Capture(${app.hwnd}, ${psString(file)}, ${Math.round(width ?? 1280)}, ${app.cursor.x}, ${app.cursor.y}, ${rx}, ${ry}, ${rw}, ${rh})`,
        )
        const [imageWidth = 0, imageHeight = 0, clientWidth = 0, clientHeight = 0, bright = 255] = reply
          .split(/\s+/)
          .map(Number)
        return { imageWidth, imageHeight, clientWidth, clientHeight, black: bright < 3 }
      }
      const notes: string[] = []
      const initial = await capture()
      const first = initial.black ? await (async () => {
        // The pick may be a helper window: the first other window of the app that draws wins.
        const others = (await call(`[OcPlay]::Windows(${app.pid ?? 0}, ${psString(app.pid ? "" : app.title)})`))
          .split("\n")
          .map((line) => line.split("\t"))
          .filter((parts) => parts[0] && parts[0] !== app.hwnd)
        for (const [hwnd = "", size = "", shown = "", , title = ""] of others) {
          const previous = app.hwnd
          app.hwnd = hwnd
          // A window that was never shown draws nothing; off-screen it can be shown without being seen.
          const staged = app.placement !== "visible" && shown === "hidden"
          if (staged) {
            await call(`[OcPlay]::Stage(${hwnd}, $true, $${app.real}, ${app.user})`)
            await new Promise((resolve) => setTimeout(resolve, 300))
          }
          const attempt = await capture().catch(() => undefined)
          if (!attempt || attempt.black) {
            if (staged) await call(`[OcPlay]::Hide(${hwnd})`)
            app.hwnd = previous
            continue
          }
          {
            const info = (
              await call(`[OcPlay]::Stage(${hwnd}, $${app.placement !== "visible"}, $${app.real}, ${app.user})`)
            ).split("\t")
            if (app.placement !== "hidden") await call(RAISE[app.placement].script(hwnd))
            const [width = 0, height = 0] = (info[0] ?? "").split(" ").map(Number)
            app.size = { width, height }
            app.cursor = { x: Math.round(width / 2), y: Math.round(height / 2) }
            notes.push(`switched to the app's window "${title}" (${size}) that actually draws`)
            return capture()
          }
        }
        return initial
      })() : initial
      // Many engines stop drawing off-screen, some while invisible, some unless seen: show the
      // window one step at a time, only as far as it takes to get a picture.
      const ladder = PLACEMENTS.slice(PLACEMENTS.indexOf(app.placement) + 1, PLACEMENTS.indexOf(app.limit) + 1)
      const shot = await ladder.reduce<Promise<typeof first>>(async (previous, placement) => {
        const result = await previous
        if (!result.black || placement === "hidden") return result
        await call(RAISE[placement].script(app.hwnd))
        app.placement = placement
        await new Promise((resolve) => setTimeout(resolve, 600))
        notes.push(RAISE[placement].note)
        return capture()
      }, Promise.resolve(first))
      if (shot.black) notes.push(BLACK_HINT)
      if (!rw && shot.imageWidth > 0 && shot.imageHeight > 0)
        app.scale = { x: shot.clientWidth / shot.imageWidth, y: shot.clientHeight / shot.imageHeight }
      return { file, ...shot, note: notes.join("; ") }
    }

    // Text on screen through Windows OCR, in the window's own pixels.
    async function words(app: App, region?: readonly number[]) {
      // An uncompressed bitmap saves and loads far faster than PNG. Windows OCR misses text at
      // some scales and reads it at others (a 2x frame can come back empty where 1.5x and 3x
      // read it), and a read takes tens of ms, so an empty read is retried at the next scale.
      const file = path.join(app.dir, "ocr.bmp")
      const largest = Math.max(1, Math.min(3, 2400 / Math.max(app.size.width, 1)))
      const scales = [...new Set([largest, 1.5, 1].filter((scale) => scale <= largest))]
      const read = async (factor: number) => {
        await call(`[OcPlay]::Snap(${app.hwnd}, ${psString(file)}, ${factor})`)
        return (await call(`Read-Text ${psString(file)}`))
          .split("\n")
          .map((line) => line.split("\t"))
          .filter((parts) => parts.length >= 3)
          .map(([box = "", line = "0", text = ""]) => {
            const [x = 0, y = 0, w = 0, h = 0] = box.split(" ").map((value) => Number(value) / factor)
            return { x, y, w, h, line: Number(line), text: text.trim() }
          })
      }
      const found = await scales.reduce<Promise<Word[]>>(
        async (previous, factor) => {
          const result = await previous
          return result.length > 0 ? result : read(factor)
        },
        Promise.resolve([]),
      )
      if (!region || region.length < 4) return found
      const [rx = 0, ry = 0, rw = 0, rh = 0] = region.map((value, index) => value * (index % 2 === 0 ? app.scale.x : app.scale.y))
      return found.filter((word) => word.x + word.w / 2 >= rx && word.x + word.w / 2 <= rx + rw && word.y + word.h / 2 >= ry && word.y + word.h / 2 <= ry + rh)
    }

    // Own window pixels to the pixels of the latest screenshot, which is what the model reads and clicks.
    const shown = (app: App, x: number, y: number) => `${Math.round(x / app.scale.x)},${Math.round(y / app.scale.y)}`

    async function open(step: Step, attach: boolean) {
      counter += 1
      const id = `app${counter}`
      const dir = path.join(root, DIRECTORY, `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`)
      await mkdir(dir, { recursive: true })
      const real = step.input === "real"
      // Real clicks land where the window is on screen, so real input and attached windows start visible.
      const mode =
        step.mode ??
        (step.hidden === true ? "hidden" : step.hidden === false || real || attach ? "visible" : "auto")
      const start: Placement = mode === "auto" ? "hidden" : mode
      const limit: Placement = mode === "auto" ? "visible" : mode === "hidden" ? "behind" : start
      const hidden = start !== "visible"
      const title = step.title ?? ""
      // The window the user works in, given back if the app grabs the foreground.
      const user = (await call("[OcPlay]::User()")).trim() || "0"
      let child: ChildProcess | undefined
      let log: string | undefined
      if (!attach) {
        if (!step.path) throw new Error("launch needs path")
        log = path.join(dir, "app.log")
        const fd = openSync(log, "a")
        const target = path.isAbsolute(step.path) || !/[\\/]/.test(step.path) ? step.path : path.resolve(root, step.path)
        const cwd = step.cwd ? path.resolve(root, step.cwd) : root
        child = spawn(target, chromiumArgs(target, step.args ?? [], cwd, hidden), {
          cwd,
          stdio: ["ignore", fd, fd],
          // Started with SW_HIDE, the window never flashes on screen before it is moved away.
          windowsHide: hidden,
          shell: /\.(bat|cmd)$/i.test(target),
        })
        closeSync(fd)
        const failure = new Promise<never>((_, reject) =>
          child?.once("error", (error) => reject(new Error(`Could not start ${step.path}: ${error.message}`))),
        )
        failure.catch(() => {})
        await Promise.race([new Promise((resolve) => setTimeout(resolve, 50)), failure])
      } else if (!title) throw new Error("attach needs title")
      const deadline = Date.now() + Math.min(Math.max(step.ms ?? 20_000, 1_000), 120_000)
      let hwnd = "0"
      while (Date.now() < deadline) {
        hwnd = (await call(`[OcPlay]::Find(${child?.pid ?? 0}, ${psString(title)})`)).trim()
        if (hwnd !== "0") break
        if (child && child.exitCode !== null && !title) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      // Engines open a splash or helper window first; keep the best pick once the choice settles.
      // Done once the same window wins three times in a row (about 250 ms), at most 1.5 s.
      for (let same = 0, settle = Date.now() + 1_500; hwnd !== "0" && same < 3 && Date.now() < settle; ) {
        await new Promise((resolve) => setTimeout(resolve, 80))
        const again = (await call(`[OcPlay]::Find(${child?.pid ?? 0}, ${psString(title)})`)).trim()
        same = again === hwnd ? same + 1 : 0
        if (again !== "0") hwnd = again
      }
      if (hwnd === "0") {
        const tail = log ? (await readFile(log, "utf8").catch(() => "")).trim().split("\n").slice(-15).join("\n") : ""
        if (child) await kill({ child, pid: child.pid })
        throw new Error(
          [
            child && child.exitCode !== null
              ? `The app exited with ${child.exitCode} before it opened a window`
              : `No window ${title ? `titled *${title}* ` : ""}appeared`,
            tail && `Log:\n${tail}`,
          ]
            .filter(Boolean)
            .join("\n"),
        )
      }
      const info = (await call(`[OcPlay]::Stage(${hwnd}, $${hidden}, $${real}, ${user})`)).split("\t")
      if (start === "behind") await call(RAISE.behind.script(hwnd))
      const [clientWidth = 0, clientHeight = 0] = (info[0] ?? "").split(" ").map(Number)
      const app: App = {
        id,
        hwnd,
        pid: child?.pid ?? (Number(info[2]) || undefined),
        child,
        owned: !attach,
        real,
        placement: start,
        limit,
        size: { width: clientWidth, height: clientHeight },
        title,
        user,
        dir,
        log,
        scale: { x: 1, y: 1 },
        cursor: { x: Math.round(clientWidth / 2), y: Math.round(clientHeight / 2) },
        shots: 0,
      }
      apps.set(id, app)
      return {
        app: id,
        text: `${attach ? "attached" : "launched"} ${id} "${info[1] ?? ""}" ${clientWidth}x${clientHeight}${
          { hidden: " hidden off-screen", behind: " invisible behind your windows", under: "", visible: " on screen" }[start]
        }${mode === "auto" ? " (auto: shown only if it draws nothing)" : ""}, ${real ? "real" : "message"} input; files in ${path.relative(root, dir)}`,
      }
    }

    async function execute(step: Step, id: string | undefined): Promise<{ text?: string; app?: string; shot?: Shot }> {
      if (step.action === "launch") return open(step, false)
      if (step.action === "attach") return open(step, true)
      if (step.action === "wait") {
        await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(step.ms ?? 500, 0), 30_000)))
        return {}
      }
      const app = need(id)
      const button = step.button ?? "left"
      switch (step.action) {
        case "screenshot": {
          const zoom = step.region && step.region.length >= 4 ? step.region : undefined
          const shot = await shoot(app, step.width, zoom)
          return {
            shot: {
              file: shot.file,
              mime: "image/jpeg",
              text: [
                zoom
                  ? `${shot.imageWidth}x${shot.imageHeight} zoom of [${zoom.join(", ")}], saved as ${path.relative(root, shot.file)}; x/y still use the full screenshot's pixels`
                  : `${shot.imageWidth}x${shot.imageHeight} image of the ${shot.clientWidth}x${shot.clientHeight} window, saved as ${path.relative(root, shot.file)}; x/y now use this image's pixels`,
                shot.note,
              ]
                .filter(Boolean)
                .join("; "),
            },
          }
        }
        case "frames": {
          const count = Math.min(Math.max(Math.round(step.count ?? 9), 1), 64)
          const interval = Math.min(Math.max(Math.round(step.interval ?? 100), 0), 2_000)
          app.shots += 1
          const sheet = path.join(app.dir, `frames-${String(app.shots).padStart(3, "0")}.jpg`)
          const reply = await call(
            `[OcPlay]::Frames(${app.hwnd}, ${psString(sheet)}, ${count}, ${interval}, ${app.cursor.x}, ${app.cursor.y})`,
          )
          return {
            shot: {
              file: sheet,
              mime: "image/jpeg",
              text: `${count} frames ${interval} ms apart (${reply}) as one sheet, read left to right, top to bottom: ${path.relative(root, sheet)}`,
            },
          }
        }
        case "move": {
          app.cursor = point(app, step.x, step.y)
          return { text: await call(`[OcPlay]::Move(${app.hwnd}, ${app.cursor.x}, ${app.cursor.y})`) }
        }
        case "click":
        case "down":
        case "up": {
          app.cursor = point(app, step.x, step.y)
          const at = `${app.hwnd}, ${app.cursor.x}, ${app.cursor.y}, ${psString(button)}`
          if (step.action === "down") return { text: await call(`[OcPlay]::Button(${at}, $true)`) }
          if (step.action === "up") return { text: await call(`[OcPlay]::Button(${at}, $false)`) }
          return { text: await call(`[OcPlay]::Click(${at}, $${step.double === true})`) }
        }
        case "drag": {
          const from = point(app, step.x, step.y)
          if (step.to_x === undefined || step.to_y === undefined) throw new Error("drag needs to_x and to_y")
          const to = point(app, step.to_x, step.to_y)
          app.cursor = to
          const moves = Math.min(Math.max(Math.round(step.count ?? 12), 1), 200)
          const ms = Math.min(Math.max(Math.round(step.ms ?? 0), 0), 10_000)
          return {
            text: await call(
              `[OcPlay]::Drag(${app.hwnd}, ${from.x}, ${from.y}, ${to.x}, ${to.y}, ${psString(button)}, ${moves}, ${ms})`,
            ),
          }
        }
        case "look": {
          const dx = Math.round(step.dx ?? 0)
          const dy = Math.round(step.dy ?? 0)
          if (!app.real) app.cursor = { x: app.cursor.x + dx, y: app.cursor.y + dy }
          return { text: await call(`[OcPlay]::Look(${app.hwnd}, ${dx}, ${dy}, ${app.cursor.x}, ${app.cursor.y})`) }
        }
        case "scroll": {
          app.cursor = point(app, step.x, step.y)
          return {
            text: await call(`[OcPlay]::Wheel(${app.hwnd}, ${app.cursor.x}, ${app.cursor.y}, ${Math.round(step.amount ?? 3)})`),
          }
        }
        case "key": {
          if (!step.keys) throw new Error("key needs keys, e.g. space or ctrl+s")
          const { modifiers, key } = virtualKeys(step.keys)
          const hold = Math.min(Math.max(Math.round(step.ms ?? 0), 0), 10_000)
          const press = { tap: 0, down: 1, up: 2 }[step.press ?? "tap"]
          return {
            text: await call(`[OcPlay]::Key(${app.hwnd}, [int[]]@(${modifiers.join(",")}), ${key}, ${hold}, ${press})`),
          }
        }
        case "type":
          if (!step.text) throw new Error("type needs text")
          return { text: await call(`[OcPlay]::Type(${app.hwnd}, ${psString(step.text)})`) }
        case "wait_change": {
          const ms = Math.min(Math.max(Math.round(step.ms ?? 3_000), 0), 25_000)
          return { text: await call(`[OcPlay]::WaitChange(${app.hwnd}, ${ms}, ${step.threshold ?? 0.5})`) }
        }
        case "diff":
          return { text: `${await call(`[OcPlay]::Diff(${app.hwnd})`)}% of the frame changed since the previous frame` }
        case "pixel": {
          const at = point(app, step.x, step.y)
          const color = (await call(`[OcPlay]::Pixel(${app.hwnd}, ${at.x}, ${at.y})`)).trim()
          if (step.color && !close(color, step.color, step.tolerance ?? 16))
            throw new Error(`pixel at ${at.x},${at.y} is ${color}, expected ${step.color}`)
          return { text: `${color} at ${at.x},${at.y}${step.color ? " as expected" : ""}` }
        }
        case "resize": {
          if (!step.width || !step.height) throw new Error("resize needs width and height")
          const reply = await call(`[OcPlay]::Resize(${app.hwnd}, ${Math.round(step.width)}, ${Math.round(step.height)})`)
          app.scale = { x: 1, y: 1 }
          return { text: `client is ${reply} now` }
        }
        case "read": {
          const found = await words(app, step.region)
          if (found.length === 0) return { text: "no text on screen" }
          const lines = Map.groupBy(found, (word) => word.line)
          return {
            text:
              "\n" +
              [...lines.values()]
                .map((line) => `${shown(app, line[0]!.x, line[0]!.y + line[0]!.h / 2)}  ${line.map((word) => word.text).join(" ")}`)
                .join("\n"),
          }
        }
        case "click_text": {
          if (!step.text) throw new Error("click_text needs text")
          const found = await words(app, step.region)
          const hit = locate(found, step.text)
          if (!hit)
            throw new Error(
              `No "${step.text}" on screen. Text there: ${[...new Set(found.map((word) => word.text))].slice(0, 40).join(" ") || "none"}`,
            )
          app.cursor = { x: Math.round(hit.x + hit.w / 2), y: Math.round(hit.y + hit.h / 2) }
          await call(`[OcPlay]::Click(${app.hwnd}, ${app.cursor.x}, ${app.cursor.y}, ${psString(button)}, $${step.double === true})`)
          const seen = hit.text === step.text ? "" : ` (read as "${hit.text}")`
          return { text: `clicked "${step.text}"${seen} at ${shown(app, app.cursor.x, app.cursor.y)}` }
        }
        case "wait_text": {
          if (!step.text) throw new Error("wait_text needs text")
          const ms = Math.min(Math.max(Math.round(step.ms ?? 10_000), 0), 25_000)
          const started = Date.now()
          for (;;) {
            const found = await words(app, step.region)
            const hit = locate(found, step.text)
            if (hit)
              return {
                text: `"${step.text}"${hit.text === step.text ? "" : ` (read as "${hit.text}")`} at ${shown(app, hit.x + hit.w / 2, hit.y + hit.h / 2)} after ${Date.now() - started} ms`,
              }
            if (Date.now() - started >= ms)
              throw new Error(
                `"${step.text}" did not appear within ${ms} ms. Text there: ${[...new Set(found.map((word) => word.text))].slice(0, 40).join(" ") || "none"}`,
              )
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
        }
        case "wait_stable": {
          const ms = Math.min(Math.max(Math.round(step.ms ?? 10_000), 0), 25_000)
          const quiet = Math.min(Math.max(Math.round(step.interval ?? 400), 50), 5_000)
          return { text: await call(`[OcPlay]::WaitStable(${app.hwnd}, ${ms}, ${quiet}, ${step.threshold ?? 2})`) }
        }
        case "skip": {
          const limit = Math.min(Math.max(Math.round(step.count ?? 6), 1), 20)
          const deadline = Date.now() + Math.min(Math.max(Math.round(step.ms ?? 12_000), 500), 25_000)
          const center = { x: Math.round(app.size.width / 2), y: Math.round(app.size.height / 2) }
          const tries: [string, string][] = [
            ["click", `[OcPlay]::Click(${app.hwnd}, ${center.x}, ${center.y}, 'left', $false)`],
            ["space", `[OcPlay]::Key(${app.hwnd}, [int[]]@(), 32, 0, 0)`],
            ["enter", `[OcPlay]::Key(${app.hwnd}, [int[]]@(), 13, 0, 0)`],
            ["esc", `[OcPlay]::Key(${app.hwnd}, [int[]]@(), 27, 0, 0)`],
          ]
          const skipped: string[] = []
          // A playing video changes by itself, so a skip has to change the frame clearly more than that.
          await call(`[OcPlay]::Diff(${app.hwnd})`)
          await new Promise((resolve) => setTimeout(resolve, 150))
          const motion = Number(await call(`[OcPlay]::Diff(${app.hwnd})`)) || 0
          const needed = Math.min(90, Math.max(5, motion * 1.5 + 10))
          while (skipped.length < limit && Date.now() < deadline) {
            const reacted = await (async () => {
              // The input that skipped the last screen usually skips the next one too.
              const order = tries.toSorted((a, b) => Number(b[0] === app.skipWith) - Number(a[0] === app.skipWith))
              for (const [label, script] of order) {
                if (Date.now() >= deadline) return undefined
                await call(`[OcPlay]::Diff(${app.hwnd})`)
                await call(script)
                const changed = await call(`[OcPlay]::WaitChange(${app.hwnd}, 400, ${needed})`).catch(() => undefined)
                if (changed) {
                  app.skipWith = label
                  return `${label} (${changed.split(" changed")[0]})`
                }
              }
              return undefined
            })()
            if (!reacted) break
            skipped.push(reacted)
          }
          app.cursor = center
          if (skipped.length === 0)
            return {
              text: `nothing reacted to click, space, enter or esc: this screen does not skip${app.real ? "" : " (or the game ignores message input: try input: real)"}`,
            }
          return { text: `skipped ${skipped.length} screen(s): ${skipped.join(", ")}; then nothing more reacted` }
        }
        case "log": {
          if (!app.log) return { text: "attached apps have no captured log" }
          const text = await readFile(app.log, "utf8").catch(() => "")
          return { text: text.trim() ? `\n${text.trim().split("\n").slice(-40).join("\n")}` : "the log is empty" }
        }
        case "close": {
          if (app.owned) await kill(app)
          else await call(`[OcPlay]::Close(${app.hwnd})`)
          apps.delete(app.id)
          return { text: `closed ${app.id}` }
        }
      }
      throw new Error(`Unsupported step: ${step.action}`)
    }

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) => perform(input, context),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => {
        if (!event.tools[name]) return
        event.system.push({ type: "text", text: GUIDE })
        // Start and compile the helper while the model thinks, not on its first call.
        if (process.platform === "win32" && !warm) {
          warm = true
          host.call("''").catch(() => (warm = false))
        }
      }),
    )
  }),
}

const loadScript = Effect.fnUntraced(function* (root: string, file: string) {
  const text = yield* Effect.tryPromise({
    try: () => readFile(path.resolve(root, file), "utf8"),
    catch: (error) => new ToolFailure({ message: `Could not read script ${file}: ${String(error)}` }),
  })
  const parsed = yield* Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (error) => new ToolFailure({ message: `Script ${file} is not JSON: ${String(error)}` }),
  })
  const script = yield* Schema.decodeUnknownEffect(Script)(parsed).pipe(
    Effect.mapError((error) => new ToolFailure({ message: `Script ${file} has invalid steps: ${error.message}` })),
  )
  return "steps" in script ? script.steps : script
})

function kill(app: Pick<App, "pid" | "child">) {
  const pid = app.pid
  if (!pid) return Promise.resolve()
  // The whole tree: launchers and .cmd wrappers leave the game as a child process.
  return new Promise<void>((resolve) =>
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
      .on("error", () => resolve())
      .on("exit", () => resolve()),
  )
}

export function close(actual: string, expected: string, tolerance: number) {
  const parse = (color: string) => {
    const hex = color.trim().replace(/^#/, "")
    const full = hex.length === 3 ? [...hex].map((char) => char + char).join("") : hex
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16))
  }
  const a = parse(actual)
  const b = parse(expected)
  return a.every((value, index) => Math.abs(value - (b[index] ?? Number.NaN)) <= tolerance)
}

const VK: Record<string, number> = {
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  return: 0x0d,
  shift: 0x10,
  ctrl: 0x11,
  control: 0x11,
  alt: 0x12,
  pause: 0x13,
  capslock: 0x14,
  esc: 0x1b,
  escape: 0x1b,
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  insert: 0x2d,
  delete: 0x2e,
  del: 0x2e,
  win: 0x5b,
  "-": 0xbd,
  "=": 0xbb,
  ",": 0xbc,
  ".": 0xbe,
  "/": 0xbf,
  ";": 0xba,
  "'": 0xde,
  "[": 0xdb,
  "]": 0xdd,
  "\\": 0xdc,
  "`": 0xc0,
}

export function virtualKeys(combo: string) {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
  const code = (part: string) => {
    if (VK[part] !== undefined) return VK[part]
    const f = /^f([1-9]|1[0-9]|2[0-4])$/.exec(part)
    if (f) return 0x6f + Number(f[1])
    if (/^num[0-9]$/.test(part)) return 0x60 + Number(part.slice(3))
    if (/^[a-z0-9]$/.test(part)) return part.toUpperCase().charCodeAt(0)
    throw new Error(`Unknown key: ${part}`)
  }
  const key = parts.at(-1)
  if (!key) throw new Error("Pass a key, e.g. space")
  return { modifiers: parts.slice(0, -1).map(code), key: code(key) }
}

const psString = (text: string) => `'${text.replace(/'/g, "''")}'`

type Word = { x: number; y: number; w: number; h: number; line: number; text: string }

// OCR in one language reads lookalike letters of another ("Мепи" for "Menu", "PIay" for "Play"),
// so both sides are folded to one alphabet before they are compared.
const LOOKALIKE: Record<string, string> = {
  а: "a", в: "b", с: "c", е: "e", ё: "e", н: "h", к: "k", м: "m", п: "n", о: "o", р: "p", т: "t", и: "u", у: "y", х: "x", г: "r", з: "3",
  i: "l", "1": "l", "|": "l", "0": "o",
}

const normalize = (text: string) =>
  [...text.toLowerCase().replace(/[^\p{L}\p{N}|]/gu, "")].map((char) => LOOKALIKE[char] ?? char).join("")

// Edits to turn a into some substring of b, so a misread letter or two still matches.
function distance(goal: string, text: string) {
  const row = Array.from({ length: text.length + 1 }, () => 0)
  for (const [i, char] of [...goal].entries()) {
    let diagonal = row[0]!
    row[0] = i + 1
    for (let j = 1; j <= text.length; j++) {
      const above = row[j]!
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (text[j - 1] === char ? 0 : 1))
      diagonal = above
    }
  }
  return Math.min(...row)
}

// The shortest run of words on one line whose letters contain the wanted text, allowing one
// misread letter in five when nothing matches exactly.
export function locate(words: readonly Word[], wanted: string) {
  const goal = normalize(wanted)
  if (!goal) return undefined
  const lines = [...Map.groupBy(words, (word) => word.line).values()]
  const runs = (allowed: number) =>
    lines.flatMap((line) =>
      line.flatMap((_, start) =>
        line
          .slice(start)
          .map((__, length) => line.slice(start, start + length + 1))
          .filter((run) => distance(goal, normalize(run.map((word) => word.text).join(""))) <= allowed)
          .slice(0, 1),
      ),
    )
  const exact = runs(0)
  const found = exact.length > 0 ? exact : runs(Math.floor(goal.length / 5))
  const best = found.toSorted((a, b) => a.length - b.length)[0]
  if (!best) return undefined
  const left = Math.min(...best.map((word) => word.x))
  const top = Math.min(...best.map((word) => word.y))
  return {
    x: left,
    y: top,
    w: Math.max(...best.map((word) => word.x + word.w)) - left,
    h: Math.max(...best.map((word) => word.y + word.h)) - top,
    text: best.map((word) => word.text).join(" "),
  }
}

// Off-screen Chromium and Electron windows stop drawing unless told not to track occlusion.
export function chromiumArgs(target: string, args: readonly string[], cwd: string, hidden: boolean) {
  if (!hidden) return [...args]
  const name = path.basename(target).toLowerCase()
  const folder = path.dirname(target)
  const direct =
    /^(electron|chrome|chromium|msedge|brave|nw)(\.exe|\.cmd)?$/.test(name) ||
    existsSync(path.join(folder, "resources", "app.asar")) ||
    // NW.js games (RPG Maker MV/MZ ship it as Game.exe) keep nw.dll or package.nw beside the exe.
    ["nw.dll", "nw_elf.dll", "package.nw"].some((file) => existsSync(path.join(folder, file))) ||
    (/^npx(\.cmd)?$/.test(name) && args.some((arg) => /electron/i.test(arg)))
  if (direct) return [...args, ...CHROMIUM_FLAGS]
  // npm start in an Electron project passes arguments after -- on to electron.
  if (!/^(npm|pnpm|yarn)(\.cmd)?$/.test(name)) return [...args]
  const manifest = (() => {
    try {
      return readFileSync(path.join(cwd, "package.json"), "utf8")
    } catch {
      return ""
    }
  })()
  if (!/"electron"/.test(manifest)) return [...args]
  return [...args, ...(args.includes("--") ? [] : ["--"]), ...CHROMIUM_FLAGS]
}

// One compiled helper does every step in-process: window lookup, message input, PrintWindow
// capture and frame comparison each take milliseconds, not a PowerShell start per step.
export const HOST_PRELUDE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class OcPlay {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct PE {
    public uint Size, Usage, Pid; public IntPtr Heap; public uint Module, Threads, Parent; public int Base; public uint Flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Exe;
  }
  [StructLayout(LayoutKind.Sequential)] public struct GUI {
    public uint Size, Flags; public IntPtr Active, Focus, Capture, Menu, Move, Caret; public RECT Rect;
  }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetLong(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern IntPtr ChildWindowFromPointEx(IntPtr h, POINT p, uint f);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint c, uint t);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint t, ref GUI g);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint f, uint p);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr s, ref PE e);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr s, ref PE e);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, int x, int y, int d, IntPtr e);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint f, IntPtr e);
  [DllImport("user32.dll")] static extern short VkKeyScan(char c);
  [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, uint op);

  static readonly Dictionary<long, int> held = new Dictionary<long, int>();
  static readonly Dictionary<long, IntPtr> target = new Dictionary<long, IntPtr>();
  static readonly Dictionary<long, byte[]> last = new Dictionary<long, byte[]>();
  static readonly HashSet<long> real = new HashSet<long>();
  static readonly Dictionary<long, IntPtr> owner = new Dictionary<long, IntPtr>();
  // What the user had before real input borrowed it, restored by Release.
  static IntPtr userWindow = IntPtr.Zero;
  static POINT userCursor;
  static bool borrowed;

  public static void Init() {
    // Per-monitor aware: window sizes and captures are real pixels.
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
  }

  static HashSet<uint> Tree(uint root) {
    var all = new HashSet<uint>();
    if (root == 0) return all;
    all.Add(root);
    var parents = new List<KeyValuePair<uint, uint>>();
    var snap = CreateToolhelp32Snapshot(2, 0);
    var e = new PE(); e.Size = (uint)Marshal.SizeOf(typeof(PE));
    if (Process32FirstW(snap, ref e)) do { parents.Add(new KeyValuePair<uint, uint>(e.Pid, e.Parent)); } while (Process32NextW(snap, ref e));
    CloseHandle(snap);
    for (bool grew = true; grew; ) {
      grew = false;
      foreach (var p in parents) if (all.Contains(p.Value) && all.Add(p.Key)) grew = true;
    }
    return all;
  }

  static string Text(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }

  // The largest owned top-level window of the process tree, or of any process when only a title is given.
  public static long Find(int pid, string title) {
    var all = Candidates(pid, title);
    return all.Count > 0 ? all[0].Key.ToInt64() : 0;
  }

  // Every window of the app, best first, for when the first pick draws nothing (NW.js and
  // Chromium keep hidden helper windows next to the real one).
  public static string Windows(int pid, string title) {
    var lines = new List<string>();
    foreach (var item in Candidates(pid, title)) {
      RECT r; GetClientRect(item.Key, out r);
      lines.Add(item.Key.ToInt64() + "\t" + (r.R - r.L) + "x" + (r.B - r.T) + "\t" + (IsWindowVisible(item.Key) ? "visible" : "hidden") + "\t" + Class(item.Key) + "\t" + Text(item.Key).Replace("\t", " "));
    }
    return string.Join("\\n", lines);
  }

  static List<KeyValuePair<IntPtr, long>> Candidates(int pid, string title) {
    var pids = Tree((uint)pid);
    var found = new List<KeyValuePair<IntPtr, long>>();
    EnumWindows((h, l) => {
      if (GetWindow(h, 4) != IntPtr.Zero) return true;
      uint owner; GetWindowThreadProcessId(h, out owner);
      bool mine = pids.Contains(owner);
      if (title.Length > 0) { if (Text(h).IndexOf(title, StringComparison.OrdinalIgnoreCase) < 0) return true; }
      else if (!mine) return true;
      var c = Class(h);
      if (c == "ConsoleWindowClass" || c == "IME" || c == "MSCTFIME UI" || c == "PseudoConsoleWindow" || c == "tooltips_class32"
        || c.StartsWith("GDI+") || c.StartsWith(".NET-")) return true;
      long style = GetLong(h, -16).ToInt64();
      if ((style & 0xC00000) == 0 && Text(h).Length == 0) return true;
      RECT r; GetWindowRect(h, out r);
      long a = (long)(r.R - r.L) * (r.B - r.T);
      if (a < 100 * 80) return true;
      // A shown window beats a hidden helper and a captioned one beats a bare one; launched
      // hidden, the main window is the largest captioned one.
      if (IsWindowVisible(h)) a += 1L << 40;
      if ((style & 0xC00000) == 0xC00000) a += 1L << 38;
      if (Text(h).Length > 0) a += 1L << 36;
      found.Add(new KeyValuePair<IntPtr, long>(h, a));
      return true;
    }, IntPtr.Zero);
    found.Sort((x, y) => y.Value.CompareTo(x.Value));
    return found;
  }

  // PowerShell's process DPI mode is fixed by its manifest, so each measurement sets the thread's:
  // per-monitor for real pixels, or the window's own for the pixels its mouse messages use.
  static RECT Client(IntPtr h, bool own) {
    RECT r;
    var old = SetThreadDpiAwarenessContext(own ? GetWindowDpiAwarenessContext(h) : new IntPtr(-4));
    try { GetClientRect(h, out r); } finally { SetThreadDpiAwarenessContext(old); }
    return r;
  }

  public static long User() { return GetForegroundWindow().ToInt64(); }

  // A hidden app must never take the user's keyboard: it gets WS_EX_NOACTIVATE, and whenever it
  // grabs the foreground anyway (on start, or later by itself) the user's window gets it back.
  static void GiveBack(long handle, IntPtr h) {
    IntPtr user;
    if (!owner.TryGetValue(handle, out user) || user == IntPtr.Zero || !IsWindow(user)) return;
    var front = GetForegroundWindow();
    if (front == user) return;
    uint mine, theirs; GetWindowThreadProcessId(h, out mine); GetWindowThreadProcessId(front, out theirs);
    if (front == h || theirs == mine) Foreground(user);
  }

  public static string Stage(long handle, bool hidden, bool hardware, long user) {
    if (hardware) real.Add(handle); else real.Remove(handle);
    var h = new IntPtr(handle);
    if (!IsWindow(h)) throw new Exception("The window is gone");
    if (hidden) {
      if (user != 0) owner[handle] = new IntPtr(user);
      ShowWindow(h, 0);
      long ex = GetLong(h, -20).ToInt64();
      SetLong(h, -20, new IntPtr((ex | 0x80 | 0x08000000) & ~0x40000L));
      RECT w; GetWindowRect(h, out w);
      int left = GetSystemMetrics(76) - (w.R - w.L) - 400;
      SetWindowPos(h, IntPtr.Zero, left, GetSystemMetrics(77), 0, 0, 0x1 | 0x4 | 0x10);
      ShowWindow(h, 4);
      GiveBack(handle, h);
    } else ShowWindow(h, 5);
    Activate(h);
    var c = Client(h, true);
    uint pid; GetWindowThreadProcessId(h, out pid);
    return (c.R - c.L) + " " + (c.B - c.T) + "\\t" + Text(h).Replace("\\t", " ") + "\\t" + pid;
  }

  // Tells the app it is the active window without taking the real focus, so games that pause in the background keep running.
  static void Activate(IntPtr h) {
    PostMessage(h, 0x1C, new IntPtr(1), IntPtr.Zero);
    PostMessage(h, 0x86, new IntPtr(1), IntPtr.Zero);
    PostMessage(h, 0x06, new IntPtr(1), IntPtr.Zero);
    PostMessage(h, 0x07, IntPtr.Zero, IntPtr.Zero);
  }

  static IntPtr Pack(int x, int y) { return new IntPtr(((y & 0xFFFF) << 16) | (x & 0xFFFF)); }

  // The child control under a client point and the point in its coordinates. Windows scales posted
  // mouse messages for DPI-unaware windows as if they were real pixels, so the point is sent in those.
  static IntPtr Hit(IntPtr h, ref POINT p) {
    var own = Client(h, true); var phys = Client(h, false);
    if (own.R > own.L && phys.R != own.R) {
      p.X = p.X * (phys.R - phys.L) / (own.R - own.L);
      p.Y = p.Y * (phys.B - phys.T) / Math.Max(1, own.B - own.T);
    }
    var old = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      var hit = h;
      for (int depth = 0; depth < 8; depth++) {
        var child = ChildWindowFromPointEx(hit, p, 1 | 4);
        if (child == IntPtr.Zero || child == hit) break;
        ClientToScreen(hit, ref p); ScreenToClient(child, ref p);
        hit = child;
      }
      return hit;
    } finally { SetThreadDpiAwarenessContext(old); }
  }

  static int Mask(long h) { int m; return held.TryGetValue(h, out m) ? m : 0; }
  static IntPtr Check(long handle) {
    var h = new IntPtr(handle);
    if (!IsWindow(h)) throw new Exception("The app's window is gone; it may have crashed (see log)");
    if (!real.Contains(handle)) GiveBack(handle, h);
    return h;
  }

  public static string Move(long handle, int x, int y) {
    var h = Check(handle);
    if (real.Contains(handle)) { Point(h, x, y); return ""; }
    var p = new POINT { X = x, Y = y };
    var hit = Hit(h, ref p);
    PostMessage(hit, 0x200, new IntPtr(Mask(handle)), Pack(p.X, p.Y));
    return "";
  }

  static int Bit(string b) { return b == "right" ? 2 : b == "middle" ? 0x10 : 1; }
  static uint Down(string b) { return b == "right" ? 0x204u : b == "middle" ? 0x207u : 0x201u; }

  public static string Button(long handle, int x, int y, string button, bool down) {
    var h = Check(handle);
    if (real.Contains(handle)) {
      Point(h, x, y);
      uint flag = button == "right" ? 0x08u : button == "middle" ? 0x20u : 0x02u;
      mouse_event(down ? flag : flag * 2, 0, 0, 0, IntPtr.Zero);
      return "";
    }
    var p = new POINT { X = x, Y = y };
    var hit = Hit(h, ref p);
    int mask = down ? Mask(handle) | Bit(button) : Mask(handle) & ~Bit(button);
    held[handle] = mask;
    if (down) target[handle] = hit;
    PostMessage(hit, 0x200, new IntPtr(down ? Mask(handle) & ~Bit(button) : Mask(handle) | Bit(button)), Pack(p.X, p.Y));
    PostMessage(hit, down ? Down(button) : Down(button) + 1, new IntPtr(mask), Pack(p.X, p.Y));
    return "";
  }

  public static string Click(long handle, int x, int y, string button, bool twice) {
    Button(handle, x, y, button, true); Button(handle, x, y, button, false);
    if (twice && real.Contains(handle)) { Button(handle, x, y, button, true); Button(handle, x, y, button, false); }
    else if (twice) {
      var h = Check(handle); var p = new POINT { X = x, Y = y }; var hit = Hit(h, ref p);
      PostMessage(hit, Down(button) + 2, new IntPtr(Bit(button)), Pack(p.X, p.Y));
      Button(handle, x, y, button, false);
    }
    return "";
  }

  public static string Drag(long handle, int x1, int y1, int x2, int y2, string button, int moves, int ms) {
    Button(handle, x1, y1, button, true);
    for (int i = 1; i <= moves; i++) {
      if (ms > 0) Thread.Sleep(ms / moves);
      Move(handle, x1 + (x2 - x1) * i / moves, y1 + (y2 - y1) * i / moves);
    }
    Button(handle, x2, y2, button, false);
    return "";
  }

  public static string Wheel(long handle, int x, int y, int notches) {
    var h = Check(handle);
    if (real.Contains(handle)) { Point(h, x, y); mouse_event(0x800, 0, 0, -notches * 120, IntPtr.Zero); return ""; }
    var p = new POINT { X = x, Y = y };
    var hit = Hit(h, ref p);
    var s = new POINT { X = p.X, Y = p.Y }; ClientToScreen(hit, ref s);
    int delta = -notches * 120;
    PostMessage(hit, 0x20A, new IntPtr(((delta & 0xFFFF) << 16) | Mask(handle)), Pack(s.X, s.Y));
    return "";
  }

  // Keys go to the control with keyboard focus, else the one clicked last, else the window.
  static IntPtr Keyboard(IntPtr h, long handle) {
    uint pid; uint thread = GetWindowThreadProcessId(h, out pid);
    var g = new GUI(); g.Size = (uint)Marshal.SizeOf(typeof(GUI));
    if (GetGUIThreadInfo(thread, ref g) && g.Focus != IntPtr.Zero) return g.Focus;
    IntPtr t; return target.TryGetValue(handle, out t) && IsWindow(t) ? t : h;
  }

  static void Post(IntPtr to, int vk, bool down, bool alt) {
    uint scan = MapVirtualKey((uint)vk, 0);
    bool extended = (vk >= 0x21 && vk <= 0x2E) || vk == 0x5B;
    long l = 1 | (scan << 16) | (extended ? 1L << 24 : 0) | (alt ? 1L << 29 : 0) | (down ? 0 : (1L << 30) | (1L << 31));
    uint msg = alt || vk == 0x12 ? (down ? 0x104u : 0x105u) : (down ? 0x100u : 0x101u);
    PostMessage(to, msg, new IntPtr(vk), new IntPtr(unchecked((int)l)));
  }

  // press: 0 tap, 1 hold down until a later up, 2 release.
  public static string Key(long handle, int[] modifiers, int key, int hold, int press) {
    var h = Check(handle);
    if (real.Contains(handle)) {
      Borrow(h);
      if (press != 2) { foreach (var m in modifiers) Hardware(m, true); Hardware(key, true); }
      if (press == 1) return "holding";
      if (hold > 0) Thread.Sleep(hold);
      Hardware(key, false);
      for (int i = modifiers.Length - 1; i >= 0; i--) Hardware(modifiers[i], false);
      return "";
    }
    var to = Keyboard(h, handle);
    if (press == 1) { foreach (var m in modifiers) Post(to, m, true, false); Post(to, key, true, false); return "holding"; }
    if (press == 2) { Post(to, key, false, false); for (int i = modifiers.Length - 1; i >= 0; i--) Post(to, modifiers[i], false, false); return ""; }
    bool alt = Array.IndexOf(modifiers, 0x12) >= 0;
    foreach (var m in modifiers) Post(to, m, true, alt && m != 0x12);
    Post(to, key, true, alt);
    if (hold > 0) {
      // Held keys auto-repeat like a real keyboard, so games that poll key messages keep moving.
      for (int waited = 0; waited < hold; waited += 33) { Thread.Sleep(Math.Min(33, hold - waited)); Post(to, key, true, alt); }
    }
    Post(to, key, false, alt);
    for (int i = modifiers.Length - 1; i >= 0; i--) Post(to, modifiers[i], false, alt && modifiers[i] != 0x12);
    return "";
  }

  public static string Type(long handle, string text) {
    var h = Check(handle);
    if (real.Contains(handle)) {
      Borrow(h);
      foreach (var ch in text) {
        short code = VkKeyScan(ch == '\\n' ? '\\r' : ch);
        if (code == -1) continue;
        bool shift = (code & 0x100) != 0;
        if (shift) Hardware(0x10, true);
        Hardware(code & 0xFF, true); Hardware(code & 0xFF, false);
        if (shift) Hardware(0x10, false);
      }
      return text.Length + " characters";
    }
    var to = Keyboard(h, handle);
    foreach (var ch in text.Replace("\\r\\n", "\\r").Replace('\\n', '\\r')) PostMessage(to, 0x102, new IntPtr(ch), new IntPtr(1));
    return text.Length + " characters";
  }

  // Hardware-level key: scan codes reach DirectInput and Raw Input games, not only the message queue.
  static void Hardware(int vk, bool press) {
    uint scan = MapVirtualKey((uint)vk, 0);
    bool extended = (vk >= 0x21 && vk <= 0x2E) || vk == 0x5B;
    keybd_event((byte)vk, (byte)scan, 0x8u | (extended ? 1u : 0u) | (press ? 0u : 2u), IntPtr.Zero);
  }

  static void Foreground(IntPtr h) {
    if (GetForegroundWindow() == h) return;
    uint pid;
    uint mine = GetCurrentThreadId(), theirs = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    AttachThreadInput(mine, theirs, true);
    try { BringWindowToTop(h); SetForegroundWindow(h); } finally { AttachThreadInput(mine, theirs, false); }
  }

  // Real input needs the game in front; the user's window and cursor are saved once per call.
  static void Borrow(IntPtr h) {
    if (!borrowed) { userWindow = GetForegroundWindow(); GetCursorPos(out userCursor); borrowed = true; }
    if (GetForegroundWindow() != h) { Foreground(h); Thread.Sleep(30); }
  }

  // Keys held with press: down stay held across calls.
  public static string Release() {
    if (!borrowed) return "";
    borrowed = false;
    if (userWindow != IntPtr.Zero && IsWindow(userWindow)) Foreground(userWindow);
    SetCursorPos(userCursor.X, userCursor.Y);
    return "";
  }

  // A client point in the window's own pixels to the real cursor, ready for a hardware click.
  static void Point(IntPtr h, int x, int y) {
    Borrow(h);
    var own = Client(h, true); var phys = Client(h, false);
    float k = own.R > own.L ? (float)(phys.R - phys.L) / (own.R - own.L) : 1f;
    var p = new POINT { X = (int)(x * k), Y = (int)(y * k) };
    var old = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      ClientToScreen(h, ref p);
      int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
      if (p.X < left || p.Y < top || p.X >= left + GetSystemMetrics(78) || p.Y >= top + GetSystemMetrics(79))
        throw new Exception("Real clicks need the window on screen; launch with hidden: false");
      SetCursorPos(p.X, p.Y);
    } finally { SetThreadDpiAwarenessContext(old); }
  }

  // Relative mouse motion for game cameras: raw mouse in real mode, a moved cursor otherwise.
  public static string Look(long handle, int dx, int dy, int cx, int cy) {
    var h = Check(handle);
    if (real.Contains(handle)) {
      Borrow(h);
      int steps = Math.Max(1, Math.Max(Math.Abs(dx), Math.Abs(dy)) / 40);
      for (int i = 1; i <= steps; i++) mouse_event(1, dx * i / steps - dx * (i - 1) / steps, dy * i / steps - dy * (i - 1) / steps, 0, IntPtr.Zero);
      return "";
    }
    return Move(handle, cx, cy);
  }

  static Bitmap Grab(IntPtr h) {
    // PrintWindow draws a DPI-unaware window at its own (unscaled) size, so that is the bitmap size.
    var r = Client(h, true);
    int w = Math.Max(1, r.R - r.L), ht = Math.Max(1, r.B - r.T);
    var old = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      // PW_CLIENTONLY | PW_RENDERFULLCONTENT first (DirectX and OpenGL too, off-screen), then plain
      // PrintWindow for GDI apps that ignore the first, then the window's own DC.
      // The window's DC only holds its picture where it is on screen; elsewhere it is whatever lies there.
      RECT at; GetWindowRect(h, out at);
      int vl = GetSystemMetrics(76), vt = GetSystemMetrics(77);
      bool seen = IsWindowVisible(h) && at.L >= vl && at.T >= vt && at.R <= vl + GetSystemMetrics(78) && at.B <= vt + GetSystemMetrics(79);
      var modes = seen ? new[] { 3, 1, 0 } : new[] { 3, 1 };
      foreach (int mode in modes) {
        var bmp = new Bitmap(w, ht, PixelFormat.Format32bppRgb);
        using (var g = Graphics.FromImage(bmp)) {
          var dc = g.GetHdc();
          try {
            if (mode > 0) PrintWindow(h, dc, (uint)mode);
            else { var src = GetDC(h); BitBlt(dc, 0, 0, w, ht, src, 0, 0, 0x00CC0020 | 0x40000000); ReleaseDC(h, src); }
          } finally { g.ReleaseHdc(dc); }
        }
        if (mode == modes[modes.Length - 1] || Bright(bmp) >= 3) return bmp;
        bmp.Dispose();
      }
    } finally { SetThreadDpiAwarenessContext(old); }
    throw new Exception("unreachable");
  }

  // Average brightness from a sparse grid, cheap enough for every capture; 0 when no sample is
  // more than near-black, so a blank frame is told apart from a dark scene with detail in it.
  static double Bright(Bitmap b) {
    double sum = 0; int n = 0, top = 0;
    for (int y = 0; y < 24; y++) for (int x = 0; x < 24; x++) {
      // Inset from the edges, where a border line can survive in an otherwise empty frame.
      var c = b.GetPixel((b.Width - 1) * (1 + x * 30 / 23) / 32, (b.Height - 1) * (1 + y * 30 / 23) / 32);
      sum += (c.R + c.G + c.B) / 3.0; n++;
      top = Math.Max(top, Math.Max(c.R, Math.Max(c.G, c.B)));
    }
    return top < 24 ? 0 : Math.Max(3, sum / n);
  }

  // Back on screen under every other window, fully transparent and click-through: engines that
  // stop drawing off-screen keep drawing, and the user sees nothing.
  public static string Behind(long handle) {
    var h = Check(handle);
    long ex = GetLong(h, -20).ToInt64();
    SetLong(h, -20, new IntPtr(ex | 0x80000 | 0x20 | 0x80 | 0x08000000));
    SetLayeredWindowAttributes(h, 0, 1, 2);
    SetWindowPos(h, new IntPtr(1), GetSystemMetrics(76), GetSystemMetrics(77), 0, 0, 0x1 | 0x10);
    return "";
  }

  // A full-size PNG for OCR, enlarged so small game text is readable.
  public static string Snap(long handle, string file, double factor) {
    var h = Check(handle);
    using (var bmp = Grab(h)) {
      float ratio = Ratio(h, bmp);
      int w = (int)(bmp.Width / ratio * factor), ht = (int)(bmp.Height / ratio * factor);
      using (var big = new Bitmap(w, ht))
      using (var g = Graphics.FromImage(big)) {
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.DrawImage(bmp, 0, 0, w, ht);
        big.Save(file, ImageFormat.Bmp);
      }
      return w + " " + ht;
    }
  }

  // Waits until the frame stops changing for quiet ms: loading screens, transitions, fades.
  public static string WaitStable(long handle, int ms, int quiet, double threshold) {
    var h = Check(handle);
    var watch = Stopwatch.StartNew();
    byte[] prev; using (var bmp = Grab(h)) prev = Thumb(bmp);
    long calm = 0;
    while (true) {
      Thread.Sleep(30);
      byte[] now; using (var bmp = Grab(Check(handle))) now = Thumb(bmp);
      if (Changed(prev, now) > threshold) calm = watch.ElapsedMilliseconds;
      prev = now;
      if (watch.ElapsedMilliseconds - calm >= quiet) { last[handle] = now; return "calm after " + watch.ElapsedMilliseconds + " ms"; }
      if (watch.ElapsedMilliseconds >= ms) {
        last[handle] = now;
        throw new Exception("The screen kept changing for " + ms + " ms; an animated scene never calms, so check it with wait_text or a screenshot instead");
      }
    }
  }

  static void Cursor(Graphics g, float x, float y, float size) {
    var arrow = new PointF[] {
      new PointF(x, y), new PointF(x, y + size), new PointF(x + size * 0.28f, y + size * 0.72f),
      new PointF(x + size * 0.5f, y + size * 1.1f), new PointF(x + size * 0.62f, y + size * 1.04f),
      new PointF(x + size * 0.42f, y + size * 0.66f), new PointF(x + size * 0.75f, y + size * 0.66f) };
    g.SmoothingMode = SmoothingMode.AntiAlias;
    using (var fill = new SolidBrush(Color.FromArgb(255, 0, 200)))
    using (var pen = new Pen(Color.White, Math.Max(1f, size / 12f))) { g.FillPolygon(fill, arrow); g.DrawPolygon(pen, arrow); }
  }

  static void Save(Bitmap bmp, string file) {
    ImageCodecInfo codec = null;
    foreach (var c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") codec = c;
    var p = new EncoderParameters(1);
    p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);
    bmp.Save(file, codec, p);
  }

  // Client size in the window's own pixels, and the factor from those to captured pixels.
  static float Ratio(IntPtr h, Bitmap bmp) {
    var own = Client(h, true);
    return own.R > own.L ? (float)bmp.Width / (own.R - own.L) : 1f;
  }

  // rw > 0 zooms into the region rx, ry, rw, rh of the window's own pixels.
  public static string Capture(long handle, string file, int width, int cx, int cy, int rx, int ry, int rw, int rh) {
    var h = Check(handle);
    using (var bmp = Grab(h)) {
      Remember(handle, bmp);
      var own = Client(h, true);
      float ratio = Ratio(h, bmp);
      var src = rw > 0 && rh > 0
        ? Rectangle.Intersect(new Rectangle((int)(rx * ratio), (int)(ry * ratio), Math.Max(1, (int)(rw * ratio)), Math.Max(1, (int)(rh * ratio))), new Rectangle(0, 0, bmp.Width, bmp.Height))
        : new Rectangle(0, 0, bmp.Width, bmp.Height);
      if (src.Width < 1 || src.Height < 1) throw new Exception("The region is outside the window");
      // A zoom may enlarge; a full frame only shrinks.
      int w = rw > 0 ? Math.Min(Math.Max(width, 160), 1280) : Math.Min(Math.Max(width, 160), src.Width);
      int ht = Math.Max(1, src.Height * w / src.Width);
      using (var small = new Bitmap(w, ht))
      using (var g = Graphics.FromImage(small)) {
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.DrawImage(bmp, new Rectangle(0, 0, w, ht), src, GraphicsUnit.Pixel);
        float k = (float)w / src.Width;
        Cursor(g, (cx * ratio - src.X) * k, (cy * ratio - src.Y) * k, Math.Max(12f, w / 60f));
        Save(small, file);
      }
      return w + " " + ht + " " + (own.R - own.L) + " " + (own.B - own.T) + " " + ((int)Bright(bmp));
    }
  }

  public static string Frames(long handle, string file, int count, int interval, int cx, int cy) {
    var h = Check(handle);
    int cols = (int)Math.Ceiling(Math.Sqrt(count)), rows = (count + cols - 1) / cols;
    var watch = Stopwatch.StartNew();
    var frames = new List<Bitmap>();
    try {
      for (int i = 0; i < count; i++) {
        long due = (long)i * interval;
        if (watch.ElapsedMilliseconds < due) Thread.Sleep((int)(due - watch.ElapsedMilliseconds));
        frames.Add(Grab(h));
      }
      long took = watch.ElapsedMilliseconds;
      Remember(handle, frames[frames.Count - 1]);
      int tw = Math.Min(frames[0].Width, 1600 / cols), th = Math.Max(1, frames[0].Height * tw / frames[0].Width);
      float k = Ratio(h, frames[0]) * tw / frames[0].Width;
      using (var sheet = new Bitmap(cols * tw, rows * th))
      using (var g = Graphics.FromImage(sheet))
      using (var font = new Font("Segoe UI", Math.Max(9f, th / 14f), FontStyle.Bold)) {
        g.Clear(Color.Black);
        g.InterpolationMode = InterpolationMode.HighQualityBilinear;
        for (int i = 0; i < frames.Count; i++) {
          int x = (i % cols) * tw, y = (i / cols) * th;
          g.DrawImage(frames[i], x, y, tw, th);
          Cursor(g, x + cx * k, y + cy * k, Math.Max(8f, tw / 40f));
          g.DrawString((i + 1).ToString(), font, Brushes.Yellow, x + 4, y + 2);
          g.DrawRectangle(Pens.Black, x, y, tw - 1, th - 1);
        }
        Save(sheet, file);
      }
      return "captured in " + took + " ms";
    } finally { foreach (var f in frames) f.Dispose(); }
  }

  static byte[] Thumb(Bitmap bmp) {
    const int w = 160; int ht = Math.Max(1, bmp.Height * w / bmp.Width);
    using (var small = new Bitmap(w, ht, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(small)) g.DrawImage(bmp, 0, 0, w, ht);
      var data = small.LockBits(new Rectangle(0, 0, w, ht), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      var bytes = new byte[data.Stride * ht];
      Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
      small.UnlockBits(data);
      return bytes;
    }
  }

  static void Remember(long handle, Bitmap bmp) { last[handle] = Thumb(bmp); }

  static double Changed(byte[] a, byte[] b) {
    if (a == null || b == null || a.Length != b.Length) return 100;
    int changed = 0, total = a.Length / 3;
    for (int i = 0; i + 2 < a.Length; i += 3)
      if (Math.Abs(a[i] - b[i]) > 24 || Math.Abs(a[i + 1] - b[i + 1]) > 24 || Math.Abs(a[i + 2] - b[i + 2]) > 24) changed++;
    return Math.Round(100.0 * changed / Math.Max(1, total), 2);
  }

  public static string Diff(long handle) {
    var h = Check(handle);
    byte[] before; last.TryGetValue(handle, out before);
    byte[] now; using (var bmp = Grab(h)) now = Thumb(bmp);
    last[handle] = now;
    return Changed(before, now).ToString(System.Globalization.CultureInfo.InvariantCulture);
  }

  // Compares with the latest screenshot, frames or diff of the app, so a step before the action sets the baseline.
  public static string WaitChange(long handle, int ms, double threshold) {
    var h = Check(handle);
    byte[] before;
    if (!last.TryGetValue(handle, out before)) using (var bmp = Grab(h)) before = Thumb(bmp);
    var watch = Stopwatch.StartNew();
    while (true) {
      byte[] now; using (var bmp = Grab(Check(handle))) now = Thumb(bmp);
      double changed = Changed(before, now);
      if (changed >= threshold) {
        long at = watch.ElapsedMilliseconds;
        // A repaint can be caught half drawn; the step ends once two frames in a row agree (or 500 ms pass).
        for (var settle = Stopwatch.StartNew(); settle.ElapsedMilliseconds < 500; ) {
          Thread.Sleep(15);
          byte[] next; using (var bmp = Grab(Check(handle))) next = Thumb(bmp);
          bool still = Changed(now, next) < 0.1;
          now = next;
          if (still) break;
        }
        last[handle] = now;
        return changed.ToString(System.Globalization.CultureInfo.InvariantCulture) + "% changed after " + at + " ms, settled after " + watch.ElapsedMilliseconds + " ms";
      }
      if (watch.ElapsedMilliseconds >= ms) throw new Exception("Nothing changed within " + ms + " ms (" + changed + "% < " + threshold + "%)");
      Thread.Sleep(15);
    }
  }

  public static string Pixel(long handle, int x, int y) {
    var h = Check(handle);
    using (var bmp = Grab(h)) {
      float ratio = Ratio(h, bmp);
      int px = Math.Min(bmp.Width - 1, Math.Max(0, (int)(x * ratio))), py = Math.Min(bmp.Height - 1, Math.Max(0, (int)(y * ratio)));
      var c = bmp.GetPixel(px, py);
      return "#" + c.R.ToString("x2") + c.G.ToString("x2") + c.B.ToString("x2");
    }
  }

  public static string Resize(long handle, int width, int height) {
    var h = Check(handle);
    RECT w, c; GetWindowRect(h, out w); GetClientRect(h, out c);
    SetWindowPos(h, IntPtr.Zero, 0, 0, width + (w.R - w.L) - (c.R - c.L), height + (w.B - w.T) - (c.B - c.T), 0x2 | 0x4 | 0x10);
    var own = Client(h, true);
    return (own.R - own.L) + "x" + (own.B - own.T);
  }

  // Back on screen as a normal, opaque window that still never takes the keyboard: under the
  // user's windows, or on top of them for apps that draw only when seen.
  public static string Place(long handle, bool top) {
    var h = Check(handle);
    long ex = GetLong(h, -20).ToInt64();
    SetLong(h, -20, new IntPtr((ex & ~0x80000L & ~0x20L) | 0x08000000));
    int left = Math.Max(GetSystemMetrics(76), 0) + 40, up = Math.Max(GetSystemMetrics(77), 0) + 40;
    SetWindowPos(h, new IntPtr(top ? 0 : 1), left, up, 0, 0, 0x1 | 0x10 | 0x40 | 0x20);
    return "";
  }

  public static string Hide(long handle) { ShowWindow(new IntPtr(handle), 0); return ""; }

  public static string Close(long handle) { PostMessage(new IntPtr(handle), 0x10, IntPtr.Zero, IntPtr.Zero); return ""; }
}
'@
[OcPlay]::Init()
function Send-Reply([string]$tag, [string]$text) {
  [Console]::Out.WriteLine('@@' + $tag + ' ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
  [Console]::Out.Flush()
}
# Windows OCR is a WinRT API; it is loaded on first use, so the helper starts fast without it.
$script:ocr = $null
function Read-Text([string]$file) {
  if (-not $script:ocr) {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
    $script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\x601' } | Select-Object -First 1
    $script:ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $script:ocr) { throw 'Windows OCR has no language installed' }
  }
  function Await($operation, [Type]$type) {
    $task = $script:asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    [void]$task.Wait(-1)
    $task.Result
  }
  $item = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file)) ([Windows.Storage.StorageFile])
  $stream = Await ($item.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($script:ocr.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  } finally { $stream.Dispose() }
  $index = 0
  foreach ($line in $result.Lines) {
    foreach ($word in $line.Words) {
      $r = $word.BoundingRect
      "$([int]$r.X) $([int]$r.Y) $([int]$r.Width) $([int]$r.Height)" + "\x60t" + $index + "\x60t" + $word.Text
    }
    $index++
  }
}
function Invoke-Step([string]$encoded) {
  try {
    $script = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
    $result = & ([ScriptBlock]::Create($script)) | Out-String
    Send-Reply 'OK' $result.Trim()
  } catch {
    $e = $_.Exception
    while ($e.InnerException) { $e = $e.InnerException }
    Send-Reply 'ERR' $e.Message
  }
}
`
