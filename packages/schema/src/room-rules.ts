export * as RoomRules from "./room-rules.js"

import { Schema } from "effect"

// The host decides these rules for the room. Privacy, network and command restrictions also
// constrain the host's AI; guest-only restrictions apply to every remote role.
// The host enforces them; a guest's client cannot switch one off.
export const Rules = Schema.Struct({
  // Guests and their AIs never see the project's path on the host.
  hidePaths: Schema.Boolean.pipe(Schema.optional),
  // Other guests do not receive raw tool inputs/outputs or command execution details.
  hideExecution: Schema.Boolean.pipe(Schema.optional),
  // Hide embedded image/screenshot attachments in guest history and live events, independently.
  hideScreenshots: Schema.Boolean.pipe(Schema.optional),
  // Command patterns that ask the host to approve use of the matching program for a non-Trusted room member.
  // "Always allow" grants this program to that room member only.
  blockCommands: Schema.Array(Schema.String).pipe(Schema.optional),
  // Files the room's AI may not read or edit (patterns such as `.env*` or `secrets/*`);
  // direct shell references are checked too, but indirect access still needs OS sandboxing.
  protectedFiles: Schema.Array(Schema.String).pipe(Schema.optional),
  // The room's AI cannot send anything out: no web requests, desktop control, shell/hub egress, or messages to other computers or projects.
  noOutbound: Schema.Boolean.pipe(Schema.optional),
  // Guests cannot submit prompts to the host's AI.
  denyGuestPrompts: Schema.Boolean.pipe(Schema.optional),
  // Guests cannot invoke slash commands, execute shell commands or submit DoD checks, regardless of role.
  denyGuestCommands: Schema.Boolean.pipe(Schema.optional),
}).annotate({ identifier: "Room.Rules" })
export interface Rules extends Schema.Schema.Type<typeof Rules> {}

// A session can sit in several rooms; every room's rules apply, so the strictest wins.
export function merge(all: ReadonlyArray<Rules | undefined>): Rules | undefined {
  const rules = all.filter((item): item is Rules => item !== undefined)
  if (rules.length === 0) return undefined
  return {
    hidePaths: rules.some((item) => item.hidePaths),
    hideExecution: rules.some((item) => item.hideExecution),
    hideScreenshots: rules.some((item) => item.hideScreenshots),
    // Outbound tools are denied by default in shared rooms; every overlapping room must opt in.
    noOutbound: rules.some((item) => item.noOutbound !== false),
    denyGuestPrompts: rules.some((item) => item.denyGuestPrompts),
    denyGuestCommands: rules.some((item) => item.denyGuestCommands),
    blockCommands: [...new Set(rules.flatMap((item) => item.blockCommands ?? []))],
    protectedFiles: [...new Set(rules.flatMap((item) => item.protectedFiles ?? []))],
  }
}

// Both tools can execute local commands, so room command restrictions apply to both.
export const commandActions: readonly string[] = ["shell", "hub"]

// This is the authoritative room policy used after all plugin hooks. Hook results are advisory;
// no extension may reverse a room denial or suppress a required program-approval prompt.
const LOCAL_ONLY_ACTIONS = new Set([
  "read", "edit", "write", "patch", "apply_patch", "apply-patch", "multiedit", "grep", "glob", "list",
  "todowrite", "todoread", "task", "plan", "question", "skill", "lsp", "dod",
])

export function isLocalOnlyAction(action: string) {
  return LOCAL_ONLY_ACTIONS.has(action)
}
const FILE_ACTIONS = new Set([
  "read", "edit", "write", "patch", "apply_patch", "apply-patch", "multiedit",
  "grep", "glob", "list", "delete", "remove", "rename", "move", "copy", "chmod", "chown",
  "mkdir", "rmdir", "find", "cat", "readfile", "writefile",
])

export type PolicyInput = {
  action: string
  resources: readonly string[]
  metadata?: Readonly<Record<string, unknown>>
}
export type PolicyDecision = { effect: "deny" | "ask"; message: string; save?: readonly string[] }

