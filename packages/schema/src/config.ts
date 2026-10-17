export * as Config from "./config.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { Permission } from "./permission.js"
import { AbsolutePath, optional } from "./schema.js"
import { ConfigAgent } from "./config/agent.js"
import { ConfigMedia } from "./config/media.js"
import { ConfigCompaction } from "./config/compaction.js"
import { ConfigCompatibility } from "./config/compatibility.js"
import { ConfigCommand } from "./config/command.js"
import { ConfigExperimental } from "./config/experimental.js"
import { ConfigFormatter } from "./config/formatter.js"
import { ConfigLSP } from "./config/lsp.js"
import { ConfigMCP } from "./config/mcp.js"
import { ConfigModel } from "./config/model.js"
import { ConfigPlugin } from "./config/plugin.js"
import { ConfigProvider } from "./config/provider.js"
import { ConfigProxy } from "./config/proxy.js"
import { ConfigReference } from "./config/reference.js"
import { ConfigWebSearch } from "./config/websearch.js"
import { ConfigToolOutput } from "./config/tool-output.js"
import { ConfigWatcher } from "./config/watcher.js"
import { ConfigWarming } from "./config/warming.js"
import { ConfigWorktree } from "./config/worktree.js"

export class Info extends Schema.Class<Info>("Config.Info")({
  $schema: optional(Schema.String).annotate({
    description: "JSON schema reference for configuration validation",
  }),
  shell: Schema.String.pipe(optional).annotate({
    description: "Default shell to use for terminal and shell tool execution",
  }),
  model: ConfigModel.Selection.pipe(optional).annotate({
    description: "Default model to use when no session or agent model is selected",
  }),
  default_agent: Schema.String.pipe(optional).annotate({
    description: "Default primary agent to use when no session agent is selected",
  }),
  proxy: ConfigProxy.Info.pipe(optional).annotate({
    description: "HTTP/HTTPS proxy for OpenCode network requests only; local endpoints must be bypassed",
  }),
  update: Schema.Literals(["disable", "notify", "auto"]).pipe(optional).annotate({
    description: "Disable updates, notify when one is available, or install updates automatically",
  }),
  share: Schema.Literals(["manual", "auto", "disabled"]).pipe(optional).annotate({
    description: "Control whether sessions may be shared manually, automatically, or not at all",
  }),
  enterprise: Schema.Struct({
    url: Schema.String.pipe(optional),
  })
    .pipe(optional)
    .annotate({
      description: "Enterprise sharing service configuration",
    }),
  username: Schema.String.pipe(optional).annotate({
    description: "Username displayed in conversations and used for telemetry identity",
  }),
  permissions: Permission.Ruleset.pipe(optional).annotate({
    description: "Ordered tool permission rules applied to agent tool use",
  }),
  agents: Schema.Record(Schema.String, ConfigAgent.Info).pipe(optional).annotate({
    description: "Named built-in agent overrides and custom agent definitions",
  }),
  snapshots: Schema.Boolean.pipe(optional).annotate({
    description: "Enable snapshots used for undo and revert behavior",
  }),
  watcher: ConfigWatcher.Info.pipe(optional).annotate({
    description: "Filesystem watcher configuration",
  }),
  formatter: ConfigFormatter.Info.pipe(optional).annotate({
    description: "Enable built-in formatters or configure formatter overrides",
  }),
  lsp: ConfigLSP.Info.pipe(optional).annotate({
    description: "Enable built-in language servers or configure server overrides",
  }),
  media: ConfigMedia.Info.pipe(optional).annotate({
    description: "Media processing configuration",
  }),
  tool_output: ConfigToolOutput.Info.pipe(optional).annotate({
    description: "Tool output truncation thresholds",
  }),
  mcp: ConfigMCP.Info.pipe(optional).annotate({
    description: "MCP server configuration",
  }),
  compaction: ConfigCompaction.Info.pipe(optional).annotate({
    description: "Conversation compaction behavior",
  }),
  skills: Schema.String.pipe(Schema.Array, optional).annotate({
    description: "Additional paths or URLs to discover skills from",
  }),
  commands: Schema.Record(Schema.String, ConfigCommand.Info).pipe(optional).annotate({
    description: "Named slash command definitions",
  }),
  instructions: Schema.String.pipe(Schema.Array, optional).annotate({
    description: "Additional paths or URLs supplying ambient instructions",
  }),
  references: ConfigReference.Info.pipe(optional).annotate({
    description: "Named local directories or Git repositories available as external context",
  }),
  websearch: ConfigWebSearch.Selection.pipe(optional).annotate({
    description: "Web search provider selection",
  }),
  plugins: ConfigPlugin.Plugins.pipe(optional).annotate({
    description: "Ordered plugin enablement directives and external package declarations",
  }),
  worktree: ConfigWorktree.Info.pipe(optional).annotate({
    description: "Directory defaults for local worktree creation",
  }),
  warming: ConfigWarming.Warming.pipe(optional).annotate({
    description: "Keep recently active sessions warm with transient model requests (default: false)",
  }),
  compatibility: ConfigCompatibility.Info.pipe(optional).annotate({
    description: "Which other agent tools' folders (.claude, .codex, .gemini, ...) to read and how to merge them",
  }),
  providers: Schema.Record(Schema.String, ConfigProvider.Info).pipe(optional),
  experimental: ConfigExperimental.Info.pipe(optional),
}) {}

// Each key present is written to the global config; null removes it, an absent key is left alone.
export const Patch = Schema.Struct({
  shell: Schema.optionalKey(Schema.NullOr(Schema.String)),
  model: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: "Default model for new sessions, as provider/model",
  }),
  mcpServers: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(ConfigMCP.Server))).annotate({
    description: "MCP servers to add or replace under mcp.servers by name; null removes one",
  }),
  proxy: Schema.optionalKey(Schema.NullOr(ConfigProxy.Info)),
  compatibilityEnabled: Schema.optionalKey(Schema.NullOr(Schema.Boolean)).annotate({
    description: "Turn reading other agent tools' folders on or off everywhere (compatibility.enabled); null clears it",
  }),
}).annotate({ identifier: "Config.Patch" })
export interface Patch extends Schema.Schema.Type<typeof Patch> {}

export class Document extends Schema.Class<Document>("Config.Document")({
  type: Schema.Literal("document"),
  path: AbsolutePath.pipe(optional),
  info: Info,
}) {}

export class Directory extends Schema.Class<Directory>("Config.Directory")({
  type: Schema.Literal("directory"),
  path: AbsolutePath,
}) {}

export const Entry = Schema.Union([Document, Directory]).annotate({
  identifier: "Config.Entry",
})
export type Entry = typeof Entry.Type

const Updated = ephemeral({
  type: "config.updated",
  schema: {},
})

export const Event = { Updated, Definitions: inventory(Updated) }
