import { expect, test } from "bun:test"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"

test("/upgrade opens the manual update dialog and checks for a newer version", async () => {
  await using state = await tmpdir()
  let checks = 0
  let installs = 0
  const session = {
    id: `ses_${crypto.randomUUID()}`,
    projectID: "project",
    title: "Update command fixture",
    agent: "build",
    model: { providerID: "demo", id: "first" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  await using setup = await createAppFixture({
    state: state.path,
    args: { sessionID: session.id },
    updater: {
      remote: false,
      subscribe: () => () => {},
      check: async () => {
        checks++
        return { type: "available", version: "9.9.9" }
      },
      apply: async () => {
        installs++
        // the install had a local edit that clashes with the update
        return { type: "stashed" as const, files: ["packages/tui/src/util/i18n.ts"] }
      },
    },
    fetch: async (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }],
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            {
              id: "first",
              providerID: "demo",
              name: "first model",
              variants: [],
              cost: [],
              time: { released: 0 },
            },
          ],
        })
      if (url.pathname === "/api/command") return json({ location, data: [] })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (
        url.pathname.startsWith(`/api/session/${session.id}/`) &&
        ["/message", "/inbox", "/permission"].some((suffix) => url.pathname.endsWith(suffix))
      )
        return json({ data: [], cursor: {} })
      return undefined
    },
  })

  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Build · first model"))
  setup.mockInput.typeText("/upgrade")
  // Wait for slash-command autocomplete before Enter; otherwise the key can land on
  // the composer itself while the command list is still being rendered.
  await setup.waitForFrame((frame) => frame.includes("/upgrade") && frame.includes("Update Opencode++"))
  setup.mockInput.pressEnter()

  await setup.waitForFrame((frame) => frame.includes("Version 9.9.9 is available"))
  expect(checks).toBe(1)
  expect(installs).toBe(0)
  expect(setup.captureCharFrame()).toContain("Update")

  // installing says where a clashing local edit went instead of failing the update
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Update successful"))
  expect(installs).toBe(1)
  const done = setup.captureCharFrame().replace(/\s+/g, " ")
  expect(done).toContain("i18n.ts")
  expect(done).toContain("git stash pop")
})
