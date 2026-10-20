import { expect, test } from "bun:test"
import { directory, json } from "../fixture/tui-client"
import { createAppFixture } from "../fixture/app"

// The numbers the live Freebuff API answered with on 2026-10-20: 10 freebucks left of a
// daily limit of 25, 15 already spent, and the prices the account's own price table
// lists for its catalog rows. Nothing here is invented.
const balance = 10
const spent = 15
const limit = 25
const resetIn = 8 * 60 * 60 * 1000 + 46 * 60 * 1000
const sessionEndsIn = 42 * 60 * 1000

const freebuffPrices = [
  { key: "m-00032eaeec", name: "MiMo v2.6 Flash Fast", price: 10, modelID: "mimo/mimo-v2.5", access: "open" },
  {
    key: "m-096e75164d",
    name: "DeepSeek V4.1 Flash 10/17",
    price: 15,
    modelID: "deepseek/deepseek-v4-flash",
    access: "open",
  },
  {
    key: "m-127314bb39",
    name: "DeepSeek V4.1 Flash Fast 10/17",
    price: 25,
    modelID: "deepseek/deepseek-v4-flash-fast",
    access: "open",
  },
  { key: "m-b2a427415d", name: "MiniMax M3.1 Flash", price: 0, modelID: "fbc/minimax-m3.1-flash", access: "open" },
  { key: "m-61c26317cc", name: "MiMo v2.6 Flash Slow", price: 5, modelID: "fbc/mimo-slow", access: "open" },
  { key: "m-02244092cb", name: "Glyph Cluster", price: 0, modelID: "fbc/glyph-cluster", access: "open" },
  {
    key: "m-ddc687c50f",
    name: "Nemotron 3.5 Lightning",
    price: 0,
    modelID: "fbc/nemotron-3.5-lightning",
    access: "open",
  },
  { key: "m-7e20df6765", name: "GLM 5.3 Flash", price: 20, modelID: "z-ai/glm-5.3-flash", access: "open" },
]

const freebuffModels = freebuffPrices.map((entry) => ({
  id: entry.key,
  modelID: `fbm1.${entry.key}`,
  providerID: "freebuff",
  name: entry.name,
  variants: [],
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  status: "active",
  enabled: true,
  limit: { context: 400_000, output: 32_000 },
  capabilities: { text: true, reasoning: false, vision: false, toolCall: true, embed: false },
  time: { released: 0 },
}))

const demoModel = {
  id: "first",
  modelID: "first",
  providerID: "demo",
  name: "Demo model",
  variants: [],
  cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
  status: "active",
  enabled: true,
  limit: { context: 200_000, output: 32_000 },
  capabilities: { text: true, reasoning: false, vision: false, toolCall: true, embed: false },
  time: { released: 0 },
}

const location = { directory, project: { id: "project", directory, canonical: directory } }

const session = {
  id: `ses_${crypto.randomUUID()}`,
  projectID: "project",
  title: "Model fixture",
  agent: "build",
  model: { providerID: "freebuff", id: "m-096e75164d" },
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

/**
 * The Freebuff plugin's own status RPC, answered from the account's price table. The
 * `prices` field is what the picker reads to label a model with its freebucks price;
 * `prices: null` answers the RPC without it.
 */
function createFixture(
  input: { prices?: typeof freebuffPrices | null; model?: { providerID: string; id: string } } = {},
) {
  const prices = input.prices === null ? undefined : (input.prices ?? freebuffPrices)
  return createAppFixture({
    width: 200,
    height: 40,
    config: { animations: false, keybinds: { "model.list": "f8" } },
    args: { sessionID: session.id },
    fetch: async (url) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: ["build", "plan"].map((id) => ({ id, mode: "primary", hidden: false, permissions: [] })),
        })
      if (url.pathname === "/api/provider")
        return json({
          location,
          data: [
            { id: "freebuff", name: "Freebuff" },
            { id: "demo", name: "Demo" },
          ],
        })
      if (url.pathname === "/api/model") return json({ location, data: [...freebuffModels, demoModel] })
      // A connected account: the picker groups by provider, so the provider name is the
      // category a search matches against.
      if (url.pathname === "/api/integration")
        return json({
          location,
          data: [
            {
              id: "opencode",
              name: "OpenCode",
              methods: [],
              connections: [{ type: "credential", method: "api" }],
            },
          ],
        })
      if (url.pathname === `/api/session/${session.id}`)
        return json({ data: { ...session, ...(input.model ? { model: input.model } : {}) } })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname === "/api/orchestra/group") return json([])
      if (url.pathname === "/api/room/mesh")
        return json({
          nodeID: "node_test",
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
      if (url.pathname === "/api/rpc/opencode.freebuff/status")
        return json({
          output: {
            loggedIn: true,
            balance,
            spent,
            limit,
            resetIn,
            sessionEndsIn,
            tier: "limited",
            ...(prices ? { prices } : {}),
          },
        })
      return undefined
    },
  })
}

