import { expect, test } from "bun:test"
import { createTaskQueue } from "../../src/util/task-queue"

test("deduplicates concurrent work for the same key and serializes different keys", async () => {
  const tasks = createTaskQueue<string>()
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const order: string[] = []

  const first = tasks.run("group-a", async () => {
    order.push("a:start")
    await gate
    order.push("a:end")
  })
  const duplicate = tasks.run("group-a", async () => {
    order.push("duplicate")
  })
  const second = tasks.run("group-b", async () => {
    order.push("b")
  })

  expect(duplicate).toBe(first)
  await Promise.resolve()
  expect(order).toEqual(["a:start"])
  release()
  await Promise.all([first, duplicate, second])
  expect(order).toEqual(["a:start", "a:end", "b"])
})

test("a failed task does not block later work and the same key can be retried", async () => {
  const tasks = createTaskQueue<string>()
  await expect(tasks.run("group-a", async () => { throw new Error("failed") })).rejects.toThrow("failed")
  const result: string[] = []
  await tasks.run("group-a", async () => { result.push("retried") })
  await tasks.run("group-b", async () => { result.push("next") })
  expect(result).toEqual(["retried", "next"])
})
