export * as LspClient from "./client.js"

import { Option, Schema } from "effect"
import { pathToFileURL } from "url"
import path from "path"

/**
 * A minimal Language Server Protocol client over stdio: Content-Length framed JSON-RPC,
 * full-text document sync and pushed diagnostics. It speaks only what the symbol tools
 * need, so any server that implements the base protocol works.
 */

export interface Position {
  readonly line: number
  readonly character: number
}
export interface Range {
  readonly start: Position
  readonly end: Position
}
export interface Diagnostic {
  readonly range: Range
  readonly severity?: number
  readonly message: string
  readonly source?: string
}

export interface Client {
  readonly request: <T>(method: string, params: unknown, timeout?: number) => Promise<T>
  readonly notify: (method: string, params: unknown) => void
  /** Opens a document or sends its new text; returns the version the server now has. */
  readonly sync: (file: string, language: string, text: string) => number
  /** Diagnostics for a document version, waiting up to `timeout` for the server to publish them. */
  readonly diagnostics: (file: string, version: number, timeout: number) => Promise<ReadonlyArray<Diagnostic>>
  readonly exited: Promise<number>
  readonly close: () => Promise<void>
}

export interface StartInput {
  readonly command: ReadonlyArray<string>
  readonly root: string
  readonly env?: Readonly<Record<string, string>>
  readonly initialization?: unknown
}

const TIMEOUT = 45_000
const SETTLE = 500

interface Message {
  readonly id?: number | string
  readonly method?: string
  readonly params?: unknown
  readonly result?: unknown
  readonly error?: { readonly message?: string }
}

interface Published {
  readonly uri: string
  readonly version?: number
  readonly diagnostics?: ReadonlyArray<Diagnostic>
}

