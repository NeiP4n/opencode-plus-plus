export * as RoomRules from "./room-rules.js"

import { Schema } from "effect"

// What the host decides for everyone in a room, the host's own AI included. These are rules
// about data and commands, not roles: a role says who may do what, a rule says what nobody may.
// The host enforces them; a guest's client cannot switch one off.
export const Rules = Schema.Struct({
  // Guests and their AIs never see the project's path on the host.
  hidePaths: Schema.Boolean.pipe(Schema.optional),
  // Programs in this list require host approval before a non-Trusted member can use them.
  // Kept as blockCommands for backwards compatibility with rooms already saved on disk.
  blockCommands: Schema.Array(Schema.String).pipe(Schema.optional),
  // Files the room's AI may not read or edit (patterns such as `.env*` or `secrets/*`).
  protectedFiles: Schema.Array(Schema.String).pipe(Schema.optional),
  // The room's AI cannot make network requests, use connected services, or message other computers/projects.
  noOutbound: Schema.Boolean.pipe(Schema.optional),
  // Other room members do not see shell/tool execution events, raw tool inputs or tool output.
  hideCommandExecution: Schema.Boolean.pipe(Schema.optional),
  // Hide image attachments and images returned by tools from other room members.
  hideScreenshots: Schema.Boolean.pipe(Schema.optional),
}).annotate({ identifier: "Room.Rules" })
export interface Rules extends Schema.Schema.Type<typeof Rules> {}

// A session can sit in several rooms; every room's rules apply, so the strictest wins.
export function merge(all: ReadonlyArray<Rules | undefined>): Rules | undefined {
  const rules = all.filter((item): item is Rules => item !== undefined)
  if (rules.length === 0) return undefined
  return {
    hidePaths: rules.some((item) => item.hidePaths),
    noOutbound: rules.some((item) => item.noOutbound),
    hideCommandExecution: rules.some((item) => item.hideCommandExecution),
    hideScreenshots: rules.some((item) => item.hideScreenshots),
    blockCommands: [...new Set(rules.flatMap((item) => item.blockCommands ?? []))],
    protectedFiles: [...new Set(rules.flatMap((item) => item.protectedFiles ?? []))],
  }
}

// Permission actions and connected-service tools that can open a network connection or send data out.
export const outbound: readonly string[] = ["webfetch", "websearch", "peers", "federation"]

export function outboundAction(action: string) {
  const value = action.toLowerCase()
  return outbound.includes(value) || /(?:web|http|fetch|browser|peer|federation|mcp|integration|connector|api|github|gitlab|slack|discord|telegram|whatsapp|email|gmail|outlook|mail|message|send|publish|upload|request|network|remote|external|dropbox|drive|notion|linear|jira|salesforce|shopify|calendar|cloud|account)/.test(value)
}

// Credential files are protected in every shared room by default, even when the host has not
// added them to the custom list. Explicit room rules can add further patterns, not weaken this set.
const SECRET_FILE_PATTERNS: readonly string[] = [
  ".env*",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.azure/**",
  "**/.config/gcloud/**",
  "**/.config/gh/**",
  "**/.git-credentials",
  "**/.netrc",
  "**/.npmrc",
  "**/.pypirc",
  "**/*credentials*.json",
  "**/*service-account*.json",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.keystore",
  "**/id_rsa*",
  "**/id_ed25519*",
]

// A glob where `*` is any text and `?` one character, case-insensitive.
function glob(pattern: string, before: string, after = "") {
  const body = pattern
    .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".")
  return new RegExp(before + body + after, "i")
}

// The parts of a command line that each start a command.
function segments(command: string) {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function matchesCommand(pattern: string, command: string) {
  const start = glob(pattern, "^")
  if (segments(command).some((part) => start.test(part))) return true
  // Retain the old matching behavior for rules such as "rm -rf" wrapped by "bash -c".
  return !pattern.includes("*") && command.toLowerCase().includes(pattern.toLowerCase())
}

// Extract the executable name rather than the full command: "git push" means approval to use
// git, not approval for that exact invocation. Wrapper prefixes and assignments are ignored.
export function programName(command: string): string | undefined {
  const tokens = command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g) ?? []
  const wrappers = new Set(["sudo", "doas", "command", "builtin", "nohup", "time", "nice", "stdbuf", "env", "exec"])
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index].replace(/^['"]|['"]$/g, "")
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index++
      continue
    }
    const base = token.split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat|ps1|com)$/i, "").toLowerCase()
    if (base && wrappers.has(base)) {
      index++
      continue
    }
    return base || undefined
  }
  return undefined
}

