/**
 * Long-term agent memory, owned by the core rather than by a plugin.
 *
 * Two tiers, each in two scopes (`user` follows the person across projects, `project`
 * stays with the repository):
 *
 * - Blocks are small labelled texts with a character limit that the model sees in every
 *   request and edits itself (Letta's core memory). They are markdown files, so a person
 *   can read and fix them too.
 * - The archive is an unbounded list of facts searched on demand, with near-duplicates
 *   folded into the fact already stored instead of piling up.
 *
 * Search also reaches the visible text of earlier chats in the same project (recall).
 *
 * Unlike Letta, an edited block does not rewrite the system prompt: `MemoryInstructions`
 * delivers each change as a chronological update, so the cached request prefix survives.
 */
export * as Memory from "./index.js"

import { FSUtil } from "@opencode/util/fs-util"
import { Flock } from "@opencode/util/flock"
import { Global } from "@opencode/util/global"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { and, desc, eq, inArray, like, or } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import path from "path"
import { Database } from "../database/database.js"
import { Location } from "../location.js"
import { SessionMessageTable, SessionTable } from "../session/sql.js"
import { MemoryRank } from "./rank.js"

export const Scope = Schema.Literals(["user", "project"])
export type Scope = typeof Scope.Type

export interface Block {
  readonly scope: Scope
  readonly label: string
  readonly description: string
  readonly limit: number
  readonly value: string
  /** Epoch ms of the last write; 0 for a standard block nobody wrote yet. */
  readonly updated: number
}

export const Entry = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  tags: Schema.Array(Schema.String),
  created: Schema.Number,
  updated: Schema.Number,
})
export type Entry = typeof Entry.Type & { readonly scope: Scope }

export interface Recalled {
  readonly sessionID: string
  readonly title: string
  readonly role: "user" | "assistant"
  readonly text: string
  readonly time: number
}

export class MemoryError extends Schema.TaggedError<MemoryError>()("Memory.Error", {
  message: Schema.String,
}) {}

export const DEFAULT_LIMIT = 2000
export const MAX_LIMIT = 8000
const MAX_BLOCKS = 12
const FRESH = 3000
/** Folded into an existing fact at or above this token overlap. */
const DUPLICATE = 0.8

/** Always shown, even before anything is written, so the model knows where a fact belongs. */
export const STANDARD: ReadonlyArray<Pick<Block, "scope" | "label" | "description">> = [
  {
    scope: "user",
    label: "human",
    description: "Who the user is: name, language, role, preferences and how they like to work.",
  },
  {
    scope: "project",
    label: "project",
    description: "Durable facts about this project: architecture, conventions, commands, decisions and pitfalls.",
  },
]

export interface Interface {
  readonly blocks: () => Effect.Effect<ReadonlyArray<Block>, MemoryError>
  readonly append: (input: { label: string; text: string; scope?: Scope }) => Effect.Effect<Block, MemoryError>
  readonly replace: (input: {
    label: string
    old: string
    new: string
    scope?: Scope
  }) => Effect.Effect<Block, MemoryError>
  readonly rewrite: (input: {
    label: string
    value: string
    description?: string
    limit?: number
    scope?: Scope
  }) => Effect.Effect<Block, MemoryError>
  readonly drop: (input: { label: string; scope?: Scope }) => Effect.Effect<Block, MemoryError>
  readonly remember: (input: {
    text: string
    tags?: ReadonlyArray<string>
    scope?: Scope
  }) => Effect.Effect<{ entry: Entry; merged: boolean }, MemoryError>
  readonly search: (input: {
    query: string
    scope?: Scope
    limit?: number
    sessions?: boolean
  }) => Effect.Effect<{ entries: ReadonlyArray<Entry>; recalled: ReadonlyArray<Recalled> }, MemoryError>
  readonly forget: (input: { id: string }) => Effect.Effect<Entry, MemoryError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

const decodeEntry = Schema.decodeUnknownOption(Schema.fromJsonString(Entry))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const db = (yield* Database.Service).db
    const roots: Record<Scope, string> = {
      user: path.join(global.data, "memory"),
      project: path.join(location.project.directory, ".opencode", "memory"),
    }

    const fail = (message: string) => new MemoryError({ message })
    const io = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(Effect.mapError((cause) => fail(`Memory storage failed: ${String(cause)}`)))

