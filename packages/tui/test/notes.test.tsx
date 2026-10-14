import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const project = { id: "prj_demo", name: "Demo", directory, created: 0 }
const other = { id: "prj_empty", name: "Empty", directory: "/tmp/empty-project", created: 0 }
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
const now = Date.now()

type Note = {
  name: string
  frontmatter: {
    title: string
    status: "inbox" | "active" | "done" | "archived"
    tags: string[]
    length?: "brief" | "balanced" | "detailed"
    session?: string
    created: number
    updated: number
  }
  body: string
  mtime: number
}

const plan = (): Note => ({
  name: "release-plan",
  frontmatter: {
    title: "Release plan",
    status: "active",
    tags: ["release"],
    session: worker.id,
    created: now - 3_600_000,
    updated: now - 120_000,
  },
  body: "# Goals\n\nShip the notes canvas.",
  mtime: 100,
})
const ideas = (): Note => ({
  name: "ideas",
  frontmatter: {
    title: "Onboarding ideas",
    status: "inbox",
    tags: ["ux"],
    created: now,
    updated: now - 86_400_000 * 2,
  },
  body: "",
  mtime: 50,
})

type Call = { method: string; path: string; body?: unknown }

function render(
  state: string,
  input: { notes: Note[]; calls: Call[]; conflict?: () => boolean; width?: number; layout?: "compact" },
) {
  let created: (ReturnType<typeof session> & { metadata?: unknown; permissions?: unknown[] }) | undefined
  return createAppFixture({
    width: input.width ?? 150,
    height: 40,
    state,
    args: { sessionID: worker.id },
    config: { animations: false, layout: input.layout, session: { sidebar: "hide" }, debug: { devtools: true } },
    fetch: async (url, request) => {
      if (url.pathname.startsWith("/api/note")) {
        const body = request.method === "GET" ? undefined : await request.json().catch(() => undefined)
        input.calls.push({ method: request.method, path: url.pathname, body })
        if (url.pathname === "/api/note" && request.method === "POST") {
          const payload = body as { title: string; session?: string }
          const created: Note = {
            name: "new-idea",
            frontmatter: { title: payload.title, status: "inbox", tags: [], session: payload.session, created: now, updated: now },
            body: "",
            mtime: 1,
          }
          input.notes.unshift(created)
          return json({ location, data: created })
        }
        if (url.pathname === "/api/note/ideas" && request.method === "DELETE") {
          input.notes.splice(input.notes.findIndex((item) => item.name === "ideas"), 1)
          return new Response(null, { status: 204 })
        }
        if (url.pathname === "/api/note" && request.method === "GET")
          return json({ location, data: url.search.includes("empty-project") ? [] : input.notes })
        const name = url.pathname.split("/")[3]
        const note = input.notes.find((item) => item.name === name)
        if (!note) return json({ _tag: "NoteNotFoundError", name, message: "missing" }, { status: 404 })
        if (input.conflict?.())
          return json({ _tag: "NoteConflictError", name, expected: 1, actual: 2, message: "changed" }, { status: 409 })
        if (url.pathname.endsWith("/edit") && body && typeof body === "object" && "body" in body) {
          note.body = String(body.body)
          note.mtime += 1
        }
        if (request.method === "PATCH" && body && typeof body === "object" && "length" in body) {
          note.frontmatter.length = body.length as Note["frontmatter"]["length"]
          note.mtime += 1
        }
        return json({ location, data: note })
      }
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/orchestra/project") return json([project, other])
      if (url.pathname === `/api/orchestra/project/${project.id}/session`)
        return json({ data: [worker], access: { [worker.id]: "write" } })
      if (url.pathname === `/api/orchestra/project/${other.id}/session`) return json({ data: [], access: {} })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const payload = (await request.json()) as { id: string; title?: string; agent?: string }
        input.calls.push({ method: "POST", path: url.pathname, body: payload })
        created = { ...worker, id: payload.id, title: payload.title ?? "", agent: payload.agent ?? worker.agent }
        return json({ data: created })
      }
      if (created && url.pathname === `/api/session/${created.id}/agent` && request.method === "POST") {
        const payload = (await request.json()) as { agent: string }
        input.calls.push({ method: "POST", path: url.pathname, body: payload })
        created = { ...created, agent: payload.agent }
        return new Response(null, { status: 204 })
      }
      if (created && url.pathname === `/api/session/${created.id}`) {
        // The chat of a note binds itself with metadata and rights on open, so the
        // fixture has to accept the patch and echo the stored session back.
        if (request.method === "PATCH") {
          const payload = (await request.json()) as { metadata?: Record<string, unknown>; permissions?: unknown[] }
          input.calls.push({ method: "PATCH", path: url.pathname, body: payload })
          if (payload.metadata !== undefined) created = { ...created, metadata: payload.metadata }
          if (payload.permissions !== undefined) created = { ...created, permissions: payload.permissions }
          return new Response(null, { status: 204 })
        }
        return json({ data: created })
      }
      if (url.pathname === "/api/session") return json({ data: [worker], cursor: {} })
      if (url.pathname === `/api/session/${worker.id}`) return json({ data: worker })
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
  const exact = lines.findIndex((line) => line.includes(needle))
  // Terminal renderers can substitute a different glyph for a button icon.
  // Retry against the visible label so mouse tests stay portable across platforms.
  const label = needle.trim().replace(/^[^\p{L}\p{N}]+/u, "").trim()
  const y = exact >= 0 ? exact : label ? lines.findIndex((line) => line.includes(label)) : -1
  if (y < 0) throw new Error(`no ${needle} on screen:\n${frame}`)
  return { x: lines[y].indexOf(exact >= 0 ? needle : label), y }
}

async function click(setup: Awaited<ReturnType<typeof render>>, needle: string, offset = 0) {
  const target = cell(setup.captureCharFrame(), needle)
  await setup.mockMouse.click(target.x + offset, target.y)
}

test("switching from Notes back to Projects releases the hidden canvas column", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, { notes: [plan(), ideas()], calls, width: 150 })
  await setup.waitForFrame((frame) => frame.includes("Projects │ Notes") && frame.includes("Note: Release plan"))

  await click(setup, "Notes", 1)
  await setup.waitForFrame((frame) => frame.includes("Ship the notes canvas."))
  await click(setup, "Projects", 1)

  const frame = await setup.waitForFrame(
    (frame) => frame.includes("Projects │ Notes") && frame.includes("Note: Release plan") && !frame.includes("Length"),
  )
  expect(frame).not.toContain("Ship the notes canvas.")
})