// Returns each configured program whose use needs explicit approval. The approval is later stored
// on the individual room member, never as a shared/global permission rule.
export function programsRequiringApproval(rules: Rules | undefined, command: string): string[] {
  return [...new Set((rules?.blockCommands ?? []).flatMap((raw) => {
    const pattern = raw.trim()
    if (!pattern || !matchesCommand(pattern, command)) return []
    const first = pattern.split(/\s+/)[0] ?? ""
    const source = /[*?]/.test(first) ? (segments(command).find((part) => matchesCommand(pattern, part)) ?? command) : first
    const program = programName(source)
    return program ? [program] : []
  }))]
}

// Compatibility helper for callers that still need to inspect a matching rule. A match now
// means "ask permission to use this program", not "refuse to execute the command".
export function blockedCommand(rules: Rules | undefined, command: string) {
  return (rules?.blockCommands ?? []).find((raw) => raw.trim() && matchesCommand(raw.trim(), command))
}

export function protectedFile(rules: Rules | undefined, file: string) {
  const normal = file.replaceAll("\\", "/")
  return [...SECRET_FILE_PATTERNS, ...(rules?.protectedFiles ?? [])].find((raw) => {
    const pattern = raw.trim()
    return pattern !== "" && glob(pattern.replaceAll("\\", "/"), "(^|/)", "$").test(normal)
  })
}

// Also guard file paths passed as shell arguments (including quoted paths and --option=path).
export function commandTouchesProtectedFile(rules: Rules | undefined, command: string) {
  const normal = command.replaceAll("\\", "/")
  return (rules?.protectedFiles ?? []).some((raw) => {
    const pattern = raw.trim().replaceAll("\\", "/")
    if (!pattern) return false
    // Check path-like substrings too: a filename can be embedded inside a quoted script
    // argument (for example python -c 'open(".env").read()').
    return glob(pattern, "(^|/)").test(normal) || (!pattern.includes("/") && glob(pattern, "").test(normal))
  })
}

// Best-effort command-level outbound guard for shells that can bypass the AI's web/peer tools.
// This is a policy check, not an OS-level network sandbox.
export function commandSendsOutbound(command: string) {
  const value = command.toLowerCase()
  return (
    /\b(curl|wget|fetch|ssh|scp|sftp|rsync|ftp|nc|netcat|ncat|socat|telnet|tftp)\b/.test(value) ||
    /\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b/.test(value) ||
    /\bgit\s+(push|fetch|pull|clone|ls-remote|submodule\s+update)\b/.test(value) ||
    /\b(npm|pnpm|yarn|bun)\s+(install|add|publish|update|upgrade|i)\b/.test(value) ||
    /\bpip\s+install\b/.test(value) ||
    /\bdocker\s+(pull|push|login)\b/.test(value) ||
    /\bhttps?:\/\//.test(value)
  )
}

// Whether a log event contains command/tool execution details that should stay host-side.
export function hideExecutionEvent(rules: Rules | undefined, event: unknown) {
  if (!rules?.hideCommandExecution || event === null || typeof event !== "object" || !("type" in event)) return false
  const type = (event as { type?: unknown }).type
  return typeof type === "string" &&
    (type.startsWith("session.shell.") ||
      type.startsWith("session.tool.") ||
      type.startsWith("session.execution.") ||
      type.startsWith("session.step."))
}

