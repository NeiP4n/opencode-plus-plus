import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const session = {
  id: "ses_worker",
  title: "Worker task",
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const developer = {
  id: "developer",
  agent: "team-developer",
  name: "Developer",
  description: "Implements changes",
  rules: "Role: developer.",
  category: "Build",
  readOnly: false,
  origin: "builtin",
}
const feature = {
  id: "feature",
  name: "Feature",
  description: "Design, build, test and review a new feature",
  origin: "builtin",
  members: [{ agent: "team-developer", title: "Developer", category: "Build" }],
}

type Call = { method: string; path: string; body?: unknown }

function render(state: string, calls: Call[], language?: "ru", options: { templateFailures?: number } = {}) {
  const roles: Record<string, unknown>[] = [developer]
  const teams: Record<string, unknown>[] = [feature]
  const failures = { templates: options.templateFailures ?? 0 }
  return createAppFixture({
    width: 140,
    height: 44,
    state,
    args: { sessionID: session.id },
    config: { animations: false, language, session: { sidebar: "hide" }, debug: { devtools: true } },
    fetch: async (url, request) => {
      const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined)
      if (url.pathname.startsWith("/api/orchestra")) calls.push({ method: request.method, path: url.pathname, body })
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/orchestra/project" && request.method === "POST")
        return json({ _tag: "InvalidRequestError", message: "Not an existing directory: /nope", field: "directory" }, { status: 400 })
      if (url.pathname === "/api/orchestra/project") return json([])
      if (url.pathname === "/api/orchestra/role" && request.method === "POST") {
        const role = { ...(body as object), id: "auditor", agent: "team-auditor", origin: "custom" }
        roles.push(role)
        return json(role)
      }
      if (url.pathname === "/api/orchestra/role") return json(roles)
      if (url.pathname === "/api/orchestra/template" && request.method === "POST") {
        const team = { ...(body as object), id: "audit", origin: "custom" }
        teams.push(team)
        return json(team)
      }
      if (url.pathname === "/api/orchestra/template" && failures.templates > 0) {
        failures.templates--
        return new Response("unavailable", { status: 503 })
      }
      if (url.pathname === "/api/orchestra/template") return json(teams)
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    },
  })
}

function cell(frame: string, needle: string) {
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(needle))
  if (y < 0) throw new Error(`no ${needle} on screen`)
  return { x: lines[y].indexOf(needle), y }
}

