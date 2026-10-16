export * as DesktopTool from "./desktop.js"

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Permission } from "../../permission.js"
import type { Tool } from "@opencode/schema/tool"

export const name = "desktop"

const description = [
  "Control this computer's desktop in one call of several steps: screenshot, type, keys, click, move, scroll, wait, windows, focus, open, clipboard.",
  "The steps run in order without a round trip each, so a whole interaction (focus a window, type, press enter, wait, screenshot) is one call. For a single action the desktop_* tools are shorter.",
  "x/y in click, move and scroll are pixels of the latest screenshot this session took (scaled to the real screen); pass screen: true for real screen pixels.",
  "Long text is pasted through the clipboard, much faster than key by key; pass paste: false to force key presses.",
  "Keys: combinations like ctrl+s, ctrl+shift+t, alt+tab, win+r, enter, esc, tab, f5, up, pagedown.",
].join("\n")

const Step = Schema.Struct({
  action: Schema.Literals(["screenshot", "type", "keys", "click", "move", "scroll", "wait", "windows", "focus", "open", "clipboard"]),
  text: Schema.optionalKey(Schema.String).annotate({
    description:
      "For type: the text; focus: part of the window title; open: app, file, folder or URL; clipboard: text to copy (omit to read it)",
  }),
  keys: Schema.optionalKey(Schema.String).annotate({ description: "For keys: a combination such as ctrl+shift+s" }),
  x: Schema.optionalKey(Schema.Number),
  y: Schema.optionalKey(Schema.Number),
  screen: Schema.optionalKey(Schema.Boolean).annotate({ description: "x/y are real screen pixels, not screenshot pixels" }),
  button: Schema.optionalKey(Schema.Literals(["left", "right", "middle"])),
  double: Schema.optionalKey(Schema.Boolean),
  amount: Schema.optionalKey(Schema.Number).annotate({ description: "For scroll: notches, positive scrolls down" }),
  ms: Schema.optionalKey(Schema.Number).annotate({ description: "For wait: milliseconds (max 10000)" }),
  paste: Schema.optionalKey(Schema.Boolean),
  width: Schema.optionalKey(Schema.Number).annotate({
    description: "For screenshot: image width in pixels (default 1280, smaller is faster)",
  }),
})

export const Input = Schema.Struct({
  steps: Schema.Array(Step).check(Schema.isNonEmpty()).annotate({ description: "Actions to run in order" }),
})

export const Output = Schema.Struct({ output: Schema.String })

type StepInput = typeof Step.Type
type Shot = { file: string; mime: string; width: number; height: number; screenWidth: number; screenHeight: number }

const Coordinate = Schema.optionalKey(Schema.Number).annotate({
  description: "Pixels of the latest screenshot unless screen is true",
})
const Screen = Schema.optionalKey(Schema.Boolean).annotate({ description: "x/y are real screen pixels" })
const Button = Schema.optionalKey(Schema.Literals(["left", "right", "middle"]))

// One-action shortcuts: a model reaches for a named tool more readily than for a step list.
const ScreenshotInput = Schema.Struct({
  width: Schema.optionalKey(Schema.Number).annotate({ description: "Image width, default 1280; smaller is faster" }),
})
const TypeInput = Schema.Struct({ text: Schema.String, paste: Schema.optionalKey(Schema.Boolean) })
const KeysInput = Schema.Struct({ keys: Schema.String })
const ClickInput = Schema.Struct({ x: Coordinate, y: Coordinate, screen: Screen, button: Button, double: Schema.optionalKey(Schema.Boolean) })
const ScrollInput = Schema.Struct({ amount: Schema.Number, x: Coordinate, y: Coordinate, screen: Screen })
const FocusInput = Schema.Struct({ title: Schema.String })
const OpenInput = Schema.Struct({ target: Schema.String })
const ClipboardInput = Schema.Struct({ text: Schema.optionalKey(Schema.String) })