// Suppress the room's public activity-feed entries that reveal a command and who ran it.
export function hideExecutionFeed(rules: Rules | undefined, value: unknown) {
  if (!rules?.hideCommandExecution || value === null || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  if (Array.isArray(record.events)) {
    return { ...record, events: record.events.filter((item) =>
      !(item && typeof item === "object" && "kind" in item && (item as { kind?: unknown }).kind === "run"),
    ) }
  }
  if (Array.isArray(value)) {
    return value.filter((item) => !(item && typeof item === "object" && "kind" in item && (item as { kind?: unknown }).kind === "run"))
  }
  return value
}

// Redact image/screenshot payloads from messages and tool results. We cannot reliably distinguish
// a screenshot from an image pasted by a user, so the rule suppresses all embedded images.
export function sanitizeScreenshots<T>(value: T, enabled: boolean): T {
  if (!enabled) return value
  const visit = (item: unknown, key?: string): unknown => {
    if (typeof item === "string") {
      if (/^data:image\//i.test(item) || (key && /(image|screenshot|base64)/i.test(key))) {
        return "[image hidden by room rules]"
      }
      return item
    }
    if (Array.isArray(item)) {
      return item.flatMap((child) => {
        const result = visit(child)
        return result === undefined ? [] : [result]
      })
    }
    if (item === null || typeof item !== "object") return item
    const record = item as Record<string, unknown>
    const mime = typeof record.mime === "string" ? record.mime.toLowerCase() : ""
    if (mime.startsWith("image/")) {
      // A prompt image has inline/remote data; drop the attachment entirely. Tool file content
      // is represented as a valid text item so consumers of Tool.Content can keep rendering.
      if ("data" in record || "source" in record) return undefined
      if (record.type === "file") return { type: "text", text: "[image hidden by room rules]" }
      return "[image hidden by room rules]"
    }
    const output: Record<string, unknown> = {}
    for (const [childKey, child] of Object.entries(record)) {
      const result = visit(child, childKey)
      if (result !== undefined) output[childKey] = result
    }
    return output
  }
  return visit(value) as T
}

// Apply the host's current room privacy rules to a response payload.
export function sanitizeForGuest<T>(value: T, rules: Rules | undefined, directory: string): T {
  let result = sanitizeScreenshots(value, rules?.hideScreenshots === true)
  if (rules?.hideCommandExecution) result = sanitizeExecutionPayload(result)
  if (rules?.hidePaths) result = redactPaths(result, directory)
  return result
}

// Remove tool parts from persisted assistant messages while leaving normal assistant text intact.
function sanitizeExecutionPayload<T>(value: T): T {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.flatMap((child) => {
        const result = visit(child)
        return result === undefined ? [] : [result]
      })
    }
    if (item === null || typeof item !== "object") return item
    const record = item as Record<string, unknown>
    if (record.type === "tool") return undefined
    if (typeof record.action === "string" && ["shell", "room.run", "room.check", "room.program"].includes(record.action)) return undefined
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(record)) {
      const result = visit(child)
      if (result !== undefined) output[key] = result
    }
    return output
  }
  return visit(value) as T
}

// Replaces the project's directory in text a guest will read, regardless of slash style/case.
export function redactPath(text: string, directory: string) {
  const forward = directory.replaceAll("\\", "/")
  const variants = [...new Set([directory, forward, forward.replaceAll("/", "\\")])]
    .filter((variant) => variant.length > 1)
    .sort((a, b) => b.length - a.length)
  return variants.reduce((out, variant) => {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return out.replace(new RegExp(escaped, "gi"), "<project>")
  }, text)
}

// Redact nested API responses and stream events too, not just the passport's directory field.
export function redactPaths<T>(value: T, directory: string): T {
  if (typeof value === "string") return redactPath(value, directory) as T
  if (Array.isArray(value)) return value.map((item) => redactPaths(item, directory)) as T
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    // Preserve Date/DateTime and other non-DTO values; API payloads are plain objects.
    if (prototype !== Object.prototype && prototype !== null) return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactPaths(item, directory)]),
    ) as T
  }
  return value
}

// A one-paragraph statement of the rules for the AI that has to follow them.
export function describe(rules: Rules | undefined) {
  if (!rules) return undefined
  const lines = [
    rules.hidePaths ? "Do not reveal the project's absolute path to anyone in the room." : undefined,
    rules.blockCommands?.length
      ? `These programs require approval per room member: ${rules.blockCommands.join(", ")}.`
      : undefined,
    rules.protectedFiles?.length ? `These files are off limits: ${rules.protectedFiles.join(", ")}.` : undefined,
    rules.noOutbound ? "Do not use network, browser, connected-account, integration or cross-computer tools; do not send data outside." : undefined,
    rules.hideCommandExecution ? "Do not expose shell commands, tool inputs, execution events or tool output to other room members." : undefined,
    rules.hideScreenshots ? "Do not expose screenshots or embedded images to other room members." : undefined,
    "Credential and secret files are protected by default; do not read, print, copy or disclose them.",
  ].filter((line): line is string => line !== undefined)
  return lines.length > 0 ? lines.join("\n") : undefined
}
