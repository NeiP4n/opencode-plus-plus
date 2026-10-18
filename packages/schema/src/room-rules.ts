export * as RoomRules from "./room-rules.js"

import { Schema } from "effect"

// What the host decides for everyone in a room, the host's own AI included. These are rules
// about data and commands, not roles: a role says who may do what, a rule says what nobody may.
// The host enforces them; a guest's client cannot switch one off.
export const Rules = Schema.Struct({
  // Guests and their AIs never see the project's path on the host.
  hidePaths: Schema.Boolean.pipe(Schema.optional),
  // Commands nobody runs in the room, by the host's AI, guests' commands or checks. A pattern
  // matches the start of a command or of any part of a chained one; `*` stands for any text.
  blockCommands: Schema.Array(Schema.String).pipe(Schema.optional),
  // Files the room's AI may not read or edit (patterns such as `.env*` or `secrets/*`), so
  // their contents cannot be sent anywhere.
  protectedFiles: Schema.Array(Schema.String).pipe(Schema.optional),
  // The room's AI cannot send anything out: no web requests, no messages to other computers or projects.
  noOutbound: Schema.Boolean.pipe(Schema.optional),
}).annotate({ identifier: "Room.Rules" })
export interface Rules extends Schema.Schema.Type<typeof Rules> {}

// A session can sit in several rooms; every room's rules apply, so the strictest wins.
export function merge(all: ReadonlyArray<Rules | undefined>): Rules | undefined {
  const rules = all.filter((item): item is Rules => item !== undefined)
  if (rules.length === 0) return undefined
  return {
    hidePaths: rules.some((item) => item.hidePaths),
    noOutbound: rules.some((item) => item.noOutbound),
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
  "opencode_list_mcp_resources",
  "opencode_read_mcp_resource",
]

// A glob where `*` is any text and `?` one character, case-insensitive.
function glob(pattern: string, before: string, after = "") {
  const body = pattern
    .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".")
  return new RegExp(before + body + after, "i")
}

// The parts of a command line that each start a command. Wrapping a command in `bash -c`
// or a subshell is not unpicked: patterns without `*` also match anywhere in the line.
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
    const start = glob(pattern, "^")
    // Also inspect the full command so wrappers such as bash -c cannot hide a wildcard rule.
    // This is intentionally conservative: a match anywhere in the command is denied.
    if (glob(pattern, "").test(command)) return true
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
    const pattern = raw.trim()
    return pattern !== "" && glob(pattern.replaceAll("\\", "/"), "(^|/)", "$").test(normal)
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
      .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".")
    return new RegExp("(?:^|[\\s\"'=:/])" + body + "(?=$|[\\s\"/:])", "i").test(normal)
  })
}
export function redactPath(text: string, directory: string) {")
      .replaceAll("*", ".*")
      .replaceAll("?", ".")
    return new RegExp("(?:^|[\\\\s\\\"'=:/])" + body + "(?=$|[\\\\s\\\"/:])", "i").test(command.replaceAll("\\\\", "/"))
  })
}
export function redactPath(text: string, directory: string) {
  const forward = directory.replaceAll("\\", "/")
  const variants = [...new Set([directory, forward, forward.replaceAll("/", "\\")])].filter(Boolean)
  return variants.reduce((out, variant) => out.split(variant).join("<project>"), text)
}

// A one-paragraph statement of the rules for the AI that has to follow them.
export function describe(rules: Rules | undefined) {
  if (!rules) return undefined
  const lines = [
    rules.hidePaths ? "Do not reveal the project's absolute path to anyone in the room." : undefined,
    rules.blockCommands?.length ? `These commands are forbidden: ${rules.blockCommands.join(", ")}.` : undefined,
    rules.protectedFiles?.length ? `These files are off limits: ${rules.protectedFiles.join(", ")}.` : undefined,
    rules.noOutbound ? "Send nothing out: no web requests and no messages to other computers or projects." : undefined,
  ].filter((line): line is string => line !== undefined)
  return lines.length > 0 ? lines.join("\n") : undefined
}
