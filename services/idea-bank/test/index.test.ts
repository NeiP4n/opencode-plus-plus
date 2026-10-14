import { describe, expect, test } from "bun:test"
import Worker from "../src/index"

type Query = { sql: string; bindings: unknown[] }
type MockOptions = {
  duplicate?: { id: string; status: string } | null
  raceDuplicate?: { id: string; status: string } | null
  insertConflict?: boolean
  quota?: { count: number } | null
  signalCount?: number
  items?: unknown[]
  total?: number
}

function makeDB(options: MockOptions = {}) {
  const queries: Query[] = []
  let duplicateLookups = 0
  const db = {
    prepare(sql: string) {
      const statement = {
        sql,
        bindings: [] as unknown[],
        bind(...bindings: unknown[]) {
          this.bindings = bindings
          return this
        },
        async first() {
          queries.push({ sql: this.sql, bindings: this.bindings })
          if (this.sql.includes("SELECT COUNT(*) AS total")) return { total: options.total ?? 0 }
          if (this.sql.includes("SELECT id, status FROM ideas WHERE content_hash")) {
            duplicateLookups++
            return duplicateLookups === 1 ? (options.duplicate ?? null) : (options.raceDuplicate ?? null)
          }
          if (this.sql.includes("INSERT INTO submission_rate_limits")) return options.quota === undefined ? { count: 1 } : options.quota
          if (this.sql.includes("SELECT signal_count FROM ideas")) return { signal_count: options.signalCount ?? 2 }
          return null
        },
        async all() {
          queries.push({ sql: this.sql, bindings: this.bindings })
          return { results: options.items ?? [] }
        },
        async run() {
          queries.push({ sql: this.sql, bindings: this.bindings })
          if (options.insertConflict && this.sql.includes("INSERT INTO ideas")) {
            throw new Error("UNIQUE constraint failed: ideas.content_hash")
          }
          return { meta: { changes: 1 } }
        },
      }
      return statement
    },
  }
  return { db: db as never, queries }
}

function env(db: unknown, salt = "test-only-salt") {
  return { DB: db, RATE_LIMIT_SALT: salt }
}

function request(path: string, init?: RequestInit) {
  return new Request("https://idea-bank.test" + path, init)
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    consent: true,
    title: "Translate an old game",
    summary: "A tool to extract game text, keep formatting, and check translation context.",
    category: "Games and creativity",
    tags: ["translation", "games"],
    language: "en",
    ...overrides,
  }
}

