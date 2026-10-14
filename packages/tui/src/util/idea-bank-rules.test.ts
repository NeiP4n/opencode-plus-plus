import { describe, expect, test } from "bun:test"
import { classifyIdeaSignal, looksSensitive } from "./idea-bank-rules"

describe("Idea Bank local signal rules", () => {
  test("recognizes repetitive work in Russian without returning source text", () => {
    const text = "Мне каждый раз приходится вручную переименовывать сотни файлов."
    const result = classifyIdeaSignal(text)

    expect(result?.id).toBe("manual-work")
    expect(JSON.stringify(result)).not.toContain("переименовывать")
    expect(JSON.stringify(result)).not.toContain(text)
  })

  test("recognizes missing capabilities in English", () => {
    expect(classifyIdeaSignal("I wish there were a simple tool for comparing these reports.")?.id).toBe(
      "missing-tool",
    )
  })

  test("recognizes friction, documentation gaps, and integration needs", () => {
    expect(classifyIdeaSignal("This workflow is frustrating and too difficult to repeat.")?.id).toBe(
      "workflow-friction",
    )
    expect(classifyIdeaSignal("Нет документации, и не могу найти инструкцию по настройке.")?.id).toBe(
      "documentation",
    )
    expect(classifyIdeaSignal("The tools do not sync and there is no integration between them.")?.id).toBe(
      "integration",
    )
  })

  test("ignores short, long, and unrelated text", () => {
    expect(classifyIdeaSignal("неудобно")).toBeUndefined()
    expect(classifyIdeaSignal("Build a linked list from these values please.")).toBeUndefined()
    expect(classifyIdeaSignal("x".repeat(5001))).toBeUndefined()
  })

  test("rejects text that resembles secrets or personal identifiers", () => {
    const sensitive = [
      "Need an automation for this task; password=super-secret-value",
      "Please help me; contact jane.doe@example.com about the repetitive task.",
      "The workaround is documented at https://internal.example.test/path and is annoying.",
      "My local file at C:\\Users\\Alice\\project\\config.txt breaks every time.",
      "Server 192.168.1.44 does not work and is frustrating.",
      "-----BEGIN PRIVATE KEY-----\nsecret material\n-----END PRIVATE KEY-----",
      "Use token: abcdefghijklmnopqrstuvwxyz when the repeated job fails.",
    ]
    for (const text of sensitive) {
      expect(looksSensitive(text)).toBe(true)
      expect(classifyIdeaSignal(text)).toBeUndefined()
    }
  })

  test("only returns predefined generic labels", () => {
    const result = classifyIdeaSignal("I keep having to manually rebuild these reports every single week.")
    expect(result).toMatchObject({
      id: "manual-work",
      title: "Automate repetitive work",
      category: "Automation",
      kind: "Utility or workflow",
    })
    expect(Object.keys(result ?? {}).sort()).toEqual(["category", "description", "id", "kind", "title"])
  })
})
