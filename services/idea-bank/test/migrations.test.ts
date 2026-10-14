import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { Database } from "bun:sqlite"

const migrationFiles = [
  "0001_init.sql",
  "0002_seed_content_hashes.sql",
  "0003_global_signal_counts.sql",
  "0004_unicode_search_text.sql",
]

describe("Global Idea Bank database migrations", () => {
  test("upgrades an existing install without losing community ideas", () => {
    const db = new Database(":memory:")
    try {
      const first = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8")
      db.exec(first)
      db.query(
        `INSERT INTO ideas
          (id, title, summary, category, tags, language, status, submitter_hash, content_hash, created_at, updated_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "legacy-community-idea",
        "Legacy local search helper",
        "A tool to search old project notes and keep them available after an upgrade.",
        "Productivity",
        '["notes","search"]',
        "en",
        "published",
        "legacy-hash",
        "legacy-content-hash",
        100,
        200,
        200,
      )

      for (const name of migrationFiles.slice(1)) {
        const sql = readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8")
        db.exec(sql)
      }

      const legacy = db
        .query("SELECT title, signal_count, search_text FROM ideas WHERE id = ?")
        .get("legacy-community-idea") as { title: string; signal_count: number; search_text: string } | null
      expect(legacy?.title).toBe("Legacy local search helper")
      expect(legacy?.signal_count).toBe(1)
      expect(legacy?.search_text).toContain("legacy local search helper")
    } finally {
      db.close()
    }
  })

  test("fresh databases can apply every migration in order", () => {
    const db = new Database(":memory:")
    try {
      for (const name of migrationFiles) {
        const sql = readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8")
        db.exec(sql)
      }

      const seeds = db.query(
        "SELECT id, content_hash, signal_count FROM ideas WHERE id LIKE 'seed-%' ORDER BY id",
      ).all() as Array<{ id: string; content_hash: string; signal_count: number }>

      expect(seeds).toHaveLength(8)
      expect(new Set(seeds.map((idea) => idea.content_hash)).size).toBe(8)
      expect(seeds.every((idea) => idea.signal_count === 1)).toBe(true)

      const searchSeed = db.query("SELECT search_text FROM ideas WHERE id = 'seed-accessibility-audit'").get() as
        | { search_text: string }
        | null
      expect(searchSeed?.search_text).toContain("accessibility")

      const rateTable = db.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'submission_rate_limits'",
      ).get()
      expect(rateTable).toBeTruthy()
    } finally {
      db.close()
    }
  })
})
