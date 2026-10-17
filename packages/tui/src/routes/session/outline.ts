import type { SessionMessageInfo } from "@opencode/client"
import { Option, Schema } from "effect"
import { canonicalToolName } from "../../util/tool-display"
import type { PartRef } from "./grouping/session"

/** A section inside a topic, pointing at the turn where it starts. */
export type OutlineEntry = {
  key: string
  title: string
  ref: PartRef
}

/** A topic of the conversation and the turns it covers. */
export type OutlineCategory = {
  key: string
  title: string
  ref: PartRef
  messageIDs: string[]
  entries: OutlineEntry[]
}

/** One user request with the assistant's work on it, as the model sees it when naming topics. */
export type Turn = {
  messageID: string
  messageIDs: string[]
  user: string
  answer: string
  tools: string[]
}

const Topics = Schema.Array(
  Schema.Struct({
    title: Schema.String,
    from: Schema.Number,
    sections: Schema.optional(Schema.Array(Schema.Struct({ title: Schema.String, at: Schema.Number }))),
  }),
)
export type Topic = { title: string; from: number; sections: { title: string; at: number }[] }

const decodeTopics = Schema.decodeUnknownOption(Schema.fromJsonString(Topics))

const DIGEST_LIMIT = 12_000

export function chatTurns(messages: readonly SessionMessageInfo[]): Turn[] {
  return messages.reduce<Turn[]>((turns, message) => {
    if (message.type === "user") {
      turns.push({ messageID: message.id, messageIDs: [message.id], user: message.text, answer: "", tools: [] })
      return turns
    }
    const turn = turns.at(-1)
    if (message.type !== "assistant" || !turn) return turns
    turn.messageIDs.push(message.id)
    message.content.forEach((part) => {
      if (part.type === "text" && part.text.trim()) turn.answer = part.text
      if (part.type === "tool") turn.tools.push(canonicalToolName(part.name))
    })
    return turns
  }, [])
}

/** Asks for a table of contents of the whole conversation rather than one entry per message. */
export function outlinePrompt(turns: readonly Turn[], previous: readonly Topic[], language: string | undefined) {
  const instructions = [
    "Below is a numbered list of turns from a chat between a user and an AI assistant.",
    "Build a table of contents of the whole conversation: group the turns into topics by their overall context, the way a person would name chapters.",
    "Never make a topic per message. Greetings, small talk, short questions and follow-ups belong to the topic around them.",
    "Start a new topic only when the subject of the work clearly changes. Use at most 8 topics; a short chat may have just one.",
    "A topic may list up to 5 sections for notable steps inside it, each pointing at the turn where that step starts. Skip sections that would only repeat the topic.",
    `Write titles in ${language === "ru" ? "Russian" : "English"}, two to five words, without quotes or trailing punctuation.`,
    'Reply with JSON only, no prose and no code fence: [{"title":"…","from":1,"sections":[{"title":"…","at":3}]}]. Numbers are turn numbers, topics are in order, and the first topic starts at 1.',
  ].join(" ")
  const current = previous.length
    ? `Current table of contents; keep its titles where they still fit:\n${JSON.stringify(previous)}`
    : ""
  return [instructions, current, digest(turns)].filter(Boolean).join("\n\n")
}

/** Reads the model's reply into topics ordered by turn, dropping anything that points outside the chat. */
export function parseTopics(text: string, turns: number): Topic[] {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start === -1 || end <= start) return []
  const topics = Option.getOrUndefined(decodeTopics(text.slice(start, end + 1))) ?? []
  const valid = (turn: number) => Number.isInteger(turn) && turn >= 1 && turn <= turns
  const sorted = topics
    .filter((topic) => topic.title.trim() && valid(topic.from))
    .map((topic) => ({
      title: topic.title.trim(),
      from: topic.from,
      sections: (topic.sections ?? [])
        .filter((section) => section.title.trim() && valid(section.at))
        .map((section) => ({ title: section.title.trim(), at: section.at })),
    }))
    .toSorted((a, b) => a.from - b.from)
    .filter((topic, index, all) => index === 0 || topic.from !== all[index - 1].from)
  if (sorted[0]) sorted[0].from = 1
  return sorted
}

/** Lays topics over the current turns; turns after the last generation join the last topic. */
export function topicOutline(topics: readonly Topic[], turns: readonly Turn[]): OutlineCategory[] {
  return topics.flatMap((topic, index) => {
    const end = topics[index + 1]?.from ?? turns.length + 1
    const covered = turns.slice(topic.from - 1, end - 1)
    if (!covered[0]) return []
    return [
      {
        key: `${covered[0].messageID}:${index}`,
        title: topic.title,
        ref: { messageID: covered[0].messageID, partID: "message" },
        messageIDs: covered.flatMap((turn) => turn.messageIDs),
        entries: topic.sections.flatMap((section, position) => {
          const turn = section.at >= topic.from && section.at < end ? turns[section.at - 1] : undefined
          return turn
            ? [
                {
                  key: `${turn.messageID}:${index}:${position}`,
                  title: section.title,
                  ref: { messageID: turn.messageID, partID: "message" },
                },
              ]
            : []
        }),
      },
    ]
  })
}

/** Until topics exist (or when naming them failed), each request stands on its own. */
export function turnOutline(turns: readonly Turn[]): OutlineCategory[] {
  return turns.map((turn) => ({
    key: turn.messageID,
    title: firstLine(turn.user),
    ref: { messageID: turn.messageID, partID: "message" },
    messageIDs: turn.messageIDs,
    entries: [],
  }))
}

// Long chats shrink every turn's excerpt so the whole conversation still fits.
function digest(turns: readonly Turn[]) {
  const render = (size: number) =>
    turns
      .map((turn, index) => {
        const tools = Object.entries(
          turn.tools.reduce<Record<string, number>>(
            (counts, tool) => ({ ...counts, [tool]: (counts[tool] ?? 0) + 1 }),
            {},
          ),
        )
          .map(([tool, count]) => (count > 1 ? `${tool}×${count}` : tool))
          .join(", ")
        return [
          `${index + 1}. User: ${clip(turn.user, size)}`,
          turn.answer ? `   Assistant: ${clip(turn.answer, size)}` : "",
          tools ? `   Tools: ${tools}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      })
      .join("\n")
  return [240, 120, 60, 30].map(render).find((text) => text.length <= DIGEST_LIMIT) ?? render(30).slice(-DIGEST_LIMIT)
}

function clip(text: string, size: number) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > size ? `${flat.slice(0, size)}…` : flat
}

function firstLine(text: string) {
  return (text.split("\n").find((line) => line.trim()) ?? "").replace(/\s+/g, " ").trim()
}
