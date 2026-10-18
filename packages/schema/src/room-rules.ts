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
  // External tools are blocked by default in shared rooms; the host must explicitly opt in.
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
    // External tools are blocked by default in shared rooms; the host must opt in explicitly.
    noOutbound: rules.some((item) => item.noOutbound !== false),
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
  return outbound.includes(value) || /(?:web|http|fetch|browser|peer|federation|mcp|integration|connector|api|github|gitlab|git|slack|discord|telegram|whatsapp|email|gmail|outlook|mail|message|send|publish|upload|request|network|remote|external|dropbox|drive|notion|linear|jira|salesforce|shopify|calendar|cloud|account|oauth|token|webhook)/.test(value)
}

const LOCAL_ONLY_ACTIONS = new Set([
  "read", "edit", "write", "patch", "apply_patch", "apply-patch", "multiedit", "grep", "glob", "list", "shell",
  "delete", "remove", "rename", "move", "copy", "chmod", "chown", "mkdir", "rmdir", "find", "cat", "readfile", "writefile",
  "todowrite", "todoread", "task", "plan", "question", "skill", "lsp", "dod",
  // Room-run/check/program actions are host-gated local operations; the server separately
  // checks the actual command against strict outbound rules before it reaches the shell.
  "room.run", "room.check", "room.program",
])

// Privacy mode is deny-by-default for tool actions: tools that are not explicitly known to be
// local are blocked, since a connected-account tool may have an innocent-looking name.
export function localOnlyAction(action: string) {
  return LOCAL_ONLY_ACTIONS.has(action.toLowerCase())
}

// Credential files are protected in every shared room by default, even when the host has not
// added them to the custom list. Explicit room rules can add further patterns, not weaken this set.
const SECRET_FILE_PATTERNS: readonly string[] = [
  ".env*",
  "**/.ssh",
  "**/.ssh/**",
  "**/.aws",
  "**/.aws/**",
  "**/.azure",
  "**/.azure/**",
  "**/.config/gcloud/**",
  "**/.config/gh/**",
  "**/.config/opencode/**",
  "**/.local/share/opencode/auth.json",
  "**/.claude/.credentials.json",
  "**/.claude.json",
  "**/.codex/auth.json",
  "**/.config/codex/**",
  "**/.git-credentials",
  "**/.netrc",
  "**/.npmrc",
  "**/.pypirc",
  "**/.docker/config.json",
  "**/.kube/config",
  "**/.vault-token",
  "**/.terraformrc",
  "**/terraform.tfstate*",
  "**/auth.json",
  "**/token.json",
  "**/tokens.json",
  "**/*token*.json",
  "**/*oauth*.json",
  "**/*secret*.json",
  "**/credentials",
  "**/credentials/**",
  "**/secrets/**",
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

const COMMAND_WRAPPERS = new Set(["sudo", "doas", "command", "builtin", "nohup", "time", "nice", "stdbuf", "env", "exec"])
const WRAPPER_OPTIONS_WITH_VALUE: Record<string, ReadonlySet<string>> = {
  sudo: new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--chdir"]),
  doas: new Set(["-u", "-C"]),
  env: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]),
  nice: new Set(["-n", "--adjustment"]),
  stdbuf: new Set(["-i", "--input", "-o", "--output", "-e", "--error"]),
  time: new Set(["-f", "--format", "-o", "--output"]),
}

function commandTokens(command: string) {
  return command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g) ?? []
}

function unquoteToken(token: string) {
  return token.replace(/^['"]|['"]$/g, "")
}

// Strip common command launchers and their options so sudo -u root git push still matches
// the host's git push* rule and is attributed to the git executable.
function commandAfterWrappers(command: string) {
  const tokens = commandTokens(command)
  let index = 0
  while (index < tokens.length) {
    const token = unquoteToken(tokens[index])
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index++
      continue
    }
    const base = token.split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat|ps1|com)$/i, "").toLowerCase()
    if (!base || !COMMAND_WRAPPERS.has(base)) break
    index++
    const options = WRAPPER_OPTIONS_WITH_VALUE[base] ?? new Set<string>()
    while (index < tokens.length) {
      const option = unquoteToken(tokens[index])
      if (base === "env" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(option)) {
        index++
        continue
      }
      if (!option.startsWith("-")) break
      const equals = option.indexOf("=")
      const name = equals > 0 ? option.slice(0, equals) : option
      index++
      if (options.has(name) && equals < 0 && index < tokens.length) index++
    }
  }
  return tokens.slice(index).map(unquoteToken).join(" ")
}

function matchesCommand(pattern: string, command: string) {
  const start = glob(pattern, "(^|[;&|\\s'\"(])")
  if (
    segments(command).some((part) => start.test(part) || start.test(commandAfterWrappers(part)))
  ) return true
  // Retain the old matching behavior for rules such as "rm -rf" wrapped by "bash -c".
  return !pattern.includes("*") && command.toLowerCase().includes(pattern.toLowerCase())
}

// Extract the executable name rather than the full command: "git push" means approval to use
// git, not approval for that exact invocation. Wrapper prefixes and assignments are ignored.
export function programName(command: string): string | undefined {
  const source = commandAfterWrappers(command)
  const token = commandTokens(source)[0]
  if (!token) return undefined
  const base = unquoteToken(token).split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat|ps1|com)$/i, "").toLowerCase()
  return base || undefined
}

