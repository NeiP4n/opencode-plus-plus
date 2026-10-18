import { randomUUID } from "node:crypto"
import { EOL } from "node:os"
import path from "node:path"
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { Effect, Option } from "effect"
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser"
import { Global } from "@opencode/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.mcp.commands.add,
  Effect.fn("cli.mcp.add")(function* (input) {
    const url = Option.getOrUndefined(input.url)
    const headers = Option.getOrUndefined(input.header)
    const environment = Option.getOrUndefined(input.env)
    // The CLI framework strands `--` operands on the root command, so read the local server command
    // straight from argv after `--`. This also lets the command carry its own flags (e.g. `npx -y`).
    const dash = process.argv.indexOf("--")
    const command = dash === -1 ? [...input.command] : process.argv.slice(dash + 1)

    const hasCommand = command.length > 0
    if (url && hasCommand)
      return yield* Effect.fail(new Error("Provide either --url <url> or a command after --, not both"))
    if (!url && !hasCommand) return yield* Effect.fail(new Error("Provide either --url <url> or a command after --"))
    if (url && !URL.canParse(url)) return yield* Effect.fail(new Error(`Invalid URL: ${url}`))
    if (url && environment) return yield* Effect.fail(new Error("--env is only valid for local MCP servers"))
    if (hasCommand && headers) return yield* Effect.fail(new Error("--header is only valid for remote MCP servers"))

    const server = url
      ? { type: "remote" as const, url, ...(headers ? { headers } : {}) }
      : { type: "local" as const, command, ...(environment ? { environment } : {}) }

    const global = yield* Global.Service
    const configPath = yield* Effect.promise(() => resolveConfigPath(input.global ? global.config : process.cwd()))
    yield* Effect.promise(() => writeConfig(configPath, input.name, server))
    process.stdout.write(`MCP server "${input.name}" added to ${configPath}` + EOL)
  }),
)

export async function resolveConfigPath(directory: string) {
  const candidates = [
    path.join(directory, "opencode.json"),
    path.join(directory, "opencode.jsonc"),
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
  ]
  for (const candidate of candidates) {
    if (
      await stat(candidate).then(
        (info) => info.isFile(),
        () => false,
      )
    )
      return candidate
  }
  return candidates[0]
}

export async function writeConfig(configPath: string, name: string, server: unknown) {
  const text = await readFile(configPath, "utf8").catch((error) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return "{}"
    throw error
  })

  // Never turn a malformed existing config into a silently rewritten file.
  const errors: ParseError[] = []
  const document: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || typeof document !== "object" || document === null || Array.isArray(document)) {
    const details = errors.length ? ` (${errors.map((error) => printParseErrorCode(error.error)).join(", ")})` : ""
    throw new Error(`Invalid OpenCode configuration: ${configPath}${details}`)
  }
  const mcp = "mcp" in document ? document.mcp : undefined
  if (mcp !== undefined && (typeof mcp !== "object" || mcp === null || Array.isArray(mcp))) {
    throw new Error(`Invalid MCP configuration in ${configPath}: "mcp" must be an object`)
  }
  const servers = mcp && "servers" in mcp ? mcp.servers : undefined
  if (servers !== undefined && (typeof servers !== "object" || servers === null || Array.isArray(servers))) {
    throw new Error(`Invalid MCP configuration in ${configPath}: "mcp.servers" must be an object`)
  }

  const edits = modify(text, ["mcp", "servers", name], server, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  })
  const updated = applyEdits(text, edits)
  await mkdir(path.dirname(configPath), { recursive: true })
  const temporary = `${configPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, updated.endsWith("\\n") ? updated : updated + "\\n", { flag: "wx", mode: 0o600 })
    await rename(temporary, configPath)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}
