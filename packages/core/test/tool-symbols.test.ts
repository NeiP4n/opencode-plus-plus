import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FileAccess } from "@opencode/core/file-access"
import { FileMutation } from "@opencode/core/file-mutation"
import { Formatter } from "@opencode/core/formatter"
import { Location } from "@opencode/core/location"
import { Lsp } from "@opencode/core/lsp/index"
import { Permission } from "@opencode/core/permission"
import { Plot } from "@opencode/core/plot"
import { Ripgrep } from "@opencode/core/ripgrep"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { SymbolsTool } from "@opencode/core/tool/plugin/symbols"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity, type ToolExecution } from "./lib/tool"

const available = Bun.which("typescript-language-server") !== null && Bun.which("rg") !== null

const symbolsToolNode = makeLocationNode({
  name: "test/symbols-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(SymbolsTool.Plugin)),
  deps: [
    Tool.node,
    Lsp.node,
    Ripgrep.node,
    Location.node,
    FileAccess.node,
    FileMutation.node,
    Formatter.node,
    Permission.node,
    Plot.node,
  ],
})

const sessionID = Session.ID.make("ses_symbols_tool_test")

const run = (registry: Tool.Interface, input: Record<string, unknown>) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call", id: `call-${String(input.action)}`, name: "symbols", input },
  })

const text = (result: ToolExecution) =>
  result.status === "completed"
    ? (result.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("")
    : `ERROR ${result.error?.message}`

const source = `export class Store {
  private items = new Map<string, number>()

  get(key: string) {
    return this.items.get(key)
  }
}

export function total(store: Store) {
  return store.get("a") ?? 0
}
`

describe.skipIf(!available)("symbols tool", () => {
  it.live(
    "finds, references and edits declarations by name path",
    () =>
      withTempDir((tmp) =>
        Effect.gen(function* () {
          const asserted: Permission.AssertInput[] = []
          yield* Effect.promise(async () => {
            await fs.writeFile(path.join(tmp.path, "store.ts"), source)
            await fs.writeFile(
              path.join(tmp.path, "tsconfig.json"),
              JSON.stringify({ compilerOptions: { target: "es2022", lib: ["es2022"], strict: true } }),
            )
          })
          yield* Effect.gen(function* () {
            const registry = yield* Tool.Service

            expect(text(yield* run(registry, { action: "overview", path: "store.ts", depth: 2 }))).toBe(
              [
                "store.ts:",
                "  class Store (1-7)",
                "    property items (2)",
                "    method get (4-6)",
                "  function total (9-11)",
              ].join("\n"),
            )
            expect(text(yield* run(registry, { action: "find", name_path: "Store/get" }))).toBe(
              "store.ts:4-6 method Store/get",
            )
            expect(text(yield* run(registry, { action: "references", path: "store.ts", name_path: "Store/get" }))).toBe(
              ["1 references to Store/get:", "store.ts:", '  10 in total: return store.get("a") ?? 0'].join("\n"),
            )

            const replaced = text(
              yield* run(registry, {
                action: "replace",
                path: "store.ts",
                name_path: "Store/get",
                body: "  get(key: string): number {\n    return this.items.get(key) ?? 0\n  }",
              }),
            )
            expect(replaced).toBe("Replaced Store/get in store.ts. No errors reported by the language server.")
            const inserted = text(
              yield* run(registry, {
                action: "insert_after",
                path: "store.ts",
                name_path: "Store/get",
                body: "  has(key: string) {\n    return this.items.has(key)\n  }",
              }),
            )
            expect(inserted).toContain("Inserted after Store/get")
            const broken = text(
              yield* run(registry, {
                action: "insert_before",
                path: "store.ts",
                name_path: "/total",
                body: "const n: number = 'x'",
              }),
            )
            expect(broken).toContain("store.ts:13: Type 'string' is not assignable to type 'number'.")
          }).pipe(
            Effect.provide(
              AppNodeBuilder.build(LayerNode.group([Tool.node, symbolsToolNode]), [
                Location.node.replace(
                  Layer.succeed(
                    Location.Service,
                    Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
                  ),
                ),
                Permission.node.replace(
                  permissionLayer({ assert: (input) => Effect.sync(() => void asserted.push(input)) }),
                ),
              ]),
            ),
          )
          expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "store.ts"), "utf8"))).toBe(
            [
              "export class Store {",
              "  private items = new Map<string, number>()",
              "",
              "  get(key: string): number {",
              "    return this.items.get(key) ?? 0",
              "  }",
              "",
              "  has(key: string) {",
              "    return this.items.has(key)",
              "  }",
              "}",
              "",
              "const n: number = 'x'",
              "",
              "export function total(store: Store) {",
              '  return store.get("a") ?? 0',
              "}",
              "",
            ].join("\n"),
          )
          expect(asserted.map((input) => [input.action, input.resources])).toEqual([
            ["edit", ["store.ts"]],
            ["edit", ["store.ts"]],
            ["edit", ["store.ts"]],
          ])
        }),
      ),
    60_000,
  )
})
