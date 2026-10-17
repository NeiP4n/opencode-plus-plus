import { describe, expect, test } from "bun:test"
import { normalize } from "../src/models-dev"

describe("anonymous FREE model routes", () => {
  const providers = normalize({})
  const byID = new Map(providers.map((provider) => [provider.info.id, provider]))

  test("registers Kilo free routes without account credentials", () => {
    const kilo = byID.get("kilo-free")
    expect(kilo).toBeDefined()
    expect(kilo!.info.name).toContain("FREE")
    expect(kilo!.info.settings?.baseURL).toBe("https://ai-gateway.kilo.ai/api/v1")
    expect(kilo!.info.headers).toBeUndefined()
    expect(kilo!.info.package).toBe("@opencode/ai/providers/openai-compatible")
    expect(kilo!.models.map((model) => model.id)).toEqual([
      "kilo-auto/free",
      "minimax/minimax-m2.1:free",
      "z-ai/glm-5:free",
    ])
    expect(kilo!.models.every((model) => model.name.includes("[FREE]"))).toBe(true)
    expect(kilo!.models.every((model) => model.cost.every((cost) => cost.input === 0 && cost.output === 0))).toBe(true)
  })

  test("registers LLMFaucet free routes with its documented placeholder token", () => {
    const faucet = byID.get("llmfaucet-free")
    expect(faucet).toBeDefined()
    expect(faucet!.info.name).toContain("FREE")
    expect(faucet!.info.settings?.baseURL).toBe("https://api.llmfaucet.dev/v1")
    expect(faucet!.info.headers).toEqual({ Authorization: "Bearer free" })
    expect(faucet!.info.package).toBe("@opencode/ai/providers/openai-compatible")
    expect(faucet!.models.map((model) => model.id)).toEqual(["auto", "auto:fast", "auto:smart", "auto:coding"])
    expect(faucet!.models.every((model) => model.name.includes("[FREE]"))).toBe(true)
    expect(faucet!.models.every((model) => model.cost.every((cost) => cost.input === 0 && cost.output === 0))).toBe(true)
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
    expect(refreshed.some((provider) => provider.info.id === "llmfaucet-free")).toBe(true)
  })
})
