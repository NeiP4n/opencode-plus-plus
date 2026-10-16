export * as ClaudeAgents from "./agents.js"

/** `.claude/agents/*.md` subagents as OpenCode subagents. */

import path from "path"
import type { Permission } from "@opencode/schema/permission"
import { ConfigMarkdown } from "../../config/markdown.js"
import { CompatTools } from "../tools.js"
import { ClaudeModel } from "./model.js"
import { ClaudeContext } from "./context.js"

export interface Agent {
  readonly description?: string
  readonly system: string
  readonly mode: "subagent"
  readonly color?: string
  readonly model?: string
  readonly permissions?: readonly Permission.Rule[]
}

/** Claude's named agent colors; OpenCode takes hex. */
const COLORS: Readonly<Record<string, string>> = {
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#ffc53d",
  green: "#30a46c",
  cyan: "#05a2c2",
  blue: "#0090ff",
  purple: "#8e4ec6",
  pink: "#d6409f",
}

function list(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  return undefined
}

/**
 * A `tools` list is an allowlist: deny everything, then allow each listed tool. Agent rules only narrow what
 * the agent may do, so they need no trust.
 */
function permissions(tools: readonly string[], source: string, skipped: ClaudeContext.Skipped[]) {
  const allowed = new Set<string>()
  for (const tool of tools) {
    const resolved = CompatTools.resolve("claude", tool)
    if (resolved) allowed.add(resolved.action)
    else skipped.push({ source, reason: `tool ${JSON.stringify(tool)} has no OpenCode counterpart` })
  }
  return [
    { action: "*", resource: "*", effect: "deny" as const },
    ...Array.from(allowed, (action) => ({ action, resource: "*", effect: "allow" as const })),
  ]
}

export function convert(file: { readonly path: string; readonly content: string }) {
  const skipped: ClaudeContext.Skipped[] = []
  const markdown = ConfigMarkdown.parseOption(file.content)
  if (!markdown) return { skipped: [{ source: file.path, reason: "frontmatter does not parse" }] }
  const data = markdown.data as Record<string, unknown>
  const id = typeof data.name === "string" && data.name.trim() ? data.name.trim() : path.basename(file.path, ".md")
  const system = markdown.content.trim()
  if (!system) return { skipped: [{ source: file.path, reason: "agent has no system prompt" }] }
  const model = ClaudeModel.resolve(data.model)
  if (model.type === "unsupported") skipped.push({ source: file.path, reason: model.reason })
  const color =
    typeof data.color === "string"
      ? (COLORS[data.color.toLowerCase()] ?? (/^#[0-9a-f]{6}$/i.test(data.color) ? data.color : undefined))
      : undefined
  const tools = list(data.tools)
  const agent: Agent = {
    system,
    mode: "subagent",
    ...(typeof data.description === "string" ? { description: data.description } : {}),
    ...(color ? { color } : {}),
    ...(model.type === "model" ? { model: model.model } : {}),
    ...(tools ? { permissions: permissions(tools, file.path, skipped) } : {}),
  }
  return { id, agent, skipped }
}