    // Two sessions of a team can write the same scope at once; each write is a read-modify-write.
    const locked = <A>(scope: Scope, effect: Effect.Effect<A, MemoryError>) =>
      Effect.scoped(Flock.effect(`memory:${roots[scope]}`).pipe(Effect.andThen(effect)))

    const writeFile = (file: string, content: string) => {
      const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
      return io(
        fs
          .ensureDir(path.dirname(file))
          .pipe(
            Effect.andThen(fs.writeFileString(temporary, content)),
            Effect.andThen(fs.rename(temporary, file)),
            Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
          ),
      )
    }

    const blockFile = (scope: Scope, label: string) => path.join(roots[scope], "blocks", `${label}.md`)

    const readScope = Effect.fn("Memory.readScope")(function* (scope: Scope) {
      const directory = path.join(roots[scope], "blocks")
      if (!(yield* fs.existsSafe(directory))) return []
      const entries = yield* io(fs.readDirectoryEntries(directory))
      const labels = entries
        .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
        .map((entry) => entry.name.slice(0, -3))
        .filter((label) => LABEL.test(label))
        .toSorted()
      return yield* Effect.forEach(labels, (label) =>
        io(fs.readFileStringSafe(blockFile(scope, label))).pipe(
          Effect.map((content) => (content === undefined ? [] : [parseBlock(scope, label, content)])),
        ),
      ).pipe(Effect.map((found) => found.flat()))
    })

    // Every step reads the blocks, so they are cached for a few seconds of wall time. Writes through
    // this service drop the cache at once; a file edited by hand or by another process shows up
    // within FRESH. Wall time on purpose: the cache bounds disk reads, not anything the model sees.
    let cached: { blocks: ReadonlyArray<Block>; at: number } | undefined

    const blocks = Effect.fn("Memory.blocks")(function* () {
      if (cached && Date.now() - cached.at < FRESH) return cached.blocks
      const result = yield* readBlocks()
      cached = { blocks: result, at: Date.now() }
      return result
    })

    const readBlocks = Effect.fn("Memory.readBlocks")(function* () {
      const written = (yield* Effect.all([readScope("user"), readScope("project")])).flat()
      const standard = STANDARD.filter(
        (block) => !written.some((item) => item.scope === block.scope && item.label === block.label),
      ).map((block) => ({ ...block, limit: DEFAULT_LIMIT, value: "", updated: 0 }))
      return [...standard, ...written].toSorted(
        (a, b) => (a.scope === b.scope ? 0 : a.scope === "user" ? -1 : 1) || a.label.localeCompare(b.label),
      )
    })

    // An omitted scope means the block that already carries the label, preferring the project.
    const find = Effect.fn("Memory.find")(function* (label: string, scope?: Scope) {
      if (!LABEL.test(label))
        return yield* fail(`Block label must be 2 to 40 lowercase latin letters, digits and hyphens, got: ${label}`)
      const all = yield* blocks()
      const matches = all.filter((block) => block.label === label && (scope === undefined || block.scope === scope))
      const block = matches.find((item) => item.scope === "project") ?? matches[0]
      return { block, scope: block?.scope ?? scope ?? "project", count: all.filter((item) => item.updated > 0).length }
    })

    const save = Effect.fn("Memory.save")(function* (block: Block) {
      if (block.value.length > block.limit)
        return yield* fail(
          `Block "${block.label}" would hold ${block.value.length} of its ${block.limit} characters. ` +
            "Condense it with rewrite, or move details to the archive with remember and keep only the essentials here.",
        )
      yield* writeFile(blockFile(block.scope, block.label), serializeBlock(block))
      cached = undefined
      return block
    })

    const existing = Effect.fn("Memory.existing")(function* (label: string, scope?: Scope) {
      const found = yield* find(label, scope)
      if (!found.block)
        return yield* fail(`No memory block "${label}". Use rewrite to create it, or view to list the blocks.`)
      return found.block
    })

    // The lock is the scope the label resolves to, so edits of one block never interleave.
    const editing = <A>(label: string, scope: Scope | undefined, effect: Effect.Effect<A, MemoryError>) =>
      find(label, scope).pipe(Effect.flatMap((found) => locked(found.scope, effect)))