export const names = [
  name,
  "desktop_screenshot",
  "desktop_type",
  "desktop_keys",
  "desktop_click",
  "desktop_scroll",
  "desktop_windows",
  "desktop_focus",
  "desktop_open",
  "desktop_clipboard",
]

// Told to every session that has these tools, so the model knows they exist and how to use them.
const GUIDE = [
  "# Computer tools",
  "You can see and operate this computer, not only its files:",
  "- desktop_screenshot to look at the screen; then desktop_click / desktop_scroll with x/y read from that image.",
  "- desktop_type for text (long text is pasted, fast), desktop_keys for shortcuts (ctrl+s, alt+tab, win+r, enter).",
  "- desktop_windows lists windows, desktop_focus brings one forward, desktop_open starts an app, file or URL, desktop_clipboard reads or sets the clipboard.",
  "- desktop runs several of these steps in one call (focus, type, enter, wait, screenshot); prefer it for multi-step interactions, it is the fastest.",
  "- Commands: the shell tool with background: true returns at once and you are notified when the command ends; independent tool calls in one step run in parallel. Never poll a background command.",
  "Work loop: screenshot, act, screenshot again to check the result. Never guess coordinates without a fresh screenshot.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.desktop",
  effect: Effect.fn("DesktopTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    // The scale of each session's latest screenshot, so clicks land where the model saw them.
    const scales = new Map<string, { x: number; y: number }>()
    const host = makeHost()
    yield* Effect.addFinalizer(() => Effect.sync(() => host.close()))

    const perform = Effect.fnUntraced(function* (steps: readonly StepInput[], context: Tool.Context) {
      // Every desktop tool shares one permission, so a role grants or denies the computer as a whole.
      yield* permission
        .assert({
          action: name,
          resources: [...new Set(steps.map((step) => step.action))],
          save: ["*"],
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
        })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: "Permission denied: desktop", error })))
      const lines: string[] = []
      const images: { uri: string; mime: string; name: string }[] = []
      for (const [index, step] of steps.entries()) {
        const label = steps.length > 1 ? `${index + 1}. ${step.action}` : step.action
        const result = yield* Effect.promise(() =>
          run(host, step, scales.get(context.sessionID)).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
        )
        if (!result.ok) {
          lines.push(`${label}: failed: ${result.error instanceof Error ? result.error.message : String(result.error)}`)
          if (index < steps.length - 1) lines.push("Remaining steps were skipped.")
          break
        }
        const value = result.value
        if (typeof value === "string") {
          lines.push(value ? `${label}: ${value}` : `${label}: ok`)
          continue
        }
        // Only Windows reports the real screen size; elsewhere coordinates stay as given.
        if (value.width > 0 && value.height > 0 && value.screenWidth > 0 && value.screenHeight > 0)
          scales.set(context.sessionID, {
            x: value.screenWidth / value.width,
            y: value.screenHeight / value.height,
          })
        const data = yield* Effect.promise(() => readFile(value.file))
        yield* Effect.promise(() => rm(path.dirname(value.file), { recursive: true, force: true }))
        images.push({ uri: `data:${value.mime};base64,${data.toString("base64")}`, mime: value.mime, name: `screenshot-${index + 1}` })
        lines.push(
          `${label}: ${value.width}x${value.height} image of a ${value.screenWidth}x${value.screenHeight} screen; x/y of later clicks use this image's pixels`,
        )
      }
      const output = lines.join("\n")
      return {
        output: { output },
        content: [{ type: "text" as const, text: output }, ...images.map((image) => ({ type: "file" as const, ...image }))],
      }
    })

    // The shortcuts share the batch tool's permission action, so filtering by role treats them as one.
    const options = { codemode: false, permission: name }
    yield* ctx.tool
      .transform((editor) => {
        editor.add({ name, options, description, input: Input, output: Output, execute: (input, context) => perform(input.steps, context) })
        editor.add({
          name: "desktop_screenshot",
          options,
          description: "Take a screenshot of the whole screen and see it. Later clicks take x/y in this image's pixels.",
          input: ScreenshotInput,
          output: Output,
          execute: (input, context) => perform([{ action: "screenshot", ...input }], context),
        })
        editor.add({
          name: "desktop_type",
          options,
          description: "Type text into the focused window. Long text is pasted through the clipboard (fast); paste: false types key by key.",
          input: TypeInput,
          output: Output,
          execute: (input, context) => perform([{ action: "type", ...input }], context),
        })
        editor.add({
          name: "desktop_keys",
          options,
          description: "Press a key or combination in the focused window: enter, esc, tab, ctrl+s, ctrl+shift+t, alt+tab, win+r, f5, up, pagedown.",
          input: KeysInput,
          output: Output,
          execute: (input, context) => perform([{ action: "keys", ...input }], context),
        })
        editor.add({
          name: "desktop_click",
          options,
          description: "Click at x/y of the latest screenshot, or where the pointer is when x/y are omitted. Take a screenshot first to know where things are.",
          input: ClickInput,
          output: Output,
          execute: (input, context) => perform([{ action: "click", ...input }], context),
        })
        editor.add({
          name: "desktop_scroll",
          options,
          description: "Scroll the mouse wheel, over x/y when given. A positive amount scrolls down, a negative one up.",
          input: ScrollInput,
          output: Output,
          execute: (input, context) => perform([{ action: "scroll", ...input }], context),
        })
        editor.add({
          name: "desktop_windows",
          options,
          description: "List the open windows (process and title) on this computer.",
          input: Schema.Struct({}),
          output: Output,
          execute: (_input, context) => perform([{ action: "windows" }], context),
        })
        editor.add({
          name: "desktop_focus",
          options,
          description: "Bring the window whose title contains this text to the front, restoring it when minimized.",
          input: FocusInput,
          output: Output,
          execute: (input, context) => perform([{ action: "focus", text: input.title }], context),
        })
        editor.add({
          name: "desktop_open",
          options,
          description:
            "Open an app, file, folder or URL with its default program without waiting for it to close: notepad, calc, C:\\path\\report.pdf, https://example.com.",
          input: OpenInput,
          output: Output,
          execute: (input, context) => perform([{ action: "open", text: input.target }], context),
        })
        editor.add({
          name: "desktop_clipboard",
          options,
          description: "Read the clipboard text, or copy text to the clipboard when text is given.",
          input: ClipboardInput,
          output: Output,
          execute: (input, context) => perform([{ action: "clipboard", ...input }], context),
        })
      })
      .pipe(Effect.orDie)

    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => {
        if (names.some((tool) => event.tools[tool])) event.system.push({ type: "text", text: GUIDE })
      }),
    )
  }),
}

