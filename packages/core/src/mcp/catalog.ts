export * as McpCatalog from "./catalog.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { ServerConfig } from "@opencode/schema/mcp"
import { Effect } from "effect"
import { Config } from "../config.js"

// AI tools the Registry offers to install: MCP servers that give the model new abilities.
// Installing one writes it under mcp.servers in the global config; its tools then reach every
// session (narrowed per role by the team editor's tool list, as `<id>_*`).
export type Entry = {
  readonly id: string
  readonly name: string
  readonly description: string
  // How the model should use it; shown to every session that has it installed.
  readonly usage: string
  // The launcher the server needs on PATH, when it is a local process.
  readonly runtime?: "npx" | "uvx"
  readonly platforms?: readonly NodeJS.Platform[]
  readonly config: ServerConfig
}

const local = (command: string[]): ServerConfig => ({ type: "local", command }) as ServerConfig
const remote = (url: string): ServerConfig => ({ type: "remote", url }) as ServerConfig

export const all: readonly Entry[] = [
  {
    id: "context7",
    name: "Context7",
    description: "Up-to-date documentation and code examples for libraries and frameworks.",
    usage: "Before using a library API you are not sure about, resolve the library id, then fetch its docs for the exact version and topic.",
    runtime: "npx",
    config: local(["npx", "-y", "@upstash/context7-mcp"]),
  },
  {
    id: "rea-anything",
    name: "REA — Reverse Engineer Anything",
    description: "Official REA MCP for evidence-based reverse engineering of native binaries, JavaScript/Electron apps, websites, Android APKs, and .NET assemblies.",
    usage: "Use REA to investigate how an app feature works without source code. Start with the narrowest matching analysis tool, inspect its evidence and limitations, and use runtime capture only when appropriate for the target.",
    runtime: "npx",
    config: local(["npx", "-y", "rea-agents@latest", "mcp"]),
  },
  {
    id: "playwright",
    name: "Playwright",
    description: "Drive a real browser: open pages, click, fill forms, read the accessibility tree, and take screenshots.",
    usage: "For web apps: navigate, inspect the page, interact with elements by stable references, and take screenshots to verify the result.",
    runtime: "npx",
    config: local(["npx", "-y", "@playwright/mcp@latest"]),
  },
  {
    id: "chrome-devtools",
    name: "Chrome DevTools",
    description: "Inspect Chrome pages, console errors, network requests, DOM state, and performance traces.",
    usage: "Use it to debug browser failures, inspect network/API calls, investigate console errors, and profile slow pages.",
    runtime: "npx",
    config: local(["npx", "-y", "chrome-devtools-mcp@latest"]),
  },
  {
    id: "desktop-commander",
    name: "Desktop Commander",
    description: "Long-running terminal sessions, process management, fast file search, and edits across the computer.",
    usage: "Use for interactive or long-running programs: start a process, inspect its output later, send input, search files, or manage processes.",
    runtime: "npx",
    config: local(["npx", "-y", "@wonderwhy-er/desktop-commander"]),
  },
  {
    id: "windows",
    name: "Windows MCP",
    description: "Windows UI automation by accessible element name: inspect windows, click controls, and type text.",
    usage: "Use on Windows for reliable desktop automation by inspecting controls and operating them by semantic names instead of screen coordinates.",
    runtime: "uvx",
    platforms: ["win32"],
    config: local(["uvx", "windows-mcp"]),
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Structured step-by-step problem solving with revisions and branches.",
    usage: "Use only for genuinely difficult planning, architecture, debugging, or analysis where explicit revision of intermediate hypotheses helps.",
    runtime: "npx",
    config: local(["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"]),
  },
  {
    id: "memory",
    name: "Memory",
    description: "Persistent knowledge graph for storing and recalling useful facts across sessions.",
    usage: "Store durable project facts, decisions, entities, and relationships; retrieve them before asking the user for information already recorded.",
    runtime: "npx",
    config: local(["npx", "-y", "@modelcontextprotocol/server-memory"]),
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Secure file and directory operations with search and access control.",
    usage: "Use for file operations when direct tools are insufficient; prefer narrow project roots and never grant access to secrets or unrelated personal directories.",
    runtime: "npx",
    config: local(["npx", "-y", "@modelcontextprotocol/server-filesystem"]),
  },
  {
    id: "git",
    name: "Git",
    description: "Inspect Git status, diffs, history, branches, and repository state through MCP.",
    usage: "Use for repository-aware Git inspection and safe version-control operations. Prefer read-only inspection before modifying history or pushing changes.",
    runtime: "uvx",
    config: local(["uvx", "mcp-server-git"]),
  },
  {
    id: "github",
    name: "GitHub",
    description: "Official GitHub MCP for repositories, code, issues, pull requests, Actions, and workflow intelligence.",
    usage: "Use when a task involves GitHub repositories, issues, pull requests, CI, releases, or code search. Authenticate with OAuth or a token supported by the host.",
    config: remote("https://api.githubcopilot.com/mcp/"),
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    description: "Ask questions about public GitHub repositories and read generated project documentation.",
    usage: "Use to quickly understand an unfamiliar public repository, its architecture, and the location of a feature before making changes.",
    config: remote("https://mcp.deepwiki.com/mcp"),
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch web pages and convert their contents into model-friendly text.",
    usage: "Use to read documentation, articles, changelogs, and other web pages when direct web retrieval is unavailable or when a plain MCP resource is preferable.",
    runtime: "uvx",
    config: local(["uvx", "mcp-server-fetch"]),
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web, news, image, video, local, and place search through the Brave Search API.",
    usage: "Use when current web search is required and a Brave API key is configured. Prefer narrow queries and only enable the search tools actually needed.",
    runtime: "npx",
    config: local(["npx", "-y", "@brave/brave-search-mcp-server", "--transport", "stdio"]),
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Inspect application errors, events, performance data, and debugging context from Sentry.",
    usage: "Use when investigating production errors or regressions: inspect the relevant issue and recent events before proposing a fix.",
    runtime: "npx",
    config: local(["npx", "-y", "@sentry/mcp-server"]),
  },
  {
    id: "time",
    name: "Time",
    description: "Current time and timezone conversion using IANA timezone names.",
    usage: "Use when a task depends on the current time, date, timezone, or converting a time between locations.",
    runtime: "uvx",
    config: local(["uvx", "mcp-server-time"]),
  },
  {
    id: "mcp-docs",
    name: "MCP Documentation",
    description: "Official Model Context Protocol documentation exposed as a remote MCP server.",
    usage: "Use when implementing or debugging MCP clients, servers, transports, schemas, authentication, or protocol behavior.",
    config: remote("https://modelcontextprotocol.io/mcp"),
  },
]

