/**
 * Serialize keyed asynchronous work and collapse concurrent requests for the same key.
 *
 * Failed work does not poison the queue: the next task still runs, and a later request
 * for the failed key can retry after the failed promise has been removed.
 */
export function createTaskQueue<K>() {
  const pending = new Map<K, Promise<void>>()
  let queue: Promise<void> = Promise.resolve()

  return {
    run(key: K, action: () => Promise<void>): Promise<void> {
      const existing = pending.get(key)
      if (existing) return existing

      const task = queue.then(action)
      pending.set(key, task)
      queue = task.then(
        () => undefined,
        () => undefined,
      )
      const clear = () => {
        if (pending.get(key) === task) pending.delete(key)
      }
      void task.then(clear, clear)
      return task
    },
  }
}