/** The option rows of the model picker: between its title and its action hints. */
function pickerRows(frame: string) {
  const lines = frame.split("\n")
  const start = lines.findIndex((line) => line.includes("Select model"))
  if (start === -1) throw new Error(`Frame has no model picker:\n${frame}`)
  const end = lines.findIndex((line, index) => index > start && line.includes("ctrl+a"))
  if (end === -1) throw new Error(`Frame has no model picker actions:\n${frame}`)
  return lines.slice(start, end)
}

/** The Freebuff strip in the prompt footer. */
function freebuffStrip(frame: string) {
  const line = frame.split("\n").find((item) => item.includes("Freebuff limited"))
  if (!line) throw new Error(`Frame has no Freebuff strip:\n${frame}`)
  return line
}

test("the model picker shows a Freebuff price in freebucks, the balance left and what is out of reach", async () => {
  await using setup = await createFixture()
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("DeepSeek V4.1 Flash 10/17"))
  setup.mockInput.pressKey("F8")
  await setup.waitForFrame((frame) => frame.includes("Select model"))
  const frame = await setup.waitForFrame((frame) => frame.includes("15 freebucks"))
  const rows = pickerRows(frame)

  // A price the balance covers, with the balance left.
  expect(rows.join("\n")).toContain("10 freebucks · 10 left")
  // Prices above the balance: marked as out of reach, listed, and not disabled.
  expect(rows.join("\n")).toContain("15 freebucks · not enough (10 left)")
  expect(rows.join("\n")).toContain("25 freebucks · not enough (10 left)")
  expect(rows.join("\n")).toContain("20 freebucks · not enough (10 left)")
  // A price of zero is a price of zero.
  expect(rows.join("\n")).toContain("0 freebucks · 10 left")
  expect(rows.join("\n")).toContain("5 freebucks · 10 left")

  // Another provider keeps its own label and never mentions freebucks.
  const demo = rows.find((row) => row.includes("Demo model"))
  expect(demo).toBeDefined()
  expect(demo).toContain("Free")
  expect(demo).not.toContain("freebucks")

  // No Freebuff row carries the "Free" badge the picker used to show for a zero token cost.
  const freebuffRows = rows.filter((row) => row.includes("freebucks"))
  expect(freebuffRows.length).toBe(freebuffPrices.length)
  for (const row of freebuffRows) expect(row).not.toMatch(/\bFree\b/)
}, 30000)

test("the model picker keeps the provider and the price while searching", async () => {
  await using setup = await createFixture()
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("DeepSeek V4.1 Flash 10/17"))
  setup.mockInput.pressKey("F8")
  await setup.waitForFrame((frame) => frame.includes("Select model"))
  await setup.waitForFrame((frame) => frame.includes("15 freebucks"))
  await setup.mockInput.typeText("freebuff")
  const frame = await setup.waitForFrame((frame) => frame.includes("Freebuff ·"))
  const rows = pickerRows(frame)

  // While searching, the right column carries the provider and the price together.
  expect(rows.join("\n")).toContain("Freebuff · 10 freebucks · 10 left")
  expect(rows.join("\n")).toContain("Freebuff · 15 freebucks · not enough (10 left)")
  expect(rows.join("\n")).toContain("Freebuff · 0 freebucks · 10 left")
  // Only the Freebuff rows match the search, and none of them wears a "Free" badge.
  expect(rows.find((row) => row.includes("Demo model"))).toBeUndefined()
  for (const row of rows.filter((row) => row.includes("freebucks"))) expect(row).not.toMatch(/\bFree\b/)
}, 30000)

test("the prompt footer strip shows the Freebuff balance and no Free badge", async () => {
  await using setup = await createFixture()
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("DeepSeek V4.1 Flash 10/17"))
  const frame = await setup.waitForFrame((frame) => frame.includes("10 freebucks"))
  const strip = freebuffStrip(frame)
  expect(strip).toContain("DeepSeek V4.1 Flash 10/17")
  expect(strip).toContain("10 freebucks")
  expect(strip).toContain("15/25")
  expect(strip).toContain("reset in")
  // "Freebuff" is the provider label; the "Free" badge is a word of its own.
  expect(strip).not.toMatch(/\bFree\b/)
}, 30000)

test("the prompt footer strip stays away when the selected model is not a Freebuff one", async () => {
  await using setup = await createFixture({ model: { providerID: "demo", id: "first" } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo model"))
  await setup.renderOnce()
  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("freebucks")
  expect(frame).not.toContain("Freebuff")
}, 30000)
