import { describe, expect, test } from "bun:test"
import { modelCandidates, toAnthropicResponse, toOpenAIRequest } from "../src/index"

describe("room gateway protocol conversion", () => {
  test("converts Anthropic system, text and tools to OpenAI chat format", () => {
    const request = toOpenAIRequest({
      model: "client-model",
      system: [{ type: "text", text: "You are helpful." }],
      messages: [
        { role: "user", content: [{ type: "text", text: "Add two numbers" }] },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call-1", name: "add", input: { a: 2, b: 3 } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "call-1", content: "5" }],
        },
      ],
      tools: [{ name: "add", description: "Add numbers", input_schema: { type: "object" } }],
      tool_choice: { type: "tool", name: "add" },
      max_tokens: 400,
      stream: true,
    }, "space-bunny-free")

    expect(request.model).toBe("space-bunny-free")
    expect(request.messages[0]).toEqual({ role: "system", content: "You are helpful." })
    expect(request.messages[1]).toEqual({ role: "user", content: "Add two numbers" })
    expect(request.messages[2].tool_calls[0].function).toEqual({
      name: "add",
      arguments: JSON.stringify({ a: 2, b: 3 }),
    })
    expect(request.messages[3]).toEqual({ role: "tool", tool_call_id: "call-1", content: "5" })
    expect(request.tools[0].function.name).toBe("add")
    expect(request.tool_choice.function.name).toBe("add")
    expect(request.stream_options.include_usage).toBe(true)
  })

  test("preserves multimodal image content", () => {
    const request = toOpenAIRequest({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Describe this" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "YWJj" } },
        ],
      }],
    }, "space-bunny-free")
    expect(request.messages[0].content).toEqual([
      { type: "text", text: "Describe this" },
      { type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
    ])
  })

  test("converts a completed tool call into Anthropic tool_use content", () => {
    const response = toAnthropicResponse({
      id: "chatcmpl-1",
      choices: [{
        finish_reason: "tool_calls",
        message: {
          content: "Working",
          tool_calls: [{ id: "call-1", function: { name: "add", arguments: '{"a":2}' } }],
        },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }, "space-bunny-free")

    expect(response.model).toBe("space-bunny-free")
    expect(response.content).toEqual([
      { type: "text", text: "Working" },
      { type: "tool_use", id: "call-1", name: "add", input: { a: 2 } },
    ])
    expect(response.stop_reason).toBe("tool_use")
    expect(response.usage).toEqual({ input_tokens: 12, output_tokens: 4 })
  })

  test("fails over only to configured models and starts with the requested allowed model", () => {
    const config = { model: "primary", fallbackModels: ["backup-a", "backup-b"] }
    expect(modelCandidates("backup-a", config)).toEqual(["backup-a", "primary", "backup-b"])
    expect(modelCandidates("not-configured", config)).toEqual(["primary", "backup-a", "backup-b"])
  })
})
