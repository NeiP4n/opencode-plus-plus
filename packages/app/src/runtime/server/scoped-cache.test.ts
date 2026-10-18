import { describe, expect, test } from "bun:test"
import { createScopedCache } from "./scoped-cache"

describe("createScopedCache", () => {
  test("prunes an empty-string key when the cache is over capacity", () => {
    const disposed: string[] = []
    const cache = createScopedCache((key) => ({ key }), {
      maxEntries: 0,
      dispose: (value) => disposed.push(value.key),
    })

    cache.get("")
    expect(cache.peek("")).toBeUndefined()
    expect(disposed).toEqual([""])
  })

  test("evicts least-recently-used entry when max is reached", () => {
    const disposed: string[] = []

    const cache = createScopedCache((key) => ({ key }), {
      maxEntries: 2,
      dispose: (value) => disposed.push(value.key),
    })

    const a = cache.get("a")
    const b = cache.get("b")
    expect(a.key).toBe("a")
    expect(b.key).toBe("b")

    cache.get("a")
    const c = cache.get("c")

    expect(c.key).toBe("c")
    expect(cache.peek("a")?.key).toBe("a")
    expect(cache.peek("b")).toBeUndefined()
    expect(cache.peek("c")?.key).toBe("c")
    expect(disposed).toEqual(["b"])
  })

  test("disposes entries on delete and clear", () => {
    const disposed: string[] = []

    const cache = createScopedCache((key) => ({ key }), {
      dispose: (value) => disposed.push(value.key),
    })

    cache.get("a")
    cache.get("b")

    const removed = cache.delete("a")
    expect(removed?.key).toBe("a")
    expect(cache.peek("a")).toBeUndefined()

    cache.clear()
    expect(cache.peek("b")).toBeUndefined()
    expect(disposed).toEqual(["a", "b"])
  })

  test("expires stale entries with ttl and recreates on get", () => {
    let clock = 0
    let count = 0
    const disposed: string[] = []

    const cache = createScopedCache((key) => ({ key, count: ++count }), {
      ttlMs: 10,
      now: () => clock,
      dispose: (value) => disposed.push(`${value.key}:${value.count}`),
    })

    const first = cache.get("a")
    expect(first.count).toBe(1)

    clock = 9
    expect(cache.peek("a")?.count).toBe(1)

    clock = 11
    expect(cache.peek("a")).toBeUndefined()
    expect(disposed).toEqual(["a:1"])

    const second = cache.get("a")
    expect(second.count).toBe(2)
    expect(disposed).toEqual(["a:1"])
  })
  test("sweeps expired entries from the oldest end of the LRU cache", () => {
    let clock = 0
    const disposed: string[] = []
    const cache = createScopedCache((key) => ({ key }), {
      ttlMs: 10,
      now: () => clock,
      dispose: (value) => disposed.push(value.key),
    })

    cache.get("old")
    clock = 5
    cache.get("recent")
    clock = 8
    cache.get("old")
    clock = 11

    expect(cache.peek("old")?.key).toBe("old")
    expect(disposed).toEqual(["recent"])

    clock = 19
    expect(cache.peek("old")).toBeUndefined()
    expect(disposed).toEqual(["recent", "old"])
  })

})
