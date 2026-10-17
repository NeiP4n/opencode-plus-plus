/**
 * Language servers for the active Location, started lazily per language and stopped with
 * the Location. They power the symbol tools: outline, find, references, rename and
 * diagnostics after an edit, the way Serena exposes an IDE to an agent.
 *
 * Built-in servers start only when their binary is on PATH (or in the project's
 * node_modules/.bin). The `lsp` config key adds servers, overrides a built-in by name,
 * disables one with `{ "disabled": true }`, or turns all of them off with `false`.
 */
export * as Lsp from "./index.js"

import { ConfigLSP } from "@opencode/schema/config/lsp"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Option, Schema } from "effect"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Config } from "../config.js"
import { Location } from "../location.js"
import { LspClient } from "./client.js"

export type Range = LspClient.Range
export type Position = LspClient.Position
export type Diagnostic = LspClient.Diagnostic

export interface Symbol {
  readonly name: string
  readonly kind: string
  /** The whole declaration. */
  readonly range: Range
  /** The name inside the declaration. */
  readonly selection: Range
  readonly children: ReadonlyArray<Symbol>
}

export interface Reference {
  readonly file: string
  readonly range: Range
}

export interface FileEdit {
  readonly file: string
  readonly edits: ReadonlyArray<{ readonly range: Range; readonly newText: string }>
}

export class LspError extends Schema.TaggedError<LspError>()("Lsp.Error", {
  message: Schema.String,
}) {}

export interface Interface {
  /** Whether some server handles the file, without starting it. */
  readonly supports: (file: string) => Effect.Effect<boolean>
  readonly symbols: (file: string) => Effect.Effect<ReadonlyArray<Symbol>, LspError>
  readonly references: (file: string, position: Position) => Effect.Effect<ReadonlyArray<Reference>, LspError>
  readonly rename: (file: string, position: Position, name: string) => Effect.Effect<ReadonlyArray<FileEdit>, LspError>
  /** Sends the file's current text and returns the errors and warnings the server reports for it. */
  readonly diagnostics: (file: string, timeout?: number) => Effect.Effect<ReadonlyArray<Diagnostic>, LspError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Lsp") {}

interface Server {
  readonly id: string
  readonly extensions: ReadonlyArray<string>
  /** Alternatives, the first one found on PATH wins. */
  readonly commands: ReadonlyArray<ReadonlyArray<string>>
  readonly env?: Readonly<Record<string, string>>
  readonly initialization?: unknown
}

export const BUILTIN: ReadonlyArray<Server> = [
  {
    id: "typescript",
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
    commands: [["typescript-language-server", "--stdio"]],
  },
  {
    id: "python",
    extensions: [".py", ".pyi"],
    commands: [["basedpyright-langserver", "--stdio"], ["pyright-langserver", "--stdio"], ["pylsp"]],
  },
  { id: "go", extensions: [".go"], commands: [["gopls"]] },
  { id: "rust", extensions: [".rs"], commands: [["rust-analyzer"]] },
  {
    id: "clangd",
    extensions: [".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx", ".m", ".mm"],
    commands: [["clangd"]],
  },
  { id: "csharp", extensions: [".cs"], commands: [["csharp-ls"], ["OmniSharp", "-lsp"]] },
  { id: "java", extensions: [".java"], commands: [["jdtls"]] },
  { id: "kotlin", extensions: [".kt", ".kts"], commands: [["kotlin-language-server"]] },
  { id: "lua", extensions: [".lua"], commands: [["lua-language-server"]] },
  { id: "ruby", extensions: [".rb"], commands: [["ruby-lsp"], ["solargraph", "stdio"]] },
  { id: "php", extensions: [".php"], commands: [["intelephense", "--stdio"]] },
  { id: "zig", extensions: [".zig"], commands: [["zls"]] },
  { id: "swift", extensions: [".swift"], commands: [["sourcekit-lsp"]] },
  { id: "dart", extensions: [".dart"], commands: [["dart", "language-server"]] },
  { id: "bash", extensions: [".sh", ".bash"], commands: [["bash-language-server", "start"]] },
]

const LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".m": "objective-c",
  ".mm": "objective-cpp",
  ".cs": "csharp",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".lua": "lua",
  ".rb": "ruby",
  ".php": "php",
  ".zig": "zig",
  ".swift": "swift",
  ".dart": "dart",
  ".sh": "shellscript",
  ".bash": "shellscript",
}