describe("Global Idea Bank API", () => {
  test("health check does not require a database", async () => {
    const response = await Worker.fetch(request("/v1/health"), {} as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "ok", service: "opencode-idea-bank" })
  })

  test("refuses a contribution without explicit consent", async () => {
    const mock = makeDB()
    const response = await Worker.fetch(
      request("/v1/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission({ consent: false })),
      }),
      env(mock.db),
    )
    expect(response.status).toBe(400)
    expect(mock.queries).toHaveLength(0)
  })

  test("rejects oversized bodies even when Content-Length is absent", async () => {
    const mock = makeDB()
    const response = await Worker.fetch(
      request("/v1/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission({ summary: "x".repeat(20_000) })),
      }),
      env(mock.db),
    )
    expect(response.status).toBe(413)
    expect(mock.queries).toHaveLength(0)
  })

  test("blocks private-looking content before writing to D1", async () => {
    const mock = makeDB()
    const response = await Worker.fetch(
      request("/v1/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission({ summary: "Contact dev@example.com for help with this translation tool." })),
      }),
      env(mock.db),
    )
    expect(response.status).toBe(400)
    expect(mock.queries).toHaveLength(0)
  })

  test("publishes a consented safe idea after applying the daily quota", async () => {
    const mock = makeDB()
    const response = await Worker.fetch(
      request("/v1/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.10" },
        body: JSON.stringify(submission()),
      }),
      env(mock.db),
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ status: "published", signalCount: 1 })
    const quotaIndex = mock.queries.findIndex((item) => item.sql.includes("INSERT INTO submission_rate_limits"))
    const insertIndex = mock.queries.findIndex((item) => item.sql.includes("INSERT INTO ideas"))
    expect(quotaIndex).toBeGreaterThanOrEqual(0)
    expect(insertIndex).toBeGreaterThan(quotaIndex)
    expect(mock.queries[insertIndex].sql).toContain("'published'")
  })

  test("deduplicates ideas after Unicode normalization", async () => {
    const submit = async (title: string) => {
      const mock = makeDB()
      const response = await Worker.fetch(
        request("/v1/ideas", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.19" },
          body: JSON.stringify(submission({ title })),
        }),
        env(mock.db),
      )
      expect(response.status).toBe(201)
      const lookup = mock.queries.find((item) => item.sql.includes("SELECT id, status FROM ideas WHERE content_hash"))
      return lookup?.bindings[0]
    }

    const plain = await submit("Translate an old game")
    const fullWidth = await submit("Ｔｒａｎｓｌａｔｅ an old game")
    expect(fullWidth).toBe(plain)
  })

  test("counts a repeated signal after consuming quota", async () => {
    const mock = makeDB({ duplicate: { id: "idea-123", status: "published" }, signalCount: 8 })
    const response = await Worker.fetch(
      request("/v1/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.11" },
        body: JSON.stringify(submission()),
      }),
      env(mock.db),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: "idea-123", status: "published", signalCount: 8 })
    const quotaIndex = mock.queries.findIndex((item) => item.sql.includes("INSERT INTO submission_rate_limits"))
    const updateIndex = mock.queries.findIndex((item) => item.sql.includes("signal_count = signal_count + 1"))
    expect(updateIndex).toBeGreaterThan(quotaIndex)
  })

  test("counts a duplicate inserted concurrently instead of returning a server error", async () => {
    const mock = makeDB({
      raceDuplicate: { id: "raced-idea", status: "published" },
      insertConflict: true,
      signalCount: 6,
    })
    const response = await Worker.fetch(
      request("/v1/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.33" },
        body: JSON.stringify(submission()),
      }),
      env(mock.db),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: "raced-idea",
      status: "published",
      signalCount: 6,
    })
    expect(mock.queries.filter((item) => item.sql.includes("SELECT id, status FROM ideas WHERE content_hash"))).toHaveLength(2)
    expect(mock.queries.some((item) => item.sql.includes("signal_count = signal_count + 1"))).toBe(true)
  })

  test("normalizes Cyrillic queries before binding database search terms", async () => {
    const mock = makeDB({ total: 1, items: [] })
    const response = await Worker.fetch(request("/v1/ideas?q=%D0%9F%D0%95%D0%A0%D0%95%D0%92%D0%9E%D0%94%20%D0%98%D0%93%D0%A0%D0%AB"), env(mock.db))
    expect(response.status).toBe(200)
    const search = mock.queries.find((item) => item.sql.includes("instr(search_text, ?)"))
    expect(search?.bindings.slice(0, 2)).toEqual(["перевод", "игры"])
  })

  test("rejects contributions after the daily quota without inserting an idea", async () => {
    const mock = makeDB({ quota: null })
    const response = await Worker.fetch(
      request("/v1/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.12" },
        body: JSON.stringify(submission()),
      }),
      env(mock.db),
    )
    expect(response.status).toBe(429)
    expect(mock.queries.some((item) => item.sql.includes("INSERT INTO ideas"))).toBe(false)
  })

  test("searches with separate safe query terms and returns public results", async () => {
    const mock = makeDB({
      total: 1,
      items: [{
        id: "idea-123",
        title: "Translate an old game",
        summary: "Extract text and validate translations.",
        category: "Games and creativity",
        tags: '["games","translation"]',
        language: "en",
        status: "published",
        submitter_hash: "hashed",
        content_hash: "content-hash",
        created_at: 100,
        updated_at: 200,
        signal_count: 4,
        reviewed_at: 200,
      }],
    })
    const response = await Worker.fetch(request("/v1/ideas?q=translate%20old%20game&limit=10"), env(mock.db))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      total: 1,
      items: [{ id: "idea-123", signalCount: 4, title: "Translate an old game" }],
    })
    const search = mock.queries.find((item) => item.sql.includes("SELECT id, title") && item.sql.includes("instr(search_text, ?)"))
    expect(search?.bindings.slice(0, 3)).toEqual(["translate", "old", "game"])
    expect(search?.sql).toContain("DESC, signal_count DESC, updated_at DESC")
  })
})
