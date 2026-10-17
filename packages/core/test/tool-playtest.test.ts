import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Location } from "@opencode/core/location"
import { PlaytestTool } from "@opencode/core/tool/plugin/playtest"
import { Permission } from "@opencode/core/permission"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_playtest_tool_test")
const fixture = path.join(import.meta.dir, "fixture", "playtest-app.ps1")

const pluginNode = makeLocationNode({
  name: "test/playtest-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(PlaytestTool.Plugin)),
  deps: [Tool.node, Permission.node, Location.node],
})

function harness(directory: string, seen: string[]) {
  return AppNodeBuilder.build(LayerNode.group([Tool.node, pluginNode]), [
    Location.node.replace(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
    Permission.node.replace(
      permissionLayer({
        assert: (input) => {
          seen.push(`${input.action}:${input.resources.join(",")}`)
          return Effect.void
        },
      }),
    ),
  ])
}

const run = (tools: Tool.Interface, id: string, input: Record<string, unknown>) =>
  executeTool(tools, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call" as const, id, name: PlaytestTool.name, input },
  })

const text = (result: { readonly content?: ReadonlyArray<Tool.Content> }) =>
  (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")

describe("PlaytestTool", () => {
  test("maps key combinations to virtual keys", () => {
    expect(PlaytestTool.virtualKeys("ctrl+shift+s")).toEqual({ modifiers: [0x11, 0x10], key: 0x53 })
    expect(PlaytestTool.virtualKeys("space")).toEqual({ modifiers: [], key: 0x20 })
    expect(PlaytestTool.virtualKeys("f5").key).toBe(0x74)
    expect(() => PlaytestTool.virtualKeys("hyper")).toThrow("Unknown key")
  })

  test("finds text across OCR words", () => {
    const words = [
      { x: 10, y: 10, w: 40, h: 10, line: 0, text: "New" },
      { x: 55, y: 10, w: 40, h: 10, line: 0, text: "Game" },
      { x: 10, y: 30, w: 40, h: 10, line: 1, text: "Options" },
    ]
    expect(PlaytestTool.locate(words, "new game")).toEqual({ x: 10, y: 10, w: 85, h: 10, text: "New Game" })
    expect(PlaytestTool.locate(words, "OPTIONS!")?.text).toBe("Options")
    expect(PlaytestTool.locate(words, "quit")).toBeUndefined()
    const misread = [
      { x: 0, y: 0, w: 10, h: 10, line: 0, text: "Main" },
      { x: 12, y: 0, w: 10, h: 10, line: 0, text: "Мепи" },
      { x: 0, y: 20, w: 10, h: 10, line: 1, text: "PIay" },
      { x: 0, y: 40, w: 10, h: 10, line: 2, text: "Settngs" },
    ]
    expect(PlaytestTool.locate(misread, "Main Menu")?.text).toBe("Main Мепи")
    expect(PlaytestTool.locate(misread, "Play")?.text).toBe("PIay")
    expect(PlaytestTool.locate(misread, "Settings")?.text).toBe("Settngs")
  })

  test("keeps Chromium drawing off-screen and opens its DevTools port", () => {
    const args = PlaytestTool.chromiumArgs("electron.exe", ["."], ".", 9333)
    expect(args).toContain("--disable-backgrounding-occluded-windows")
    expect(args).toContain("--remote-debugging-port=9333")
    expect(PlaytestTool.chromiumArgs("game.exe", [], ".", 9333)).toEqual([])
  })

  test("maps virtual keys to DOM keys for DevTools input", () => {
    expect(PlaytestTool.keyInfo(0x5a, false)).toEqual({ key: "z", code: "KeyZ", text: "z" })
    expect(PlaytestTool.keyInfo(0x0d, false)).toEqual({ key: "Enter", code: "Enter", text: "\r" })
    expect(PlaytestTool.keyInfo(0x26, false)).toEqual({ key: "ArrowUp", code: "ArrowUp", text: undefined })
    expect(PlaytestTool.keyInfo(0x74, false).code).toBe("F5")
  })

  test("compares colors with a tolerance", () => {
    expect(PlaytestTool.close("#ff0000", "#f00", 0)).toBe(true)
    expect(PlaytestTool.close("#f00a00", "#ff0000", 16)).toBe(true)
    expect(PlaytestTool.close("#00ff00", "#ff0000", 16)).toBe(false)
  })

  ;(process.platform === "win32" ? it.live : it.live.skip)(
    "moves from a black helper window to the window that draws",
    () =>
      withTempDir(({ path: directory }) => {
        const seen: string[] = []
        return Effect.gen(function* () {
          const tools = yield* Tool.Service
          const result = yield* run(tools, "decoy", {
            steps: [
              {
                action: "launch",
                path: "powershell.exe",
                args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Decoy"],
                title: "Loader",
              },
              { action: "screenshot", see: false },
              { action: "wait_text", text: "STUDIO LOGO", ms: 5000 },
              { action: "close" },
            ],
          })
          const output = text(result)
          expect(output).toContain("PASS")
          expect(output).toContain(`switched to the app's window "Playtest Fixture"`)
        }).pipe(Effect.provide(harness(directory, seen)))
      }),
    60_000,
  )

  ;(process.platform === "win32" ? it.live : it.live.skip)(
    "drives a hidden app with the virtual mouse and keyboard and sees the result",
    () =>
      withTempDir(({ path: directory }) => {
        const seen: string[] = []
        return Effect.gen(function* () {
          const tools = yield* Tool.Service
          const result = yield* run(tools, "play", {
            steps: [
              {
                action: "launch",
                path: "powershell.exe",
                args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture],
                title: "Playtest Fixture",
              },
              { action: "wait_stable", ms: 5000 },
              { action: "skip", count: 1 },
              { action: "wait_text", text: "main menu", ms: 5000 },
              { action: "click_text", text: "Play" },
              { action: "wait_text", text: "Level 1", ms: 5000 },
              { action: "read" },
              { action: "screenshot", width: 400, see: false },
              { action: "screenshot", region: [0, 0, 120, 50], see: false },
              { action: "pixel", x: 200, y: 150, color: "#0000ff" },
              { action: "click", x: 100, y: 150 },
              { action: "wait_change", ms: 3000 },
              { action: "pixel", x: 200, y: 150, color: "#ff0000" },
              { action: "click", x: 300, y: 150 },
              { action: "wait_change", ms: 3000 },
              { action: "pixel", color: "#00ff00" },
              { action: "key", keys: "space" },
              { action: "wait_change", ms: 3000 },
              { action: "pixel", color: "#ffff00" },
              { action: "type", text: "hi" },
              { action: "frames", count: 4, interval: 20, see: false },
              { action: "wait", ms: 300 },
              { action: "log" },
              { action: "close" },
            ],
          })
          const output = text(result)
          expect(output).toContain("PASS")
          expect(output).toContain("hidden off-screen")
          expect(output).toContain("skipped 1 screen(s): click")
          expect(output).toContain('clicked "Play"')
          expect(output).toMatch(/Level 1/)
          expect(output).toContain("zoom of [0, 0, 120, 50]")
          expect(output).toContain("click 100 150")
          expect(output).toContain("key Space")
          expect(output).toContain("char h")
          expect(seen[0]).toContain("playtest:launch powershell.exe")
        }).pipe(Effect.provide(harness(directory, seen)))
      }),
    60_000,
  )
})
