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
    description: "Drive a real browser: open pages, click, fill forms, read the accessibility tree, take screenshots.",
    usage: "For web pages and web apps: navigate, take a snapshot to get element refs, then click/type by ref; screenshot to verify.",
    runtime: "npx",
    config: local(["npx", "-y", "@playwright/mcp@latest"]),
  },
  {
    id: "chrome-devtools",
    name: "Chrome DevTools",
    description: "Inspect a Chrome page: console, network requests, performance traces, DOM.",
    usage: "To debug a web page: open it, read console errors and failed network requests, record a performance trace when it is slow.",
    runtime: "npx",
    config: local(["npx", "-y", "chrome-devtools-mcp@latest"]),
  },
  {
    id: "desktop-commander",
    name: "Desktop Commander",
    description: "Long-running terminal sessions, process management, fast file search and edits across the whole computer.",
    usage: "For interactive or long programs: start a process, read its output later, send input to it, list and kill processes.",
    runtime: "npx",
    config: local(["npx", "-y", "@wonderwhy-er/desktop-commander"]),
  },
  {
    id: "windows",
    name: "Windows MCP",
    description: "Windows UI automation by element: read the window's controls, click and type into them by name.",
    usage: "To operate a Windows app reliably: read its UI state to find controls by name, then click or type into them instead of guessing pixels.",
    runtime: "uvx",
    platforms: ["win32"],
    config: local(["uvx", "windows-mcp"]),
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Structured step-by-step reasoning for hard problems, with revisions and branches.",
    usage: "For a hard design or debugging problem: think it through in numbered steps, revising earlier steps when you learn more.",
    runtime: "npx",
    config: local(["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"]),
  },
  {
    id: "memory",
    name: "Memory",
    description: "A persistent knowledge graph the model can store facts in and recall across sessions.",
    usage: "Store durable facts about the user and project as entities and relations; search memory before asking again.",
    runtime: "npx",
    config: local(["npx", "-y", "@modelcontextprotocol/server-memory"]),
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    description: "Ask questions about any public GitHub repository and read its generated documentation.",
    usage: "To understand an open-source project without cloning it: ask about its structure or a specific feature.",
    config: remote("https://mcp.deepwiki.com/mcp"),
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch a web page and get it as markdown.",
    usage: "To read a web page as text when the webfetch tool is not enough.",
    runtime: "uvx",
    config: local(["uvx", "mcp-server-fetch"]),
  },
  {
    id: "time",
    name: "Time",
    description: "Current time and time zone conversion.",
    usage: "When a task depends on the current date or time in a time zone.",
    runtime: "uvx",
    config: local(["uvx", "mcp-server-time"]),
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