// Returns each configured program whose use needs explicit approval. The approval is later stored
// on the individual room member, never as a shared/global permission rule.
export function programsRequiringApproval(rules: Rules | undefined, command: string): string[] {
  return [...new Set((rules?.blockCommands ?? []).flatMap((raw) => {
    const pattern = raw.trim()
    if (!pattern || !matchesCommand(pattern, command)) return []
    const first = pattern.split(/\s+/)[0] ?? ""
    const prefix = /^[A-Za-z0-9_.-]+/.exec(first)?.[0]
    const source = /[*?]/.test(first)
      ? prefix || (segments(command).find((part) => matchesCommand(pattern, part)) ?? command)
      : pattern
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
    const pattern = raw.trim().replaceAll("\\", "/")
    if (!pattern) return false
    const candidates = [pattern, pattern.replace(/^\*\*\//, "")]
    return candidates.some((candidate) => glob(candidate, "(^|/)", "$").test(normal))
  })
}

// Also guard file paths passed as shell arguments (including quoted paths and --option=path).
export function commandTouchesProtectedFile(rules: Rules | undefined, command: string) {
  const normal = command.replaceAll("\\", "/")
  const patterns = [...SECRET_FILE_PATTERNS, ...(rules?.protectedFiles ?? [])]
  return patterns.some((raw) => {
    const pattern = raw.trim().replaceAll("\\", "/")
    if (!pattern) return false
    // "**/name" must also match "name" when it is relative to the project root.
    const candidates = [pattern, pattern.replace(/^\*\*\//, "")]
    // A path can begin after whitespace or a quote in a shell argument, not only after a slash.
    const prefix = "(^|[/\\s'\"=])"
    return candidates.some((candidate) => glob(candidate, prefix).test(normal))
  })
}

// Best-effort command-level outbound guard for shells that can bypass the AI's web/peer tools.
// This is a policy check, not an OS-level network sandbox.
export function commandSendsOutbound(command: string) {
  const value = command.toLowerCase()
  return (
    // Arbitrary script interpreters can open their own sockets or print environment credentials.
    /\b(python|python3|node|bun|deno|ruby|perl|php|pwsh|powershell|bash|sh|zsh|cmd|lua|npx|npm|pnpm|yarn)\b/.test(value) ||
    /\b(env|printenv|set)\b/.test(value) ||
    /\b(?:openai|anthropic|claude|github|gh|aws|azure|google|gcp)_[a-z0-9_]*(?:api_key|token|secret|password|credential|private_key)[a-z0-9_]*\b/i.test(value) ||
    /\b(?:get-childitem|gci)\s+env:/i.test(value) ||
    /\b(gh|glab|aws|az|gcloud|kubectl|helm|terraform|wrangler|fly|vercel|netlify|heroku|railway)\b/.test(value) ||
    /\b(curl|wget|fetch|ssh|scp|sftp|rsync|ftp|nc|netcat|ncat|socat|telnet|tftp)\b/.test(value) ||
    /\b(invoke-webrequest|invoke-restmethod|iwr|irm)\b/.test(value) ||
    /\bgit\s+(push|fetch|pull|clone|ls-remote|submodule\s+update)\b/.test(value) ||
    /\bdocker\s+(pull|push|login|run|build|compose\s+up)\b/.test(value) ||
    /\bpip\s+install\b/.test(value) ||
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
      type.startsWith("session.step.") ||
      type.startsWith("permission."))
}

// Suppress the room's public activity-feed entries that reveal a command and who ran it.
export function hideExecutionFeed(rules: Rules | undefined, value: unknown) {
  if (!rules?.hideCommandExecution || value === null || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  if (Array.isArray(record.events)) {
    return {
      ...record,
      events: record.events.filter((item) =>
        !(item && typeof item === "object" && "kind" in item &&
          ["run", "pass", "fail"].includes(String((item as { kind?: unknown }).kind))),
      ),
    }
  }
  if (Array.isArray(value)) {
    return value.filter((item) =>
      !(item && typeof item === "object" && "kind" in item &&
        ["run", "pass", "fail"].includes(String((item as { kind?: unknown }).kind))),
    )
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
    const prototype = Object.getPrototypeOf(item)
    if (prototype !== Object.prototype && prototype !== null) return item
    const record = item as Record<string, unknown>
    const contentType = typeof record.type === "string" ? record.type.toLowerCase() : ""
    if (contentType.includes("image") || contentType.includes("screenshot")) return undefined
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
    const prototype = Object.getPrototypeOf(item)
    if (prototype !== Object.prototype && prototype !== null) return item
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
  const forward = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  const candidates = new Set<string>([directory, forward])
  // A session may live inside a project subfolder. Mask ancestor paths too, so project metadata
  // cannot expose the same host directory under a shorter canonical root.
  let parent = forward
  while (parent.length > 1) {
    const index = parent.lastIndexOf("/")
    if (index <= 0) break
    parent = parent.slice(0, index)
    if (parent.length > 1) candidates.add(parent)
  }
  const variants = [...candidates, ...[...candidates].map((item) => item.replaceAll("/", "\\"))]
    .filter((variant) => variant.length > 1)
    .sort((a, b) => b.length - a.length)
  return variants.reduce((out, variant) => {
    const escaped = variant.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")
    return out.replace(new RegExp(escaped + "(?=$|[/\\\\\\s:'\"<>])", "gi"), "<project>")
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
