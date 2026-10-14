import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { Database } from "bun:sqlite"

const migrationFiles = [
  "0001_init.sql",
  "0002_seed_content_hashes.sql",
  "0003_global_signal_counts.sql",
]

describe("Global Idea Bank database migrations", () => {
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

      const rateTable = db.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'submission_rate_limits'",
      ).get()
      expect(rateTable).toBeTruthy()
    } finally {
      db.close()
    }
  })
})
