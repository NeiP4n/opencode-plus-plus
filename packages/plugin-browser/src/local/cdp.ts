export * as LocalCdp from "./cdp.js"

import type { Commands, Events } from "./protocol.js"

/** No single protocol command may wait longer than this; a stalled renderer must not hold a tool call. */
export const COMMAND_TIMEOUT_MS = 15_000

export type Client = Awaited<ReturnType<typeof connect>>

type Listener = (params: unknown, sessionID?: string) => void

/** One flattened browser-level connection: page and frame targets are addressed by session ID. */
export async function connect(url: string) {
  const socket = new WebSocket(url)
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const listeners = new Map<string, Set<Listener>>()
  const closed = Promise.withResolvers<void>()
  let sequence = 0
  let open = true

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out connecting to the browser at ${url}`)), 5_000)
    socket.addEventListener("open", () => (clearTimeout(timer), resolve()), { once: true })
    socket.addEventListener("error", () => (clearTimeout(timer), reject(new Error(`Cannot connect to ${url}`))), {
      once: true,
    })
  })

  const shutdown = (reason: string) => {
    if (!open) return
    open = false
    const error = new Error(`Browser connection closed: ${reason}`)
    pending.forEach((request) => request.reject(error))
    pending.clear()
    closed.resolve()
  }

  socket.addEventListener("close", () => shutdown("the browser went away"))
  socket.addEventListener("error", () => shutdown("socket error"))
  socket.addEventListener("message", (event) => {
    const message = parse(String(event.data))
    if (!message) return
    if (message.id !== undefined) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) return request.reject(new Error(message.error.message))
      return request.resolve(message.result ?? {})
    }
    if (message.method) listeners.get(message.method)?.forEach((listener) => listener(message.params, message.sessionId))
  })

  return {
    closed: closed.promise,
    get open() {
      return open
    },
    send<Method extends keyof Commands>(
      method: Method,
      params: Commands[Method]["params"],
      sessionID?: string,
      timeoutMs = COMMAND_TIMEOUT_MS,
    ): Promise<Commands[Method]["result"]> {
      if (!open) return Promise.reject(new Error("Browser connection is closed"))
      const id = ++sequence
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Chromium did not answer ${method} within ${timeoutMs} ms`))
        }, timeoutMs)
        pending.set(id, {
          // The protocol answers this method with its declared result shape.
          resolve: (value) => (clearTimeout(timer), resolve(value as Commands[Method]["result"])),
          reject: (error) => (clearTimeout(timer), reject(error)),
        })
        socket.send(JSON.stringify({ id, method, params, ...(sessionID ? { sessionId: sessionID } : {}) }))
      })
    },
    on<Method extends keyof Events>(method: Method, callback: (params: Events[Method], sessionID?: string) => void) {
      // The protocol emits this event with its declared parameter shape.
      const listener: Listener = (params, sessionID) => callback(params as Events[Method], sessionID)
      const set = listeners.get(method) ?? new Set()
      set.add(listener)
      listeners.set(method, set)
      return () => {
        set.delete(listener)
      }
    },
    close() {
      shutdown("closed by opencode")
      socket.close()
    },
  }
}

type Message = {
  id?: number
  result?: unknown
  error?: { message: string }
  method?: string
  params?: unknown
  sessionId?: string
}

function parse(data: string): Message | undefined {
  const value: unknown = JSON.parse(data)
  if (typeof value !== "object" || value === null) return
  // CDP frames are JSON objects with these optional fields.
  return value as Message
}