test("the Notes tab lists the project's notes, filters them and shows an empty project", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, { notes: [plan(), ideas()], calls })

  // A chat bound to a note offers the way to it even in the Projects tab.
  await setup.waitForFrame((frame) => frame.includes("Projects │ Notes") && frame.includes("Note: Release plan"))

  await click(setup, "Notes", 1)
  const frame = await setup.waitForFrame(
    (frame) => frame.includes("Onboarding ideas") && frame.includes("2 notes") && frame.includes("Ship the notes"),
  )
  expect(frame).toContain("● Release plan")
  expect(frame).toContain("○ Onboarding ideas")
  expect(frame).toContain("2m")
  expect(frame).toContain("2d")
  // Notes mode of a bound chat shows the note as its document.
  expect(frame).toContain("Length")
  expect(frame).toContain("Ship the notes canvas.")

  await click(setup, "Filter by title", 1)
  await setup.mockInput.typeText("#ux")
  await setup.waitForFrame((frame) => !frame.includes("● Release plan") && frame.includes("○ Onboarding ideas"))
  await setup.mockInput.typeText("zz")
  await setup.waitForFrame((frame) => frame.includes('No notes match "#uxzz".'))

  // The project switcher shows the other project and its empty state.
  await click(setup, "▸ Demo", 2)
  await setup.waitForFrame((frame) => frame.includes("    Empty"))
  await click(setup, "    Empty", 4)
  const empty = await setup.waitForFrame((frame) => frame.includes("No notes yet."))
  expect(empty).toContain("+ New note")
  expect(empty).toContain("ask the AI")
})

test("the length control and the editor write through the note API once", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, { notes: [plan(), ideas()], calls })
  await setup.waitForFrame((frame) => frame.includes("Note: Release plan"))
  await click(setup, "Note: Release plan", 2)
  await setup.waitForFrame((frame) => frame.includes("Detailed & useful") && frame.includes("● Balanced"))

  await click(setup, "Detailed & useful", 2)
  await setup.waitFor(() => calls.some((call) => call.method === "PATCH"))
  expect(calls.find((call) => call.method === "PATCH")).toEqual({
    method: "PATCH",
    path: "/api/note/release-plan",
    body: { length: "detailed", expectedMtime: 100 },
  })
  await setup.waitForFrame((frame) => frame.includes("● Detailed & useful"))

  await click(setup, "✎ Edit", 1)
  await setup.waitForFrame((frame) => frame.includes("ctrl+s save"))
  await Bun.sleep(50)
  await setup.mockInput.typeText("Draft ")
  setup.mockInput.pressKey("s", { ctrl: true })
  await setup.waitFor(() => calls.some((call) => call.path.endsWith("/edit")))
  await setup.waitForFrame((frame) => frame.includes("Draft # Goals") || frame.includes("Draft"))
  await Bun.sleep(100)
  const edits = calls.filter((call) => call.path.endsWith("/edit"))
  expect(edits).toHaveLength(1)
  expect(edits[0].body).toEqual({ body: "Draft # Goals\n\nShip the notes canvas.", expectedMtime: 101 })
  await setup.waitForFrame((frame) => !frame.includes("ctrl+s save"))

  // Escape leaves the editor without writing.
  await click(setup, "✎ Edit", 1)
  await setup.waitForFrame((frame) => frame.includes("ctrl+s save"))
  await Bun.sleep(50)
  await setup.mockInput.typeText("discard me ")
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("ctrl+s save") && !frame.includes("discard me"))
  expect(calls.filter((call) => call.path.endsWith("/edit"))).toHaveLength(1)
})

