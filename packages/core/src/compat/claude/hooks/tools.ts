export * as ClaudeHookTools from "./tools.js"

/**
 * OpenCode tool calls as Claude hooks see them: Claude's tool name (hook matchers are written against it)
 * and Claude's input field names, plus the way back for `updatedInput`.
 */

/** OpenCode tool → Claude tool name, with the input fields that are spelled differently. */
const TABLE: Readonly<Record<string, { readonly name: string; readonly fields?: Readonly<Record<string, string>> }>> = {
  shell: { name: "Bash" },
  read: { name: "Read", fields: { path: "file_path" } },
  edit: {
    name: "Edit",
    fields: { path: "file_path", oldString: "old_string", newString: "new_string", replaceAll: "replace_all" },
  },
  write: { name: "Write", fields: { path: "file_path" } },
  glob: { name: "Glob" },
  grep: { name: "Grep", fields: { include: "glob" } },
  webfetch: { name: "WebFetch" },
  websearch: { name: "WebSearch" },
  subagent: { name: "Task", fields: { agent: "subagent_type" } },
  skill: { name: "Skill" },
}

export interface Mcp {
  /** Server namespace the tool was registered under. */
  readonly namespace: string
  /** The server's own tool name. */
  readonly name: string
}

/** The name a Claude matcher sees; MCP tools become `mcp__<server>__<tool>`, unknown tools keep their name. */
export function name(tool: string, mcp?: Mcp) {
  if (mcp) return `mcp__${mcp.namespace}__${mcp.name}`
  return TABLE[tool]?.name ?? tool
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function rename(input: unknown, fields: Readonly<Record<string, string>> | undefined) {
  if (!fields || !isRecord(input)) return input
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [fields[key] ?? key, value]))
}

export function toClaude(tool: string, input: unknown) {
  return rename(input, TABLE[tool]?.fields)
}

/** A hook's `updatedInput` in OpenCode's field names; fields the tool does not know pass through. */
export function fromClaude(tool: string, input: Record<string, unknown>) {
  const fields = TABLE[tool]?.fields
  if (!fields) return input
  return rename(input, Object.fromEntries(Object.entries(fields).map(([open, claude]) => [claude, open]))) as Record<
    string,
    unknown
  >
}
