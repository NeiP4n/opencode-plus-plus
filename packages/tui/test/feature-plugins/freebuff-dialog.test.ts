import { expect, test } from "bun:test"
import { directory, json } from "../fixture/tui-client"
import { createAppFixture } from "../fixture/app"

// Regression test for the /freebuff status dialog.
//
// The price table used to be a flex row of four <text> children without
// explicit widths. Their content was wider than the dialog, so OpenTUI shrank
// the columns, each <text> re-wrapped inside its own shrunken box (default
// wrapMode "word") and the wrapped second line of the price landed in the
// neighbouring column ("не фрибаксовхватит"). The status labels had the same
// defect: the label column was padded to a fixed 13 columns, but the russian
// "Сброс за сутки" is 14, so the value touched the label.
//
// The table is now one line of text per model with every column padded to its
// own width, so the columns cannot overlap, and the label column is as wide
// as the widest label. These assertions read the real captured frame, not the
// source.
//
// The numbers come from the live Freebuff API on 2026-10-20: 10 freebucks left
// of a daily limit of 25, 15 already spent. The price table is the account's own.
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

function createFixture(input: { width?: number; height?: number; language?: "en" | "ru" } = {}) {
  return createAppFixture({
    width: input.width ?? 80,
    height: input.height ?? 40,
    config: { animations: false, keybinds: { "model.list": "f8" }, language: input.language ?? "ru" },
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
        return json({ data: { ...session, model: { providerID: "freebuff", id: "m-096e75164d" } } })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname)) return json({ data: [], cursor: {} })
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
            prices: freebuffPrices,
          },
        })
      return undefined
    },
  })
}

type Setup = Awaited<ReturnType<typeof createFixture>>

/**
 * The renderer paints on its own schedule, so wait for the text by polling the
 * frame instead of counting render passes.
 */
async function waitForText(setup: Setup, text: string, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (frame.includes(text)) return frame
    await Bun.sleep(50)
  }
  throw new Error(`The frame never showed ${JSON.stringify(text)}`)
}

/** The price rows of the status dialog: between the "Prices" title and the action hints. */
function priceRows(frame: string) {
  const lines = frame.split("\n")
  const start = lines.findIndex((line) => line.includes("Цены") || line.includes("Prices"))
  if (start === -1) throw new Error(`The frame has no prices section`)
  const end = lines.findIndex(
    (line, index) => index > start && (line.includes("esc закрыть") || line.includes("esc close")),
  )
  if (end === -1) throw new Error(`The frame has no dialog actions`)
  return lines.slice(start, end)
}

/** Opens the /freebuff status dialog and returns the captured frame. */
async function openStatusDialog(setup: Setup, pricesTitle: string) {
  await setup.waitForFrame((frame) => frame.includes("DeepSeek V4.1 Flash 10/17"), { maxPasses: 200 })
  await setup.mockInput.typeText("/freebuff")
  setup.mockInput.pressEnter()
  return waitForText(setup, pricesTitle)
}

test("the /freebuff dialog keeps the price columns apart (russian)", async () => {
  await using setup = await createFixture({ width: 80, language: "ru" })
  await setup.ready
  const frame = await openStatusDialog(setup, "Цены")
  console.log("=== DIALOG FRAME (80 columns, russian) ===")
  console.log(frame)
  console.log("=== END DIALOG FRAME ===")
  console.log("=== PRICE ROWS ===")
  console.log(priceRows(frame).join("\n"))
  console.log("=== END PRICE ROWS ===")

  // The price and the "not enough" warning are two columns: they must not share cells.
  expect(frame).not.toMatch(/фрибакс\S*хватит/)
  // The price reads as one phrase with its warning.
  expect(frame).toMatch(/15 фрибаксов\s+·\s+не хватит/)
  // The label column is as wide as the widest label, so the value never touches it.
  expect(frame).not.toMatch(/за суткичерез/)
  expect(frame).toMatch(/Сброс за сутки\s+через/)
  // The name and the price are never cut: only the gateway model id gives up room.
  const row = priceRows(frame).find((line) => line.includes("DeepSeek V4.1 Flash Fast 10/17")) ?? ""
  expect(row).toContain("DeepSeek V4.1 Flash Fast 10/17")
  expect(row).toContain("25 фрибаксов")
  expect(row).not.toContain("10/17…")
  // Every row puts the gateway model id in the same column.
  const modelColumns = priceRows(frame)
    .filter((line) => line.includes("/"))
    .map((line) => line.lastIndexOf(line.trim().split(/\s+/).at(-1) ?? ""))
  expect(modelColumns.length).toBeGreaterThan(0)
  expect(new Set(modelColumns).size).toBe(1)
}, 120000)

test("the /freebuff dialog keeps the price list inside a short terminal", async () => {
  await using setup = await createFixture({ width: 80, height: 20, language: "ru" })
  await setup.ready
  const frame = await openStatusDialog(setup, "Цены")
  console.log("=== DIALOG FRAME (80x20, russian) ===")
  console.log(frame)
  console.log("=== END DIALOG FRAME ===")

  // The dialog fits on the screen: the action hints are still visible.
  expect(frame).toMatch(/esc закрыть/)
  // The price list scrolls instead of running past the bottom of the screen.
  const visible = priceRows(frame).filter((line) => line.includes("фрибаксов"))
  expect(visible.length).toBeGreaterThan(0)
  expect(visible.length).toBeLessThan(8)
}, 120000)

test("the /freebuff dialog keeps the price columns apart in english too", async () => {
  await using setup = await createFixture({ width: 80, language: "en" })
  await setup.ready
  const frame = await openStatusDialog(setup, "Prices")
  console.log("=== DIALOG FRAME (80 columns, english) ===")
  console.log(frame)
  console.log("=== END DIALOG FRAME ===")

  expect(frame).not.toMatch(/freebucks\S*not enough/)
  expect(frame).toMatch(/15 freebucks\s+·\s+not enough/)
  // The label column is as wide as the widest label, so the value never touches it.
  expect(frame).not.toMatch(/resetin/)
  expect(frame).toMatch(/Daily reset\s+in/)
  // The name and the price are never cut: only the gateway model id gives up room.
  const row = priceRows(frame).find((line) => line.includes("DeepSeek V4.1 Flash Fast 10/17")) ?? ""
  expect(row).toContain("DeepSeek V4.1 Flash Fast 10/17")
  expect(row).toContain("25 freebucks")
  expect(row).not.toContain("10/17…")
}, 120000)