test("a save that lost a race keeps the text and offers the latest version", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  const notes = [plan()]
  let conflict = false
  await using setup = await render(state.path, { notes, calls, conflict: () => conflict })
  await setup.waitForFrame((frame) => frame.includes("Note: Release plan"))
  await click(setup, "Note: Release plan", 2)
  await setup.waitForFrame((frame) => frame.includes("Edit"))
  await click(setup, "✎ Edit", 1)
  await setup.waitForFrame((frame) => frame.includes("ctrl+s save"))
  await Bun.sleep(50)
  await setup.mockInput.typeText("Mine ")

  conflict = true
  setup.mockInput.pressKey("s", { ctrl: true })
  const frame = await setup.waitForFrame((frame) => frame.includes("Not saved: this note changed"))
  expect(frame).toContain("Reload latest")
  expect(frame).toContain("Overwrite with mine")
  expect(frame).toContain("Mine # Goals")
})

test("a note written elsewhere updates live from note.updated", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  const notes = [plan()]
  await using setup = await render(state.path, { notes, calls })
  await setup.waitForFrame((frame) => frame.includes("Note: Release plan"))
  await click(setup, "Note: Release plan", 2)
  await setup.waitForFrame((frame) => frame.includes("Ship the notes canvas."))

  notes[0].body = "# Goals\n\nWritten by a guest through the AI."
  notes[0].mtime += 1
  setup.events.emit({
    id: "evt_note",
    created: Date.now(),
    type: "note.updated",
    location,
    data: { name: "release-plan" },
  })
  await setup.waitForFrame((frame) => frame.includes("Written by a guest through the AI."))

  // The chat toggle puts the note aside for the full chat, and the chip brings it back.
  await click(setup, "⇤ Chat", 1)
  await setup.waitForFrame((frame) => !frame.includes("Brief & useful") && frame.includes("Note: Release plan"))
})

test("a new note starts with its own bound chat, and deleting one takes two clicks", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  await using setup = await render(state.path, { notes: [plan(), ideas()], calls })
  await setup.waitForFrame((frame) => frame.includes("Projects │ Notes"))
  await click(setup, "Notes", 1)
  await setup.waitForFrame((frame) => frame.includes("Onboarding ideas"))

  const row = cell(setup.captureCharFrame(), "Onboarding ideas")
  const line = setup.captureCharFrame().split("\n")[row.y]
  await setup.mockMouse.click(line.indexOf("×", row.x), row.y)
  await setup.waitForFrame((frame) => frame.includes("delete?"))
  expect(calls.some((call) => call.method === "DELETE")).toBe(false)
  await click(setup, "delete?", 1)
  await setup.waitFor(() => calls.some((call) => call.method === "DELETE"))
  await setup.waitForFrame((frame) => !frame.includes("Onboarding ideas"))

  // Escape closes the field without creating anything.
  await click(setup, "+ New", 1)
  await setup.waitForFrame((frame) => frame.includes("Note title, enter to create"))
  await Bun.sleep(50)
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Note title, enter to create"))

  await click(setup, "+ New", 1)
  await setup.waitForFrame((frame) => frame.includes("Note title, enter to create"))
  await Bun.sleep(50)
  await setup.mockInput.typeText("New idea")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => calls.some((call) => call.method === "POST" && call.path === "/api/note"))
  const createdSession = calls.find((call) => call.method === "POST" && call.path === "/api/session")?.body as {
    id: string
    title: string
    agent: string
  }
  expect(createdSession.title).toBe("New idea")
  // A note's chat runs the Notes agent from its first prompt.
  expect(createdSession.agent).toBe("notes")
  expect(calls.find((call) => call.method === "POST" && call.path === "/api/note")?.body).toEqual({
    title: "New idea",
    session: createdSession.id,
  })
  // The new note opens as the document of its new chat.
  await setup.waitForFrame((frame) => frame.includes("This note is empty.") && frame.includes("New idea"))
})

test("a long note title gives way in a compact panel and the delete control stays readable", async () => {
  await using state = await tmpdir()
  const calls: Call[] = []
  const long = { ...ideas(), frontmatter: { ...ideas().frontmatter, title: "Opencode++ доработки по итогам совета ИИ" } }
  await using setup = await render(state.path, { notes: [plan(), long], calls, width: 140, layout: "compact" })
  await setup.waitForFrame((frame) => frame.includes("Projects │ Notes"))
  await click(setup, "Notes", 1)
  await setup.waitForFrame((frame) => frame.includes("Release plan") && frame.includes("○ Openco"))
  const row = () => setup.captureCharFrame().split("\n")[cell(setup.captureCharFrame(), "○ Openco").y]
  expect(row()).toMatch(/ 2d +× /)

  const line = row()
  await setup.mockMouse.click(line.indexOf("×"), cell(setup.captureCharFrame(), "○ Openco").y)
  await setup.waitForFrame((frame) => frame.includes("delete?"))
  expect(row()).toMatch(/ 2d +delete\? /)
  expect(calls.some((call) => call.method === "DELETE")).toBe(false)
})
