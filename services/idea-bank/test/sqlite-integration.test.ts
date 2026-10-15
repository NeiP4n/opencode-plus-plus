import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import Worker from "../src/index"

const migrationFiles = [
  "0001_init.sql",
  "0002_seed_content_hashes.sql",
  "0003_global_signal_counts.sql",
  "0004_unicode_search_text.sql",
]

function fixture() {
  const db = new Database(":memory:")
  for (const name of migrationFiles) {
    db.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"))
  }

  // Run the real Worker against SQLite with a small D1-compatible adapter.
  // The SQL is not mocked: migrations, indexes, unique constraints, RETURNING,
  // quotas, ranking, duplicate races' normal path, and moderation all execute.
  const adapter = {
    prepare(sql: string) {
      let bindings: unknown[] = []
      return {
        bind(...values: unknown[]) {
          bindings = values
          return this
        },
        first<T = unknown>() {
          return db.query(sql).get(...(bindings as never[])) as T | null
        },
        all<T = unknown>() {
          return { results: db.query(sql).all(...(bindings as never[]) as T[]) }
        },
        run() {
          const result = db.query(sql).run(...(bindings as never[]))
          return { meta: { changes: result.changes } }
        },
      }
    },
  }
  const env = {
    DB: adapter,
    RATE_LIMIT_SALT: "integration-test-salt",
    IDEA_BANK_ADMIN_TOKEN: "integration-test-admin-token",
  } as never
  return { db, env }
}

function request(path: string, init?: RequestInit) {
  return new Request("https://idea-bank.test" + path, init)
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    consent: true,
    title: "Offline localization helper for old games",
    summary: "An assistant that extracts dialogue, preserves formatting tokens, and validates translated text.",
    category: "Game tools",
    tags: ["games", "translation"],
    language: "en",
    ...overrides,
  }
}

describe("Global Idea Bank SQLite integration", () => {
  test("searches migrated seed ideas using the real Unicode search index", async () => {
    const { db, env } = fixture()
    try {
      const response = await Worker.fetch(
        request("/v1/ideas?q=translation%20games&limit=10"),
        env,
      )
      expect(response.status).toBe(200)
      const body = await response.json() as {
        total: number
        items: Array<{ id: string; title: string; signalCount: number }>
      }
      expect(body.total).toBeGreaterThan(0)
      expect(body.items.some((idea) => idea.id === "seed-game-localization")).toBe(true)
      expect(body.items.find((idea) => idea.id === "seed-game-localization")?.signalCount).toBe(1)
    } finally {
      db.close()
    }
  })

  test("publishes a consented idea once and aggregates an identical contribution", async () => {
    const { db, env } = fixture()
    try {
      const init = {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.77" },
      } satisfies RequestInit
      const first = await Worker.fetch(
        request("/v1/ideas", { ...init, body: JSON.stringify(submission()) }),
        env,
      )
      expect(first.status).toBe(201)
      expect(await first.json()).toMatchObject({ status: "published", signalCount: 1 })

      const duplicate = await Worker.fetch(
        request("/v1/ideas", { ...init, body: JSON.stringify(submission()) }),
        env,
      )
      expect(duplicate.status).toBe(200)
      const result = await duplicate.json() as { id: string; status: string; signalCount: number }
      expect(result).toMatchObject({ status: "published", signalCount: 2 })

      const rows = db.query(
        "SELECT id, signal_count FROM ideas WHERE title = ? AND category = ?",
      ).all("Offline localization helper for old games", "Game tools") as Array<{ id: string; signal_count: number }>
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe(result.id)
      expect(rows[0]?.signal_count).toBe(2)

      const stored = db.query("SELECT submitter_hash FROM ideas WHERE id = ?").get(result.id) as { submitter_hash: string }
      expect(stored.submitter_hash).not.toContain("192.0.2.77")
    } finally {
      db.close()
    }
  })

  test("rejects private-looking content before it reaches the database", async () => {
    const { db, env } = fixture()
    try {
      const before = db.query("SELECT COUNT(*) AS total FROM ideas").get() as { total: number }
      const response = await Worker.fetch(
        request("/v1/ideas", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.78" },
          body: JSON.stringify(submission({ summary: "Contact dev@example.org to get the secret translation files." })),
        }),
        env,
      )
      expect(response.status).toBe(400)
      const after = db.query("SELECT COUNT(*) AS total FROM ideas").get() as { total: number }
      expect(after.total).toBe(before.total)
    } finally {
      db.close()
    }
  })

  test("applies the per-day contribution quota atomically", async () => {
    const { db, env } = fixture()
    try {
      const ip = "192.0.2.79"
      const send = (number: number) => Worker.fetch(
        request("/v1/ideas", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
          body: JSON.stringify(submission({
            title: `Unique localization idea number ${number}`,
            summary: `A distinct game-text helper concept number ${number} that preserves formatting and validates translation context.`,
          })),
        }),
        env,
      )
      for (let number = 1; number <= 5; number++) {
        const response = await send(number)
        expect(response.status).toBe(201)
      }
      const blocked = await send(6)
      expect(blocked.status).toBe(429)
      const rows = db.query(
        "SELECT COUNT(*) AS total FROM ideas WHERE title LIKE 'Unique localization idea number %'",
      ).get() as { total: number }
      expect(rows.total).toBe(5)
    } finally {
      db.close()
    }
  })

  test("moderator rejection immediately removes an idea from public search", async () => {
    const { db, env } = fixture()
    try {
      const submitted = await Worker.fetch(
        request("/v1/ideas", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.80" },
          body: JSON.stringify(submission()),
        }),
        env,
      )
      const added = await submitted.json() as { id: string }
      const review = await Worker.fetch(
        request(`/v1/admin/submissions/${added.id}/review`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer integration-test-admin-token",
          },
          body: JSON.stringify({ status: "rejected" }),
        }),
        env,
      )
      expect(review.status).toBe(200)
      expect(await review.json()).toEqual({ id: added.id, status: "rejected" })

      const search = await Worker.fetch(request("/v1/ideas?q=localization"), env)
      const results = await search.json() as { items: Array<{ id: string }> }
      expect(results.items.some((idea) => idea.id === added.id)).toBe(false)
    } finally {
      db.close()
    }
  })
})