export async function run(host: Host, step: StepInput, scale: { x: number; y: number } | undefined): Promise<string | Shot> {
  const point = () => {
    if (step.x === undefined || step.y === undefined) throw new Error("Pass x and y")
    const factor = step.screen === true || !scale ? { x: 1, y: 1 } : scale
    return { x: Math.round(step.x * factor.x), y: Math.round(step.y * factor.y) }
  }
  switch (step.action) {
    case "wait":
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(step.ms ?? 500, 0), 10_000)))
      return ""
    case "screenshot": {
      const directory = await mkdtemp(path.join(tmpdir(), "opencode-desktop-"))
      const file = path.join(directory, "screen.jpg")
      const width = Math.max(320, Math.min(Math.round(step.width ?? 1280), 3840))
      const reply = await host.call(platformScript.screenshot(file, width))
      const [screenWidth, screenHeight, imageWidth, imageHeight] = reply.split(/\s+/).map(Number)
      return {
        file,
        mime: "image/jpeg",
        width: imageWidth || width,
        height: imageHeight || 0,
        screenWidth: screenWidth || width,
        screenHeight: screenHeight || 0,
      }
    }
    case "type": {
      if (!step.text) throw new Error("Pass text")
      const paste = step.paste ?? step.text.length > 40
      return host.call(paste ? platformScript.paste(step.text) : platformScript.type(step.text))
    }
    case "keys":
      if (!step.keys) throw new Error("Pass keys, e.g. ctrl+s")
      return host.call(platformScript.keys(step.keys))
    case "click": {
      const target = step.x === undefined ? undefined : point()
      return host.call(platformScript.click(target, step.button ?? "left", step.double === true))
    }
    case "move":
      return host.call(platformScript.move(point()))
    case "scroll":
      return host.call(platformScript.scroll(step.x === undefined ? undefined : point(), step.amount ?? 3))
    case "windows":
      return host.call(platformScript.windows())
    case "focus":
      if (!step.text) throw new Error("Pass part of the window title as text")
      return host.call(platformScript.focus(step.text))
    case "open":
      if (!step.text) throw new Error("Pass the app, file, folder or URL to open as text")
      return host.call(platformScript.open(step.text))
    case "clipboard":
      return host.call(step.text === undefined ? platformScript.clipboardRead() : platformScript.clipboardWrite(step.text))
  }
}