    const append: Interface["append"] = (input) =>
      editing(
        input.label,
        input.scope,
        Effect.gen(function* () {
          const block = yield* existing(input.label, input.scope)
          const text = input.text.trim()
          if (text === "") return yield* fail("Nothing to append: text is empty.")
          return yield* save({
            ...block,
            value: block.value === "" ? text : `${block.value}\n${text}`,
            updated: Date.now(),
          })
        }),
      )

    const replace: Interface["replace"] = (input) =>
      editing(
        input.label,
        input.scope,
        Effect.gen(function* () {
          const block = yield* existing(input.label, input.scope)
          if (input.old === "") return yield* fail("old must not be empty; use append to add text.")
          const count = block.value.split(input.old).length - 1
          if (count === 0)
            return yield* fail(
              `Block "${block.label}" does not contain the text to replace. Its current value:\n${block.value}`,
            )
          if (count > 1)
            return yield* fail(
              `The text occurs ${count} times in "${block.label}"; include more of it so it is unique.`,
            )
          return yield* save({
            ...block,
            value: block.value.replace(input.old, () => input.new).trim(),
            updated: Date.now(),
          })
        }),
      )

    const rewrite: Interface["rewrite"] = (input) =>
      editing(
        input.label,
        input.scope,
        Effect.gen(function* () {
          const found = yield* find(input.label, input.scope)
          if (!found.block && found.count >= MAX_BLOCKS)
            return yield* fail(`There are already ${found.count} memory blocks; reuse or drop one first.`)
          return yield* save({
            scope: found.scope,
            label: input.label,
            description: oneLine(input.description ?? found.block?.description ?? ""),
            limit: Math.min(MAX_LIMIT, Math.max(200, Math.round(input.limit ?? found.block?.limit ?? DEFAULT_LIMIT))),
            value: input.value.trim(),
            updated: Date.now(),
          })
        }),
      )

    const drop: Interface["drop"] = (input) =>
      editing(
        input.label,
        input.scope,
        Effect.gen(function* () {
          const block = yield* existing(input.label, input.scope)
          if (block.updated > 0) yield* io(fs.remove(blockFile(block.scope, block.label), { force: true }))
          cached = undefined
          return block
        }),
      )

    const archiveFile = (scope: Scope) => path.join(roots[scope], "archive.jsonl")

    const readArchive = Effect.fn("Memory.readArchive")(function* (scope: Scope) {
      const content = yield* io(fs.readFileStringSafe(archiveFile(scope)))
      if (content === undefined) return []
      return content
        .split("\n")
        .flatMap((line) => Option.toArray(decodeEntry(line)))
        .map((entry): Entry => ({ ...entry, scope }))
    })

    const writeArchive = (scope: Scope, entries: ReadonlyArray<Entry>) =>
      writeFile(
        archiveFile(scope),
        entries.map((entry) => JSON.stringify({ ...entry, scope: undefined })).join("\n") + "\n",
      )

    const remember: Interface["remember"] = (input) => {
      const scope = input.scope ?? "project"
      return locked(
        scope,
        Effect.gen(function* () {
          const text = input.text.trim()
          if (text === "") return yield* fail("Nothing to remember: text is empty.")
          const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
          const entries = yield* readArchive(scope)
          const now = Date.now()
          const twin = entries
            .map((entry) => ({ entry, score: MemoryRank.similarity(entry.text, text) }))
            .filter((item) => item.score >= DUPLICATE)
            .toSorted((a, b) => b.score - a.score)[0]?.entry
          if (twin) {
            const entry = { ...twin, text, tags: [...new Set([...twin.tags, ...tags])], updated: now }
            yield* writeArchive(
              scope,
              entries.map((item) => (item.id === twin.id ? entry : item)),
            )
            return { entry, merged: true }
          }
          const entry: Entry = {
            id: `m_${crypto.randomUUID().slice(0, 8)}`,
            text,
            tags,
            created: now,
            updated: now,
            scope,
          }
          yield* writeArchive(scope, [...entries, entry])
          return { entry, merged: false }
        }),
      )
    }

