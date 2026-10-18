/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"

import { QuickHelp, explainSelection, setQuickMode } from "../src/component/quick-help"
import { ConfigProvider } from "../src/config"
import { ArgsProvider } from "../src/context/args"
import { ClientProvider } from "../src/context/client"
import { DataProvider } from "../src/context/data"
import { Keymap } from "../src/context/keymap"
import { LocalProvider } from "../src/context/local"
import { LocationProvider } from "../src/context/location"
import { PermissionProvider } from "../src/context/permission"
import { RouteProvider } from "../src/context/route"
import { ThemeProvider } from "../src/context/theme"
import { ToastProvider } from "../src/ui/toast"
import { emptyThemeSource, tmpdir } from "./fixture/fixture"
import { createApi, createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { TestTuiContexts } from "./fixture/tui-environment"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"

// Markdown the model sends back: a bold lead, a bullet list and inline code.
const ANSWER = [
  "**Chromium** — это сам браузер.",
  "",
  "- **Первый** пункт с `кодом`",
  "- Второй пункт",
].join("\n")

async function mount() {
  await using tmp = await tmpdir()
  const prompts: Array<{ prompt: string }> = []
  const transport = createFetch(async (url, input) => {
    if (url.pathname === "/api/model")
      return json({ location: { directory }, data: [{ id: "first", modelID: "first", providerID: "provider" }] })
    if (url.pathname === "/api/agent") return json({ location: { directory }, data: [] })
    if (url.pathname === "/api/experimental/generate")
      return input.json().then((body: { prompt: string }) => {
        prompts.push(body)
        return json({ data: { text: ANSWER } })
      })
  }, createEventStream())

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: tmp.path, home: tmp.path, worktree: tmp.path }} cwd={directory}>
        <ArgsProvider>
          <ConfigProvider config={createTuiResolvedConfig({ animations: false, language: "ru" })}>
            <Keymap.Provider>
              <ThemeProvider mode="dark" source={emptyThemeSource}>
                <ToastProvider>
                  <RouteProvider initialRoute={{ type: "home" }}>
                    <ClientProvider api={createApi(transport.fetch)}>
                      <DataProvider directory={directory}>
                        <LocationProvider>
                          <PermissionProvider>
                            <LocalProvider>
                              <QuickHelp />
                            </LocalProvider>
                          </PermissionProvider>
                        </LocationProvider>
                      </DataProvider>
                    </ClientProvider>
                  </RouteProvider>
                </ToastProvider>
              </ThemeProvider>
            </Keymap.Provider>
          </ConfigProvider>
        </ArgsProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.renderOnce()
  // The theme discovers its syntax style asynchronously; markdown highlighting needs it ready.
  await Bun.sleep(100)
  await app.renderOnce()
  return { app, prompts }
}

test("the explain window renders the answer as markdown, not as its source", async () => {
  const { app, prompts } = await mount()
  try {
    explainSelection("No Chromium or Chrome executable was found")
    await app.waitForFrame((frame) => frame.includes("Chromium"))
    // Highlighting resolves after the frame that first shows the answer.
    await Bun.sleep(500)
    await app.renderOnce()

    const frame = app.captureCharFrame()
    expect(prompts.length).toBeGreaterThan(0)
    expect(prompts[0]?.prompt).toContain("No Chromium or Chrome executable was found")
    // Bold and inline code are concealed; their markers never reach the screen.
    expect(frame).toContain("Chromium — это сам браузер.")
    expect(frame).toContain("Первый пункт с кодом")
    expect(frame).not.toContain("**")
    expect(frame).not.toContain("`")
  } finally {
    setQuickMode()
    app.renderer.destroy()
  }
})