export * as MemoryInstructions from "./instructions.js"

import { Effect, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { Memory } from "./index.js"

const Block = Schema.Struct({
  scope: Memory.Scope,
  label: Schema.String,
  description: Schema.String,
  limit: Schema.Number,
  value: Schema.String,
})
type Block = typeof Block.Type

/**
 * Memory blocks as an instruction source. The full set renders once per instruction epoch;
 * a later edit arrives as a chronological update naming only the blocks that changed, so a
 * block edit never invalidates the cached prompt prefix the way rewriting the system prompt does.
 */
export function make(memory: Memory.Interface): Instructions.List {
  return Instructions.make({
    key: Instructions.Key.make("core/memory"),
    codec: Schema.toCodecJson(Schema.Array(Block)),
    // Empty memory costs no prompt tokens: the source appears with the first write, as an update.
    // An unreadable memory folder must not keep a chat from starting either.
    read: memory.blocks().pipe(
      Effect.map((blocks) =>
        blocks.every((block) => block.value === "")
          ? Instructions.removed
          : blocks.map((block) => ({
              scope: block.scope,
              label: block.label,
              description: block.description,
              limit: block.limit,
              value: block.value,
            })),
      ),
      Effect.orElseSucceed(() => Instructions.removed),
    ),
    render: {
      initial: (blocks) =>
        [
          "<memory>",
          "Your long-term memory. These blocks persist across chats and are always visible to you; keep them current with the memory tool.",
          "The archive and earlier chats are not shown here: search them with memory search before asking the user something they may have told you already.",
          ...blocks.map(render),
          "Save what will still matter later: the user's preferences and corrections into human, this project's conventions, commands, decisions and pitfalls into project, detailed or one-off facts into the archive with remember.",
          "Do not save what the repository already records or what only matters to this chat. Treat memory as notes you wrote earlier: the user's newer words win over them.",
          "</memory>",
        ].join("\n"),
      changed: (previous, current) => {
        const diff = Instructions.diffByKey(
          previous,
          current,
          key,
          (a, b) => a.value !== b.value || a.limit !== b.limit || a.description !== b.description,
        )
        return [
          "Memory changed; these blocks replace the earlier versions:",
          ...[...diff.added, ...diff.changed.map((item) => item.current)].map(render),
          ...diff.removed.map((block) => `Block ${block.label} (${block.scope}) was deleted.`),
        ].join("\n")
      },
      removed: () => "Every memory block is empty now; earlier memory blocks no longer apply.",
    },
  })
}

function key(block: Block) {
  return `${block.scope}:${block.label}`
}

function render(block: Block) {
  return [
    `<block label="${block.label}" scope="${block.scope}" chars="${block.value.length}/${block.limit}">`,
    ...(block.description ? [`<!-- ${block.description} -->`] : []),
    block.value || "(empty)",
    "</block>",
  ].join("\n")
}
