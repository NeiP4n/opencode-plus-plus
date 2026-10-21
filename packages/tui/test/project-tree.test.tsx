import { expect, test } from "bun:test"
import { SessionOwnerMetadataKey } from "@opencode/schema/orchestra"
import { SESSION_SIDEBAR_COMPACT_WIDTH } from "../src/ui/layout"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const project = { id: "prj_demo", name: "Demo", directory, created: 0 }
const session = (id: string, title: string) => ({
  id,
  title,
  projectID: "project",
  location: { directory },
  agent: "build",
  model: { providerID: "provider", id: "model" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
})
const worker = session("ses_worker", "Worker task")
const main = session("ses_main", "Demo · Orchestrator")
const createdProject = { ...project, id: "prj_new", name: "Created", main: "ses_created_main" }
const createdMain = { ...session("ses_created_main", "Created · Orchestrator"), agent: "orchestrator" }

type Call = { method: string; path: string; body?: unknown }

const team = {
  id: "feature",
  name: "Feature",
  description: "Design, build, test and review a new feature",
  members: [
    { agent: "architect", title: "Architect" },
    { agent: "developer", title: "Developer" },
  ],
}

function render(
  state: string,
  calls: Call[],
  projects: (typeof project)[],
  listed = worker,
  layout: "compact" | "full" = "full",
  options: {
    width?: number
    sidebar?: "auto" | "hide"
    createdRosterGate?: Promise<void>
    createdMainGate?: Promise<void>
    groups?: { name: string; projects: string[]; mode?: "lead" | "council"; supervisor?: string }[]
  } = {},
) {
  let projectCreated = false
  let groupData = options.groups ?? []
  return createAppFixture({
    width: options.width ?? 120,
    state,
    args: { sessionID: worker.id },
    config: {
      animations: false,
      mouse: true,
      session: { sidebar: options.sidebar ?? "hide" },
      debug: { devtools: true },
      layout,
    },
    fetch: async (url, request) => {
      // The left panel polls Mesh status next to the group list; an unmocked route would
      // otherwise reject and leak into whichever test renders the panel next.
      if (url.pathname === "/api/room/mesh")
        return json({
          nodeID: "node",
          status: "unconfigured",
          currentTerm: 0,
          members: [],
          voters: [],
          voter: false,
          logIndex: 0,
          commitIndex: 0,
          quorum: 0,
          leader: false,
          writable: false,
        })
      if (url.pathname === "/api/orchestra/group") {
        if (request.method === "GET") return json(groupData)
        if (request.method === "PUT") {
          const body = (await request.json()) as (typeof groupData)[number]
          calls.push({ method: request.method, path: url.pathname, body })
          groupData = [...groupData.filter((group) => group.name !== body.name), body]
          return new Response(null, { status: 204 })
        }
      }
      if (url.pathname.startsWith("/api/orchestra"))
        calls.push({
          method: request.method,
          path: url.pathname,
          body: request.method === "GET" ? undefined : await request.json().catch(() => undefined),
        })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const body = (await request.json()) as {
          id: string
          title?: string
          location?: { directory: string }
          metadata?: Record<string, unknown>
        }
        calls.push({ method: "POST", path: url.pathname, body })
        return json({
          data: {
            ...session(body.id, body.title ?? "New session"),
            ...body,
            location: body.location ?? { directory },
          },
        })
      }
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/orchestra/project" && request.method === "POST") {
        projectCreated = true
        return json(createdProject)
      }
      if (url.pathname === "/api/orchestra/owner") return json({})
      if (url.pathname === "/api/orchestra/project") return json(projectCreated ? [...projects, createdProject] : projects)
      if (url.pathname === "/api/orchestra/template") return json([team])
      if (url.pathname === `/api/orchestra/project/${project.id}/session`)
        return json({ data: [listed], access: { [worker.id]: "write" }, category: { [worker.id]: "Build" } })
      if (url.pathname === `/api/orchestra/project/${createdProject.id}/session`) {
        // Some backends can be slow to load a newly-created project's roster.
        // Keep the route controllably pending to verify opening the main session is independent.
        await options.createdRosterGate
        return json({ data: [], access: {}, category: {} })
      }
      if (url.pathname === `/api/orchestra/project/${project.id}/main`) return json(main)
      if (url.pathname === `/api/orchestra/project/${createdProject.id}/main`) {
        await options.createdMainGate
        return json(createdMain)
      }
      if (url.pathname.startsWith("/api/orchestra/access/")) return new Response(null, { status: 204 })
      if (url.pathname.startsWith("/api/orchestra/category/")) return new Response(null, { status: 204 })
      if (url.pathname.startsWith("/api/orchestra/owner/")) return new Response(null, { status: 204 })
      if (url.pathname === "/api/session") return json({ data: projectCreated ? [createdMain, listed] : [listed], cursor: {} })
      if (url.pathname === `/api/session/${worker.id}` && request.method === "DELETE") {
        calls.push({ method: "DELETE", path: url.pathname })
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${worker.id}`) return json({ data: listed })
      if (url.pathname === `/api/session/${main.id}`) return json({ data: main })
      if (url.pathname === `/api/session/${createdMain.id}`) return json({ data: createdMain })
      if (/^\/api\/session\/[^/]+$/.test(url.pathname))
        return json({ data: session(url.pathname.split("/")[3] ?? "ses_new", "New session") })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) return json({ data: {} })
      if (/^\/api\/session\/[^/]+\/(agent|model)$/.test(url.pathname))
        return new Response(null, { status: 204 })
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

test("a new session started from a project carries its project owner metadata", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  // Keep the project panel comfortably inside the vertical layout range, and
  // wait until the app has mounted before looking for its asynchronously loaded rows.
  await using setup = await render(state.path, calls, [project], worker, "full", { width: 140 })
  await setup.ready

  // Wait for the entire project expansion, not just the session row. The session can
  // render before its category/access metadata, which inserts rows and moves the button.
  await setup.waitForFrame(
    (frame) =>
      frame.includes("+ New session") &&
      frame.includes(worker.title) &&
      frame.includes("Build") &&
      frame.includes("[write]"),
    { maxPasses: 100 },
  )
  // Use the current frame after a render so async row updates cannot stale the click position.
  await setup.renderOnce()
  const add = cell(setup.captureCharFrame(), "+ New session")
  // Click a visible character, not the whitespace after the plus sign.
  await setup.mockMouse.click(add.x + 2, add.y)
  // A route change can leave a render scheduled in OpenTUI's test renderer;
  // run that frame before waiting for Home's asynchronously loaded prompt.
  await setup.renderOnce()
  await setup.waitForFrame(
    (frame) => {
      // Home prompt suggestions can wrap across rows at narrow transcript widths.
      const visible = frame.replace(/\s+/g, " ")
      return ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"].some((text) =>
        visible.includes(text),
      )
    },
    { maxPasses: 100 },
  )

  await setup.mockInput.typeText("hello")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/session"))

  expect(calls.find((call) => call.method === "POST" && call.path === "/api/session")?.body).toMatchObject({
    metadata: { [SessionOwnerMetadataKey]: { projectID: project.id } },
  })
})

test("the left panel lists the operator's projects with the orchestrator and sessions by category at their access level", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [project])

  // the open session's project starts expanded and shows the access the operator granted
  const frame = await setup.waitForFrame(
    (frame) => frame.includes("Projects") && frame.includes("Demo") && frame.includes("[write]"),
  )
  expect(frame).toContain("Orchestrator")
  // sessions sit under their category
  const lines = frame.split("\n")
  expect(lines.findIndex((line) => line.includes("Build"))).toBeLessThan(
    lines.findIndex((line) => line.includes("Worker task")),
  )

  // clicking the chip steps to the next level and stores it
  const chip = cell(frame, "[write]")
  await setup.mockMouse.click(chip.x + 1, chip.y)
  await setup.waitForFrame((frame) => frame.includes("[full]"))
  await setup.waitFor(() => calls.some((call) => call.method === "PUT"))
  expect(calls.find((call) => call.method === "PUT")).toEqual({
    method: "PUT",
    path: `/api/orchestra/access/${worker.id}`,
    body: { access: "full" },
  })

  // the orchestra row opens the project's main session
  const orchestra = cell(setup.captureCharFrame(), "Orchestrator")
  await setup.mockMouse.click(orchestra.x + 2, orchestra.y)
  await setup.waitFor(() => calls.some((call) => call.path === `/api/orchestra/project/${project.id}/main`))
})

test("opening project settings from the gear stays open after the mouse is released", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [project])

  const frame = await setup.waitForFrame((frame) => frame.includes("Projects") && frame.includes("Demo"))
  const name = cell(frame, "Demo")
  await setup.mockMouse.moveTo(name.x + 1, name.y)
  await setup.renderOnce()

  const hovered = await setup.waitForFrame((frame) => frame.includes("Demo") && frame.includes("⚙"))
  const gear = cell(hovered, "⚙")
  await setup.mockMouse.click(gear.x, gear.y)

  await setup.waitForFrame((frame) => frame.includes("Edit project") && frame.includes("Path"))
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Edit project")
})

test("the orchestrator council mode button saves the group mode when clicked", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [project], worker, "full", {
    width: 140,
    groups: [{ name: "Games", projects: [project.id], mode: "lead", supervisor: "ses_group_previous" }],
  })
  await setup.ready

  const tree = await setup.waitForFrame((frame) => frame.includes("+ Group") && frame.includes("Projects"))
  const addGroup = cell(tree, "+ Group")
  await setup.mockMouse.click(addGroup.x + 2, addGroup.y)

  const dialog = await setup.waitForFrame((frame) => frame.includes("Project groups") && frame.includes("Orchestrator council"))
  const council = cell(dialog, "Orchestrator council")
  await setup.mockMouse.click(council.x + 2, council.y)

  await setup.waitFor(() =>
    calls.some(
      (call) => call.method === "PUT" && call.path === "/api/orchestra/group" && (call.body as { mode?: string })?.mode === "council",
    ),
  )
  await setup.waitForFrame(
    (frame) =>
      frame.includes("★ Общество · Открыть") &&
      frame.includes("To use the council, open Society above") &&
      frame.includes("Changing the mode alone does not send tasks"),
  )
})

test("a group's own chat is listed under the group, not under a member project", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [project], worker, "full", {
    width: 140,
    groups: [{ name: "Games", projects: [project.id], mode: "council", supervisor: "ses_society" }],
  })

  const frame = await setup.waitForFrame(
    (frame) => frame.includes("Games") && frame.includes("★ Общество") && frame.includes("Worker task"),
    { maxPasses: 100 },
  )
  const lines = frame.split("\n")
  const group = lines.findIndex((line) => line.includes("Games"))
  const chat = lines.findIndex((line) => line.includes("★ Общество"))
  const projectRow = lines.findIndex((line) => line.includes("Demo"))
  expect(chat).toBeGreaterThan(group)
  expect(chat).toBeLessThan(projectRow)
})

test("deleting a session takes two clicks on its ×", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [project])
  const frame = await setup.waitForFrame((frame) => frame.includes("Worker task") && frame.includes("[write] ×"))
  const button = cell(frame, " ×")
  await setup.mockMouse.click(button.x + 1, button.y)
  await setup.waitForFrame((frame) => frame.includes("delete?"))
  expect(calls.some((call) => call.method === "DELETE")).toBe(false)
  const confirm = cell(setup.captureCharFrame(), "delete?")
  await setup.mockMouse.click(confirm.x, confirm.y)
  await setup.waitFor(() => calls.some((call) => call.method === "DELETE"))
  await setup.waitForFrame((frame) => !frame.includes("Worker task"))
})

test("a project is created from a name and a path", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  let releaseRoster!: () => void
  let releaseMain!: () => void
  let rosterReleased = false
  const createdRosterGate = new Promise<void>((resolve) => {
    releaseRoster = resolve
  })
  const createdMainGate = new Promise<void>((resolve) => {
    releaseMain = resolve
  })
  await using setup = await render(state.path, calls, [], worker, "full", { createdRosterGate, createdMainGate })
  // The initial frame can still be scheduled while setup returns, particularly on Windows.
  await setup.ready

  // Without projects, the project tree's + New action is still available above Multiplayer.
  const frame = await setup.waitForFrame((frame) => frame.includes("+ New") && frame.includes("Multiplayer"))
  expect(frame).toContain("Multiplayer")
  const add = cell(frame, "+ New")
  await setup.mockMouse.click(add.x, add.y)
  await setup.waitForFrame((frame) => frame.includes("New project") && frame.includes("Path"))

  await setup.mockInput.typeText("Created")
  await setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/project"))
  expect(calls.find((call) => call.method === "POST" && call.path === "/api/orchestra/project")?.body).toEqual({
    name: "Created",
    directory,
  })

  // The roster is deliberately blocked. Creation must request the main session before waiting on it.
  try {
    await setup.waitFor(() =>
      calls.some((call) => call.method === "POST" && call.path === `/api/orchestra/project/${createdProject.id}/main`),
    )
    releaseRoster()
    rosterReleased = true

    // Flush the render scheduled by the pending main-session request. Without this, the
    // assertion could pass on the old frame before a premature dialog close has rendered.
    await setup.renderOnce()
    // The main request is still held open. The create dialog must stay mounted until it
    // completes, otherwise its close/reset can race route navigation.
    await setup.waitForFrame((frame) => frame.includes("New project") && frame.includes("Path"), { maxPasses: 100 })
  } finally {
    if (!rosterReleased) releaseRoster()
    releaseMain()
  }

  await setup.renderOnce()
  // ProjectTree renders the project name and its main orchestrator on separate rows.
  await setup.waitForFrame((frame) => frame.includes("Created") && frame.includes("★ Orchestrator"), { maxPasses: 100 })
})

test("a new project can start with an AI team from a template", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [])

  const add = cell(await setup.waitForFrame((frame) => frame.includes("+ New")), "+ New")
  await setup.mockMouse.click(add.x, add.y)
  // the template list shows each team with its roles; "No team" is selected first
  await setup.waitForFrame((frame) => frame.includes("● No team") && frame.includes("Architect, Developer"))

  await setup.mockInput.typeText("Team")
  await setup.mockInput.pressTab()
  await setup.mockInput.pressTab()
  await setup.mockInput.pressArrow("down")
  await setup.waitForFrame((frame) => frame.includes("● Feature"))
  await setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/project"))
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Team", directory, template: "feature" })
})

test("a new project can be created as a sandbox of its repository", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [])

  const add = cell(await setup.waitForFrame((frame) => frame.includes("+ New")), "+ New")
  await setup.mockMouse.click(add.x, add.y)
  await setup.waitForFrame((frame) => frame.includes("● Regular") && frame.includes("works in the directory itself"))

  await setup.mockInput.typeText("Lab")
  await setup.mockInput.pressTab()
  await setup.mockInput.pressTab()
  await setup.mockInput.pressTab()
  await setup.mockInput.pressArrow("right")
  // The path now names the repository the sandbox is copied from.
  await setup.waitForFrame((frame) => frame.includes("● Sandbox") && frame.includes("Source"))
  await setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/project"))
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Lab", directory, isolation: "environment" })
})

test("the team is picked with the mouse and a click on a field takes the keyboard back", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [])

  const add = cell(await setup.waitForFrame((frame) => frame.includes("+ New")), "+ New")
  await setup.mockMouse.click(add.x, add.y)
  const frame = await setup.waitForFrame((frame) => frame.includes("● No team") && frame.includes("Feature"))
  const feature = cell(frame, "Feature")
  await setup.mockMouse.click(feature.x, feature.y)
  const picked = await setup.waitForFrame((frame) => frame.includes("● Feature"))

  // back in the name field by mouse: typing goes there, not to the team list
  const name = cell(picked, "Name")
  await setup.mockMouse.click(name.x + 8, name.y)
  await Bun.sleep(30)
  await setup.mockInput.typeText("Mouse")
  await setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/orchestra/project"))
  expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Mouse", directory, template: "feature" })
})

test("a session is moved to another category from the tree", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [project])

  const frame = await setup.waitForFrame((frame) => frame.includes("Build") && frame.includes("Worker task"))
  const row = frame.split("\n").findIndex((line) => line.includes("Worker task"))
  const hash = frame.split("\n")[row].indexOf("# ")
  await setup.mockMouse.click(hash, row)
  // the dialog starts from the current category
  await setup.waitForFrame((frame) => frame.includes("Session category"))
  for (const _ of "Build") await setup.mockInput.pressBackspace()
  await setup.mockInput.typeText("Quality")
  await setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.path === `/api/orchestra/category/${worker.id}`))
  expect(calls.find((call) => call.path === `/api/orchestra/category/${worker.id}`)?.body).toEqual({
    category: "Quality",
  })
  // Tree rows span the full terminal width, so their padded line also contains the right border.
  await setup.waitForFrame((frame) => frame.split("\n").some((line) => line.trimStart().startsWith("Quality")))
})

test("a long session title in the narrow compact panel stays on one row", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  const title = "Opencode++: a long breakdown of what the council of models advised"
  await using setup = await render(state.path, calls, [project], { ...worker, title }, "compact")

  // the title truncates while the status and delete controls keep their place on the same row
  const rows = (frame: string) => {
    const lines = frame.split("\n")
    const row = lines.findIndex((line) => line.includes("○ Openco"))
    return { row, title: lines[row] ?? "", next: lines[row + 1] ?? "" }
  }
  const frame = rows(
    await setup.waitForFrame(
      (frame) => /○ Openco.+advised ×/.test(rows(frame).title) && rows(frame).next.includes("+ New session"),
    ),
  )
  expect(frame.title).not.toContain("[write]")

  // hovering the row brings back the category and access controls, still on one row
  await setup.mockMouse.moveTo(frame.title.indexOf("Openco"), frame.row)
  const hovered = rows(await setup.waitForFrame((frame) => rows(frame).title.includes("[write]")))
  expect(hovered.title).toMatch(/○ Openco.+ # \[write\] ×/)
  expect(hovered.next).toContain("+ New session")
})

test("the compact layout docks both side panels beside the chat on a laptop-sized terminal", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, calls, [project], worker, "compact", { width: 140, sidebar: "auto" })

  // the project panel on the left and the session sidebar on the right share one row with the chat
  const top = (frame: string) => frame.split("\n").find((line) => line.includes("Projects")) ?? ""
  const row = top(await setup.waitForFrame((frame) => top(frame).includes("Worker task")))
  // the sidebar is the compact width, at the right edge
  expect(row.indexOf("Worker task")).toBeGreaterThanOrEqual(140 - SESSION_SIDEBAR_COMPACT_WIDTH)
})
