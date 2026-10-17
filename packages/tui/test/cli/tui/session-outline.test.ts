import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { buildOutline, headings } from "../../../src/routes/session/outline"

const t = (text: string) => text

function assistant(id: string, content: SessionMessageAssistant["content"]) {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "test", id: "test" },
    time: { created: 0 },
    content,
  } as SessionMessageAssistant
}

function tool(id: string, name: string, input: Record<string, string>, status: "running" | "completed" = "completed") {
  return {
    type: "tool" as const,
    id,
    name,
    time: { created: 0 },
    state:
      status === "running"
        ? { status, input, metadata: {} }
        : { status, input, content: [{ type: "text" as const, text: "" }] as [{ type: "text"; text: string }] },
  }
}

test("splits requests into categories with headings and tool runs as subcategories", () => {
  const messages: SessionMessageInfo[] = [
    { id: "u1", type: "user", text: "Fix the **login** bug\nmore details", time: { created: 0 } },
    assistant("a1", [
      { type: "reasoning", text: "thinking" },
      tool("t1", "read", { filePath: "src/auth/login.ts" }),
      tool("t2", "bash", { command: "bun test" }),
      tool("t3", "edit", { filePath: "src/auth/login.ts" }),
    ]),
    assistant("a2", [
      { type: "text", text: "## Cause\nThe token expired.\n```md\n# not a heading\n```\n### Fix details\n**Result**" },
    ]),
    { id: "u2", type: "user", text: "Now add tests", time: { created: 1 } },
    assistant("a3", [tool("t4", "write", { filePath: "test/login.test.ts" }, "running")]),
  ]

  const outline = buildOutline(messages, t)

  expect(outline.map((category) => category.title)).toEqual(["Fix the login bug", "Now add tests"])
  expect(outline[0].messageIDs).toEqual(["u1", "a1", "a2"])
  expect(outline[0].entries.map((entry) => [entry.kind, entry.level, entry.title])).toEqual([
    ["activity", 1, "Reads 1 · Commands 1 · Edits 1"],
    ["heading", 1, "Cause"],
    ["heading", 2, "Fix details"],
    ["heading", 2, "Result"],
  ])
  expect(outline[0].entries[1].ref).toEqual({ messageID: "a2", partID: "text:0" })
  expect(outline[1].entries).toMatchObject([{ title: "Write: login.test.ts", busy: true, ref: { partID: "t4" } }])
})

test("ignores headings inside code fences", () => {
  expect(headings("~~~\n# no\n~~~\n# Yes")).toEqual([{ title: "Yes", level: 1 }])
})
