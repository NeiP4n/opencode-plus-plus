export * as CompatTools from "./tools.js"

/**
 * Maps other ecosystems' tool names and permission rules onto OpenCode's. One table serves every later
 * adapter: permission rules, hook matchers, `allowed-tools` in commands, and `tools` in agents.
 *
 * Each OpenCode tool is checked under a permission action, which is not always its tool name: write and
 * patch are checked as `edit`, and reads go through `read`. Resources follow each tool: a path relative to
 * the session directory (absolute when outside it), the shell command text, the URL, the agent or skill id.
 */

import path from "path"
import type { Permission } from "@opencode/schema/permission"
import { McpTool } from "../tool/mcp.js"
import type { Ecosystem } from "./ecosystem.js"

export interface Target {
  /** OpenCode tool name, as the model sees it. */
  readonly tool: string
  /** Permission action the tool asserts. */
  readonly action: string
  /** How a rule argument becomes a resource pattern. */
  readonly argument: "command" | "path" | "url" | "pattern" | "id"
}

const shell: Target = { tool: "shell", action: "shell", argument: "command" }
const read: Target = { tool: "read", action: "read", argument: "path" }
const edit: Target = { tool: "edit", action: "edit", argument: "path" }
const write: Target = { tool: "write", action: "edit", argument: "path" }
const glob: Target = { tool: "glob", action: "glob", argument: "pattern" }
const grep: Target = { tool: "grep", action: "grep", argument: "pattern" }
const webfetch: Target = { tool: "webfetch", action: "webfetch", argument: "url" }
const websearch: Target = { tool: "websearch", action: "websearch", argument: "pattern" }
const subagent: Target = { tool: "subagent", action: "subagent", argument: "id" }
const skill: Target = { tool: "skill", action: "skill", argument: "id" }

/** Tool names per ecosystem. Names with no OpenCode counterpart (TodoWrite, ExitPlanMode, ...) are absent. */
const tables: { readonly [K in Ecosystem.ID]?: Readonly<Record<string, Target>> } = {
  claude: {
    Bash: shell,
    Read: read,
    Edit: edit,
    MultiEdit: edit,
    Write: write,
    NotebookEdit: edit,
    Glob: glob,
    Grep: grep,
    LS: read,
    WebFetch: webfetch,
    WebSearch: websearch,
    Task: subagent,
    Agent: subagent,
    Skill: skill,
  },
  codex: {
    shell: shell,
    exec_command: shell,
    apply_patch: edit,
    read_file: read,
    list_dir: read,
    grep_files: grep,
    web_search: websearch,
  },
  gemini: {
    run_shell_command: shell,
    ShellTool: shell,
    read_file: read,
    read_many_files: read,
    ReadFileTool: read,
    list_directory: read,
    write_file: write,
    WriteFileTool: write,
    replace: edit,
    EditTool: edit,
    glob: glob,
    GlobTool: glob,
    search_file_content: grep,
    GrepTool: grep,
    web_fetch: webfetch,
    WebFetchTool: webfetch,
    google_web_search: websearch,
    WebSearchTool: websearch,
  },
}

export type Resolved =
  | ({ readonly type: "tool" } & Target)
  /** An MCP tool, or with `tool` absent every tool of that server. */
  | { readonly type: "mcp"; readonly server: string; readonly tool?: string; readonly action: string }

/** Resolves a foreign tool name; `undefined` when OpenCode has no counterpart. */
export function resolve(ecosystem: Ecosystem.ID, name: string): Resolved | undefined {
  // Claude names MCP tools mcp__<server>__<tool>; `mcp__<server>` alone means the whole server.
  const mcp = /^mcp__(.+?)(?:__(.+))?$/.exec(name)
  if (mcp) {
    const [, server, tool] = mcp
    return {
      type: "mcp",
      server,
      tool,
      action: tool === undefined ? `${McpTool.namespace(server)}_*` : McpTool.name(server, tool),
    }
  }
  const target = tables[ecosystem]?.[name]
  return target ? { type: "tool", ...target } : undefined
}

export interface RuleContext {
  /** Session directory: OpenCode file resources are relative to it. */
  readonly directory: string
  /** Folder holding the settings file; Claude's `/path` patterns are relative to it. */
  readonly settings: string
  readonly home: string
}

export type Parsed =
  | { readonly type: "rules"; readonly rules: readonly Permission.Rule[] }
  | { readonly type: "unsupported"; readonly reason: string }

const slash = (value: string) => value.replaceAll("\\", "/")

/**
 * Claude path patterns: `//abs` is absolute, `~/p` is under home, `/p` is relative to the settings file, and
 * `./p` or a bare `p` is relative to the current directory. OpenCode's `*` already crosses `/`, so `**` becomes `*`.
 */
function pathPattern(pattern: string, context: RuleContext) {
  const absolute = pattern.startsWith("//")
    ? pattern.slice(1)
    : pattern.startsWith("~/")
      ? path.join(context.home, pattern.slice(2))
      : pattern.startsWith("/")
        ? path.join(context.settings, pattern.slice(1))
        : path.resolve(context.directory, pattern)
  const relative = path.relative(context.directory, absolute)
  const inside = !relative.startsWith("..") && !path.isAbsolute(relative)
  const resource = slash(inside ? relative || "." : absolute).replace(/\*\*+/g, "*")
  // `**/x` also matches `x` itself at the top, which `*/x` would not.
  return resource.startsWith("*/") ? [resource, resource.slice(2)] : [resource]
}

function resources(target: Target, argument: string, context: RuleContext): readonly string[] {
  switch (target.argument) {
    case "command":
      // Claude's legacy `npm run test:*` means "this prefix, then anything"; a trailing ` *` keeps arguments optional.
      return [argument.endsWith(":*") ? `${argument.slice(0, -2)} *` : argument]
    case "path":
      return pathPattern(argument, context)
    case "url": {
      if (!argument.startsWith("domain:")) return [argument]
      const host = argument.slice("domain:".length)
      return [`*://${host}`, `*://${host}/*`]
    }
    default:
      return [argument]
  }
}

/**
 * Parses one permission rule such as `Bash(npm run *)`, `Read(./src/**)`, `WebFetch(domain:example.com)`
 * or `mcp__github__create_issue` into OpenCode rules with the given effect.
 */
export function parseRule(
  ecosystem: Ecosystem.ID,
  rule: string,
  effect: Permission.Effect,
  context: RuleContext,
): Parsed {
  const match = /^([^()\s]+)\s*(?:\((.*)\))?$/s.exec(rule.trim())
  if (!match) return { type: "unsupported", reason: `cannot parse permission rule ${JSON.stringify(rule)}` }
  const [, name, argument] = match
  const resolved = resolve(ecosystem, name)
  if (!resolved) return { type: "unsupported", reason: `no OpenCode tool matches ${JSON.stringify(name)}` }
  if (resolved.type === "mcp") {
    if (argument !== undefined)
      return { type: "unsupported", reason: `MCP rule ${JSON.stringify(rule)} takes no argument` }
    return { type: "rules", rules: [{ action: resolved.action, resource: "*", effect }] }
  }
  const patterns =
    argument === undefined || argument.trim() === "" ? ["*"] : resources(resolved, argument.trim(), context)
  return { type: "rules", rules: patterns.map((resource) => ({ action: resolved.action, resource, effect })) }
}
