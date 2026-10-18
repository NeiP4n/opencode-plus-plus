type ScopedCacheOptions<T> = {
  maxEntries?: number
  ttlMs?: number
  dispose?: (value: T, key: string) => void
  now?: () => number
}

type Entry<T> = {
  value: T
  touchedAt: number
}

export function createScopedCache<T>(createValue: (key: string) => T, options: ScopedCacheOptions<T> = {}) {
  const store = new Map<string, Entry<T>>()
  const now = options.now ?? Date.now
  let lastNow = Number.NEGATIVE_INFINITY
  const timestamp = () => (lastNow = Math.max(lastNow, now()))

  const dispose = (key: string, entry: Entry<T>) => {
    options.dispose?.(entry.value, key)
  }

  const expired = (entry: Entry<T>, time?: number) => {
    if (options.ttlMs === undefined) return false

    return (time ?? timestamp()) - entry.touchedAt >= options.ttlMs
  }

  const sweep = () => {
    if (options.ttlMs === undefined) return

    // Map order is LRU order: touched entries move to the end. With monotonic
    // timestamps, expired entries are a prefix, so stop at the first live entry
    // instead of checking every cached value on every lookup.
    const time = timestamp()
    for (const [key, entry] of store) {
      if (!expired(entry, time)) break
      store.delete(key)
      dispose(key, entry)
    }
  }

  const touch = (key: string, entry: Entry<T>) => {
    entry.touchedAt = timestamp()
    store.delete(key)
    store.set(key, entry)
  }

  const prune = () => {
    if (options.maxEntries === undefined) return

    while (store.size > options.maxEntries) {
      const key = store.keys().next().value

      if (key === undefined) return
      const entry = store.get(key)
      store.delete(key)

      if (!entry) continue
      dispose(key, entry)
    }
  }

  const remove = (key: string) => {
    const entry = store.get(key)

    if (!entry) return
    store.delete(key)
    dispose(key, entry)

    return entry.value
  }

  const peek = (key: string) => {
    sweep()
    const entry = store.get(key)

    if (!entry) return

    if (!expired(entry)) return entry.value
    store.delete(key)
    dispose(key, entry)
  }

  const get = (key: string) => {
    sweep()
    const entry = store.get(key)

    if (entry && !expired(entry)) {
      touch(key, entry)

      return entry.value
    }

    if (entry) {
      store.delete(key)
      dispose(key, entry)
    }

    const created = {
      value: createValue(key),
      touchedAt: timestamp(),
    }

    store.set(key, created)
    prune()

    return created.value
  }

  const clear = () => {
    for (const [key, entry] of store) {
      dispose(key, entry)
    }

    store.clear()
  }

  return {
    get,
    peek,
    delete: remove,
    clear,
  }
}
