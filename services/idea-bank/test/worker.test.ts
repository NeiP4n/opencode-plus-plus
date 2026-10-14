import { describe, expect, it } from "bun:test"
import worker from "../src/index"

const noDatabase = {
  prepare() {
    throw new Error("The database must not be accessed by these request paths")
  },
}

const env = {
  DB: noDatabase,
  RATE_LIMIT_SALT: "test-only-salt",
} as never

function request(body: string, options?: { consent?: boolean; contentLength?: string }) {
  const headers = new Headers({ "content-type": "application/json" })
  if (options?.contentLength) headers.set("content-length", options.contentLength)
  return new Request("https://ideas.example/v1/ideas", {
    method: "POST",
    headers,
    body,
  })
}

describe("Global Idea Bank HTTP API", () => {
  it("returns health without touching the database", async () => {
    const response = await worker.fetch(new Request("https://ideas.example/v1/health"), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: "ok",
      service: "opencode-idea-bank",
      apiVersion: 1,
    })
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("refuses to publish without explicit consent", async () => {
    const response = await worker.fetch(
      request(JSON.stringify({
        consent: false,
        title: "An idea for a private tool",
        summary: "A sufficiently long summary for an idea that must not be shared.",
        category: "Productivity",
      })),
      env,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "Explicit consent is required before an idea can be sent to the shared bank" })
  })

  it("blocks ideas containing personal contact data before database access", async () => {
    const response = await worker.fetch(
      request(JSON.stringify({
        consent: true,
        title: "Contact person@example.org",
        summary: "A sufficiently long summary for an otherwise generic idea.",
        category: "Productivity",
      })),
      env,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: "The idea appears to contain private or sensitive data; remove it before sharing",
    })
  })

  it("rejects a request that exceeds the body size limit", async () => {
    const response = await worker.fetch(request("x".repeat(16_385), { contentLength: "16385" }), env)
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ error: "Idea submission body exceeds 16 KiB" })
  })

  it("rejects malformed JSON before database access", async () => {
    const response = await worker.fetch(request("{ not json"), env)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "Body must be valid JSON" })
  })
})
