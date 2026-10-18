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

// Permission actions that carry data out of the machine.
export const outbound: readonly string[] = ["webfetch", "websearch", "peers", "federation"]

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
  // Shell commands can be nested in substitutions, quoted wrappers, subshells,
  // redirections and background jobs. Splitting only on ;, pipes and newlines
  // misses e.g. `$(git push*)` or `bash -c 'git push*'`. This is deliberately
  // conservative: policy matching may reject a harmless command containing a
  // blocked invocation, but must not silently permit common shell wrappers.
  // In POSIX shells, backslash escapes the next character and backslash-newline
  // joins physical lines into one command. Normalize both before splitting, otherwise
  // a blocked command can be hidden as `g\\it push` or `git \\\n push`.
  const normalized = command.replace(/\\\r?\n/g, "").replace(/\\(.)/gs, "$1")
  return normalized
    .split(/[;&|()\n\r\t`<>$"'\\]+/)
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
      // A blocked executable can be prefixed with sudo, env, command, nohup,
      // assignments, or another wrapper. Try every word boundary, not only the
      // beginning of the shell segment.
      return [part, ...words.map((_, index) => words.slice(index).join(" "))]
    })
    if (candidates.some((candidate) => start.test(candidate))) return true
    return !pattern.includes("*") && command.toLowerCase().includes(pattern.toLowerCase())
  })
}

export function protectedFile(rules: Rules | undefined, file: string) {
  const normal = file.replaceAll("\\", "/")
  return (rules?.protectedFiles ?? []).find((raw) => {
    const pattern = raw.trim()
    return pattern !== "" && glob(pattern.replaceAll("\\", "/"), "(^|/)", "$").test(normal)
  })
}

// Replaces the project's directory in text a guest will read.
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
