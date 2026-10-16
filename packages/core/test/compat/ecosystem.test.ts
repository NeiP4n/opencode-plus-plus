import path from "path"
import { describe, expect, test } from "bun:test"
import { Document, Info } from "@opencode/schema/config"
import { Schema } from "effect"
import { Ecosystem } from "@opencode/core/compat/ecosystem"

const document = (input: unknown) => new Document({ type: "document", info: Schema.decodeUnknownSync(Info)(input) })

describe("Ecosystem", () => {
  test("every ecosystem is on unless someone turned it off", () => {
    expect(Ecosystem.ids.every((id) => Ecosystem.enabled(id, {}))).toBe(true)
    expect(Ecosystem.enabled("codex", { ecosystems: { codex: false } })).toBe(false)
  })

  test("the per-project choice outranks config", () => {
    expect(Ecosystem.enabled("codex", { ecosystems: { codex: false } }, { codex: true })).toBe(true)
    expect(Ecosystem.enabled("claude", { ecosystems: { claude: true } }, { claude: false })).toBe(false)
  })

  test("settings merge key by key across documents, later documents winning", () => {
    const settings = Ecosystem.settings([
      document({ compatibility: { ecosystems: { claude: false, codex: false }, order: ["codex"] } }),
      document({ compatibility: { ecosystems: { codex: true } } }),
    ])
    expect(settings).toEqual({ ecosystems: { claude: false, codex: true }, order: ["codex"] })
  })

  test("the order lists configured ecosystems first, then the rest by default priority", () => {
    expect(Ecosystem.order()).toEqual(["agents", "claude", "codex", "gemini", "cursor"])
    expect(Ecosystem.order(["codex", "claude"])).toEqual(["codex", "claude", "agents", "gemini", "cursor"])
  })

  test("Codex honors CODEX_HOME for its home folder", () => {
    expect(Ecosystem.get("codex").global("/home/u", { CODEX_HOME: "/opt/codex" })).toEqual([path.resolve("/opt/codex")])
  })
})
