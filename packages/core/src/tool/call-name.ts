export * as ToolCallName from "./call-name.js"

/**
 * Models trained on other agent harnesses call tools by the names they learned there
 * (`Bash`, `read_file`, `str_replace_editor`, `functions.read`). Every such call used to
 * fail with "No tool named ..." and cost a full extra step. A call name resolves to an
 * advertised name only when the match is unambiguous; anything else still fails, now with
 * the nearest names spelled out so the next attempt is right.
 */

// Keys are loose spellings (lowercase, latin letters and digits only); values are core tool names.
const ALIASES: Record<string, string> = {
  bash: "shell",
  sh: "shell",
  zsh: "shell",
  terminal: "shell",
  cmd: "shell",
  command: "shell",
  exec: "shell",
  runcommand: "shell",
  executecommand: "shell",
  runterminalcmd: "shell",
  runshellcommand: "shell",
  shellcommand: "shell",
  powershell: "shell",
  readfile: "read",
  view: "read",
  viewfile: "read",
  cat: "read",
  openfile: "read",
  fileread: "read",
  writefile: "write",
  createfile: "write",
  writetofile: "write",
  filewrite: "write",
  strreplace: "edit",
  strreplaceeditor: "edit",
  strreplacebasededittool: "edit",
  replaceinfile: "edit",
  editfile: "edit",
  multiedit: "edit",
  searchreplace: "edit",
  applypatch: "patch",
  applydiff: "patch",
  search: "grep",
  searchfiles: "grep",
  grepsearch: "grep",
  ripgrep: "grep",
  rg: "grep",
  findfiles: "glob",
  filesearch: "glob",
  fetch: "webfetch",
  fetchurl: "webfetch",
  readurl: "webfetch",
  searchweb: "websearch",
  googlesearch: "websearch",
  internetsearch: "websearch",
  task: "subagent",
  agent: "subagent",
  dispatchagent: "subagent",
  askuser: "question",
  askquestion: "question",
  askfollowupquestion: "question",
}

// Wrappers some models put around a tool name: `functions.read`, `default_api:read`, `tools.read`.
const PREFIX = /^(?:functions|default_api|tools|tool|api)[.:_-]+/i

/**
 * The advertised name a call means. `available` maps each advertised name to the registry
 * name it executes, so an alias still finds a tool a plugin advertised under another name.
 */
export function resolve(name: string, available: ReadonlyMap<string, string>) {
  if (available.has(name)) return name
  const stripped = name.replace(PREFIX, "")
  if (available.has(stripped)) return stripped
  const key = loose(stripped)
  const spelled = unique([...available.keys()].filter((candidate) => loose(candidate) === key))
  if (spelled) return spelled
  const target = ALIASES[key]
  if (!target) return undefined
  if (available.has(target)) return target
  return unique([...available].filter((entry) => entry[1] === target).map((entry) => entry[0]))
}

/** Advertised names closest to an unknown call name, nearest first. */
export function suggest(name: string, available: Iterable<string>) {
  const key = loose(name.replace(PREFIX, ""))
  const limit = Math.max(2, Math.floor(key.length / 3))
  return [...available]
    .map((candidate) => {
      const other = loose(candidate)
      const contained = key.length >= 3 && other.length >= 3 && (other.includes(key) || key.includes(other))
      return { candidate, distance: contained ? 1 : distance(key, other) }
    })
    .filter((entry) => entry.distance <= limit)
    .toSorted((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map((entry) => entry.candidate)
}

/** The model-facing failure for a call name that resolves to nothing. */
export function unknown(name: string, available: ReadonlyArray<string>) {
  const near = suggest(name, available)
  const names = available.toSorted()
  return [
    `No tool named "${name}" is currently available.`,
    ...(near.length > 0 ? [`Did you mean ${near.map((item) => `"${item}"`).join(" or ")}?`] : []),
    names.length > 0 && names.length <= 60
      ? `Available tools: ${names.join(", ")}.`
      : "Please use a tool from the available tool list.",
  ].join(" ")
}

function loose(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "")
}

function unique(values: ReadonlyArray<string>) {
  return values.length === 1 ? values[0] : undefined
}

function distance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (const [i, a] of [...left].entries()) {
    let diagonal = row[0]
    row[0] = i + 1
    for (const [j, b] of [...right].entries()) {
      const above = row[j + 1]
      row[j + 1] = Math.min(above + 1, row[j] + 1, diagonal + (a === b ? 0 : 1))
      diagonal = above
    }
  }
  return row[right.length]
}
