import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { canonicalToolName } from "../../util/tool-display"
import type { PartRef } from "./grouping/session"

/** A step inside a turn: a heading the model wrote, or a run of tool calls between texts. */
export type OutlineEntry = {
  key: string
  kind: "heading" | "activity"
  title: string
  level: 1 | 2
  ref: PartRef
  busy: boolean
}

/** One user request and everything the assistant did for it. */
export type OutlineCategory = {
  key: string
  title: string
  ref: PartRef
  messageIDs: string[]
  entries: OutlineEntry[]
}

type Translate = (text: string, values?: Record<string, string | number>) => string

const verbs: Record<string, string> = {
  shell: "Command",
  read: "Read",
  edit: "Edit",
  write: "Write",
  patch: "Patch",
  glob: "Find files",
  grep: "Search",
  webfetch: "Fetch",
  websearch: "Web search",
  subagent: "Subagent",
  todowrite: "Plan",
  execute: "Code",
}

const counters: Record<string, string> = {
  shell: "Commands",
  read: "Reads",
  edit: "Edits",
  write: "Edits",
  patch: "Edits",
  glob: "Searches",
  grep: "Searches",
  webfetch: "Fetches",
  websearch: "Searches",
  subagent: "Subagents",
}

/**
 * Builds the transcript outline from the live message list, so new categories and
 * subcategories appear while the assistant is still streaming.
 */
export function buildOutline(messages: readonly SessionMessageInfo[], t: Translate): OutlineCategory[] {
  const categories: OutlineCategory[] = []
  let run: { entry: OutlineEntry; tools: SessionMessageAssistantTool[] } | undefined
  const closeRun = () => {
    if (run) run.entry.title = activityTitle(run.tools, t)
    run = undefined
  }
  messages.forEach((message) => {
    if (message.type === "user") {
      closeRun()
      categories.push({
        key: message.id,
        title: firstLine(message.text) || t("Request"),
        ref: { messageID: message.id, partID: "message" },
        messageIDs: [message.id],
        entries: [],
      })
      return
    }
    if (message.type !== "assistant") return
    const category = categories.at(-1)
    if (!category) return
    category.messageIDs.push(message.id)
    const ordinals = { text: 0, reasoning: 0 }
    message.content.forEach((part) => {
      if (part.type === "reasoning") {
        ordinals.reasoning++
        return
      }
      if (part.type === "text") {
        const ref = { messageID: message.id, partID: `text:${ordinals.text++}` }
        if (!part.text.trim()) return
        closeRun()
        headings(part.text).forEach((heading, index) =>
          category.entries.push({
            key: `${ref.messageID}:${ref.partID}:${index}`,
            kind: "heading",
            title: heading.title,
            level: heading.level,
            ref,
            busy: false,
          }),
        )
        return
      }
      const busy = part.state.status === "streaming" || part.state.status === "running"
      if (run) {
        run.tools.push(part)
        run.entry.busy ||= busy
        return
      }
      const entry: OutlineEntry = {
        key: `${message.id}:${part.id}`,
        kind: "activity",
        title: "",
        level: 1,
        ref: { messageID: message.id, partID: part.id },
        busy,
      }
      category.entries.push(entry)
      run = { entry, tools: [part] }
    })
  })
  closeRun()
  return categories
}

/** Markdown headings outside code fences; `#`/`##` are sections, `###` and bold lines are subsections. */
export function headings(text: string) {
  let fenced = false
  return text.split("\n").flatMap((line): { title: string; level: 1 | 2 }[] => {
    const trimmed = line.trim()
    if (/^(```|~~~)/.test(trimmed)) {
      fenced = !fenced
      return []
    }
    if (fenced) return []
    const heading = /^(#{1,4})\s+(.+?)\s*#*$/.exec(trimmed)
    if (heading) return [{ title: plain(heading[2]), level: heading[1].length <= 2 ? 1 : 2 }]
    const bold = /^\*\*([^*]{2,80})\*\*:?$/.exec(trimmed)
    if (bold) return [{ title: plain(bold[1]), level: 2 }]
    return []
  })
}

function activityTitle(tools: readonly SessionMessageAssistantTool[], t: Translate) {
  if (tools.length === 1) {
    const name = canonicalToolName(tools[0].name)
    const target = toolTarget(tools[0])
    const verb = t(verbs[name] ?? name)
    return target ? `${verb}: ${target}` : verb
  }
  const counts = tools.reduce<Record<string, number>>((result, tool) => {
    const name = canonicalToolName(tool.name)
    const label = t(counters[name] ?? "Tools")
    result[label] = (result[label] ?? 0) + 1
    return result
  }, {})
  return Object.entries(counts)
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ")
}

function toolTarget(tool: SessionMessageAssistantTool) {
  if (tool.state.status === "streaming") return ""
  const input = tool.state.input
  const value = ["description", "filePath", "path", "pattern", "command", "url", "query"]
    .map((key) => input[key])
    .find((value) => typeof value === "string" && value.trim())
  if (typeof value !== "string") return ""
  return firstLine(value.includes("/") || value.includes("\\") ? (value.split(/[\\/]/).at(-1) ?? value) : value)
}

function firstLine(text: string) {
  return plain(text.split("\n").find((line) => line.trim()) ?? "")
}

function plain(text: string) {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}
