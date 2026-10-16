export * as ClaudeAdapter from "./index.js"

/**
 * Turns everything Claude Code reads into OpenCode config documents, so the existing command, agent, MCP
 * and permission plugins pick them up unchanged; CLAUDE.md files come back separately as instructions.
 *
 * Two documents come out: one for the home folder and one for the project. Config places the home one
 * above OpenCode's global config and the project one below OpenCode's project config, so OpenCode wins at
 * each level and a Claude project still beats an OpenCode global.
 */

import path from "path"
import { Effect, Schema } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { ClaudeContext } from "./context.js"
import { ClaudeSettings } from "./settings.js"
import { ClaudeCommands } from "./commands.js"
import { ClaudeAgents } from "./agents.js"
import { ClaudeMcp } from "./mcp.js"
import { ClaudeInstructions } from "./instructions.js"
import { ClaudeHookConfig } from "./hooks/config.js"

export interface Input {
  /** Claude folders, home first, then project folders from farthest to nearest. */
  readonly roots: readonly string[]
  /** Which of `roots` are home folders. */
  readonly global: readonly string[]
  readonly project: string
  readonly directory: string
  readonly home: string
  readonly trusted: boolean
  readonly env: NodeJS.ProcessEnv
  /** Read the home folder and `~/.claude.json`; false when global config is off. */
  readonly includeGlobal: boolean
  /** Walk the project for CLAUDE.md and `.mcp.json`; false when project config is off. */
  readonly includeProject: boolean
  /** AGENTS.md files other sources already load; CLAUDE.md imports of them are not repeated. */
  readonly loadedInstructions: readonly string[]
}

export interface Loaded {
  instructions: number
  commands: number
  agents: number
  mcp: number
  rules: number
  hooks: number
}

export interface Result {
  /** Encoded config documents, decoded by Config like any other source. */
  readonly documents: { readonly global?: Record<string, unknown>; readonly project?: Record<string, unknown> }
  /** Source path per document, for diagnostics. */
  readonly paths: { readonly global?: string; readonly project?: string }
  readonly instructions: readonly ClaudeInstructions.File[]
  /** Command hooks that may run: home ones always, project ones only when trusted. */
  readonly hooks: readonly ClaudeHookConfig.Hook[]
  readonly loaded: Loaded
  readonly skipped: readonly ClaudeContext.Skipped[]
}

interface Scope {
  commands: Record<string, ClaudeCommands.Command>
  agents: Record<string, ClaudeAgents.Agent>
  servers: Record<string, ClaudeMcp.Server>
  permissions: unknown[]
  model?: string
  defaultAgent?: string
  disabledMcpServers: string[]
}

const emptyScope = (): Scope => ({ commands: {}, agents: {}, servers: {}, permissions: [], disabledMcpServers: [] })

function encode(scope: Scope) {
  const document: Record<string, unknown> = {}
  if (Object.keys(scope.commands).length) document.commands = scope.commands
  if (Object.keys(scope.agents).length) document.agents = scope.agents
  if (Object.keys(scope.servers).length) document.mcp = { servers: scope.servers }
  if (scope.permissions.length) document.permissions = scope.permissions
  if (scope.model) document.model = scope.model
  if (scope.defaultAgent) document.default_agent = scope.defaultAgent
  return Object.keys(document).length ? document : undefined
}

