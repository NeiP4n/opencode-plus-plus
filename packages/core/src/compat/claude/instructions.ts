export * as ClaudeInstructions from "./instructions.js"

/**
 * CLAUDE.md memory files with their `@path` imports. Imports expand recursively up to five levels; an
 * untrusted project may only import files inside the project, so a repository cannot pull `~/.ssh` into
 * the model's context.
 */

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { ClaudeContext } from "./context.js"

export const MAX_DEPTH = 5
/** Per directory level, in the order Claude reads them. */
export const PROJECT_FILES = ["CLAUDE.md", path.join(".claude", "CLAUDE.md"), "CLAUDE.local.md"] as const

export interface File {
  readonly path: string
  readonly content: string
}

/** `@path` tokens outside code: fenced blocks and inline code are skipped. */
export function imports(content: string): string[] {
  const found: string[] = []
  let fenced = false
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const text = line.replace(/`[^`]*`/g, "")
    for (const match of text.matchAll(/(?:^|\s)@((?:~|\.{1,2})?[\\/]?[^\s@`]*[\\/.][^\s`]*)/g)) {
      found.push(match[1].replace(/[),.;:!?]+$/, ""))
    }
  }
  return found
}

function inside(root: string, file: string) {
  const relative = path.relative(root, file)
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

/**
 * Loads one memory file and appends the files it imports. `skip` holds files loaded by other sources (the
 * AGENTS.md chain), so a CLAUDE.md that only says `@AGENTS.md` adds nothing twice.
 */
export const load = Effect.fn("ClaudeInstructions.load")(function* (
  file: string,
  context: ClaudeContext.Context,
  skip: ReadonlySet<string>,
) {
  const fs = yield* FSUtil.Service
  const skipped: ClaudeContext.Skipped[] = []
  const seen = new Set<string>()
  const read = Effect.fnUntraced(function* (current: string, depth: number): Effect.fn.Return<string | undefined> {
    const resolved = yield* fs.resolve(current)
    if (seen.has(resolved) || skip.has(resolved)) return undefined
    seen.add(resolved)
    const content = yield* fs.readFileStringSafe(current).pipe(Effect.orElseSucceed(() => undefined))
    if (content === undefined) return undefined
    const parts = [content.trim()]
    for (const target of imports(content)) {
      const absolute = target.startsWith("~")
        ? path.join(context.home, target.slice(1))
        : path.resolve(path.dirname(current), target)
      if (!(yield* fs.isFile(absolute))) continue
      if (depth >= MAX_DEPTH) {
        skipped.push({ source: current, reason: `import ${target} is deeper than ${MAX_DEPTH} levels` })
        continue
      }
      if (!ClaudeContext.allowed(context) && !inside(context.project, yield* fs.resolve(absolute))) {
        skipped.push({ source: current, reason: `import ${target} outside the project ${ClaudeContext.TRUST_HINT}` })
        continue
      }
      const imported = yield* read(absolute, depth + 1)
      if (imported) parts.push(`Imported from ${absolute}:\n\n${imported}`)
    }
    return parts.filter(Boolean).join("\n\n")
  })
  const content = yield* read(file, 0)
  // A file that only imported what another source already loads has nothing of its own left.
  const own = content?.replace(/(?:^|\s)@\S+/g, "").trim()
  return { file: own ? ({ path: file, content: content! } satisfies File) : undefined, skipped }
})
