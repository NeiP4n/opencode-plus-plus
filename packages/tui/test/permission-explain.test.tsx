/** @jsxImportSource @opentui/solid */
import type { PermissionRequest } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { ConfigProvider } from "../src/config"
import { ClientProvider } from "../src/context/client"
import { DataProvider, useData } from "../src/context/data"
import { Keymap } from "../src/context/keymap"
import { LocationProvider } from "../src/context/location"
import { ThemeProvider } from "../src/context/theme"
import { PermissionPrompt } from "../src/routes/session/permission"
import { ToastProvider } from "../src/ui/toast"
import { emptyThemeSource, tmpdir } from "./fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "./fixture/tui-client"
import { TestTuiContexts } from "./fixture/tui-environment"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

const request = {
  id: "per_explain",
  sessionID: "ses_explain",
  action: "shell",
  resources: ["rm -rf build"],
} satisfies PermissionRequest

async function mount(root: string, language: "en" | "ru") {
  const prompts: Array<{ prompt: string; model?: unknown }> = []
  const ready = Promise.withResolvers<void>()
  const transport = createFetch((url, input) => {
    if (url.pathname === "/api/session/ses_explain")
      return json({
        data: {
          id: "ses_explain",
          title: "Explain session",
          projectID: "proj_test",
          location: { directory: root },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        },
      })
    if (url.pathname === "/api/experimental/generate")
      return input.json().then((body: { prompt: string; model?: unknown }) => {
        prompts.push(body)
        return json({ data: { text: "**Deletes** — removes the `build` folder." } })
      })
  }, createEventStream())

  function Sync() {
    const data = useData()
    onMount(() => void data.session.sync("ses_explain").then(ready.resolve, ready.reject))
    return <PermissionPrompt request={request} model={{ providerID: "opencode", id: "free-model" }} />
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={root} paths={{ home: root, state: root, worktree: root }}>
        <ConfigProvider config={createTuiResolvedConfig({ animations: false, language })}>
          <Keymap.Provider>
            <ClientProvider api={createApi(transport.fetch)}>
              <DataProvider directory={root}>
                <LocationProvider>
                  <ThemeProvider mode="dark" source={emptyThemeSource}>
                    <ToastProvider>
                      <Sync />
                    </ToastProvider>
                  </ThemeProvider>
                </LocationProvider>
              </DataProvider>
            </ClientProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  await ready.promise
  await app.renderOnce()
  return { app, prompts }
}

test("the explain button asks the session model about the command and shows the answer above the prompt", async () => {
  await using tmp = await tmpdir()
  const { app, prompts } = await mount(tmp.path, "en")
  try {
    await app.waitForFrame((frame) => frame.includes("explain"))
    const lines = app.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes("explain"))
    await app.mockMouse.click(lines[y]!.indexOf("explain"), y)
    await app.waitForFrame((frame) => frame.includes("Deletes — removes the build folder."))

    const frame = app.captureCharFrame().split("\n")
    expect(frame.findIndex((line) => line.includes("Deletes — removes the build folder."))).toBeLessThan(
      frame.findIndex((line) => line.includes("Permission required")),
    )
    expect(prompts).toHaveLength(1)
    // Only the request goes out, to the model chosen in the prompt.
    expect(prompts[0]?.prompt).toContain("rm -rf build")
    expect(prompts[0]?.prompt).toContain("Explain in English")
    expect(prompts[0]?.model).toEqual({ providerID: "opencode", id: "free-model" })
  } finally {
    app.renderer.destroy()
  }
})

test("the explain shortcut answers in the interface language", async () => {
  await using tmp = await tmpdir()
  const { app, prompts } = await mount(tmp.path, "ru")
  try {
    await app.waitForFrame((frame) => frame.includes("объяснить") && frame.includes("Нужно разрешение"))
    await app.mockInput.typeText("?")
    await app.waitForFrame((frame) => frame.includes("Deletes — removes the build folder."))
    expect(prompts[0]?.prompt).toContain("Explain in Russian")
  } finally {
    app.renderer.destroy()
  }
})
