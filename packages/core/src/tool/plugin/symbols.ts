/**
 * Symbol-level code navigation and editing over language servers, after Serena: the model
 * reads an outline instead of a whole file, finds a symbol by its name path, lists who uses
 * it, and replaces or inserts whole declarations without matching text by hand. Every edit
 * goes through the same approval, plot guard and formatter as write, and reports the errors
 * the language server finds right after it.
 */
export * as SymbolsTool from "./symbols.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai"
import { optional } from "@opencode/schema/schema"
import type { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import path from "path"
import { FileAccess } from "../../file-access.js"
import { FileMutation } from "../../file-mutation.js"
import { Formatter } from "../../formatter.js"
import { Location } from "../../location.js"
import { Lsp } from "../../lsp/index.js"
import { Permission } from "../../permission.js"
import { Plot } from "../../plot.js"
import { Ripgrep } from "../../ripgrep.js"
import { fileDiff } from "./file-diff.js"

export const name = "symbols"

export const Input = Schema.Struct({
  action: Schema.Literals([
    "overview",
    "find",
    "references",
    "replace",
    "insert_before",
    "insert_after",
    "rename",
    "diagnostics",
  ]).annotate({ description: "What to do; see the tool description" }),
  path: optional(
    Schema.String.annotate({
      description: "File with the symbol; for find also a directory to search, the whole project by default",
    }),
  ),
  name_path: optional(
    Schema.String.annotate({
      description:
        'Symbol name, or its path through enclosing symbols: "Store", "Store/get", "/Store/get" for top level only',
    }),
  ),
  depth: optional(
    Schema.Number.annotate({ description: "overview and find: levels of child symbols to list, 1 by default" }),
  ),
  include_body: optional(Schema.Boolean.annotate({ description: "find: include the source of each match" })),
  substring: optional(
    Schema.Boolean.annotate({ description: "find: match the last name segment as a case-insensitive substring" }),
  ),
  body: optional(
    Schema.String.annotate({
      description: "replace: the complete new declaration including its signature; insert_*: the code to insert",
    }),
  ),
  new_name: optional(Schema.String.annotate({ description: "rename: the new identifier" })),
})
export type Input = typeof Input.Type

export const description = [
  "Navigate and edit code by symbols through the project's language servers (TypeScript, Python, Go, Rust, C/C++, C#, Java and more when installed).",
  "Prefer it over reading whole files: an overview costs a fraction of a read, and symbol edits cannot miss because of whitespace.",
  "",
  "Actions:",
  "  overview — the symbols of a file as an indented outline with line ranges: path, optional depth.",
  "  find — where a symbol is declared: name_path, optional path to narrow the search, include_body, substring, depth.",
  "  references — every place that uses a symbol, with the enclosing symbol and the line: path of its file, name_path.",
  "  replace — replace a whole declaration: path, name_path, body (signature included).",
  "  insert_before / insert_after — add code before or after a declaration, e.g. a new method after an existing one: path, name_path, body.",
  "  rename — rename a symbol across the project: path, name_path, new_name.",
  "  diagnostics — errors and warnings the language server reports for a file: path.",
  "",
  "A name path names a symbol through its parents: Store/get is the get method of Store. Read the lines from an overview or find with the read tool when you need surrounding code.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.symbols",
  effect: Effect.fn("SymbolsTool.Plugin")(function* (ctx: Context) {
    const lsp = yield* Lsp.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const access = yield* FileAccess.Service
    const fileMutation = yield* FileMutation.Service
    const formatter = yield* Formatter.Service
    const permission = yield* Permission.Service
    const plots = yield* Plot.Service
    const root = location.directory
    const relative = (file: string) => path.relative(root, file) || "."

    const located = Effect.fn("SymbolsTool.located")(function* (input: Input) {
      const file = yield* need(input, "path")
      const query = yield* need(input, "name_path")
      const matches = flatten(yield* lsp.symbols(file)).filter((entry) => matchesPath(entry.path, query, false))
      if (matches.length === 0)
        return yield* fail(`No symbol ${query} in ${file}. Use overview to see the symbols the file declares.`)
      if (matches.length > 1)
        return yield* fail(
          `${query} matches ${matches.length} symbols in ${file}: ${matches.map((entry) => `${entry.path.join("/")} (line ${entry.symbol.range.start.line + 1})`).join(", ")}. Use a longer name path.`,
        )
      return { file: path.resolve(root, file), entry: matches[0] }
    })

    // Write one or more files through the approval, plot and formatter path write uses.
    const commit = Effect.fn("SymbolsTool.commit")(function* (
      changes: ReadonlyArray<{ readonly file: string; readonly before: string; readonly after: string }>,
      context: Tool.Context,
    ) {
      const targets = yield* Effect.forEach(changes, (change) =>
        access.resolve({ path: change.file, kind: "file" }).pipe(Effect.map((target) => ({ target, change }))),
      )
      yield* access.authorizeExternal(
        targets.map((item) => item.target),
        context,
      )
      yield* plots
        .guard({ sessionID: context.sessionID, files: targets.map((item) => item.target.absolute) })
        .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
      yield* permission.assert({
        action: "edit",
        resources: targets.map((item) => item.target.resource),
        save: ["*"],
        metadata: {
          files: targets.map((item) =>
            fileDiff(item.target.resource, item.change.before, item.change.after, "modified"),
          ),
        },
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool" as const, messageID: context.messageID, id: context.id },
      })
      yield* Effect.forEach(targets, (item) =>
        fileMutation
          .writeTextPreservingBom({ target: item.target, content: item.change.after })
          .pipe(Effect.andThen(formatter.file(item.target.absolute))),
      )
      const problems = yield* Effect.forEach(targets, (item) =>
        lsp.diagnostics(item.target.absolute).pipe(
          Effect.map((found) =>
            found
              .filter((diagnostic) => diagnostic.severity === 1)
              .slice(0, 10)
              .map((diagnostic) => `${item.target.resource}:${diagnostic.range.start.line + 1}: ${diagnostic.message}`),
          ),
          Effect.orElseSucceed((): string[] => []),
        ),
      )
      const errors = problems.flat()
      return errors.length === 0
        ? "No errors reported by the language server."
        : `Errors reported by the language server after the edit:\n${errors.join("\n")}`
    })

    const read = (file: string) =>
      Effect.tryPromise({
        try: () => Bun.file(path.resolve(root, file)).text(),
        catch: () => new ToolFailure({ message: `File not found: ${file}` }),
      })

    const run = Effect.fn("SymbolsTool.run")(function* (input: Input, context: Tool.Context) {
      switch (input.action) {
        case "overview": {
          const file = yield* need(input, "path")
          const symbols = yield* lsp.symbols(file)
          if (symbols.length === 0) return `${file} declares no symbols the language server reports.`
          return [`${file}:`, ...outline(symbols, Math.max(1, input.depth ?? 1), 0)].join("\n")
        }
        case "find": {
          const query = yield* need(input, "name_path")
          const files = yield* candidates(query, input.path)
          const found = yield* Effect.forEach(
            files,
            (file) =>
              lsp.symbols(file).pipe(
                Effect.map((symbols) =>
                  flatten(symbols)
                    .filter((entry) => matchesPath(entry.path, query, input.substring === true))
                    .map((entry) => ({ file, entry })),
                ),
                Effect.orElseSucceed(() => []),
              ),
            { concurrency: 4 },
          ).pipe(Effect.map((items) => items.flat().slice(0, 30)))
          if (found.length === 0)
            return `No symbol matches ${query}${input.path ? ` under ${input.path}` : ""}. Try substring: true or a shorter name path.`
          const sources = new Map<string, string>()
          const parts = yield* Effect.forEach(found, (item) =>
            Effect.gen(function* () {
              const head = `${relative(item.file)}:${lines(item.entry.symbol.range)} ${item.entry.symbol.kind} ${item.entry.path.join("/")}`
              const children = (input.depth ?? 0) > 0 ? outline(item.entry.symbol.children, input.depth ?? 0, 1) : []
              if (!input.include_body) return [head, ...children].join("\n")
              const text = sources.get(item.file) ?? (yield* read(item.file))
              sources.set(item.file, text)
              return [head, slice(text, item.entry.symbol.range)].join("\n")
            }),
          )
          return parts.join(input.include_body ? "\n\n" : "\n")
        }
        case "references": {
          const target = yield* located(input)
          const references = yield* lsp.references(target.file, target.entry.symbol.selection.start)
          if (references.length === 0) return `No references to ${target.entry.path.join("/")} found.`
          const byFile = Map.groupBy(references.slice(0, 200), (reference) => reference.file)
          const rendered = yield* Effect.forEach([...byFile], ([file, items]) =>
            Effect.gen(function* () {
              const text = (yield* read(file).pipe(Effect.orElseSucceed(() => ""))).split("\n")
              const symbols = yield* lsp.symbols(file).pipe(Effect.orElseSucceed(() => []))
              return [
                `${relative(file)}:`,
                ...items.map((item) => {
                  const owner = enclosing(flatten(symbols), item.range)
                  return `  ${item.range.start.line + 1}${owner ? ` in ${owner}` : ""}: ${(text[item.range.start.line] ?? "").trim()}`
                }),
              ].join("\n")
            }),
          )
          return [`${references.length} references to ${target.entry.path.join("/")}:`, ...rendered].join("\n")
        }
        case "replace":
        case "insert_before":
        case "insert_after": {
          const target = yield* located(input)
          const body = input.body ?? (yield* fail(`symbols ${input.action} needs body`))
          const before = yield* read(target.file)
          const range = target.entry.symbol.range
          // A multi-line declaration gets a blank line between it and the inserted code.
          const gap = range.start.line === range.end.line ? "" : "\n"
          const code = body.replace(/^\n+/, "").trimEnd()
          const after =
            input.action === "replace"
              ? // The range starts after the declaration's indentation, so the body's own indent is dropped.
                splice(before, offset(before, range.start), offset(before, range.end), code.trimStart())
              : input.action === "insert_after"
                ? splice(before, lineEnd(before, range.end.line), lineEnd(before, range.end.line), `\n${gap}${code}`)
                : splice(
                    before,
                    lineStart(before, range.start.line),
                    lineStart(before, range.start.line),
                    `${code}\n${gap}`,
                  )
          const report = yield* commit([{ file: target.file, before, after }], context)
          const verb =
            input.action === "replace"
              ? "Replaced"
              : input.action === "insert_after"
                ? "Inserted after"
                : "Inserted before"
          return `${verb} ${target.entry.path.join("/")} in ${relative(target.file)}. ${report}`
        }
        case "rename": {
          const target = yield* located(input)
          const newName = yield* need(input, "new_name")
          const edits = yield* lsp.rename(target.file, target.entry.symbol.selection.start, newName)
          if (edits.length === 0) return "The language server found nothing to rename."
          const changes = yield* Effect.forEach(edits, (edit) =>
            read(edit.file).pipe(
              Effect.map((before) => ({
                file: edit.file,
                before,
                // Applied from the end so earlier offsets stay valid.
                after: edit.edits
                  .map((item) => ({
                    start: offset(before, item.range.start),
                    end: offset(before, item.range.end),
                    text: item.newText,
                  }))
                  .toSorted((a, b) => b.start - a.start)
                  .reduce((text, item) => splice(text, item.start, item.end, item.text), before),
              })),
            ),
          )
          const report = yield* commit(changes, context)
          return `Renamed ${target.entry.path.join("/")} to ${newName} in ${changes.length} ${changes.length === 1 ? "file" : "files"}: ${changes.map((change) => relative(change.file)).join(", ")}. ${report}`
        }
        case "diagnostics": {
          const file = yield* need(input, "path")
          const found = yield* lsp.diagnostics(file)
          if (found.length === 0) return `No problems reported for ${file}.`
          return found
            .slice(0, 50)
            .map(
              (item) =>
                `${file}:${item.range.start.line + 1}:${item.range.start.character + 1} ${SEVERITY[item.severity ?? 1] ?? "error"}: ${item.message}`,
            )
            .join("\n")
        }
      }
    })

    // Files that mention the symbol's last name segment, most mentions first.
    const candidates = Effect.fn("SymbolsTool.candidates")(function* (query: string, scope?: string) {
      const word = query.split("/").filter(Boolean).at(-1) ?? query
      const base = scope ? path.resolve(root, scope) : root
      if (scope && (yield* Effect.promise(() => Bun.file(base).exists()))) return [base]
      const matches = yield* ripgrep
        .grep({ cwd: base, pattern: word, literal: true, caseSensitive: false, limit: 2000 })
        .pipe(Effect.orElseSucceed(() => []))
      const counts = Map.groupBy(matches, (match) => path.resolve(base, match.entry.path))
      const ranked = [...counts].toSorted((a, b) => b[1].length - a[1].length).map(([file]) => file)
      const supported = yield* Effect.filter(ranked, (file) => lsp.supports(file))
      return supported.slice(0, 40)
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          execute: (input, context) =>
            run(input, context).pipe(
              Effect.map((output) => ({ content: output })),
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: error instanceof Error ? error.message : String(error), error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

const SEVERITY = ["", "error", "warning", "info", "hint"]

interface Flat {
  readonly symbol: Lsp.Symbol
  readonly path: ReadonlyArray<string>
}

function flatten(symbols: ReadonlyArray<Lsp.Symbol>, parents: ReadonlyArray<string> = []): ReadonlyArray<Flat> {
  return symbols.flatMap((symbol) => {
    const own = [...parents, symbol.name]
    return [{ symbol, path: own }, ...flatten(symbol.children, own)]
  })
}

// "/A/b" is anchored at the top level; "A/b" matches the tail of a symbol's path.
function matchesPath(symbolPath: ReadonlyArray<string>, query: string, substring: boolean) {
  const anchored = query.startsWith("/")
  const wanted = query.split("/").filter(Boolean)
  if (wanted.length === 0 || wanted.length > symbolPath.length) return false
  if (anchored && wanted.length !== symbolPath.length) return false
  const tail = symbolPath.slice(symbolPath.length - wanted.length)
  return wanted.every((segment, index) => {
    const actual = clean(tail[index])
    if (index === wanted.length - 1 && substring) return actual.toLowerCase().includes(segment.toLowerCase())
    return actual === segment
  })
}

// Some servers decorate names: "get()" or "Store<T>"; the bare identifier is what a model types.
function clean(name: string) {
  return name.replace(/[(<].*$/, "").trim()
}

function outline(symbols: ReadonlyArray<Lsp.Symbol>, depth: number, level: number): ReadonlyArray<string> {
  if (depth <= 0) return []
  return symbols.flatMap((symbol) => [
    `${"  ".repeat(level + 1)}${symbol.kind} ${symbol.name} (${lines(symbol.range)})`,
    ...outline(symbol.children, depth - 1, level + 1),
  ])
}

function enclosing(symbols: ReadonlyArray<Flat>, range: Lsp.Range) {
  return symbols
    .filter((entry) => Lsp.contains(entry.symbol.range, range))
    .toSorted((a, b) => b.path.length - a.path.length)[0]
    ?.path.join("/")
}

function lines(range: Lsp.Range) {
  return range.start.line === range.end.line
    ? `${range.start.line + 1}`
    : `${range.start.line + 1}-${range.end.line + 1}`
}

function offset(text: string, position: Lsp.Position) {
  return Math.min(text.length, lineStart(text, position.line) + position.character)
}

function lineStart(text: string, line: number) {
  return text
    .split("\n")
    .slice(0, line)
    .reduce((sum, item) => sum + item.length + 1, 0)
}

function lineEnd(text: string, line: number) {
  return lineStart(text, line) + (text.split("\n")[line]?.length ?? 0)
}

function slice(text: string, range: Lsp.Range) {
  return text.slice(lineStart(text, range.start.line), lineEnd(text, range.end.line))
}

function splice(text: string, start: number, end: number, insert: string) {
  return text.slice(0, start) + insert + text.slice(end)
}

const fail = (message: string) => Effect.fail(new ToolFailure({ message }))

const need = <K extends "path" | "name_path" | "new_name">(input: Input, key: K) => {
  const value = input[key]
  return value === undefined || value === "" ? fail(`symbols ${input.action} needs ${key}`) : Effect.succeed(value)
}