type Host = ReturnType<typeof makeHost>

// One long-lived PowerShell answers every step on Windows: starting powershell.exe costs
// about half a second, which would otherwise be paid for every keystroke and screenshot.
// Each request and reply is one base64 line, so multi-line output never breaks framing.
export function makeHost() {
  let child: ChildProcessWithoutNullStreams | undefined
  let buffer = ""
  const waiting: { resolve: (value: string) => void; reject: (error: Error) => void }[] = []
  let queue = Promise.resolve()

  const start = () => {
    if (child && child.exitCode === null && !child.killed) return child
    buffer = ""
    const created = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-Command", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    created.stdout.setEncoding("utf8")
    created.stdout.on("data", (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf("\n")
        const match = /^@@(OK|ERR) ?(.*)$/.exec(line)
        if (!match) continue
        const text = Buffer.from(match[2] ?? "", "base64").toString("utf8")
        const pending = waiting.shift()
        if (match[1] === "OK") pending?.resolve(text)
        else pending?.reject(new Error(text))
      }
    })
    created.on("exit", () => {
      for (const pending of waiting.splice(0)) pending.reject(new Error("The desktop helper exited"))
    })
    created.stdin.write(HOST_PRELUDE + "\n")
    child = created
    return created
  }

  return {
    // Requests are serialized: the desktop has one keyboard and one mouse.
    call(script: string): Promise<string> {
      if (process.platform !== "win32") return runPosix(script)
      const result = queue.then(
        () =>
          new Promise<string>((resolve, reject) => {
            const process = start()
            const timer = setTimeout(() => {
              process.kill()
              reject(new Error("The desktop helper did not answer within 30 s"))
            }, 30_000)
            waiting.push({
              resolve: (value) => {
                clearTimeout(timer)
                resolve(value)
              },
              reject: (error) => {
                clearTimeout(timer)
                reject(error)
              },
            })
            process.stdin.write(`Invoke-Step '${Buffer.from(script, "utf8").toString("base64")}'\n`)
          }),
      )
      queue = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
    close() {
      child?.kill()
      child = undefined
    },
  }
}

const HOST_PRELUDE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, Microsoft.VisualBasic
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OcDesk {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, int d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
'@
[void][OcDesk]::SetProcessDPIAware()
function Send-Reply([string]$tag, [string]$text) {
  [Console]::Out.WriteLine('@@' + $tag + ' ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
  [Console]::Out.Flush()
}
function Invoke-Step([string]$encoded) {
  try {
    $script = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
    $result = & ([ScriptBlock]::Create($script)) | Out-String
    Send-Reply 'OK' $result.Trim()
  } catch {
    Send-Reply 'ERR' $_.Exception.Message
  }
}
`

// Characters SendKeys reads as commands are wrapped in braces to be typed literally.
const sendKeysLiteral = (text: string) =>
  text.replace(/[+^%~(){}[\]]/g, (char) => `{${char}}`).replace(/\r?\n/g, "{ENTER}").replace(/\t/g, "{TAB}")

const psString = (text: string) => `'${text.replace(/'/g, "''")}'`