    const recall = Effect.fn("Memory.recall")(function* (query: string, limit: number) {
      const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 8)
      if (words.length === 0) return []
      const rows = yield* db
        .select({
          sessionID: SessionMessageTable.session_id,
          type: SessionMessageTable.type,
          data: SessionMessageTable.data,
          time: SessionMessageTable.time_created,
          title: SessionTable.title,
        })
        .from(SessionMessageTable)
        .innerJoin(SessionTable, eq(SessionTable.id, SessionMessageTable.session_id))
        .where(
          and(
            eq(SessionTable.project_id, location.project.id),
            inArray(SessionMessageTable.type, ["user", "assistant"]),
            or(...words.map((word) => like(SessionMessageTable.data, `%${word}%`))),
          ),
        )
        .orderBy(desc(SessionMessageTable.time_created))
        .limit(400)
        .all()
        .pipe(Effect.orElseSucceed(() => []))
      const documents = rows.flatMap((row) => {
        const text = visibleText(row.type, row.data).trim()
        if (text === "") return []
        return [
          {
            sessionID: row.sessionID,
            title: row.title ?? "",
            role: row.type === "user" ? ("user" as const) : ("assistant" as const),
            text,
            time: row.time,
            updated: row.time,
          },
        ]
      })
      return MemoryRank.rank(query, documents)
        .slice(0, limit)
        .map((item) => ({
          sessionID: item.document.sessionID,
          title: item.document.title,
          role: item.document.role,
          text: excerpt(item.document.text, query),
          time: item.document.time,
        }))
    })

    const search: Interface["search"] = (input) =>
      Effect.gen(function* () {
        const limit = Math.min(30, Math.max(1, input.limit ?? 8))
        const scopes: ReadonlyArray<Scope> = input.scope ? [input.scope] : ["project", "user"]
        const entries = (yield* Effect.forEach(scopes, readArchive)).flat()
        const recalled = input.sessions === false ? [] : yield* recall(input.query, Math.min(limit, 6))
        return {
          entries: MemoryRank.rank(input.query, entries)
            .slice(0, limit)
            .map((item) => item.document),
          recalled,
        }
      })

    const forget: Interface["forget"] = (input) =>
      Effect.gen(function* () {
        for (const scope of ["project", "user"] as const) {
          const removed = yield* locked(
            scope,
            Effect.gen(function* () {
              const entries = yield* readArchive(scope)
              const entry = entries.find((item) => item.id === input.id)
              if (!entry) return undefined
              yield* writeArchive(
                scope,
                entries.filter((item) => item.id !== input.id),
              )
              return entry
            }),
          )
          if (removed) return removed
        }
        return yield* fail(`No archived memory with id ${input.id}.`)
      })

    return Service.of({ blocks, append, replace, rewrite, drop, remember, search, forget })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, Location.node, Database.node],
})

const LABEL = /^[a-z][a-z0-9-]{1,39}$/

function parseBlock(scope: Scope, label: string, content: string): Block {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const fields = Object.fromEntries(
    (match?.[1] ?? "").split("\n").flatMap((line) => {
      const index = line.indexOf(":")
      return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim()]] : []
    }),
  )
  const standard = STANDARD.find((block) => block.scope === scope && block.label === label)
  const limit = Number(fields.limit)
  return {
    scope,
    label,
    description: fields.description || standard?.description || "",
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(MAX_LIMIT, limit) : DEFAULT_LIMIT,
    value: (match ? match[2] : content).trim(),
    updated: Number(fields.updated) || 1,
  }
}

function serializeBlock(block: Block) {
  return [
    "---",
    `description: ${oneLine(block.description)}`,
    `limit: ${block.limit}`,
    `updated: ${block.updated}`,
    "---",
    block.value,
    "",
  ].join("\n")
}

function oneLine(text: string) {
  return text.replaceAll(/\s+/g, " ").trim()
}

function visibleText(type: string, data: unknown): string {
  if (typeof data !== "object" || data === null) return ""
  if (type === "user") return "text" in data && typeof data.text === "string" ? data.text : ""
  if (!("content" in data) || !Array.isArray(data.content)) return ""
  return data.content
    .flatMap((part: unknown) =>
      typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part
        ? [String(part.text)]
        : [],
    )
    .join("\n")
}

// A window of the message around the first query word it contains.
function excerpt(text: string, query: string) {
  const flat = oneLine(text)
  if (flat.length <= 400) return flat
  const words = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []
  const lower = flat.toLowerCase()
  const at = Math.max(
    0,
    Math.min(...words.map((word) => lower.indexOf(word)).filter((index) => index >= 0), flat.length),
  )
  const start = Math.max(0, (at === flat.length ? 0 : at) - 150)
  return `${start > 0 ? "..." : ""}${flat.slice(start, start + 400)}${start + 400 < flat.length ? "..." : ""}`
}
