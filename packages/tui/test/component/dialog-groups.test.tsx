/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { DialogGroups } from "../../src/component/dialog-groups"
import { ConfigProvider } from "../../src/config"
import { ClientProvider } from "../../src/context/client"
import { Keymap } from "../../src/context/keymap"
import { ProjectsProvider } from "../../src/context/projects"
import { RouteProvider } from "../../src/context/route"
import { ThemeProvider } from "../../src/context/theme"
import { ToastProvider } from "../../src/ui/toast"
import type { FetchHandler } from "../fixture/tui-client"
import { createApi, createFetch, json } from "../fixture/tui-client"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const directory = "/tmp/opencode/packages/tui"
const projects = [
  { id: "prj_a", name: "Frontend", directory },
  { id: "prj_b", name: "Backend", directory },
]

// A group chat is created only when the operator presses the group-chat button; nothing
// creates a session on render. These tests drive one real creation through the rendered
// dialog and count the requests, so a retry loop or a duplicate Supervisor fails the test.
async function createChat(app: Awaited<ReturnType<typeof renderDialog>>, label: string) {
  const frame = await app.waitForFrame((current) => current.includes("Games") && current.includes(label))
  const lines = frame.split("\n")
  const row = lines.findIndex((line) => line.includes(label))
  await app.mockMouse.click(lines[row].indexOf(label) + 2, row)
}

async function renderDialog(onRequest: FetchHandler) {
  return testRender(
    () => (
      <TestTuiContexts directory={directory}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <RouteProvider>
                <ClientProvider api={createApi(createFetch(onRequest).fetch)}>
                  <ProjectsProvider>
                    <ThemeProvider mode="dark" source={emptyThemeSource}>
                      <DialogGroups />
                    </ThemeProvider>
                  </ProjectsProvider>
                </ClientProvider>
              </RouteProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 32, kittyKeyboard: true },
  ).then(async (app) => {
    app.renderer.start()
    return app
  })
}

function groups(mode: "lead" | "council", supervisor?: string) {
  return [{ name: "Games", projects: ["prj_a", "prj_b"], mode, ...(supervisor ? { supervisor } : {}) }]
}

test("a lead group creates one President chat on request", async () => {
  let createdID: string | undefined
  let creates = 0
  let saves = 0
  let prompts = 0
  let createBody: Record<string, unknown> | undefined
  let savedGroup: Record<string, unknown> | undefined
  let promptBody: Record<string, unknown> | undefined
  const app = await renderDialog(async (url, request) => {
    if (url.pathname === "/api/orchestra/project") return json(projects)
    if (url.pathname === "/api/orchestra/owner") return json({})
    if (url.pathname === "/api/orchestra/group" && request.method === "GET") return json(groups("lead", createdID))
    if (url.pathname === "/api/orchestra/group" && request.method === "PUT") {
      saves += 1
      savedGroup = (await request.json()) as Record<string, unknown>
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/session" && request.method === "POST") {
      creates += 1
      createBody = (await request.json()) as Record<string, unknown>
      createdID = "ses_president_games"
      return json({
        data: {
          id: createdID,
          title: "Президент",
          projectID: "prj_a",
          agent: "president",
          location: { directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
        },
      })
    }
    if (createdID !== undefined && url.pathname === `/api/session/${createdID}/prompt`) {
      prompts += 1
      promptBody = (await request.json()) as Record<string, unknown>
      return json({
        data: {
          id: "msg_bootstrap",
          sessionID: createdID,
          time: { created: 1 },
          type: "user",
          payload: { text: "bootstrap" },
          delivery: "queue",
        },
      })
    }
    return undefined
  })

  try {
    await createChat(app, "Создать Президента")
    await app.waitForFrame(() => creates === 1 && saves >= 1 && prompts === 1)
    expect(creates).toBe(1)
    expect(saves).toBeGreaterThanOrEqual(1)
    // A lead-mode group chat runs the President agent, one level above the Orchestrators.
    expect(createBody?.agent).toBe("president")
    expect(createBody?.title).toBe("Президент")
    // The created chat is adopted by the group under the mode it was made for.
    expect(savedGroup?.supervisor).toBe(createdID)
    expect(savedGroup?.mode).toBe("lead")
    // Initialization is admitted without spending a model call.
    expect(prompts).toBe(1)
    expect(promptBody?.resume).toBe(false)
    expect(promptBody?.metadata).toEqual({ "opencode-pp:group-supervisor-bootstrap": true })

    // Give any accidental retry loop a chance to run before asserting the count is stable.
    await app.renderOnce()
    await app.renderOnce()
    expect(creates).toBe(1)
    expect(prompts).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

test("a council group creates one shared Orchestrator chat", async () => {
  let createdID: string | undefined
  let creates = 0
  let createBody: Record<string, unknown> | undefined
  let savedGroup: Record<string, unknown> | undefined
  const app = await renderDialog(async (url, request) => {
    if (url.pathname === "/api/orchestra/project") return json(projects)
    if (url.pathname === "/api/orchestra/owner") return json({})
    if (url.pathname === "/api/orchestra/group" && request.method === "GET") return json(groups("council", createdID))
    if (url.pathname === "/api/orchestra/group" && request.method === "PUT") {
      savedGroup = (await request.json()) as Record<string, unknown>
      return new Response(null, { status: 204 })
    }
    if (url.pathname === "/api/session" && request.method === "POST") {
      creates += 1
      createBody = (await request.json()) as Record<string, unknown>
      createdID = "ses_council_games"
      return json({
        data: {
          id: createdID,
          title: "Совет",
          projectID: "prj_a",
          agent: "orchestrator",
          location: { directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
        },
      })
    }
    if (createdID !== undefined && url.pathname === `/api/session/${createdID}/prompt`)
      return json({
        data: {
          id: "msg_bootstrap",
          sessionID: createdID,
          time: { created: 1 },
          type: "user",
          payload: { text: "bootstrap" },
          delivery: "queue",
        },
      })
    return undefined
  })

  try {
    await createChat(app, "Создать Общество")
    await app.waitForFrame(() => creates === 1 && savedGroup !== undefined)
    expect(creates).toBe(1)
    // The Council is one shared, ordinary-looking Orchestrator session the member
    // Orchestrators talk in; it is not the President above them.
    expect(createBody?.agent).toBe("orchestrator")
    expect(createBody?.title).toBe("Общество")
    expect(savedGroup?.mode).toBe("council")
    expect(savedGroup?.supervisor).toBe(createdID)
    await app.renderOnce()
    expect(creates).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})