const NAMED: Record<string, string> = {
  enter: "{ENTER}",
  return: "{ENTER}",
  tab: "{TAB}",
  esc: "{ESC}",
  escape: "{ESC}",
  space: " ",
  backspace: "{BACKSPACE}",
  delete: "{DELETE}",
  del: "{DELETE}",
  insert: "{INSERT}",
  home: "{HOME}",
  end: "{END}",
  pageup: "{PGUP}",
  pagedown: "{PGDN}",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  printscreen: "{PRTSC}",
}

function windowsKeys(combo: string) {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
  const key = parts.at(-1) ?? ""
  const modifiers = parts.slice(0, -1)
  const main = NAMED[key] ?? (/^f([1-9]|1[0-6])$/.test(key) ? `{${key.toUpperCase()}}` : sendKeysLiteral(key))
  // SendKeys has no Windows key, so win+... holds VK_LWIN (0x5B) around the rest of the combination.
  const prefix = modifiers
    .map((modifier) => ({ ctrl: "^", control: "^", shift: "+", alt: "%" })[modifier] ?? "")
    .join("")
  const send = `[System.Windows.Forms.SendKeys]::SendWait(${psString(prefix + main)})`
  if (!modifiers.includes("win")) return send
  return `[OcDesk]::keybd_event(0x5B,0,0,[IntPtr]::Zero); ${send}; [OcDesk]::keybd_event(0x5B,0,2,[IntPtr]::Zero)`
}

const MOUSE = { left: [0x02, 0x04], right: [0x08, 0x10], middle: [0x20, 0x40] } as const

const platformScript = {
  screenshot(file: string, width: number) {
    if (process.platform === "darwin") return `screenshot\t${file}\t${width}`
    if (process.platform !== "win32") return `screenshot\t${file}\t${width}`
    return `
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$w = [Math]::Min(${width}, $b.Width); $h = [int]($b.Height * $w / $b.Width)
$small = New-Object System.Drawing.Bitmap $bmp, $w, $h
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 80L
$small.Save(${psString(file)}, $codec, $params)
$g.Dispose(); $bmp.Dispose(); $small.Dispose()
"$($b.Width) $($b.Height) $w $h"`
  },
  type(text: string) {
    if (process.platform !== "win32") return `type\t${text}`
    return `[System.Windows.Forms.SendKeys]::SendWait(${psString(sendKeysLiteral(text))})`
  },
  paste(text: string) {
    if (process.platform !== "win32") return `type\t${text}`
    return `[System.Windows.Forms.Clipboard]::SetText(${psString(text)}); [System.Windows.Forms.SendKeys]::SendWait('^v')`
  },
  keys(combo: string) {
    if (process.platform !== "win32") return `keys\t${combo}`
    return windowsKeys(combo)
  },
  click(point: { x: number; y: number } | undefined, button: keyof typeof MOUSE, double: boolean) {
    if (process.platform !== "win32") return `click\t${point?.x ?? ""}\t${point?.y ?? ""}\t${button}\t${double}`
    const [down, up] = MOUSE[button]
    const once = `[OcDesk]::mouse_event(${down},0,0,0,[IntPtr]::Zero); [OcDesk]::mouse_event(${up},0,0,0,[IntPtr]::Zero)`
    return [point ? `[void][OcDesk]::SetCursorPos(${point.x}, ${point.y})` : "", once, double ? once : ""].filter(Boolean).join("; ")
  },
  move(point: { x: number; y: number }) {
    if (process.platform !== "win32") return `move\t${point.x}\t${point.y}`
    return `[void][OcDesk]::SetCursorPos(${point.x}, ${point.y})`
  },
  scroll(point: { x: number; y: number } | undefined, amount: number) {
    if (process.platform !== "win32") return `scroll\t${point?.x ?? ""}\t${point?.y ?? ""}\t${amount}`
    return [
      point ? `[void][OcDesk]::SetCursorPos(${point.x}, ${point.y})` : "",
      `[OcDesk]::mouse_event(0x0800,0,0,${Math.round(-amount * 120)},[IntPtr]::Zero)`,
    ]
      .filter(Boolean)
      .join("; ")
  },
  windows() {
    if (process.platform !== "win32") return "windows"
    return `Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName): $($_.MainWindowTitle)" }`
  },
  open(target: string) {
    if (process.platform !== "win32") return `open\t${target}`
    return `Start-Process ${psString(target)}; ${psString(`opened ${target}`)}`
  },
  clipboardRead() {
    if (process.platform !== "win32") return "clipboard-read"
    return "[System.Windows.Forms.Clipboard]::GetText()"
  },
  clipboardWrite(text: string) {
    if (process.platform !== "win32") return `clipboard-write\t${text}`
    return `[System.Windows.Forms.Clipboard]::SetText(${psString(text)}); ${psString(`copied ${text.length} characters`)}`
  },
  focus(title: string) {
    if (process.platform !== "win32") return `focus\t${title}`
    return `
$p = Get-Process | Where-Object { $_.MainWindowTitle -like ${psString(`*${title}*`)} } | Select-Object -First 1
if (-not $p) { throw "No window title contains: ${title.replace(/"/g, "'")}" }
[void][OcDesk]::ShowWindow($p.MainWindowHandle, 9)
[void][OcDesk]::SetForegroundWindow($p.MainWindowHandle)
"focused $($p.MainWindowTitle)"`
  },
}

