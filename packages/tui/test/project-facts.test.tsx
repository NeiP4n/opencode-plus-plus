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
      // Room mesh status is unrelated here; report it unavailable like a server without rooms.
      if (url.pathname === "/api/room/mesh")
        return json({ _tag: "ServiceUnavailableError", message: "rooms are off" }, { status: 503 })
      if (url.pathname.startsWith("/api/fs/read/")) {
        const path = decodeURIComponent(url.pathname.slice("/api/fs/read/".length))
        reads.push(path)
        if (path === "README.md") return new Response("# Demo\nA demo project that adds numbers.")
        return new Response(null, { status: 404 })
      }
      if (url.pathname === "/api/experimental/generate")
        return request.json().then((body: { prompt: string }) => {
          prompts.push(body.prompt)
          return json({ data: { text: "Demo — a project that adds numbers" } })
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
  expect(reads.toSorted()).toEqual(["AGENTS.md", "README.md", "package.json"])
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain("A demo project that adds numbers.")

  await click("hide")
  await setup.waitForFrame((frame) => !frame.includes("Project facts"))
})
