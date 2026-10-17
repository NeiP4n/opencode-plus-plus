import { describe, expect, test } from "bun:test"
import { normalize, parseKiloFreeModels, parseKiloFreeModelsText } from "../src/models-dev"

describe("anonymous FREE model routes", () => {
  const providers = normalize({})

  test("registers Kilo auto-free and statically documented routes without account credentials", () => {
    const kilo = providers.find((provider) => provider.info.id === "kilo-free")
    expect(kilo).toBeDefined()
    expect(kilo!.info.name).toContain("FREE")
    expect(kilo!.info.settings?.baseURL).toBe("https://ai-gateway.kilo.ai/api/v1")
    expect(kilo!.info.headers).toBeUndefined()
    expect(kilo!.info.package).toBe("@opencode/ai/providers/openai-compatible")
    expect(kilo!.models.map((model) => String(model.id))).toEqual([
      "kilo-auto/free",
      "minimax/minimax-m2.1:free",
      "z-ai/glm-5:free",
      "google/gemma-4-26b-a4b-it:free",
    ])
    expect(kilo!.models.every((model) => model.name.includes("[FREE]"))).toBe(true)
    expect(kilo!.models.every((model) => model.cost.every((cost) => cost.input === 0 && cost.output === 0))).toBe(true)
  })

  test("discovers all :free models from the anonymous Kilo model catalog", () => {
    const parsed = parseKiloFreeModels({
      data: [
        {
          id: "provider/code-model:free",
          name: "Code Model",
          context_length: 65_536,
          top_provider: { max_completion_tokens: 8_192 },
          supported_parameters: ["tools", "temperature"],
        },
        { id: "provider/another-model:free", name: "Another Model" },
        { id: "giga-potato", name: "Giga Potato", pricing: { prompt: "0", completion: "0" } },
        { id: "provider/paid-model", name: "Paid Model", pricing: { prompt: "0.0001", completion: "0.0002" } },
        { name: "Broken model" },
      ],
    })
    expect(Object.keys(parsed)).toEqual(["provider/code-model:free", "provider/another-model:free", "giga-potato"])
    expect(parsed["provider/code-model:free"].name).toBe("[FREE] Code Model")
    expect(parsed["provider/code-model:free"].limit).toEqual({ context: 65_536, input: 65_536, output: 8_192 })
    expect(parsed["provider/code-model:free"].tool_call).toBe(true)
    expect(parsed["provider/another-model:free"].name).toBe("[FREE] Another Model")
    expect(parsed["giga-potato"].name).toBe("[FREE] Giga Potato")
    const catalog = normalize({}, parsed)
    const kilo = catalog.find((provider) => provider.info.id === "kilo-free")
    expect(kilo?.models.some((model) => model.id === "provider/code-model:free")).toBe(true)
    expect(kilo?.models.find((model) => model.id === "provider/code-model:free")?.name).toBe("[FREE] Code Model")
    expect(parseKiloFreeModelsText("not json")).toBeUndefined()
  })

  test("free routes remain present when the upstream models.dev catalog refreshes", () => {
    const refreshed = normalize({
      existing: {
        id: "existing",
        name: "Existing Provider",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          sample: {
            id: "sample",
            name: "Sample model",
            release_date: "",
            attachment: false,
            reasoning: false,
            tool_call: true,
            limit: { context: 32_000, output: 4_096 },
            modalities: { input: ["text"], output: ["text"] },
          },
        },
      },
    })
    expect(refreshed.some((provider) => provider.info.id === "existing")).toBe(true)
    expect(refreshed.some((provider) => provider.info.id === "kilo-free")).toBe(true)
  })
})