// macOS and Linux run each step as its own short command: screencapture/osascript on macOS,
// and grim or scrot plus xdotool or ydotool on Linux.
async function runPosix(script: string): Promise<string> {
  const [kind = "", ...args] = script.split("\t")
  const mac = process.platform === "darwin"
  const exec = (command: string, argv: string[]) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(command, argv, { stdio: ["ignore", "pipe", "pipe"] })
      let out = ""
      let err = ""
      child.stdout.on("data", (chunk) => (out += chunk))
      child.stderr.on("data", (chunk) => (err += chunk))
      child.on("error", (error) => reject(new Error(`${command} is not available: ${error.message}`)))
      child.on("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `${command} exited with ${code}`))))
    })
  const first = async (candidates: [string, string[]][]) => {
    const errors: string[] = []
    for (const [command, argv] of candidates) {
      const result = await exec(command, argv).then(
        (value) => ({ ok: true as const, value }),
        (error: Error) => ({ ok: false as const, error }),
      )
      if (result.ok) return result.value
      errors.push(result.error.message)
    }
    throw new Error(errors.join("; "))
  }
  switch (kind) {
    case "screenshot": {
      const [file = "", width = "1280"] = args
      const png = file.replace(/\.jpg$/, ".png")
      await first(mac ? [["screencapture", ["-x", "-t", "jpg", file]]] : [["grim", [png]], ["scrot", ["-o", png]], ["import", ["-window", "root", png]]])
      if (!mac)
        await first([
          ["convert", [png, "-resize", `${width}x`, "-quality", "80", file]],
          ["ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-vf", `scale=${width}:-1`, file]],
        ])
      if (mac) await exec("sips", ["--resampleWidth", width, file])
      return `0 0 ${width} 0`
    }
    case "type":
      return mac
        ? exec("osascript", ["-e", `tell application "System Events" to keystroke ${JSON.stringify(args.join("\t"))}`])
        : first([["xdotool", ["type", "--delay", "1", args.join("\t")]], ["ydotool", ["type", args.join("\t")]]])
    case "keys":
      return mac
        ? exec("osascript", ["-e", macKeys(args[0] ?? "")])
        : first([["xdotool", ["key", (args[0] ?? "").replace(/\bctrl\b/g, "ctrl").replace(/\bwin\b/g, "super").replace(/\benter\b/g, "Return").replace(/\besc\b/g, "Escape")]]])
    case "click": {
      const [x, y, button, double] = args
      const number = { left: "1", middle: "2", right: "3" }[button ?? "left"] ?? "1"
      if (mac) return exec("osascript", ["-e", `tell application "System Events" to click at {${x}, ${y}}`])
      return first([["xdotool", [...(x ? ["mousemove", x, y ?? "0"] : []), "click", ...(double === "true" ? ["--repeat", "2"] : []), number]]])
    }
    case "move":
      if (mac) throw new Error("Moving the pointer needs cliclick on macOS")
      return first([["xdotool", ["mousemove", args[0] ?? "0", args[1] ?? "0"]]])
    case "scroll": {
      const amount = Number(args[2] ?? "3")
      if (mac) throw new Error("Scrolling needs cliclick on macOS")
      return first([["xdotool", [...(args[0] ? ["mousemove", args[0], args[1] ?? "0"] : []), "click", "--repeat", String(Math.abs(amount)), amount > 0 ? "5" : "4"]]])
    }
    case "windows":
      return mac
        ? exec("osascript", ["-e", 'tell application "System Events" to get name of every process whose visible is true'])
        : first([["wmctrl", ["-l"]], ["xdotool", ["search", "--onlyvisible", "--name", ".", "getwindowname", "%@"]]])
    case "focus":
      return mac
        ? exec("osascript", ["-e", `tell application ${JSON.stringify(args[0] ?? "")} to activate`])
        : first([["wmctrl", ["-a", args[0] ?? ""]], ["xdotool", ["search", "--name", args[0] ?? "", "windowactivate"]]])
    case "open":
      spawn(mac ? "open" : "xdg-open", [args.join("\t")], { detached: true, stdio: "ignore" }).unref()
      return `opened ${args.join("\t")}`
    case "clipboard-read":
      return mac
        ? exec("pbpaste", [])
        : first([["wl-paste", ["--no-newline"]], ["xclip", ["-selection", "clipboard", "-o"]], ["xsel", ["-b", "-o"]]])
    case "clipboard-write": {
      const text = args.join("\t")
      const copy = (command: string, argv: string[]) =>
        new Promise<string>((resolve, reject) => {
          const child = spawn(command, argv, { stdio: ["pipe", "ignore", "pipe"] })
          child.on("error", (error) => reject(new Error(`${command} is not available: ${error.message}`)))
          child.on("exit", (code) =>
            code === 0 ? resolve(`copied ${text.length} characters`) : reject(new Error(`${command} exited with ${code}`)),
          )
          child.stdin.end(text)
        })
      if (mac) return copy("pbcopy", [])
      return copy("wl-copy", []).catch(() => copy("xclip", ["-selection", "clipboard"]))
    }
  }
  throw new Error(`Unsupported step: ${kind}`)
}

function macKeys(combo: string) {
  const parts = combo.toLowerCase().split("+").map((part) => part.trim())
  const key = parts.at(-1) ?? ""
  const using = parts
    .slice(0, -1)
    .map((modifier) => ({ ctrl: "control down", cmd: "command down", win: "command down", shift: "shift down", alt: "option down" })[modifier])
    .filter(Boolean)
  const codes: Record<string, number> = { enter: 36, return: 36, tab: 48, esc: 53, escape: 53, space: 49, backspace: 51, delete: 117, up: 126, down: 125, left: 123, right: 124 }
  const press = codes[key] !== undefined ? `key code ${codes[key]}` : `keystroke ${JSON.stringify(key)}`
  return `tell application "System Events" to ${press}${using.length ? ` using {${using.join(", ")}}` : ""}`
}
