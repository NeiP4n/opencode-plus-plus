import { expect, test } from "bun:test"
import { modelErrorText, withModelWarmup } from "../../src/util/model-error"

const t = (text: string, values?: Record<string, string>) =>
  values ? text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "") : text

test("a usage limit becomes a short hint to pick another model", () => {
  const text = modelErrorText(
    new Error(
      "subscription_sharing_usage_limit_exceeded: The ChatGPT user has reached their Subscription Sharing usage limit.",
    ),
    t,
  )
  expect(text).toBe("The chosen model has run out of its usage limit. Pick another model in the prompt and refresh.")
})

test("other failures keep a shortened provider message", () => {
  expect(modelErrorText(new Error("x".repeat(500)), t)).toHaveLength("The model could not answer: ".length + 161)
})

test("a request waits out the model catalog warm-up after a server start", async () => {
  const attempts: number[] = []
  const result = await withModelWarmup(async () => {
    attempts.push(attempts.length)
    if (attempts.length === 1) throw new Error("Model unavailable: opencode/space-bunny-free")
    return "OK"
  })
  expect(result).toBe("OK")
  expect(attempts).toHaveLength(2)
})

test("other failures are not retried", async () => {
  const attempts: number[] = []
  const failed = withModelWarmup(async () => {
    attempts.push(attempts.length)
    throw new Error("usage limit")
  })
  await expect(failed).rejects.toThrow("usage limit")
  expect(attempts).toHaveLength(1)
})
