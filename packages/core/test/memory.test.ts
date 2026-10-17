import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Memory } from "@opencode/core/memory/index"
import { MemoryInstructions } from "@opencode/core/memory/instructions"
import { MemoryRank } from "@opencode/core/memory/rank"
import { Instructions } from "@opencode/core/instructions/index"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

function withMemory<A, E>(directory: string, body: (memory: Memory.Interface) => Effect.Effect<A, E>) {
  const data = path.join(directory, "data")
  return Effect.gen(function* () {
    return yield* body(yield* Memory.Service)
  }).pipe(
    Effect.scoped,
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Memory.node]), [
        Location.node.replace(
          Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make(path.join(directory, "repo")) })),
          ),
        ),
        Global.node.replace(Global.layerWith({ ...Global.make(), data })),
        Database.node.replace(Database.configured({ path: path.join(directory, "memory.sqlite") })),
      ]),
    ),
  )
}

describe("Memory blocks", () => {
  it.live("shows the standard blocks before anything is written", () =>
    withTempDir((tmp) =>
      withMemory(tmp.path, (memory) =>
        Effect.gen(function* () {
          const blocks = yield* memory.blocks()
          expect(blocks.map((block) => [block.scope, block.label, block.value])).toEqual([
            ["user", "human", ""],
            ["project", "project", ""],
          ])
        }),
      ),
    ),
  )

  it.live("appends, replaces and rewrites blocks as markdown files in their scope", () =>
    withTempDir((tmp) =>
      withMemory(tmp.path, (memory) =>
        Effect.gen(function* () {
          yield* memory.append({ label: "human", text: "Пишет по-русски." })
          yield* memory.append({ label: "human", text: "Prefers short answers." })
          const replaced = yield* memory.replace({ label: "human", old: "short", new: "concise" })
          expect(replaced.value).toBe("Пишет по-русски.\nPrefers concise answers.")
          expect(replaced.scope).toBe("user")

          const created = yield* memory.rewrite({ label: "stack", value: "Bun, Effect", description: "Tech stack" })
          expect(created.scope).toBe("project")

          const file = yield* Effect.promise(() =>
            fs.readFile(path.join(tmp.path, "repo", ".opencode", "memory", "blocks", "stack.md"), "utf8"),
          )
          expect(file).toContain("description: Tech stack")
          expect(file).toContain("Bun, Effect")
          const human = yield* Effect.promise(() =>
            fs.readFile(path.join(tmp.path, "data", "memory", "blocks", "human.md"), "utf8"),
          )
          expect(human).toContain("Prefers concise answers.")
        }),
      ),
    ),
  )

  it.live("refuses to overflow a block and points at condensing", () =>
    withTempDir((tmp) =>
      withMemory(tmp.path, (memory) =>
        Effect.gen(function* () {
          yield* memory.rewrite({ label: "tiny", value: "a".repeat(150), limit: 200 })
          const error = yield* memory.append({ label: "tiny", text: "b".repeat(100) }).pipe(Effect.flip)
          expect(error.message).toContain("would hold 251 of its 200 characters")
          const missing = yield* memory.replace({ label: "tiny", old: "zzz", new: "y" }).pipe(Effect.flip)
          expect(missing.message).toContain("does not contain the text to replace")
        }),
      ),
    ),
  )

  it.live("renders block edits as updates instead of a new baseline", () =>
    withTempDir((tmp) =>
      withMemory(tmp.path, (memory) =>
        Effect.gen(function* () {
          const [source] = MemoryInstructions.make(memory)
          expect((yield* source!.read)).toBe(Instructions.removed)
          yield* memory.append({ label: "project", text: "Run tests from packages/core." })
          const before = yield* source!.read
          expect(source!.initial(before as never)).toContain('<block label="project" scope="project" chars="29/2000">')
          yield* memory.append({ label: "human", text: "Пишет по-русски." })
          const update = source!.changed(before as never, (yield* source!.read) as never)
          expect(update).toContain("Пишет по-русски.")
          expect(update).not.toContain('label="project"')
        }),
      ),
    ),
  )
})

describe("Memory archive", () => {
  it.live("remembers facts, folds near-duplicates and searches across languages", () =>
    withTempDir((tmp) =>
      withMemory(tmp.path, (memory) =>
        Effect.gen(function* () {
          const first = yield* memory.remember({ text: "Сервис opencode нельзя перезапускать во время сессий", tags: ["ops"] })
          yield* memory.remember({ text: "Tests cannot run from the repository root" })
          const twin = yield* memory.remember({ text: "Сервис opencode нельзя перезапускать во время сессий пользователя" })
          expect(twin.merged).toBe(true)
          expect(twin.entry.id).toBe(first.entry.id)

          const found = yield* memory.search({ query: "перезапуск сервиса", sessions: true })
          expect(found.entries.map((entry) => entry.id)).toEqual([first.entry.id])
          expect(found.recalled).toEqual([])

          const english = yield* memory.search({ query: "running tests", sessions: false })
          expect(english.entries[0]?.text).toBe("Tests cannot run from the repository root")

          yield* memory.forget({ id: first.entry.id })
          expect((yield* memory.search({ query: "перезапуск сервиса" })).entries).toEqual([])
        }),
      ),
    ),
  )
})

describe("MemoryRank", () => {
  test("stems Russian and English inflections onto one term", () => {
    expect(MemoryRank.tokens("сессия сессии сессию")).toEqual(["сесс", "сесс", "сесс"])
    expect(MemoryRank.tokens("sessions session")).toEqual(["session", "session"])
  })

  test("ranks a phrase match and fresher facts higher", () => {
    const now = Date.now()
    const ranked = MemoryRank.rank(
      "prompt cache",
      [
        { text: "the cache of the browser profile", updated: now },
        { text: "prompt cache misses come from plugins", updated: now - 400 * 86_400_000 },
        { text: "prompt cache misses come from plugins rewriting prompts", updated: now },
      ],
      now,
    )
    expect(ranked.map((item) => item.document.text)).toEqual([
      "prompt cache misses come from plugins rewriting prompts",
      "prompt cache misses come from plugins",
      "the cache of the browser profile",
    ])
  })
})
