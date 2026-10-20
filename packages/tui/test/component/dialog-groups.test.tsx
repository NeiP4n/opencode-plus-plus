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
const groupDirectory = "/tmp/opencode/groups/Games"
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

test("a lead group asks the group endpoint for its President chat", async () => {
  let chatCalls = 0
  let chatBody: Record<string, unknown> | undefined
  let supervisor: string | undefined
  const app = await renderDialog(async (url, request) => {
    if (url.pathname === "/api/orchestra/project") return json(projects)
    if (url.pathname === "/api/orchestra/owner") return json({})
    if (url.pathname === "/api/orchestra/group" && request.method === "GET") return json(groups("lead", supervisor))
    if (url.pathname === "/api/orchestra/group/Games/chat" && request.method === "POST") {
      chatCalls += 1
      chatBody = (await request.json()) as Record<string, unknown>
      supervisor = "ses_group_games"
      return json({ sessionID: supervisor, title: "Президент", directory: groupDirectory })
    }
    return undefined
  })

  try {
    await createChat(app, "Создать Президента")
    await app.waitForFrame(() => chatCalls === 1)
    // The group endpoint creates the chat; the client sends only the mode it needs.
    expect(chatCalls).toBe(1)
    expect(chatBody?.mode).toBe("lead")

    // Give any accidental retry loop a chance to run before asserting the count is stable.
    await app.renderOnce()
    await app.renderOnce()
    expect(chatCalls).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

test("a council group asks the group endpoint for its shared chat", async () => {
  let chatCalls = 0
  let chatBody: Record<string, unknown> | undefined
  const app = await renderDialog(async (url, request) => {
    if (url.pathname === "/api/orchestra/project") return json(projects)
    if (url.pathname === "/api/orchestra/owner") return json({})
    if (url.pathname === "/api/orchestra/group" && request.method === "GET") return json(groups("council"))
    if (url.pathname === "/api/orchestra/group/Games/chat" && request.method === "POST") {
      chatCalls += 1
      chatBody = (await request.json()) as Record<string, unknown>
      return json({ sessionID: "ses_group_games", title: "Общество", directory: groupDirectory })
    }
    return undefined
  })

  try {
    await createChat(app, "Создать Общество")
    await app.waitForFrame(() => chatCalls === 1)
    // The Council is one shared chat in the group's own directory, not a session of a project.
    expect(chatCalls).toBe(1)
    expect(chatBody?.mode).toBe("council")
    await app.renderOnce()
    expect(chatCalls).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})

test("the group chat is created through the group endpoint and never as a session of the coordinator", async () => {
  const seen: string[] = []
  let chatCalls = 0
  const app = await renderDialog(async (url, request) => {
    seen.push(`${request.method} ${url.pathname}${url.search}`)
    if (url.pathname === "/api/orchestra/project") return json(projects)
    if (url.pathname === "/api/orchestra/owner") return json({})
    if (url.pathname === "/api/orchestra/group" && request.method === "GET") return json(groups("lead"))
    if (url.pathname === "/api/orchestra/group/Games/chat" && request.method === "POST") {
      chatCalls += 1
      return json({ sessionID: "ses_group_games", title: "Президент", directory: groupDirectory })
    }
    // A session in the coordinator's directory is what the client must not create.
    if (url.pathname === "/api/session" && request.method === "POST")
      return json({ data: { id: "ses_in_coordinator", location: { directory } } })
    return undefined
  })

  try {
    await createChat(app, "Создать Президента")
    await app.waitForFrame(() => chatCalls === 1)

    // The chat belongs to the group, so it is created through the group endpoint.
    expect(seen).toContain("POST /api/orchestra/group/Games/chat")
    // No session is listed or created in the coordinator's directory any more.
    expect(seen.filter((entry) => entry.includes("/api/session"))).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})
