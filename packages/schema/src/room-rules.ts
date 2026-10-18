export * as RoomRules from "./room-rules.js"

import { Schema } from "effect"

// The host decides these rules for the room. Privacy, network and command restrictions also
// constrain the host's AI; guest-only restrictions apply to every remote role.
// The host enforces them; a guest's client cannot switch one off.
export const Rules = Schema.Struct({
  // Guests and their AIs never see the project's path on the host.
  hidePaths: Schema.Boolean.pipe(Schema.optional),
  // Other guests do not receive raw tool inputs/outputs, command execution details, or screenshots.
  hideExecution: Schema.Boolean.pipe(Schema.optional),
  // Commands nobody runs in the room, by the host's AI, guests' commands or checks.
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
  return command.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+/g) ?? []
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
    const source = /[*?]/.test(first) ? prefix ?? matched : matched
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

// Conservatively detect protected paths directly mentioned in shell commands.
// This does not replace OS-level sandboxing for indirect access via scripts or aliases.
export function protectedFileInCommand(rules: Rules | undefined, command: string) {
  const normal = command.replaceAll("\\", "/")
  return [...SECRET_FILE_PATTERNS, ...(rules?.protectedFiles ?? [])].find((raw) => {
    const pattern = raw.trim().replaceAll("\\", "/")
    if (!pattern) return false
    return glob(pattern, "(?:^|[\\s\\x22\\x27=:/])", "(?=$|[\\s\\x22/:])").test(normal)
  })
}

export function redactPath(text: string, directory: string) {
  const forward = directory.replaceAll("\\", "/")
  const variants = [...new Set([directory, forward, forward.replaceAll("/", "\\")])].filter(Boolean)
  return variants.reduce((out, variant) => {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return out.replace(new RegExp(escaped, "gi"), "<project>")
  }, text)
}

// A one-paragraph statement of the rules for the AI that has to follow them.
export function describe(rules: Rules | undefined) {
  if (!rules) return undefined
  const lines = [
    "Credential and secret files (including .env, SSH/cloud auth, API tokens and private keys) are protected by default.",
    rules.hidePaths ? "Do not reveal the project's absolute path to anyone in the room." : undefined,
    rules.hideExecution ? "Do not broadcast raw tool inputs or outputs, command execution details, or screenshots to other guests. The host alone handles all tool approvals." : undefined,
    rules.blockCommands?.length ? `These commands are forbidden: ${rules.blockCommands.join(", ")}.` : undefined,
    rules.protectedFiles?.length ? `These files are off limits: ${rules.protectedFiles.join(", ")}.` : undefined,
    rules.noOutbound !== false ? "Outbound access is denied by default: no web, MCP, connected-account, shell/hub or remote tools unless the host explicitly allows them." : undefined,
    rules.denyGuestPrompts ? "Guests must not submit prompts to the host's AI." : undefined,
    rules.denyGuestCommands ? "Guests must not invoke slash commands, execute shell commands or submit command checks." : undefined,
  ].filter((line): line is string => line !== undefined)
  return lines.length > 0 ? lines.join("\n") : undefined
}