export const forPlatform = (platform: NodeJS.Platform = process.platform) =>
  all.filter((entry) => !entry.platforms || entry.platforms.includes(platform))

// Tells every session which installed AI tools it has and how to use them.
export const Plugin = {
  id: "opencode.mcp.catalog",
  effect: Effect.fn("McpCatalog.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const servers = Config.latest(yield* config.entries(), "mcp")?.servers ?? {}
        // A server's tools are direct tools named <server>_<tool> when its Code Mode is off, and run
        // through the `execute` tool otherwise. Only servers this session can reach are listed, so a
        // role whose tool list leaves a server out is not told about it.
        const installed = all.filter(
          (entry) =>
            servers[entry.id] !== undefined &&
            servers[entry.id]?.disabled !== true &&
            (Object.keys(event.tools).some((tool) => tool.startsWith(`${entry.id}_`)) ||
              (event.tools.execute !== undefined && servers[entry.id]?.codemode !== false)),
        )
        if (installed.length === 0) return
        event.system.push({
          type: "text",
          text: [
            "# Installed AI tools",
            'These MCP servers are installed from the Registry. Call a server\'s tools directly when your tool list has them as <server>_<tool>; otherwise run them through the execute tool under tools["<server>"]. Use them when they fit:',
            ...installed.map((entry) => `- ${entry.id} (${entry.name}): ${entry.usage}`),
          ].join("\n"),
        })
      }),
    )
  }),
}