export async function start(input: StartInput): Promise<Client> {
  const child = Bun.spawn([...input.command], {
    cwd: input.root,
    env: { ...process.env, ...input.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  })
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  // `seq` orders publishes, so a server that omits versions can still be told fresh from stale.
  const published = new Map<string, { version?: number; seq: number; items: ReadonlyArray<Diagnostic> }>()
  const waiting = new Set<() => void>()
  const documents = new Map<string, { version: number; text: string; seq: number }>()
  let seq = 0
  const rootUri = pathToFileURL(input.root).href
  let next = 1
  let closed = false

  const send = (message: unknown) => {
    // `exited` settles a tick after the process dies; a write in between must not throw.
    if (closed || child.exitCode !== null || child.signalCode !== null) return
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...(message as object) }), "utf8")
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    child.stdin.write(body)
    child.stdin.flush()
  }

  const request = <T>(method: string, params: unknown, timeout = TIMEOUT) =>
    new Promise<T>((resolve, reject) => {
      if (closed) return reject(new Error(`Language server ${input.command[0]} has stopped`))
      const id = next++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Language server ${input.command[0]} did not answer ${method} within ${timeout / 1000}s`))
      }, timeout)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value as T)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      send(params === undefined ? { id, method } : { id, method, params })
    })

  // `params: null` is invalid for methods without params, such as shutdown and exit.
  const notify = (method: string, params: unknown) => send(params === undefined ? { method } : { method, params })

  // Requests a server sends us. Answering every one keeps servers that block on them going.
  const answer = (id: number | string, method: string, params: unknown) => {
    const items = (params as { items?: ReadonlyArray<unknown> } | undefined)?.items ?? []
    const result =
      method === "workspace/configuration"
        ? items.map(() => input.initialization ?? null)
        : method === "workspace/workspaceFolders"
          ? [{ uri: rootUri, name: path.basename(input.root) }]
          : null
    send({ id, result })
  }

  const dispatch = (message: Message) => {
    if (message.method !== undefined && message.id !== undefined)
      return answer(message.id, message.method, message.params)
    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as Published
      published.set(params.uri, { version: params.version, seq: ++seq, items: params.diagnostics ?? [] })
      waiting.forEach((wake) => wake())
      return
    }
    if (typeof message.id !== "number") return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message ?? "Language server error"))
    else entry.resolve(message.result)
  }

  const read = async () => {
    const reader = child.stdout.getReader()
    let buffer = new Uint8Array(0)
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true as const, value: undefined }))
      if (chunk.done) return
      buffer = concat(buffer, chunk.value)
      for (;;) {
        const header = indexOf(buffer, HEADER_END)
        if (header < 0) break
        const length = Number(
          /content-length:\s*(\d+)/i.exec(Buffer.from(buffer.subarray(0, header)).toString("ascii"))?.[1],
        )
        if (!Number.isFinite(length)) {
          buffer = buffer.subarray(header + HEADER_END.length)
          continue
        }
        const begin = header + HEADER_END.length
        if (buffer.length < begin + length) break
        const body = Buffer.from(buffer.subarray(begin, begin + length)).toString("utf8")
        buffer = buffer.subarray(begin + length)
        Option.map(decode(body), (parsed) => dispatch(parsed as Message))
      }
    }
  }

  const exited = child.exited.then((code) => {
    closed = true
    pending.forEach((entry) => entry.reject(new Error(`Language server ${input.command[0]} exited with code ${code}`)))
    pending.clear()
    waiting.forEach((wake) => wake())
    return code
  })
  void read()

  const initialized = await request<{ capabilities?: { diagnosticProvider?: unknown } }>("initialize", {
    processId: process.pid,
    rootUri,
    rootPath: input.root,
    workspaceFolders: [{ uri: rootUri, name: path.basename(input.root) }],
    initializationOptions: input.initialization,
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
      textDocument: {
        synchronization: { didSave: true, dynamicRegistration: false },
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        references: {},
        definition: {},
        rename: { prepareSupport: false },
        publishDiagnostics: { versionSupport: true },
        diagnostic: { dynamicRegistration: false },
      },
      workspace: { workspaceFolders: true, configuration: true, workspaceEdit: { documentChanges: true } },
      window: { workDoneProgress: true },
    },
  })
  notify("initialized", {})

  return {
    request,
    notify,
    sync: (file, language, text) => {
      const uri = pathToFileURL(file).href
      const current = documents.get(uri)
      if (!current) {
        documents.set(uri, { version: 1, text, seq })
        notify("textDocument/didOpen", { textDocument: { uri, languageId: language, version: 1, text } })
        return 1
      }
      if (current.text === text) return current.version
      const version = current.version + 1
      documents.set(uri, { version, text, seq })
      notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] })
      return version
    },
    diagnostics: (file, version, timeout) => {
      const uri = pathToFileURL(file).href
      // Servers that offer pull diagnostics answer for the current text directly.
      if (initialized.capabilities?.diagnosticProvider)
        return request<{ items?: ReadonlyArray<Diagnostic> }>(
          "textDocument/diagnostic",
          { textDocument: { uri } },
          timeout,
        ).then((report) => report.items ?? [])
      const synced = documents.get(uri)?.seq ?? 0
      const fresh = () => {
        const entry = published.get(uri)
        if (!entry) return false
        return entry.version !== undefined ? entry.version >= version : entry.seq > synced
      }
      if (fresh() || closed) return Promise.resolve(published.get(uri)?.items ?? [])
      // Servers often publish syntax errors first and type errors a moment later, so after the
      // first fresh publish keep listening until they go quiet for SETTLE.
      return new Promise((resolve) => {
        let settle: ReturnType<typeof setTimeout> | undefined
        const finish = () => {
          waiting.delete(wake)
          clearTimeout(limit)
          clearTimeout(settle)
          resolve(published.get(uri)?.items ?? [])
        }
        const wake = () => {
          if (closed) return finish()
          if (!fresh()) return
          clearTimeout(settle)
          settle = setTimeout(finish, SETTLE)
        }
        const limit = setTimeout(finish, timeout)
        waiting.add(wake)
      })
    },
    exited,
    close: async () => {
      if (closed) return
      await request("shutdown", undefined, 3000).catch(() => undefined)
      notify("exit", undefined)
      closed = true
      const timer = setTimeout(() => child.kill(), 2000)
      await exited
      clearTimeout(timer)
    },
  }
}

const HEADER_END = new Uint8Array([13, 10, 13, 10])

function concat(left: Uint8Array, right: Uint8Array) {
  const result = new Uint8Array(left.length + right.length)
  result.set(left)
  result.set(right, left.length)
  return result
}

function indexOf(haystack: Uint8Array, needle: Uint8Array) {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((byte, offset) => haystack[i + offset] === byte)) return i
  }
  return -1
}

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