test("the team editor creates a role and a team made of it", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls)

  const bar = await setup.waitForFrame((frame) => frame.includes("Teams") && frame.includes("Experiments"))
  const item = cell(bar, "Teams")
  await setup.mockMouse.click(item.x + 1, item.y)
  await setup.waitForFrame((frame) => frame.includes("Team editor") && frame.includes("Feature"))

  // roles tab, new role: the list's first row, then tab into the form
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((frame) => frame.includes("+ New role") && frame.includes("Developer"))
  setup.mockInput.pressKey("n", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Rules"))
  setup.mockInput.typeText("Auditor")
  setup.mockInput.pressTab()
  setup.mockInput.typeText("Quality")
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  // model: the Orchestrator's → fixed → automatic, which asks for the models to pick from
  setup.mockInput.pressArrow("right")
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((frame) => frame.includes("models the Orchestrator picks from"))
  setup.mockInput.pressTab()
  setup.mockInput.typeText("test/fast, test/strong")
  setup.mockInput.pressTab()
  // the file access switch
  setup.mockInput.pressArrow("right")
  setup.mockInput.pressTab()
  // tools: only reading files plus an MCP pattern, and the Orchestrator may narrow them
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((frame) => frame.includes("□ read") && frame.includes("context7 (AI)"))
  setup.mockInput.pressTab()
  // each tool is its own chip: read, glob and grep are the first three
  setup.mockInput.pressKey(" ")
  setup.mockInput.pressArrow("right")
  setup.mockInput.pressKey(" ")
  setup.mockInput.pressArrow("right")
  setup.mockInput.pressKey(" ")
  setup.mockInput.pressTab()
  setup.mockInput.typeText("context7_*")
  setup.mockInput.pressTab()
  setup.mockInput.pressKey(" ")
  setup.mockInput.pressTab()
  // registry: only the first category
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((frame) => frame.includes("mobile"))
  setup.mockInput.pressTab()
  setup.mockInput.pressKey(" ")
  // Registry programs stay "all installed"
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  setup.mockInput.typeText("Check licenses.")
  setup.mockInput.pressKey("s", { ctrl: true })
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/role"))
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({
    name: "Auditor",
    category: "Quality",
    description: "",
    rules: "Check licenses.",
    readOnly: true,
    models: ["test/fast", "test/strong"],
    tools: ["read", "glob", "grep", "context7_*"],
    autoTools: true,
    hub: ["build"],
  })
  await setup.waitForFrame((frame) => frame.includes("Auditor") && frame.includes("custom"))

  // teams tab, new team with the new role
  setup.mockInput.pressKey("n", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Rules"))
  // back on the list
  setup.mockInput.pressArrow("left")
  await setup.waitForFrame((frame) => frame.includes("+ New team"))
  setup.mockInput.pressKey("n", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("+ Add member"))
  setup.mockInput.typeText("Audit")
  setup.mockInput.pressTab()
  setup.mockInput.pressTab()
  // "+ Add member", then the new row's role picker steps to the next role
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("1."))
  setup.mockInput.pressTab()
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((frame) => frame.includes("‹ Auditor"))
  // enter opens the role picker; typing filters it and enter picks the match
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Type to filter roles") && frame.includes("Quality · read only"))
  setup.mockInput.typeText("devel")
  await setup.waitForFrame((frame) => !frame.includes("Quality") && frame.includes("Developer"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("‹ Developer") && frame.includes("Playbook"))
  setup.mockInput.pressArrow("right")
  await setup.waitForFrame((frame) => frame.includes("‹ Auditor"))
  setup.mockInput.pressKey("s", { ctrl: true })
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/template"))
  expect(calls.find((call) => call.path === "/api/orchestra/template" && call.method === "POST")?.body).toEqual({
    name: "Audit",
    description: "",
    members: [{ agent: "team-auditor", title: "", category: "" }],
  })
}, 30_000)

test("the team editor follows the language switch", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path, [], "ru")
  const bar = await setup.waitForFrame((frame) => frame.includes("Команды"))
  const item = cell(bar, "Команды")
  await setup.mockMouse.click(item.x + 1, item.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("Редактор команд") && frame.includes("Feature"))
  expect(frame).toContain("+ Новая команда")
  expect(frame).toContain("Участники")
  expect(frame).not.toContain("Members")
})

async function openNewProject(setup: Awaited<ReturnType<typeof render>>, label: string) {
  const bar = await setup.waitForFrame((frame) => frame.includes(label))
  const item = cell(bar, label)
  await setup.mockMouse.click(item.x + 1, item.y)
}

test("the new-project dialog says when teams did not load and retries", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path, [], undefined, { templateFailures: 1 })
  await openNewProject(setup, "+ Project")
  const failed = await setup.waitForFrame((frame) => frame.includes("Could not load teams"))
  const retry = cell(failed, "Retry")
  await setup.mockMouse.click(retry.x + 1, retry.y)
  const loaded = await setup.waitForFrame((frame) => frame.includes("Feature") && frame.includes("Developer"))
  expect(loaded).not.toContain("Could not load teams")
})

test("the new-project dialog reads built-in teams and a bad path in Russian", async () => {
  await using state = await tmpdir()
  await using setup = await render(state.path, [], "ru")
  await openNewProject(setup, "+ Проект")
  const frame = await setup.waitForFrame((frame) => frame.includes("Фича"))
  const lines = frame.split("\n")
  const featureRow = lines.findIndex((line) => line.includes("Фича"))
  expect(featureRow).toBeGreaterThanOrEqual(0)
  // The role description intentionally wraps beneath the team name on a narrow panel.
  expect(lines.slice(featureRow, featureRow + 3).join(" ")).toContain("Разработчик")
  setup.mockInput.pressTab()
  for (let i = 0; i < 80; i++) setup.mockInput.pressBackspace()
  setup.mockInput.typeText("/nope")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Такого каталога нет: /nope"))
})
