import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { Lsp } from "@opencode/core/lsp/index"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

// Needs a real language server; skipped where typescript-language-server is not installed.
const available = Bun.which("typescript-language-server") !== null

function withLsp<A, E>(directory: string, body: (lsp: Lsp.Interface) => Effect.Effect<A, E>) {
  return Effect.gen(function* () {
    return yield* body(yield* Lsp.Service)
  }).pipe(
    Effect.scoped,
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Lsp.node]), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
      ]),
    ),
  )
}

const source = `export class Store {
  private items = new Map<string, number>()

  get(key: string) {
    return this.items.get(key)
  }

  set(key: string, value: number) {
    this.items.set(key, value)
  }
}

export function total(store: Store) {
  return store.get("a") ?? 0
}
`

describe.skipIf(!available)("Lsp over typescript-language-server", () => {
  it.live(
    "outlines, finds references, renames and reports diagnostics",
    () =>
      withTempDir((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.writeFile(path.join(tmp.path, "store.ts"), source)
            await fs.writeFile(
              path.join(tmp.path, "use.ts"),
              `import { Store, total } from "./store"\nconst s = new Store()\ns.get("x")\ntotal(s)\n`,
            )
            await fs.writeFile(
              path.join(tmp.path, "tsconfig.json"),
              JSON.stringify({ compilerOptions: { target: "es2022", lib: ["es2022"], strict: true } }),
            )
          })
          yield* withLsp(tmp.path, (lsp) =>
            Effect.gen(function* () {
              const symbols = yield* lsp.symbols("store.ts")
              expect(symbols.map((symbol) => [symbol.kind, symbol.name])).toEqual([
                ["class", "Store"],
                ["function", "total"],
              ])
              const get = symbols[0]!.children.find((symbol) => symbol.name === "get")!
              expect(get.kind).toBe("method")
              expect(get.range.start.line).toBe(3)

              const references = yield* lsp.references("store.ts", get.selection.start)
              expect(references.map((item) => [path.basename(item.file), item.range.start.line]).toSorted()).toEqual([
                ["store.ts", 13],
                ["use.ts", 2],
              ])

              const edits = yield* lsp.rename("store.ts", get.selection.start, "read")
              expect(edits.map((edit) => path.basename(edit.file)).toSorted()).toEqual(["store.ts", "use.ts"])

              yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "use.ts"), `const n: number = "text"\n`))
              const diagnostics = yield* lsp.diagnostics("use.ts", 15_000)
              expect(diagnostics.some((item) => item.severity === 1)).toBe(true)
            }),
          )
        }),
      ),
    60_000,
  )

  it.live("explains a missing server instead of failing silently", () =>
    withTempDir((tmp) =>
      withLsp(tmp.path, (lsp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "a.unknownlang"), "x"))
          const error = yield* lsp.symbols("a.unknownlang").pipe(Effect.flip)
          expect(error.message).toContain('configure one under "lsp"')
        }),
      ),
    ),
  )
})
