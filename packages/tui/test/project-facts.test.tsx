import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { json } from "./fixture/tui-client"

test("the Facts window learns the project from a few small files with one stateless request", async () => {
  await using state = await tmpdir()
  const reads: string[] = []
  const prompts: string[] = []
  await using setup = await createAppFixture({
    width: 150,
    height: 34,
    state: state.path,
    config: { animations: false, debug: { devtools: true } },
    fetch: (url, request) => {
      if (url.pathname === "/api/experimental/fs/write") return json({ location: { directory: "/demo" }, data: {} })
      // Room mesh status is unrelated here; report it unavailable like a server without rooms.
      if (url.pathname === "/api/room/mesh")
        return json({ _tag: "ServiceUnavailableError", message: "rooms are off" }, { status: 503 })
      if (url.pathname === "/api/fs/list")
        return json({
          location: { directory: "/demo" },
          data: [
            { path: "src", type: "directory" },
            { path: "README.md", type: "file" },
          ],
        })
      if (url.pathname.startsWith("/api/fs/read/")) {
        const path = decodeURIComponent(url.pathname.slice("/api/fs/read/".length))
        reads.push(path)
        if (path === "README.md") return new Response("# Demo\nA demo project that adds numbers.")
        return new Response(null, { status: 404 })
      }
      if (url.pathname === "/api/experimental/generate")
        return request.json().then((body: { prompt: string }) => {
          prompts.push(body.prompt)
          return json({ data: { text: "- **Demo** — a project that adds `numbers`" } })
        })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Facts") && frame.includes("Language"))

  const click = async (text: string, last = false) => {
    const lines = setup.captureCharFrame().split("\n")
    const y = last ? lines.findLastIndex((line) => line.includes(text)) : lines.findIndex((line) => line.includes(text))
    await setup.mockMouse.click(lines[y]!.indexOf(text) + 1, y)
  }

  await click("Facts", true)
  await setup.waitForFrame(
    (frame) => frame.includes("Project facts") && frame.includes("Demo — a project that adds numbers"),
  )
  // Markdown renders: the emphasis and code markers are not shown as text.
  expect(setup.captureCharFrame()).not.toContain("**Demo**")
  expect(reads).toContain("README.md")
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain("A demo project that adds numbers.")
  expect(prompts[0]).toContain("src/")

  await click("hide")
  await setup.waitForFrame((frame) => !frame.includes("Project facts"))
})

test("the Facts window says so without asking a model when the folder has nothing to learn from", async () => {
  await using state = await tmpdir()
  const prompts: string[] = []
  await using setup = await createAppFixture({
    width: 150,
    height: 34,
    state: state.path,
    config: { animations: false, debug: { devtools: true } },
    fetch: (url) => {
      if (url.pathname === "/api/experimental/fs/write") return json({ location: { directory: "/demo" }, data: {} })
      if (url.pathname === "/api/room/mesh")
        return json({ _tag: "ServiceUnavailableError", message: "rooms are off" }, { status: 503 })
      if (url.pathname === "/api/fs/list") return json({ location: { directory: "/empty" }, data: [] })
      if (url.pathname.startsWith("/api/fs/read/")) return new Response(null, { status: 404 })
      if (url.pathname === "/api/experimental/generate") {
        prompts.push(url.pathname)
        return json({ data: { text: "unused" } })
      }
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Facts") && frame.includes("Language"))
  const lines = setup.captureCharFrame().split("\n")
  const y = lines.findLastIndex((line) => line.includes("Facts"))
  await setup.mockMouse.click(lines[y]!.indexOf("Facts") + 1, y)
  await setup.waitForFrame((frame) => frame.includes("Nothing in this folder to learn from."))
  expect(prompts).toEqual([])
})

test("long facts scroll with the wheel and with a draggable scrollbar", async () => {
  await using state = await tmpdir()
  const facts = Array.from({ length: 14 }, (_, index) => `- **Fact ${index + 1}** — short note ${index + 1}`).join("\n")
  await using setup = await createAppFixture({
    width: 150,
    height: 24,
    state: state.path,
    config: { animations: false, debug: { devtools: true } },
    fetch: (url) => {
      if (url.pathname === "/api/experimental/fs/write") return json({ location: { directory: "/demo" }, data: {} })
      if (url.pathname === "/api/room/mesh")
        return json({ _tag: "ServiceUnavailableError", message: "rooms are off" }, { status: 503 })
      if (url.pathname === "/api/fs/list")
        return json({ location: { directory: "/demo" }, data: [{ path: "README.md", type: "file" }] })
      if (url.pathname.startsWith("/api/fs/read/")) return new Response("# Demo")
      if (url.pathname === "/api/experimental/generate") return json({ data: { text: facts } })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Facts") && frame.includes("Language"))
  const at = (text: string, last = false) => {
    const lines = setup.captureCharFrame().split("\n")
    const y = last ? lines.findLastIndex((line) => line.includes(text)) : lines.findIndex((line) => line.includes(text))
    return { x: lines[y]!.indexOf(text), y }
  }
  const facts1 = at("Facts", true)
  await setup.mockMouse.click(facts1.x + 1, facts1.y)
  await setup.waitForFrame((frame) => frame.includes("Fact 1 ") && !frame.includes("Fact 14"))

  const first = at("Fact 1 ")
  for (let index = 0; index < 10; index++) await setup.mockMouse.scroll(first.x, first.y + 2, "down")
  await setup.waitForFrame((frame) => frame.includes("Fact 14"))
  for (let index = 0; index < 10; index++) await setup.mockMouse.scroll(first.x, first.y + 2, "up")
  await setup.waitForFrame((frame) => frame.includes("Fact 1 ") && !frame.includes("Fact 14"))

  // The thumb is the first scrollbar cell at the window's right edge, near the top of the facts.
  const lines = setup.captureCharFrame().split("\n")
  const y = lines.findIndex((line, index) => index >= first.y - 2 && line.lastIndexOf("█") > first.x)
  const thumb = { x: lines[y]!.lastIndexOf("█"), y }
  await setup.mockMouse.drag(thumb.x, thumb.y, thumb.x, thumb.y + 12)
  await setup.waitForFrame((frame) => frame.includes("Fact 14"))
})

test("facts saved in the project are shown without asking a model, and new facts are saved there", async () => {
  await using state = await tmpdir()
  const prompts: string[] = []
  const writes: Array<{ path: string | null; body: string }> = []
  const saved = { current: "<!-- opencode-facts language=en format=3 -->\n- **Saved** — facts from the project file\n" }
  await using setup = await createAppFixture({
    width: 150,
    height: 34,
    state: state.path,
    config: { animations: false, debug: { devtools: true } },
    fetch: (url, request) => {
      if (url.pathname === "/api/room/mesh")
        return json({ _tag: "ServiceUnavailableError", message: "rooms are off" }, { status: 503 })
      if (url.pathname === "/api/fs/list")
        return json({ location: { directory: "/demo" }, data: [{ path: "README.md", type: "file" }] })
      if (url.pathname === "/api/fs/read/.opencode/facts.md") return new Response(saved.current)
      if (url.pathname.startsWith("/api/fs/read/")) return new Response("# Demo\nA demo project.")
      if (url.pathname === "/api/experimental/fs/write")
        return request.text().then((body) => {
          writes.push({ path: url.searchParams.get("path"), body })
          return json({ location: { directory: "/demo" }, data: {} })
        })
      if (url.pathname === "/api/experimental/generate")
        return request.json().then((body: { prompt: string }) => {
          prompts.push(body.prompt)
          return json({ data: { text: "- **Fresh** — newly collected facts" } })
        })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Facts") && frame.includes("Language"))
  const click = async (text: string, last = false) => {
    const lines = setup.captureCharFrame().split("\n")
    const y = last ? lines.findLastIndex((line) => line.includes(text)) : lines.findIndex((line) => line.includes(text))
    await setup.mockMouse.click(lines[y]!.indexOf(text) + 1, y)
  }

  await click("Facts", true)
  await setup.waitForFrame((frame) => frame.includes("Saved — facts from the project file"))
  expect(prompts).toEqual([])

  await click("refresh")
  await setup.waitForFrame((frame) => frame.includes("Fresh — newly collected facts"))
  await setup.waitFor(() => writes.length === 1)
  expect(prompts).toHaveLength(1)
  expect(writes[0]?.path).toBe(".opencode/facts.md")
  expect(writes[0]?.body).toBe("<!-- opencode-facts language=en format=3 -->\n- **Fresh** — newly collected facts\n")
})
