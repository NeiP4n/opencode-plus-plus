export * as ClaudeCommands from "./commands.js"

/**
 * `.claude/commands/**\/*.md` as OpenCode commands. The template syntax already matches: `$ARGUMENTS`,
 * `$1`..`$9` and `` !`cmd` `` work the same way, so the body is the template.
 */

import path from "path"
import { ConfigMarkdown } from "../../config/markdown.js"
import { ClaudeModel } from "./model.js"
import { ClaudeContext } from "./context.js"

export interface File {
  /** Absolute path of the Markdown file. */
  readonly path: string
  readonly content: string
}

export interface Command {
  readonly template: string
  readonly description?: string
  readonly model?: string
}

const SHELL = /!`([^`]+)`/g

/** The command name OpenCode uses for its own command folders: the path under `commands/` without `.md`. */
export function name(commands: string, file: string) {
  return path.relative(commands, file).replaceAll("\\", "/").replace(/\.md$/, "")
}

export function convert(file: File, commands: string, context: ClaudeContext.Context) {
  const skipped: ClaudeContext.Skipped[] = []
  const markdown = ConfigMarkdown.parseOption(file.content)
  if (!markdown) return { skipped: [{ source: file.path, reason: "frontmatter does not parse" }] }
  const data = markdown.data as Record<string, unknown>
  let template = markdown.content.trim()
  // Shell interpolation runs while the command expands, so an untrusted project must not get it.
  if (!ClaudeContext.allowed(context) && template.search(SHELL) !== -1) {
    template = template.replace(SHELL, "[shell output disabled: `opencode compat trust claude` enables it]")
    skipped.push({ source: file.path, reason: `shell interpolation ${ClaudeContext.TRUST_HINT}` })
  }
  // `argument-hint: [message]` is usually unquoted, so YAML reads it as a list.
  const raw = data["argument-hint"]
  const hint = typeof raw === "string" ? raw : Array.isArray(raw) ? `[${raw.join(", ")}]` : undefined
  const description = [
    typeof data.description === "string" ? data.description : undefined,
    hint && (hint.startsWith("[") ? hint : `(${hint})`),
  ]
    .filter(Boolean)
    .join(" ")
  const model = ClaudeModel.resolve(data.model)
  if (model.type === "unsupported") skipped.push({ source: file.path, reason: model.reason })
  if (data["allowed-tools"] !== undefined)
    skipped.push({
      source: file.path,
      reason: "allowed-tools has no per-command equivalent yet; normal permissions apply",
    })
  const command: Command = {
    template,
    ...(description ? { description } : {}),
    ...(model.type === "model" ? { model: model.model } : {}),
  }
  return { name: name(commands, file.path), command, skipped }
}
