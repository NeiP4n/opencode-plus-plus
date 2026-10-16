export * as ClaudeMcp from "./mcp.js"

/**
 * Claude MCP servers (`.mcp.json`, `~/.claude.json`, `mcpServers` in settings) as OpenCode servers.
 * `stdio` servers become local commands; `http` and `sse` servers become remote ones.
 */

import { ClaudeContext } from "./context.js"

export type Server =
  | {
      readonly type: "local"
      readonly command: readonly string[]
      readonly environment?: Readonly<Record<string, string>>
      readonly cwd?: string
    }
  | { readonly type: "remote"; readonly url: string; readonly headers?: Readonly<Record<string, string>> }

/** Claude's `${VAR}` and `${VAR:-default}`; an unset variable without a default becomes empty. */
export function expand(value: string, env: NodeJS.ProcessEnv) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name: string, fallback?: string) => {
    const current = env[name]
    return current !== undefined && current !== "" ? current : (fallback ?? "")
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function strings(value: unknown, env: NodeJS.ProcessEnv) {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length ? Object.fromEntries(entries.map(([key, item]) => [key, expand(item, env)])) : undefined
}

export function server(name: string, value: unknown, source: string, env: NodeJS.ProcessEnv) {
  if (!isRecord(value)) return { skipped: { source, reason: `MCP server ${name} is not an object` } }
  const type = typeof value.type === "string" ? value.type : typeof value.url === "string" ? "http" : "stdio"
  if (type === "http" || type === "sse") {
    if (typeof value.url !== "string") return { skipped: { source, reason: `MCP server ${name} has no url` } }
    const headers = strings(value.headers, env)
    return { server: { type: "remote", url: expand(value.url, env), ...(headers ? { headers } : {}) } satisfies Server }
  }
  if (type !== "stdio") return { skipped: { source, reason: `MCP server ${name} has unknown type ${type}` } }
  if (typeof value.command !== "string") return { skipped: { source, reason: `MCP server ${name} has no command` } }
  const args = Array.isArray(value.args) ? value.args.filter((item): item is string => typeof item === "string") : []
  const environment = strings(value.env, env)
  return {
    server: {
      type: "local",
      command: [value.command, ...args].map((item) => expand(item, env)),
      ...(environment ? { environment } : {}),
      ...(typeof value.cwd === "string" ? { cwd: expand(value.cwd, env) } : {}),
    } satisfies Server,
  }
}

export interface Approval {
  /** `disabledMcpjsonServers` from Claude settings. */
  readonly disabled?: readonly string[]
}

/**
 * Reads a `mcpServers` map. Project `.mcp.json` servers start processes or reach out on the repository's
 * say-so, so they need trust, as they need approval in Claude Code; `disabledMcpjsonServers` still wins.
 */
export function servers(
  value: unknown,
  source: string,
  context: ClaudeContext.Context,
  approval: Approval = {},
): { servers: Record<string, Server>; skipped: ClaudeContext.Skipped[] } {
  const result: Record<string, Server> = {}
  const skipped: ClaudeContext.Skipped[] = []
  if (!isRecord(value)) return { servers: result, skipped }
  for (const [name, item] of Object.entries(value)) {
    if (approval.disabled?.includes(name)) {
      skipped.push({ source, reason: `MCP server ${name} is disabled in Claude settings` })
      continue
    }
    if (!ClaudeContext.allowed(context)) {
      skipped.push({ source, reason: `MCP server ${name} ${ClaudeContext.TRUST_HINT}` })
      continue
    }
    const converted = server(name, item, source, context.env)
    if (converted.server) result[name] = converted.server
    else skipped.push(converted.skipped)
  }
  return { servers: result, skipped }
}