// Authoritative room policy is evaluated after plugin hooks; extensions cannot reverse a denial.
export function policy(rules: Rules | undefined, input: PolicyInput): PolicyDecision | undefined {
  if (!rules) return undefined
  const deny = (message: string): PolicyDecision => ({ effect: "deny", message })
  if (
    rules.noOutbound !== false &&
    (outbound.includes(input.action) || input.metadata?.transport === "mcp" || !LOCAL_ONLY_ACTIONS.has(input.action))
  ) {
    return deny("This room blocks outbound, connected-account and unrecognized tools by default")
  }

  if (commandActions.includes(input.action)) {
    if (input.resources.some((command) => commandLeaksCredentials(command))) {
      return deny("Commands that print the host's environment or credentials are not allowed")
    }
    if (input.resources.some((command) => protectedFileInCommand(rules, command))) {
      return deny("This room keeps that file off limits to the AI")
    }
    const programs = [...new Set(input.resources.flatMap((command) => programsRequiringApproval(rules, command)))]
    if (programs.length) {
      // Empty save list prevents a room-scoped prompt from persisting a project-wide grant.
      return { effect: "ask", message: `Room rules require host approval to use: ${programs.join(", ")}.`, save: [] }
    }
    return undefined
  }

  if (FILE_ACTIONS.has(input.action) && input.resources.some((resource) => protectedFile(rules, resource))) {
    return deny("This room keeps that file off limits to the AI")
  }
  return undefined
}

// Permission actions that carry data out of the machine.
export const outbound: readonly string[] = [
  "webfetch",
  "websearch",
  "peers",
  "federation",
  "shell",
  "hub",
  "desktop",
  "playtest",
  "opencode_list_mcp_resources",
  "opencode_read_mcp_resource",
]

// A glob where `*` is any text and `?` one character, case-insensitive.
function glob(pattern: string, before: string, after = "") {
  // In filesystem globs, **/ must also match the root (e.g. .ssh or auth.json).
  // Protect the token before escaping and expanding ordinary * wildcards.
  const recursiveDirectory = "\u0000"
  const body = pattern
    .replaceAll("**/", recursiveDirectory)
    .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".")
    .replaceAll(recursiveDirectory, "(?:.*/)?")
  return new RegExp(before + body + after, "i")
}

