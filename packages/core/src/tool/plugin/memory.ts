export * as MemoryTool from "./memory.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { optional } from "@opencode/schema/schema"
import type { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { Memory } from "../../memory/index.js"

export const name = "memory"

export const Input = Schema.Struct({
  action: Schema.Literals(["view", "append", "replace", "rewrite", "delete", "remember", "search", "forget"]).annotate({
    description:
      "view blocks; append, replace, rewrite or delete a block; remember a fact in the archive; search the archive and earlier chats; forget an archived fact",
  }),
  label: optional(
    Schema.String.annotate({ description: "Block label: 2 to 40 lowercase latin letters, digits and hyphens" }),
  ),
  scope: optional(
    Memory.Scope.annotate({
      description: "user follows the person across projects, project stays with this repository",
    }),
  ),
  text: optional(Schema.String.annotate({ description: "Text to append to a block or to remember" })),
  old: optional(Schema.String.annotate({ description: "replace: exact text currently in the block" })),
  new: optional(Schema.String.annotate({ description: "replace: text that takes its place, empty to delete it" })),
  value: optional(Schema.String.annotate({ description: "rewrite: the whole new value of the block" })),
  description: optional(Schema.String.annotate({ description: "rewrite: what belongs in the block" })),
  limit: optional(Schema.Number.annotate({ description: "rewrite: character limit of the block, 200 to 8000" })),
  tags: optional(Schema.Array(Schema.String).annotate({ description: "remember: short lowercase tags" })),
  query: optional(Schema.String.annotate({ description: "search: words to look for, any language" })),
  sessions: optional(
    Schema.Boolean.annotate({ description: "search: also search earlier chats of this project, true by default" }),
  ),
  id: optional(Schema.String.annotate({ description: "forget: id of an archived fact from search" })),
})
export type Input = typeof Input.Type

export const description = [
  "Your long-term memory, kept across chats. The blocks are already in your instructions; this tool changes them and reaches what is not shown.",
  "",
  "Blocks (always visible, each with a character limit):",
  "  append — add text to a block: label, text. The standard blocks are human (user scope) and project (project scope).",
  "  replace — change exact text inside a block: label, old, new.",
  "  rewrite — replace a whole block, or create a new one: label, value, optional description, limit and scope. Use it to condense a full block.",
  "  delete — remove a block you created: label.",
  "  view — show every block with its size.",
  "",
  "Archive (unbounded, searched on demand):",
  "  remember — store one self-contained fact: text, optional tags, scope (project by default). A near-duplicate updates the stored fact instead of adding another.",
  "  search — find facts and passages of earlier chats: query, optional scope, limit, sessions.",
  "  forget — delete an archived fact that turned out wrong: id.",
  "",
  "Save a fact the moment you learn it: a correction or preference from the user, a decision, a command that works, a pitfall you hit. Keep blocks short and current; move detail to the archive. Never store secrets, tokens or passwords.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.memory",
  effect: Effect.fn("MemoryTool.Plugin")(function* (ctx: Context) {
    const memory = yield* Memory.Service

    const run = Effect.fn("MemoryTool.run")(function* (input: Input, sessionID: Tool.Context["sessionID"]) {
      switch (input.action) {
        case "view":
          return (yield* memory.blocks()).map(show).join("\n\n")
        case "append":
          return changed(
            "Appended to",
            yield* memory.append({
              label: yield* need(input, "label"),
              text: yield* need(input, "text"),
              scope: input.scope,
            }),
          )
        case "replace":
          return changed(
            "Updated",
            yield* memory.replace({
              label: yield* need(input, "label"),
              old: yield* need(input, "old"),
              new: input.new ?? "",
              scope: input.scope,
            }),
          )
        case "rewrite":
          return changed(
            "Rewrote",
            yield* memory.rewrite({
              label: yield* need(input, "label"),
              value: input.value ?? (yield* need(input, "text")),
              description: input.description,
              limit: input.limit,
              scope: input.scope,
            }),
          )
        case "delete": {
          const block = yield* memory.drop({ label: yield* need(input, "label"), scope: input.scope })
          return `Deleted block ${block.label} (${block.scope}).`
        }
        case "remember": {
          const result = yield* memory.remember({
            text: yield* need(input, "text"),
            tags: input.tags,
            scope: input.scope,
          })
          return `${result.merged ? "Updated the matching fact" : "Remembered"} ${result.entry.id} (${result.entry.scope}).`
        }
        case "search": {
          const found = yield* memory.search({
            query: yield* need(input, "query"),
            scope: input.scope,
            limit: input.limit,
            sessions: input.sessions,
            session: sessionID,
          })
          if (found.entries.length === 0 && found.recalled.length === 0) return "Nothing found in memory."
          return [
            ...(found.entries.length === 0
              ? []
              : [
                  "Archive:",
                  ...found.entries.map(
                    (entry) =>
                      `- ${entry.id} (${entry.scope}${entry.tags.length ? `; ${entry.tags.join(", ")}` : ""}; ${day(entry.updated)}) ${entry.text}`,
                  ),
                ]),
            ...(found.recalled.length === 0
              ? []
              : [
                  "Earlier chats:",
                  ...found.recalled.map(
                    (item) => `- ${item.sessionID} "${item.title}" ${item.role}, ${day(item.time)}: ${item.text}`,
                  ),
                ]),
          ].join("\n")
        }
        case "forget": {
          const entry = yield* memory.forget({ id: yield* need(input, "id") })
          return `Forgot ${entry.id}: ${entry.text}`
        }
      }
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          execute: (input, context) =>
            run(input, context.sessionID).pipe(
              Effect.map((output) => ({ content: output })),
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: error.message }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

const need = <K extends "label" | "text" | "old" | "query" | "id">(input: Input, key: K) => {
  const value = input[key]
  return value === undefined || value === ""
    ? Effect.fail(new ToolFailure({ message: `memory ${input.action} needs ${key}` }))
    : Effect.succeed(value)
}

function show(block: Memory.Block) {
  return [
    `${block.label} (${block.scope}, ${block.value.length}/${block.limit} chars)${block.description ? ` — ${block.description}` : ""}`,
    block.value || "(empty)",
  ].join("\n")
}

function changed(verb: string, block: Memory.Block) {
  return `${verb} block ${block.label} (${block.scope}), now ${block.value.length}/${block.limit} chars:\n${block.value}`
}

function day(time: number) {
  return new Date(time).toISOString().slice(0, 10)
}