// LSP SymbolKind numbers, 1-based.
const KINDS = [
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enum member",
  "struct",
  "event",
  "operator",
  "type parameter",
]

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const config = yield* Config.Service
    const root = location.directory
    const running = new Map<string, Promise<LspClient.Client>>()

    yield* Effect.addFinalizer(() =>
      Effect.promise(() =>
        Promise.all([...running.values()].map((client) => client.then((item) => item.close()).catch(() => undefined))),
      ),
    )

    const servers = Effect.fn("Lsp.servers")(function* () {
      const configured = (yield* config.entries()).reduce<typeof ConfigLSP.Info.Type | undefined>((result, entry) => {
        if (entry.type !== "document" || entry.info.lsp === undefined) return result
        if (typeof entry.info.lsp === "boolean" || typeof result !== "object") return entry.info.lsp
        return { ...result, ...entry.info.lsp }
      }, undefined)
      if (configured === false) return []
      const entries = typeof configured === "object" ? configured : {}
      const custom = Object.entries(entries).flatMap(([id, entry]): Server[] => {
        if ("command" in entry && !entry.disabled)
          return [
            {
              id,
              extensions: entry.extensions ?? BUILTIN.find((server) => server.id === id)?.extensions ?? [],
              commands: [entry.command],
              env: entry.env,
              initialization: entry.initialization,
            },
          ]
        return []
      })
      return [...custom, ...BUILTIN.filter((server) => !Object.hasOwn(entries, server.id))]
    })

    // typescript-language-server refuses to start in a folder without the typescript package;
    // the copy opencode runs on is the fallback, and a workspace version still wins.
    const tsserver = yield* Effect.try(() => Bun.resolveSync("typescript/lib/tsserver.js", import.meta.dir)).pipe(
      Effect.option,
    )

    // The first server whose binary exists, with the command resolved to an absolute path.
    const pick = Effect.fn("Lsp.pick")(function* (file: string) {
      const extension = path.extname(file).toLowerCase()
      const searchPath = [path.join(root, "node_modules", ".bin"), process.env.PATH ?? ""].join(path.delimiter)
      for (const server of yield* servers()) {
        if (!server.extensions.includes(extension)) continue
        for (const command of server.commands) {
          const binary = Bun.which(command[0], { PATH: searchPath })
          if (binary) return { server, command: [binary, ...command.slice(1)] }
        }
      }
      return undefined
    })

    const client = Effect.fn("Lsp.client")(function* (file: string) {
      const found = yield* pick(file)
      if (!found) {
        const known = BUILTIN.find((server) => server.extensions.includes(path.extname(file).toLowerCase()))
        return yield* new LspError({
          message: known
            ? `No language server for ${path.basename(file)}: install one of ${known.commands.map((command) => command[0]).join(", ")} or configure "lsp" in opencode.json.`
            : `No language server handles ${path.extname(file) || path.basename(file)} files; configure one under "lsp" in opencode.json.`,
        })
      }
      const existing = running.get(found.server.id)
      const started =
        existing ??
        LspClient.start({
          command: found.command,
          root,
          env: found.server.env,
          initialization:
            found.server.id === "typescript" && found.server.initialization === undefined && Option.isSome(tsserver)
              ? { tsserver: { fallbackPath: tsserver.value } }
              : found.server.initialization,
        })
      if (!existing) {
        running.set(found.server.id, started)
        // A crashed server is started again on the next call instead of failing forever.
        void started.then(
          (item) => item.exited.then(() => running.delete(found.server.id)),
          () => running.delete(found.server.id),
        )
      }
      return yield* Effect.tryPromise({
        try: () => started,
        catch: (cause) => new LspError({ message: `Could not start ${found.command[0]}: ${String(cause)}` }),
      })
    })

    // Every call sends the file's text from disk first, so the server never answers for stale content.
    const open = Effect.fn("Lsp.open")(function* (file: string) {
      const absolute = path.resolve(root, file)
      const lsp = yield* client(absolute)
      const text = yield* Effect.tryPromise({
        try: () => Bun.file(absolute).text(),
        catch: () => new LspError({ message: `File not found: ${file}` }),
      })
      const version = lsp.sync(absolute, LANGUAGES[path.extname(absolute).toLowerCase()] ?? "plaintext", text)
      return { lsp, absolute, uri: pathToFileURL(absolute).href, version }
    })

    const call = <T>(promise: () => Promise<T>) =>
      Effect.tryPromise({
        try: promise,
        catch: (cause) => new LspError({ message: String(cause instanceof Error ? cause.message : cause) }),
      })

    return Service.of({
      supports: (file) =>
        pick(path.resolve(root, file)).pipe(
          Effect.map((found) => found !== undefined),
          Effect.orElseSucceed(() => false),
        ),
      symbols: Effect.fn("Lsp.symbols")(function* (file) {
        const document = yield* open(file)
        const result = yield* call(() =>
          document.lsp.request<ReadonlyArray<RawSymbol> | null>("textDocument/documentSymbol", {
            textDocument: { uri: document.uri },
          }),
        )
        return normalize(result ?? [])
      }),
      references: Effect.fn("Lsp.references")(function* (file, position) {
        const document = yield* open(file)
        const result = yield* call(() =>
          document.lsp.request<ReadonlyArray<{ uri: string; range: Range }> | null>("textDocument/references", {
            textDocument: { uri: document.uri },
            position,
            context: { includeDeclaration: false },
          }),
        )
        return (result ?? []).map((item) => ({ file: fileURLToPath(item.uri), range: item.range }))
      }),
      rename: Effect.fn("Lsp.rename")(function* (file, position, name) {
        const document = yield* open(file)
        const result = yield* call(() =>
          document.lsp.request<WorkspaceEdit | null>("textDocument/rename", {
            textDocument: { uri: document.uri },
            position,
            newName: name,
          }),
        )
        if (!result) return yield* new LspError({ message: "The language server cannot rename this symbol." })
        return fileEdits(result)
      }),
      diagnostics: Effect.fn("Lsp.diagnostics")(function* (file, timeout = 3000) {
        const document = yield* open(file)
        return yield* call(() => document.lsp.diagnostics(document.absolute, document.version, timeout))
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Location.node, Config.node] })

interface RawSymbol {
  readonly name: string
  readonly kind: number
  readonly range?: Range
  readonly selectionRange?: Range
  readonly location?: { readonly range: Range }
  readonly containerName?: string
  readonly children?: ReadonlyArray<RawSymbol>
}

interface WorkspaceEdit {
  readonly changes?: Readonly<Record<string, ReadonlyArray<{ range: Range; newText: string }>>>
  readonly documentChanges?: ReadonlyArray<{
    readonly textDocument?: { readonly uri: string }
    readonly edits?: ReadonlyArray<{ range: Range; newText: string }>
  }>
}

// Servers answer with a DocumentSymbol tree or a flat SymbolInformation list; both become a tree
// in source order, which some servers do not keep.
function normalize(raw: ReadonlyArray<RawSymbol>): ReadonlyArray<Symbol> {
  return ordered(build(raw))
}

function ordered(symbols: ReadonlyArray<Symbol>): ReadonlyArray<Symbol> {
  return symbols
    .map((symbol) => ({ ...symbol, children: ordered(symbol.children) }))
    .toSorted((a, b) => a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character)
}

function build(raw: ReadonlyArray<RawSymbol>): ReadonlyArray<Symbol> {
  const tree = (symbol: RawSymbol): Symbol => {
    const range = symbol.range ?? symbol.location?.range ?? EMPTY
    return {
      name: symbol.name,
      kind: KINDS[symbol.kind - 1] ?? "symbol",
      range,
      selection: symbol.selectionRange ?? range,
      children: (symbol.children ?? []).map(tree),
    }
  }
  if (raw.some((symbol) => symbol.location !== undefined)) {
    const flat = raw.map(tree)
    // Nest each symbol under the smallest other symbol whose range contains it.
    const parent = (symbol: Symbol) =>
      flat
        .filter((other) => other !== symbol && contains(other.range, symbol.range))
        .toSorted((a, b) => size(a.range) - size(b.range))[0]
    const childrenOf = (owner: Symbol | undefined): ReadonlyArray<Symbol> =>
      flat.filter((symbol) => parent(symbol) === owner).map((symbol) => ({ ...symbol, children: childrenOf(symbol) }))
    return childrenOf(undefined)
  }
  return raw.map(tree)
}

function fileEdits(edit: WorkspaceEdit): ReadonlyArray<FileEdit> {
  const fromChanges = Object.entries(edit.changes ?? {}).map(([uri, edits]) => ({ file: fileURLToPath(uri), edits }))
  const fromDocuments = (edit.documentChanges ?? []).flatMap((change) =>
    change.textDocument && change.edits ? [{ file: fileURLToPath(change.textDocument.uri), edits: change.edits }] : [],
  )
  return [...fromDocuments, ...fromChanges]
}

const EMPTY: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

export function contains(outer: Range, inner: Range) {
  return before(outer.start, inner.start) && before(inner.end, outer.end)
}

function before(a: Position, b: Position) {
  return a.line < b.line || (a.line === b.line && a.character <= b.character)
}

function size(range: Range) {
  return (range.end.line - range.start.line) * 10_000 + range.end.character - range.start.character
}