/** Ancestors from the project root down to the directory, farthest first. */
export function levels(project: string, directory: string) {
  const relative = path.relative(project, directory)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return [directory]
  const parts = relative ? relative.split(path.sep) : []
  return [project, ...parts.map((_, index) => path.join(project, ...parts.slice(0, index + 1)))]
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const readJson = Effect.fnUntraced(function* (file: string) {
  const fs = yield* FSUtil.Service
  const text = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
  if (text === undefined) return { type: "missing" as const }
  const parsed = decodeJson(text)
  return parsed._tag === "Some" ? { type: "ok" as const, value: parsed.value } : { type: "invalid" as const }
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const markdown = Effect.fnUntraced(function* (directory: string, pattern: string) {
  const fs = yield* FSUtil.Service
  const files = yield* fs
    .scan(pattern, { cwd: directory, absolute: true, dot: true, symlink: true })
    .pipe(Effect.orElseSucceed(() => [] as string[]))
  return yield* Effect.forEach(files.toSorted(), (file) =>
    fs.readFileStringSafe(file).pipe(
      Effect.map((content) => (content === undefined ? undefined : { path: file, content })),
      Effect.orElseSucceed(() => undefined),
    ),
  ).pipe(Effect.map((items) => items.filter((item) => item !== undefined)))
})

/** `~/.claude.json` keys projects by path; Claude writes forward slashes on Windows, so compare loosely. */
function sameProject(key: string, project: string) {
  const normalize = (value: string) => path.resolve(value).replaceAll("\\", "/").replace(/\/+$/, "")
  const left = normalize(key)
  const right = normalize(project)
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

export const load = Effect.fn("ClaudeAdapter.load")(function* (input: Input) {
  const fs = yield* FSUtil.Service
  const skipped: ClaudeContext.Skipped[] = []
  const scopes = { global: emptyScope(), project: emptyScope() }
  const hooks: ClaudeHookConfig.Hook[] = []
  let disableHooks = false
  const paths: { global?: string; project?: string } = {}
  const context = (scope: "global" | "project", root: string): ClaudeContext.Context => ({
    scope,
    trusted: input.trusted,
    root,
    project: input.project,
    directory: input.directory,
    home: input.home,
    env: input.env,
  })

  // Folders: settings, commands and agents. Later (nearer) folders override earlier ones by name.
  for (const root of input.roots) {
    const scopeName = input.global.includes(root) ? "global" : "project"
    if (scopeName === "global" ? !input.includeGlobal : !input.includeProject) continue
    const scope = scopes[scopeName]
    const ctx = context(scopeName, root)
    paths[scopeName] = root
    for (const name of ClaudeSettings.FILES) {
      const file = path.join(root, name)
      const text = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
      if (text === undefined) continue
      const settings = ClaudeSettings.parse(text, file, ctx)
      skipped.push(...settings.skipped)
      scope.permissions.push(...settings.permissions)
      if (settings.model) scope.model = settings.model
      if (settings.defaultAgent) scope.defaultAgent = settings.defaultAgent
      scope.disabledMcpServers.push(...settings.disabledMcpServers)
      hooks.push(...settings.hooks)
      if (settings.disableHooks) disableHooks = true
      if (settings.mcpServers !== undefined) {
        const found = ClaudeMcp.servers(settings.mcpServers, file, ctx)
        Object.assign(scope.servers, found.servers)
        skipped.push(...found.skipped)
      }
    }
    const commands = path.join(root, "commands")
    for (const file of yield* markdown(commands, "**/*.md")) {
      const converted = ClaudeCommands.convert(file, commands, ctx)
      skipped.push(...converted.skipped)
      if (converted.command) scope.commands[converted.name] = converted.command
    }
    for (const file of yield* markdown(path.join(root, "agents"), "**/*.md")) {
      const converted = ClaudeAgents.convert(file)
      skipped.push(...converted.skipped)
      if (converted.agent) scope.agents[converted.id] = converted.agent
    }
  }

  // MCP servers outside the folders: the user's own `~/.claude.json`, then the repository's `.mcp.json`.
  const globalRoot = input.global[0] ?? path.join(input.home, ".claude")
  if (input.includeGlobal) {
    const userFile = path.join(input.home, ".claude.json")
    const user = yield* readJson(userFile)
    if (user.type === "invalid") skipped.push({ source: userFile, reason: "file is not valid JSON" })
    if (user.type === "ok" && isRecord(user.value)) {
      const projects = isRecord(user.value.projects) ? user.value.projects : {}
      const local = Object.entries(projects).find(([key]) => sameProject(key, input.project))?.[1]
      for (const value of [user.value.mcpServers, isRecord(local) ? local.mcpServers : undefined]) {
        const found = ClaudeMcp.servers(value, userFile, context("global", globalRoot))
        Object.assign(scopes.global.servers, found.servers)
        skipped.push(...found.skipped)
      }
    }
  }
  if (input.includeProject) {
    const projectFile = path.join(input.project, ".mcp.json")
    const shared = yield* readJson(projectFile)
    if (shared.type === "invalid") skipped.push({ source: projectFile, reason: "file is not valid JSON" })
    if (shared.type === "ok" && isRecord(shared.value)) {
      const found = ClaudeMcp.servers(
        shared.value.mcpServers,
        projectFile,
        context("project", path.join(input.project, ".claude")),
        { disabled: [...scopes.global.disabledMcpServers, ...scopes.project.disabledMcpServers] },
      )
      // Servers the user configured personally outrank the repository's shared ones of the same name.
      scopes.project.servers = { ...found.servers, ...scopes.project.servers }
      skipped.push(...found.skipped)
    }
  }

  // CLAUDE.md: home first, then the project from the nearest level to the farthest, like AGENTS.md.
  const skip = new Set(yield* Effect.forEach(input.loadedInstructions, (file) => fs.resolve(file)))
  const candidates = [
    ...(input.includeGlobal ? [{ file: path.join(globalRoot, "CLAUDE.md"), scope: "global" as const }] : []),
    ...(input.includeProject
      ? levels(input.project, input.directory)
          .toReversed()
          .flatMap((level) =>
            ClaudeInstructions.PROJECT_FILES.map((name) => ({
              file: path.join(level, name),
              scope: "project" as const,
            })),
          )
      : []),
  ]
  const instructions: ClaudeInstructions.File[] = []
  for (const candidate of candidates) {
    if (!(yield* fs.isFile(candidate.file))) continue
    const loaded = yield* ClaudeInstructions.load(candidate.file, context(candidate.scope, globalRoot), skip)
    skipped.push(...loaded.skipped)
    if (loaded.file) instructions.push(loaded.file)
  }

  const count = (key: "commands" | "agents" | "servers") =>
    Object.keys(scopes.global[key]).length + Object.keys(scopes.project[key]).length
  const active = disableHooks ? [] : hooks
  if (disableHooks && hooks.length)
    skipped.push({ source: "settings", reason: `disableAllHooks turned off ${hooks.length} hook(s)` })
  return {
    documents: { global: encode(scopes.global), project: encode(scopes.project) },
    paths,
    instructions,
    hooks: active,
    loaded: {
      instructions: instructions.length,
      commands: count("commands"),
      agents: count("agents"),
      mcp: count("servers"),
      rules: scopes.global.permissions.length + scopes.project.permissions.length,
      hooks: active.length,
    },
    skipped,
  } satisfies Result
})

/** Files and folders whose change should reload Claude sources; the rest of `~/.claude` churns constantly. */
export function watchTargets(
  input: Pick<Input, "roots" | "project" | "directory" | "home" | "includeGlobal" | "includeProject">,
) {
  return {
    files: [
      ...input.roots.flatMap((root) =>
        [...ClaudeSettings.FILES, "CLAUDE.md", "commands", "agents"].map((name) => path.join(root, name)),
      ),
      ...(input.includeGlobal ? [path.join(input.home, ".claude.json")] : []),
      ...(input.includeProject
        ? [
            path.join(input.project, ".mcp.json"),
            ...levels(input.project, input.directory).flatMap((level) =>
              ["CLAUDE.md", "CLAUDE.local.md"].map((name) => path.join(level, name)),
            ),
          ]
        : []),
    ],
    directories: input.roots.flatMap((root) => ["commands", "agents"].map((name) => path.join(root, name))),
  }
}