// The parts of a command line that each start a command. Wrapping a command in bash -c
// or a subshell is not unpicked: policy checks must inspect nested commands too.
function segments(command: string) {
  // Shell commands can be nested in substitutions, quoted wrappers, subshells,
  // redirections and background jobs. This is deliberately conservative: policy
  // matching may reject a harmless command containing a blocked invocation, but
  // must not silently permit common shell wrappers.
  // POSIX backslash escapes the next character; backslash-newline joins physical lines.
  const normalized = command.replace(/\\\r?\n/g, "").replace(/\\(.)/gs, "$1")
  return normalized
    .split(/[;&|()\n\r\t\x60<>$"'\\]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function blockedCommand(rules: Rules | undefined, command: string) {
  return (rules?.blockCommands ?? []).find((raw) => {
    const pattern = raw.trim()
    if (!pattern) return false
    const start = glob(pattern, "^")
    const candidates = segments(command).flatMap((part) => {
      const words = part.split(/\s+/).filter(Boolean)
      // Try every word boundary so wrappers such as sudo, env, command and nohup
      // cannot hide a blocked executable at the start of a later token.
      return [part, ...words.map((_, index) => words.slice(index).join(" "))]
    })
    if (candidates.some((candidate) => start.test(candidate))) return true
    return !pattern.includes("*") && command.toLowerCase().includes(pattern.toLowerCase())
  })
}

export function blockedCommandForAction(rules: Rules | undefined, action: string, commands: readonly string[]) {
  if (!commandActions.includes(action)) return undefined
  for (const command of commands) {
    const blocked = blockedCommand(rules, command)
    if (blocked !== undefined) return blocked
  }
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
  // Escaped characters and ordinary characters must be disjoint to avoid exponential backtracking.
  return command.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/g) ?? []
}
function unquoteToken(token: string) {
  return token.replace(/^['"]|['"]$/g, "")
}
function unwrapCommand(command: string) {
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
export function programName(command: string): string | undefined {
  const token = commandTokens(unwrapCommand(command))[0]
  if (!token) return undefined
  const name = token.split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat|ps1|com)$/i, "").toLowerCase()
  return name || undefined
}
function blockedMatchCandidate(pattern: string, command: string) {
  const start = glob(pattern, "^")
  for (const part of segments(command)) {
    const words = part.split(/\s+/).filter(Boolean)
    const candidates = [part, ...words.map((_, index) => words.slice(index).join(" "))]
    const found = candidates.find((candidate) => start.test(candidate))
    if (found) return found
  }
  return !pattern.includes("*") && command.toLowerCase().includes(pattern.toLowerCase()) ? command : undefined
}
// A matching rule means that using this program requires host approval; it is not an unconditional ban.
export function programsRequiringApproval(rules: Rules | undefined, command: string): string[] {
  const output = new Set<string>()
  for (const raw of rules?.blockCommands ?? []) {
    const pattern = raw.trim()
    if (!pattern) continue
    const matched = blockedMatchCandidate(pattern, command)
    if (!matched) continue
    const first = pattern.split(/\s+/)[0] ?? ""
    const prefix = /^[A-Za-z0-9_.-]+/.exec(first)?.[0]
    const source = /[*?]/.test(first) ? prefix ?? matched : pattern
    const program = programName(source)
    if (program) output.add(program)
  }
  return [...output]
}

// Credential stores are protected in every room by default; custom rules only add restrictions.
export const SECRET_FILE_PATTERNS: readonly string[] = [
  ".env*",
  "**/.ssh", "**/.ssh/**",
  "**/.aws", "**/.aws/**",
  "**/.azure", "**/.azure/**",
  "**/.config/gcloud/**",
  "**/.config/gh/**",
  "**/.config/opencode/**",
  "**/.local/share/opencode/auth.json",
  "**/.claude/.credentials.json",
  "**/.claude.json",
  "**/.codex/auth.json",
  "**/.config/codex/**",
  "**/.git-credentials",
  "**/.git/config",
  "**/.bash_history",
  "**/.zsh_history",
  "**/.python_history",
  "**/.config/fish/fish_history",
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

export function protectedFile(rules: Rules | undefined, file: string) {
  const normal = file.replaceAll("\\", "/")
  return [...SECRET_FILE_PATTERNS, ...(rules?.protectedFiles ?? [])].find((raw) => {
    const pattern = raw.trim().replaceAll("\\", "/")
    return pattern !== "" && glob(pattern, "(^|/)", "$").test(normal)
  })
}

// Environment and credential dumps are forbidden even when outbound access is explicitly enabled.
// Remote commands must not be able to print the host's account tokens or process environment.
export function commandLeaksCredentials(command: string) {
  // Normalize basic shell escapes and line continuations before matching credential dumps.
  const normalized = command.replace(/\\\r?\n/g, "").replace(/\\(.)/gs, "$1")
  return (
    /\b(env|printenv)\b/i.test(normalized) ||
    /(?:^|[;&|()\s])set(?:\s|$)/i.test(normalized) ||
    /\b(?:get-childitem|gci)\s+env:/i.test(normalized) ||
    /\bpython(?:3)?\b.*(?:os\.environb?|os\.getenv|environ\s*\[|printenv)/is.test(normalized) ||
    /\bnode\b.*(?:process\.env|Object\.keys\s*\(\s*process\.env)/is.test(normalized) ||
    // PowerShell and cmd.exe use different variable syntax from POSIX shells.
    /\$env:[A-Za-z0-9_]*(?:api[_-]?key|token|secret|password|credential|private[_-]?key)/i.test(normalized) ||
    /%[A-Za-z_][A-Za-z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)[A-Za-z0-9_]*%/i.test(normalized) ||
    /\$(?:\{)?[A-Za-z_][A-Za-z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)[A-Za-z0-9_]*(?:\})?/i.test(normalized)
  )
}

// Conservatively detect protected paths directly mentioned in shell commands.
// This does not replace OS-level sandboxing for indirect access via scripts or aliases.
export function protectedFileInCommand(rules: Rules | undefined, command: string) {
  const normal = command.replaceAll("\\", "/")
  return [...SECRET_FILE_PATTERNS, ...(rules?.protectedFiles ?? [])].find((raw) => {
    const pattern = raw.trim().replaceAll("\\", "/")
    if (!pattern) return false
    return glob(pattern, "(?:^|[\\s\\x22\\x27=:/])", "(?=$|[\\s\\x22\\x27/:])").test(normal)
  })
}

export function redactPath(text: string, directory: string) {
  const forward = directory.replaceAll("\\", "/").replace(/\/+$/, "")
  const candidates = new Set<string>([directory, forward])
  // Redact the session directory and a small number of parent paths commonly used as project roots.
  // Do not mask every ancestor: that would hide unrelated sibling directories such as /work/other.
  let parent = forward
  for (let depth = 0; depth < 2 && parent.length > 1; depth++) {
    const index = parent.lastIndexOf("/")
    if (index <= 0 || (/^[A-Za-z]:/.test(parent) && index <= 2)) break
    parent = parent.slice(0, index)
    if (parent.length > 1) candidates.add(parent)
  }
  const variants = [...candidates, ...[...candidates].map((item) => item.replaceAll("/", "\\"))]
    .filter((variant) => variant.length > 1)
    .sort((a, b) => b.length - a.length)
  const windowsPath = /^(?:[a-z]:[\\/]|\\\\)/i.test(directory)
  return variants.reduce((out, variant) => {
    const escaped = variant.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&")
    return out.replace(new RegExp("(?<![A-Za-z0-9._-])" + escaped + "(?=$|[/\\\\\\s:'\"<>])", windowsPath ? "gi" : "g"), "<project>")
  }, text)
}
// Remove embedded image/screenshot data from values shared with room guests.
// The function is deliberately recursive because images can appear in messages, tool results,
// event metadata, attachments or nested response objects.
export function sanitizeScreenshots<T>(value: T, enabled: boolean): T {
  if (!enabled) return value
  const imageExtension = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|heic|avif)(?:[?#].*)?$/i
  const visit = (item: unknown, key?: string): unknown => {
    if (key && /(image|screenshot|base64)/i.test(key)) return undefined
    if (typeof item === "string") {
      if (/^data:image\//i.test(item)) return undefined
      if (key && /^(?:url|uri|path|filename|name)$/i.test(key) && imageExtension.test(item)) return undefined
      // A data URI may be embedded in otherwise ordinary text/tool output; strip its payload only.
      return item.replace(/data:image\/[^;,\s]+;base64,[A-Za-z0-9+/=]+/gi, "[image hidden by room rules]")
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
    const mime = typeof record.mime === "string" ? record.mime.toLowerCase() : ""
    const mediaType = typeof record.mediaType === "string" ? record.mediaType.toLowerCase() : ""
    const type = typeof record.type === "string" ? record.type.toLowerCase() : ""
    const namedImage = [record.name, record.filename, record.path, record.uri, record.url].some(
      (part) => typeof part === "string" && (imageExtension.test(part) || /screenshot/i.test(part)),
    )
    if (
      mime.startsWith("image/") ||
      mediaType.startsWith("image/") ||
      type.includes("screenshot") ||
      type.includes("image") ||
      ((type === "file" || type === "attachment") && namedImage)
    ) {
      return undefined
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

// A one-paragraph statement of the rules for the AI that has to follow them.
export function describe(rules: Rules | undefined) {
  if (!rules) return undefined
  const lines = [
    "Credential and secret files (including .env, SSH/cloud auth, API tokens and private keys) are protected by default.",
    rules.hidePaths ? "Do not reveal the project's absolute path to anyone in the room." : undefined,
    rules.hideExecution ? "Do not broadcast raw tool inputs or outputs or command execution details to other guests. The host alone handles all tool approvals." : undefined,
    rules.hideScreenshots ? "Do not expose image attachments or screenshots in guest history or live events." : undefined,
    rules.blockCommands?.length ? `These program patterns require host approval: ${rules.blockCommands.join(", ")}.` : undefined,
    rules.protectedFiles?.length ? `These files are off limits: ${rules.protectedFiles.join(", ")}.` : undefined,
    rules.noOutbound !== false ? "Outbound access is denied by default: no web, MCP, connected-account, shell/hub or remote tools unless the host explicitly allows them." : undefined,
    rules.denyGuestPrompts ? "Guests must not submit prompts to the host's AI." : undefined,
    rules.denyGuestCommands ? "Guests must not invoke slash commands, execute shell commands or submit command checks." : undefined,
  ].filter((line): line is string => line !== undefined)
  return lines.length > 0 ? lines.join("\n") : undefined
}
