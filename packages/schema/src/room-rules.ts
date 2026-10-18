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
  // Files the room's AI may not read or edit (patterns such as `.env*` or `secrets/*`).
  protectedFiles: Schema.Array(Schema.String).pipe(Schema.optional),
  // The room's AI cannot send anything out: no web requests, no messages to other computers or projects.
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
    noOutbound: rules.some((item) => item.noOutbound),
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
  const body = pattern
    .replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".")
  return new RegExp(before + body + after, "i")
}

// The parts of a command line that each start a command. Wrapping a command in `bash -c`
// is not unpicked; patterns are also checked against the complete command string.
function segments(command: string) {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function blockedCommand(rules: Rules | undefined, command: string) {
  return (rules?.blockCommands ?? []).find((raw) => {
    const pattern = raw.trim()
    if (!pattern) return false
    if (glob(pattern, "").test(command)) return true
    const start = glob(pattern, "^")
    return segments(command).some((part) => start.test(part))
  })
}

export function blockedCommandForAction(rules: Rules | undefined, action: string, commands: readonly string[]) {
  if (!commandActions.includes(action)) return undefined
  for (const command of commands) {
    const blocked = blockedCommand(rules, command)
    if (blocked !== undefined) return blocked
  }
}

export function protectedFile(rules: Rules | undefined, file: string) {
  const normal = file.replaceAll("\\", "/")
  return (rules?.protectedFiles ?? []).find((raw) => {
    const pattern = raw.trim().replaceAll("\\", "/")
    return pattern !== "" && glob(pattern, "(^|/)", "$").test(normal)
  })
}

// Conservatively detect protected paths directly mentioned in shell commands.
// This does not replace OS-level sandboxing for indirect access via scripts or aliases.
export function protectedFileInCommand(rules: Rules | undefined, command: string) {
  const normal = command.replaceAll("\\", "/")
  return (rules?.protectedFiles ?? []).find((raw) => {
    const pattern = raw.trim().replaceAll("\\", "/")
    if (!pattern) return false
    const body = pattern
    .replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".")
    return new RegExp("(?:^|[\\s\"'=:/])" + body + "(?=$|[\\s\"/:])", "i").test(normal)
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
    rules.hidePaths ? "Do not reveal the project's absolute path to anyone in the room." : undefined,
    rules.hideExecution ? "Do not broadcast raw tool inputs or outputs, command execution details, or screenshots to other guests. The host alone handles approvals for shell, hub and desktop actions." : undefined,
    rules.blockCommands?.length ? `These commands are forbidden: ${rules.blockCommands.join(", ")}.` : undefined,
    rules.protectedFiles?.length ? `These files are off limits: ${rules.protectedFiles.join(", ")}.` : undefined,
    rules.noOutbound ? "Send nothing out: no web requests and no messages to other computers or projects." : undefined,
    rules.denyGuestPrompts ? "Guests must not submit prompts to the host's AI." : undefined,
    rules.denyGuestCommands ? "Guests must not invoke slash commands, execute shell commands or submit command checks." : undefined,
  ].filter((line): line is string => line !== undefined)
  return lines.length > 0 ? lines.join("\n") : undefined
}
