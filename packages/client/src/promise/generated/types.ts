export type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue }

export type ServerInfo = {
  version: string
  pid: number
  urls: Array<string>
  paths: { tmp: string }
  capabilities?: { persistentPty?: boolean | undefined } | undefined
}

export type PairingCode = { code: string; expires_in: number }

export type PairingSession = { token: string }

export type LocationPublicInfo = { directory: string; project: { id: string; directory: string; canonical: string } }

export type LocationPublicRef = { directory: string }

export type ModelRef = { id: string; providerID: string; variant?: string }

export type ProviderCompaction = { type: "summary" } | { type: "native" }

export type ProviderTransport = "http" | "websocket"

export type AgentColor = string

export type PermissionEffect = "allow" | "deny" | "ask"

export type PluginSource =
  | { type: "builtin" }
  | { type: "package"; target: string; version?: string; outdated?: true; updating?: true }
  | { type: "local"; path: string }
  | { type: "sdk" }

export type PluginFeatures = { server?: true; tui?: true; rpc?: true }

export type PluginState = { status: "active" } | { status: "failed"; error: string; ref?: string }

export type SessionForkBoundary = { type: "before"; messageID: string } | { type: "through"; messageID: string }

export type MoneyUSD = number

export type TokenUsageInfo = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export type SessionMetadata = { [x: string]: JsonValue }

export type FileDiffInfo = {
  file: string
  patch: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

export type SessionStatsToolTotals = { calls: number; succeeded: number; failed: number; unfinished: number }

export type SessionStatsToolUsage = {
  name: string
  calls: number
  succeeded: number
  failed: number
  unfinished: number
  durationP50?: number
}

export type SessionStatsActivity = { date: string; steps: number }

export type SessionMessageAgentSelected = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "agent-switched"
  agent: string
  previous?: string
}

export type PromptBase64 = string

export type PromptFileSource = { type: "inline" } | { type: "uri"; uri: string }

export type PromptMention = { start: number; end: number; text: string }

export type SessionMessageSynthetic = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  text: string
  description?: string
  type: "synthetic"
}

export type SessionMessageSystem = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "system"
  text: string
  description?: string
}

export type SessionMessageSkill = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "skill"
  skill: string
  name: string
  text: string
}

export type SessionMessageShell = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number; completed?: number }
  type: "shell"
  shellID: string
  command: string
  status: "running" | "exited" | "timeout" | "killed"
  exit?: number | "Infinity" | "-Infinity" | "NaN"
  output?: { output: string; cursor: number; size: number; truncated: boolean }
}

export type SessionMessageProviderState = { [x: string]: JsonValue }

export type SessionMessageToolStateStreaming = { status: "streaming"; input: string }

export type SessionMessageToolStateRunning = {
  status: "running"
  input: { [x: string]: JsonValue }
  metadata: { [x: string]: JsonValue }
}

export type ToolTextContent = { type: "text"; text: string }

export type ToolFileContent = { type: "file"; uri: string; mime: string; name?: string | null }

export type SessionStructuredError = { type: string; message: string; status?: number; response?: { body: string } }

export type SessionMessageCompactionRunning = {
  type: "compaction"
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  status: "running"
  reason: "auto" | "manual"
  summary: string
  recent: string
}

export type SessionProviderContextProvenance = {
  providerID: string
  provider: string
  modelID: string
  route: string
  protocol: string
  endpoint: string
}

export type SessionMessageIdle = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "idle"
  outcome: "succeeded" | "failed" | "interrupted"
}

export type SessionActive = { type: "running" }

export type SessionInboxDelivery = "steer" | "queue"

export type SessionInboxSyntheticPayload = {
  text: string
  description?: string
  resumeOnStart?: boolean
  metadata?: { [x: string]: JsonValue }
}

export type SessionInboxCompactionPayload = {}

export type InstructionEntryKey = string

export type SessionGenerateResponse = { data: { text: string } }

export type LocationRef = { directory: string; workspaceID?: string }

export type SessionInboxSyntheticPayload1 = {
  text: string
  description?: string
  resumeOnStart?: boolean
  metadata?: { [x: string]: any }
}

export type ShellInfo = {
  id: string
  status: "running" | "exited" | "timeout" | "killed"
  command: string
  cwd: string
  shell: string
  file: string
  pid?: number
  exit?: number
  signal?: string
  metadata: { [x: string]: any }
  time: { started: number; completed?: number }
}

export type SessionMessageProviderState1 = { [x: string]: any }

export type ToolFileContent1 = { type: "file"; uri: string; mime: string; name?: string | undefined }

export type SessionMessageToolStateRunning1 = {
  status: "running"
  input: { [x: string]: any }
  metadata: { [x: string]: JsonValue }
}

export type EventLogSynced = { type: "log.synced"; aggregateID: string; seq?: number }

export type SessionInterruptResponse = { interrupted: boolean }

export type FormMetadata = { [x: string]: JsonValue }

export type FormWhen = {
  key: string
  op: "eq" | "neq"
  value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
}

export type FormOption = { value: string; label: string; description?: string }

export type FormExternalField = { key: string; type: "external"; url: string; title?: string; description?: string }

export type FormValue = string | number | "Infinity" | "-Infinity" | "NaN" | boolean | Array<string>

export type ModelReasoningField = "reasoning" | "reasoning_content" | "reasoning_text" | (string & {})

export type ModelMaxTokensField = "max_completion_tokens" | "max_tokens"

export type ModelCapabilities = { tools: boolean; input: Array<string>; output: Array<string> }

export type MoneyUSDPerMillionTokens = number

export type GenerateTextResponse = { data: { text: string } }

export type IntegrationCommandMethod = { id: string; type: "command"; label: string; command: Array<string> }

export type IntegrationEnvMethod = { type: "env"; names: Array<string> }

export type ConnectionStatus = { status: "needs_auth"; message: string; url?: string }

export type IntegrationAttempt = {
  attemptID: string
  url: string
  instructions: string
  mode: "auto" | "code"
  time: { created: number; expires: number }
}

export type IntegrationAttemptStatus =
  | { status: "pending"; time: { created: number; expires: number } }
  | { status: "complete"; time: { created: number; expires: number } }
  | { status: "failed"; message: string; time: { created: number; expires: number } }
  | { status: "expired"; time: { created: number; expires: number } }

export type IntegrationCommandAttempt = { attemptID: string; time: { created: number; expires: number } }

export type IntegrationCommandAttemptStatus =
  | {
      status: "pending"
      message?: string
      time: { created: number | "Infinity" | "-Infinity" | "NaN"; expires: number | "Infinity" | "-Infinity" | "NaN" }
    }
  | {
      status: "complete"
      time: { created: number | "Infinity" | "-Infinity" | "NaN"; expires: number | "Infinity" | "-Infinity" | "NaN" }
    }
  | {
      status: "failed"
      message: string
      time: { created: number | "Infinity" | "-Infinity" | "NaN"; expires: number | "Infinity" | "-Infinity" | "NaN" }
    }
  | {
      status: "expired"
      time: { created: number | "Infinity" | "-Infinity" | "NaN"; expires: number | "Infinity" | "-Infinity" | "NaN" }
    }

export type McpStatusConnected = { status: "connected" }

export type McpStatusPending = { status: "pending" }

export type McpStatusDisabled = { status: "disabled" }

export type McpStatusFailed = { status: "failed"; error: string }

export type McpStatusNeedsAuth = { status: "needs_auth"; error: string }

export type McpResource = { server: string; name: string; uri: string; description?: string; mimeType?: string }

export type McpResourceTemplate = {
  server: string
  name: string
  uriTemplate: string
  description?: string
  mimeType?: string
}

export type CredentialOAuth = {
  type: "oauth"
  methodID: string
  refresh: string
  access: string
  expires: number
  metadata?: { [x: string]: JsonValue }
}

export type CredentialExternal = { type: "external"; methodID: string; metadata?: { [x: string]: JsonValue } }

export type ProjectVcs = string

export type ProjectIcon = { url?: string; override?: string; color?: string }

export type ProjectCommands = { start?: string }

export type ProjectTime = { created: number; updated: number; active: number }

export type PermissionSource = { type: "tool"; messageID: string; id: string }

export type PermissionSavedInfo = {
  id: string
  projectID: string
  action: string
  resource: string
  time: { created: number; updated: number }
}

export type FileSystemEntry = { path: string; type: "file" | "directory" }

export type FileSystemWrite = { path: string }

export type CommandInfo = { name: string; description?: string }

export type SkillInfo = {
  id: string
  name: string
  description?: string
  autoinvoke?: boolean
  path: string
  content: string
}

export type RpcOutput = { output?: any }

export type PermissionReply = "once" | "always" | "reject"

export type Pty = {
  id: string
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
}

export type PersistentPtyInfo = {
  id: string
  title: string
  command: string
  args: Array<string>
  cwd: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
  sessionID: string
  foregroundProcess: string | null
  size: { cols: number; rows: number }
  output: { head: number; tail: number }
}

export type FormMetadata1 = { [x: string]: any }

export type FormWhen1 = { key: string; op: "eq" | "neq"; value: string | number | boolean }

export type FormValue1 = string | number | boolean | Array<string>

export type NoteSlug = string

export type SessionStatus =
  | { type: "idle" }
  | {
      type: "retry"
      attempt: number
      message: string
      action?: { reason: string; provider: string; title: string; message: string; label: string; link?: string }
      next: number
    }
  | { type: "busy" }

export type PtyTicketConnectToken = { ticket: string; expires_in: number }

export type PersistentPtyReadResult = {
  ptyID: string
  title: string
  cwd: string
  foregroundProcess: string | null
  screen: { text: string; cols: number; rows: number; cursor: { x: number; y: number } }
}

export type PersistentPtyHandoff = { directory: string; instanceID: string; ticket: string; expiresAt: number }

export type ShellInfo1 = {
  id: string
  status: "running" | "exited" | "timeout" | "killed"
  command: string
  cwd: string
  shell: string
  file: string
  pid?: number
  exit?: number
  signal?: string
  metadata: { [x: string]: JsonValue }
  time: { started: number; completed?: number }
}

export type ReferenceLocalSource = { type: "local"; path: string }

export type ReferenceGitSource = { type: "git"; repository: string; branch?: string }

export type WorktreeDirectory = { directory: string; strategy?: string }

export type WorktreeInfo = { directory: string }

export type VcsBranch = { current?: string; default?: string }

export type VcsBase = { name: string; ref: string; source: "reflog" | "default" }

export type VcsFileStatus = {
  file: string
  additions: number
  deletions: number
  status: "added" | "deleted" | "modified"
}

export type VcsBranchList = Array<string>

export type NoteStatus = "inbox" | "active" | "done" | "archived"

export type NoteTag = string

export type NoteLength = "brief" | "balanced" | "detailed"

export type WebSearchProvider = { id: string; name: string }

export type WebSearchResult = { url: string; title?: string; content?: string; time: { published?: number } }

export type ConfigProxy = { http?: string; https?: string; no_proxy?: Array<string> }

export type McpProtocol = "legacy" | "auto" | "2026-07-28"

export type ConfigWorktree = { directory: string }

export type ConfigCompatibilityChoices = {
  agents?: boolean
  claude?: boolean
  codex?: boolean
  gemini?: boolean
  cursor?: boolean
}

export type ConfigCompatibilityEcosystem = "agents" | "claude" | "codex" | "gemini" | "cursor"

export type ConfigModelCapabilities = { tools?: boolean; input?: Array<string>; output?: Array<string> }

export type ConfigShellOption = { path: string; name: string; acceptable: boolean }

export type ConfigCompatibilityFolder = { path: string; scope: "global" | "project" }

export type ConfigCompatibilityLoaded = {
  instructions: number
  commands: number
  agents: number
  mcp: number
  rules: number
  hooks: number
}

export type ConfigCompatibilitySkipped = { source: string; reason: string }

export type RoomRules = {
  hidePaths?: boolean | undefined
  hideExecution?: boolean | undefined
  blockCommands?: Array<string> | undefined
  protectedFiles?: Array<string> | undefined
  noOutbound?: boolean | undefined
}

export type RoomDodItem = {
  id: string
  what: string
  stage: string
  state: string
  done: number
  total: number
  owner?: string | undefined
  ownerID?: string | undefined
  stale?: boolean | undefined
  mine?: boolean | undefined
  waits?: Array<string> | undefined
  verify?: string | undefined
}

export type RoomDodNote = { name: string; text: string }

export type RoomEvent = {
  seq: number
  at: number
  kind: "join" | "leave" | "remove" | "ban" | "take" | "release" | "expire" | "pass" | "fail" | "run"
  who: string
  item?: string | undefined
  detail?: string | undefined
}

export type RoomJoinCode = { code: string; expires_in: number }

export type RoomGuest = { id: string; name: string }

export type RoomRules1 = {
  hidePaths?: boolean | null
  hideExecution?: boolean | null
  blockCommands?: Array<string> | null
  protectedFiles?: Array<string> | null
  noOutbound?: boolean | null
}

export type RoomLink = { url: string; roomID: string; token: string; name: string; guest: string }

export type RoomPassport = {
  machine: string
  os: string
  release: string
  arch: string
  shells: Array<string>
  tools: Array<string>
  project: { directory: string; branch?: string | undefined; commit?: string | undefined; changed?: number | undefined }
  plots: Array<{ team: string; machine: string; purpose: string; paths: Array<string>; expires: number }>
}

export type RoomRunResult = { shell: string; exitCode: number; output: string; cut?: boolean | undefined }

export type RoomMemberView = {
  id: string
  name: string
  role: "viewer" | "member" | "helper" | "cohost" | "trusted"
  device?: string | undefined
  address?: string | undefined
  joined: number
  seen?: number | undefined
  online: boolean
}

export type RoomMember = {
  id: string
  name: string
  role: "viewer" | "member" | "helper" | "cohost" | "trusted"
  device?: string | undefined
  address?: string | undefined
  joined: number
}

export type RoomBan = {
  id: string
  name: string
  device?: string | undefined
  address?: string | undefined
  created: number
}

export type RoomMessage = {
  id: string
  role: "user" | "assistant"
  author?: string | null
  text: string
  created: number | "Infinity" | "-Infinity" | "NaN"
}

export type RoomMeshNode = { id: string; url: string; name: string; joined: number; directory?: string | undefined }

export type RoomMeshEntry = {
  id: string
  index: number
  term: number
  kind: "message" | "task"
  payload: JsonValue
  originID: string
  created: number
}

export type OrchestraSandboxIsolation = "environment" | "strict"

export type OrchestraMember = { agent: string; title: string; category: string }

export type OrchestraOrigin = "builtin" | "edited" | "custom"

export type OrchestraAccess = "hidden" | "read" | "write" | "full"

export type FederationGroup = { name: string; projects: Array<string>; supervisor?: string | undefined }

export type SessionMessageLocationSwitched = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "location-switched"
  projectID?: string
  subpath?: string
  location: LocationPublicRef
  previous?: { location: LocationPublicRef; projectID?: string; subpath?: string } | null
}

export type SessionInboxMovePayload = { projectID: string; subpath?: string; location: LocationPublicRef }

export type V2EventRpc = {
  id: string
  created: number
  metadata?: { [x: string]: any } | undefined
  type: `${"rpc."}${string}`
  location: LocationPublicRef
  data: { [x: string]: any }
}

export type V2EventServerConnected = {
  id: string
  metadata?: { [x: string]: any } | undefined
  location?: LocationPublicRef | undefined
  type: "server.connected"
  data: {}
}

export type ModelSettings = { compaction?: ProviderCompaction } & { [x: string]: any }

export type ConfigModelSettings = { compaction?: ProviderCompaction } & { [x: string]: JsonValue | null }

export type ProviderSettings = {
  timeout?: number | false
  headerTimeout?: number | false
  chunkTimeout?: number | false
  compaction?: ProviderCompaction
  transport?: ProviderTransport
} & { [x: string]: any }

export type ConfigProviderSettings = {
  timeout?: number | false
  headerTimeout?: number | false
  chunkTimeout?: number | false
  compaction?: ProviderCompaction
  transport?: ProviderTransport
} & { [x: string]: JsonValue | null }

export type PermissionRule = { action: string; resource: string; effect: PermissionEffect }

export type PluginInfo = { id?: string; source: PluginSource; features: PluginFeatures; state: PluginState }

export type SessionRevert = { messageID: string; partID?: string; snapshot?: string; files?: Array<FileDiffInfo> }

export type SessionStatsTools =
  | { mode: "none" }
  | { mode: "summary"; totals: SessionStatsToolTotals }
  | { mode: "detail"; totals: SessionStatsToolTotals; usage: Array<SessionStatsToolUsage> }

export type SessionStatsModelUsage = { model: ModelRef; steps: number; tokens: TokenUsageInfo; cost: MoneyUSD }

export type SessionMessageModelSelected = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  type: "model-switched"
  model: ModelRef
  previous?: ModelRef
}

export type PromptFileAttachment = {
  data: PromptBase64
  mime: string
  source: PromptFileSource
  name?: string
  description?: string
  mention?: PromptMention
}

export type PromptAgentAttachment = { name: string; mention?: PromptMention }

export type PromptSkillAttachment = { id: string; name: string; text?: string; mention?: PromptMention }

export type SessionMessageAssistantText = { type: "text"; text: string; state?: SessionMessageProviderState }

export type SessionMessageAssistantReasoning = {
  type: "reasoning"
  text: string
  state?: SessionMessageProviderState
  time?: { created: number; completed?: number }
}

export type ToolContent = ToolTextContent | ToolFileContent

export type SessionMessageAssistantRetry = { attempt: number; at: number; error: SessionStructuredError }

export type SessionMessageCompactionFailed = {
  type: "compaction"
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  status: "failed"
  reason: "auto" | "manual"
  error: SessionStructuredError
  cost?: MoneyUSD
  tokens?: TokenUsageInfo
}

export type SessionProviderContext = { version: 1; provenance: SessionProviderContextProvenance; messages: JsonValue }

export type SessionInboxSynthetic = {
  id: string
  sessionID: string
  time: { created: number }
  type: "synthetic"
  payload: SessionInboxSyntheticPayload
  delivery: SessionInboxDelivery
}

export type SessionInboxCompaction = {
  id: string
  sessionID: string
  time: { created: number }
  type: "compaction"
  payload: SessionInboxCompactionPayload
  delivery: SessionInboxDelivery
}

export type InstructionEntryInfo = { key: InstructionEntryKey; value: JsonValue }

export type InstructionEntrySnapshot = Array<{ key: InstructionEntryKey; value: JsonValue; removed: boolean }>

export type SessionAgentSelected = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.agent.selected"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; agent: string; previous?: string }
}

export type SessionModelSelected = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.model.selected"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; model: ModelRef; previous?: ModelRef }
}

export type SessionRenamed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.renamed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; title: string }
}

export type SessionViewed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.viewed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; idle: number }
}

export type SessionDeleted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.deleted"
  durable: { aggregateID: string; seq: number; version: 2 }
  location?: LocationRef
  data: { sessionID: string }
}

export type SessionInboxDelivered = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.inbox.delivered"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; inboxID: string }
}

export type SessionInboxCancelled = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.inbox.cancelled"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; inboxID: string }
}

export type SessionInboxDeliveryChanged = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.inbox.delivery.changed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; inboxID: string; delivery: SessionInboxDelivery }
}

export type SessionExecutionStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string }
}

export type SessionExecutionSucceeded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.succeeded"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string }
}

export type SessionExecutionFailed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.failed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; error: SessionStructuredError }
}

export type SessionExecutionInterrupted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.execution.interrupted"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; reason: "user" | "shutdown" | "superseded" | "inactivity" }
}

export type SessionInstructionsUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.instructions.updated"
  durable: { aggregateID: string; seq: number; version: 2 }
  location?: LocationRef
  data: { sessionID: string; delta: { [x: string]: string | "removed" }; text?: string }
}

export type SessionSynthetic = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.synthetic"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; text: string; description?: string; metadata?: { [x: string]: any } }
}

export type SessionSkillActivated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.skill.activated"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; id: string; name: string; text: string }
}

export type SessionStepStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    agent: string
    model: ModelRef
    snapshot?: string
    started: number
  }
}

export type SessionStepStreamed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.streamed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string }
}

export type SessionTextStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.text.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; ordinal: number }
}

export type SessionToolInputStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.input.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; id: string; name: string }
}

export type SessionToolInputEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.input.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; id: string; text: string }
}

export type SessionRetryScheduled = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.retry.scheduled"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; attempt: number; at: number; error: SessionStructuredError }
}

export type SessionCompactionStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; reason: "auto" | "manual"; recent: string; inputID?: string }
}

export type SessionCompactionFailed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.failed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    reason: "auto" | "manual"
    error: SessionStructuredError
    inputID?: string
    cost?: MoneyUSD
    tokens?: TokenUsageInfo
  }
}

export type SessionRevertCleared = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.revert.cleared"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string }
}

export type SessionRevertCommitted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.revert.committed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; to: string }
}

export type SessionUsageRecorded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.usage.recorded"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; source: "title" | "compaction"; cost: MoneyUSD; tokens: TokenUsageInfo }
}

export type LocationShutdown = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "location.shutdown"
  location?: LocationRef
  data: {}
}

export type ModelsDevRefreshed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "models-dev.refreshed"
  location?: LocationRef
  data: {}
}

export type CredentialUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "credential.updated"
  location?: LocationRef
  data: {}
}

export type CredentialSwitched = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "credential.switched"
  location?: LocationRef
  data: { integrationID: string; credentialID: string | null }
}

export type IntegrationUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "integration.updated"
  location?: LocationRef
  data: {}
}

export type ProviderUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "provider.updated"
  location?: LocationRef
  data: {}
}

export type ModelUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "model.updated"
  location?: LocationRef
  data: {}
}

export type AgentUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "agent.updated"
  location?: LocationRef
  data: {}
}

export type SessionUsageUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.usage.updated"
  location?: LocationRef
  data: { sessionID: string; cost: MoneyUSD; tokens: TokenUsageInfo }
}

export type SessionTextDelta = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.text.delta"
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; ordinal: number; delta: string }
}

export type SessionReasoningDelta = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.reasoning.delta"
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; ordinal: number; delta: string }
}

export type SessionToolInputDelta = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.input.delta"
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; id: string; delta: string }
}

export type SessionToolProgress = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.progress"
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; id: string; metadata: { [x: string]: JsonValue } }
}

export type SessionCompactionDelta = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.delta"
  location?: LocationRef
  data: { sessionID: string; text: string }
}

export type FilesystemChanged = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "filesystem.changed"
  location?: LocationRef
  data: { file: string; event: "add" | "change" | "unlink" }
}

export type ReferenceUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "reference.updated"
  location?: LocationRef
  data: {}
}

export type PluginUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "plugin.updated"
  location?: LocationRef
  data: {}
}

export type WorktreeUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "worktree.updated"
  location?: LocationRef
  data: { projectID: string }
}

export type WorktreeResolved = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "worktree.resolved"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { projectID: string; directory: string; previous: string; adopted?: Array<string> }
}

export type CommandUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "command.updated"
  location?: LocationRef
  data: {}
}

export type ConfigUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "config.updated"
  location?: LocationRef
  data: {}
}

export type SkillUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "skill.updated"
  location?: LocationRef
  data: {}
}

export type PtyExited = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "pty.exited"
  location?: LocationRef
  data: { id: string; exitCode: number }
}

export type PtyDeleted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "pty.deleted"
  location?: LocationRef
  data: { id: string }
}

export type PersistentPtyRemoved = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "persistent-pty.removed"
  location?: LocationRef
  data: { sessionID: string; ptyID: string }
}

export type ShellExited = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "shell.exited"
  location?: LocationRef
  data: { id: string; exit?: number; status: "running" | "exited" | "timeout" | "killed" }
}

export type ShellDeleted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "shell.deleted"
  location?: LocationRef
  data: { id: string }
}

export type FormCancelled = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "form.cancelled"
  location?: LocationRef
  data: { id: string; sessionID: string }
}

export type WebsearchUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "websearch.updated"
  location?: LocationRef
  data: {}
}

export type SessionIdle = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.idle"
  location?: LocationRef
  data: { sessionID: string }
}

export type TuiPromptAppend = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "tui.prompt.append"
  location?: LocationRef
  data: { text: string }
}

export type TuiCommandExecute = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "tui.command.execute"
  location?: LocationRef
  data: {
    command:
      | "session.list"
      | "session.new"
      | "session.share"
      | "session.interrupt"
      | "session.background"
      | "session.compact"
      | "session.page.up"
      | "session.page.down"
      | "session.line.up"
      | "session.line.down"
      | "session.half.page.up"
      | "session.half.page.down"
      | "session.first"
      | "session.last"
      | "prompt.clear"
      | "prompt.submit"
      | "agent.cycle"
      | (string & {})
  }
}

export type TuiToastShow = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "tui.toast.show"
  location?: LocationRef
  data: {
    title?: string
    message: string
    variant: "info" | "success" | "warning" | "error"
    duration?: number | undefined
  }
}

export type TuiSessionSelect = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "tui.session.select"
  location?: LocationRef
  data: { sessionID: string }
}

export type InstallationUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "installation.updated"
  location?: LocationRef
  data: { version: string }
}

export type InstallationUpdateAvailable = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "installation.update-available"
  location?: LocationRef
  data: { version: string }
}

export type VcsBranchUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "vcs.branch.updated"
  location?: LocationRef
  data: { branch?: string }
}

export type McpStatusChanged = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "mcp.status.changed"
  location?: LocationRef
  data: { server: string }
}

export type McpResourcesChanged = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "mcp.resources.changed"
  location?: LocationRef
  data: { server: string }
}

export type SessionMoved = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.moved"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; location: LocationRef; projectID: string; subpath?: string }
}

export type SessionInboxMovePayload1 = { location: LocationRef; projectID: string; subpath?: string }

export type SessionMetadataUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.metadata.updated"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; metadata: SessionMetadata }
}

export type SessionShellStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.shell.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; shell: ShellInfo }
}

export type SessionShellEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.shell.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    shell: ShellInfo
    output: { output: string; cursor: number; size: number; truncated: boolean }
  }
}

export type ShellCreated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "shell.created"
  location?: LocationRef
  data: { info: ShellInfo }
}

export type SessionStepEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
    rawFinish?: string
    providerState?: SessionMessageProviderState1
    cost: MoneyUSD
    tokens: TokenUsageInfo
    snapshot?: string
    files?: Array<string>
  }
}

export type SessionStepFailed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.step.failed"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    error: SessionStructuredError
    finish?: "content-filter"
    rawFinish?: string
    providerState?: SessionMessageProviderState1
    cost?: MoneyUSD
    tokens?: TokenUsageInfo
    snapshot?: string
    files?: Array<string>
  }
}

export type SessionTextEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.text.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    ordinal: number
    text: string
    state?: SessionMessageProviderState1
  }
}

export type SessionReasoningStarted = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.reasoning.started"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; assistantMessageID: string; ordinal: number; state?: SessionMessageProviderState1 }
}

export type SessionReasoningEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.reasoning.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    ordinal: number
    text: string
    state?: SessionMessageProviderState1
  }
}

export type SessionToolCalled = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.called"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    id: string
    input: { [x: string]: any }
    executed: boolean
    state?: SessionMessageProviderState1
  }
}

export type SessionMessageAssistantText1 = { type: "text"; text: string; state?: SessionMessageProviderState1 }

export type SessionMessageAssistantReasoning1 = {
  type: "reasoning"
  text: string
  state?: SessionMessageProviderState1
  time?: { created: number; completed?: number }
}

export type ToolContent1 = ToolTextContent | ToolFileContent1

export type FormNumberField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "number"
  minimum?: number | "Infinity" | "-Infinity" | "NaN"
  maximum?: number | "Infinity" | "-Infinity" | "NaN"
  default?: number | "Infinity" | "-Infinity" | "NaN"
}

export type FormIntegerField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "integer"
  minimum?: number | "Infinity" | "-Infinity" | "NaN"
  maximum?: number | "Infinity" | "-Infinity" | "NaN"
  default?: number | "Infinity" | "-Infinity" | "NaN"
}

export type FormBooleanField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "boolean"
  default?: boolean
}

export type FormStringField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "string"
  format?: "email" | "uri" | "date" | "date-time"
  minLength?: number
  maxLength?: number
  pattern?: string
  placeholder?: string
  default?: string
  options?: Array<FormOption>
  custom?: boolean
}

export type FormMultiselectField = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen>
  type: "multiselect"
  options: Array<FormOption>
  minItems?: number
  maxItems?: number
  custom?: boolean
  default?: Array<string>
}

export type FormAnswer = { [x: string]: FormValue }

export type ModelCompatibility = {
  reasoningField?: ModelReasoningField
  requireReasoning?: boolean
  maxTokensField?: ModelMaxTokensField
  requireFinishReason?: boolean
  requireAssistantAfterTool?: boolean
  supportsPromptCacheKey?: boolean
  supportsThinkingBlockBinding?: boolean
  supportsEffortUpdates?: boolean
}

export type ModelCost = {
  tier?: { type: "context"; size: number }
  input: MoneyUSDPerMillionTokens
  output: MoneyUSDPerMillionTokens
  cache: { read: MoneyUSDPerMillionTokens; write: MoneyUSDPerMillionTokens }
}

export type ConnectionCredentialInfo = {
  type: "credential"
  id: string
  label: string
  method: "key" | "oauth" | "external"
  status?: ConnectionStatus
}

export type ConnectionEnvInfo = { type: "env"; name: string; status?: ConnectionStatus }

export type McpServer = {
  name: string
  status: McpStatusConnected | McpStatusPending | McpStatusDisabled | McpStatusFailed | McpStatusNeedsAuth
  integrationID?: string
}

export type McpResourceCatalog = { resources: Array<McpResource>; templates: Array<McpResourceTemplate> }

export type Project = {
  id: string
  canonical: string
  vcs?: ProjectVcs
  name?: string
  icon?: ProjectIcon
  commands?: ProjectCommands
  time: ProjectTime
  sandboxes: Array<string>
}

export type ProjectUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "project.updated"
  location?: LocationRef
  data: {
    id: string
    canonical: string
    vcs?: ProjectVcs
    name?: string
    icon?: ProjectIcon
    commands?: ProjectCommands
    time: ProjectTime
    sandboxes: Array<string>
  }
}

export type PermissionRequest = {
  id: string
  sessionID: string
  action: string
  resources: Array<string>
  save?: Array<string>
  metadata?: { [x: string]: JsonValue }
  source?: PermissionSource
  message?: string
}

export type PermissionAsked = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "permission.asked"
  location?: LocationRef
  data: {
    id: string
    sessionID: string
    action: string
    resources: Array<string>
    save?: Array<string>
    metadata?: { [x: string]: any }
    source?: PermissionSource
    message?: string
  }
}

export type PermissionReplied = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "permission.replied"
  location?: LocationRef
  data: { sessionID: string; requestID: string; reply: PermissionReply }
}

export type PtyCreated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "pty.created"
  location?: LocationRef
  data: { info: Pty }
}

export type PtyUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "pty.updated"
  location?: LocationRef
  data: { info: Pty }
}

export type PersistentPtyAdded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "persistent-pty.added"
  location?: LocationRef
  data: { sessionID: string; terminal: PersistentPtyInfo }
}

export type PersistentPtySnapshot = {
  info: PersistentPtyInfo
  text: string
  checkpoint: string
  cursor: { x: number; y: number }
}

export type FormStringField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen1>
  type: "string"
  format?: "email" | "uri" | "date" | "date-time"
  minLength?: number
  maxLength?: number
  pattern?: string
  placeholder?: string
  default?: string
  options?: Array<FormOption>
  custom?: boolean
}

export type FormNumberField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen1>
  type: "number"
  minimum?: number
  maximum?: number
  default?: number
}

export type FormIntegerField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen1>
  type: "integer"
  minimum?: number
  maximum?: number
  default?: number
}

export type FormBooleanField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen1>
  type: "boolean"
  default?: boolean
}

export type FormMultiselectField1 = {
  key: string
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  when?: Array<FormWhen1>
  type: "multiselect"
  options: Array<FormOption>
  minItems?: number
  maxItems?: number
  custom?: boolean
  default?: Array<string>
}

export type FormAnswer2 = { [x: string]: FormValue1 }

export type NoteUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "note.updated"
  location?: LocationRef
  data: { name: NoteSlug; removed?: boolean }
}

export type SessionStatusUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.status"
  location?: LocationRef
  data: { sessionID: string; status: SessionStatus }
}

export type ReferenceSource = ReferenceLocalSource | ReferenceGitSource

export type WorktreeList = Array<WorktreeDirectory>

export type VcsInfo = { provider?: string; branch: VcsBranch }

export type NoteFrontmatter = {
  title: string
  status: NoteStatus
  tags: Array<NoteTag>
  length?: NoteLength
  session?: string
  created: number
  updated: number
}

export type ConfigCompatibility = {
  enabled?: boolean
  ecosystems?: ConfigCompatibilityChoices
  order?: Array<ConfigCompatibilityEcosystem>
}

export type ConfigCompatibilityFound = {
  id: ConfigCompatibilityEcosystem
  label: string
  enabled: boolean
  decidedBy: "project" | "config" | "default"
  trusted: boolean
  folders: Array<ConfigCompatibilityFolder>
  markers: Array<string>
  loaded?: ConfigCompatibilityLoaded
  skipped?: Array<ConfigCompatibilitySkipped>
  awaitingTrust?: number
}

export type RoomInfo = {
  id: string
  sessionID: string
  name: string
  hostName?: string | undefined
  ai: "linked" | "discovered"
  guestApprovals: boolean
  defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
  directory?: string | undefined
  open?: boolean | undefined
  rules?: RoomRules | undefined
  created: number
}

export type RoomDod = {
  items: Array<RoomDodItem>
  status?: "ready" | "disabled" | undefined
  taken?: string | undefined
  note?: RoomDodNote | undefined
  check?: { exitCode: number; output: string } | undefined
}

export type RoomFeed = { events: Array<RoomEvent> }

export type RoomInfo1 = {
  id: string
  sessionID: string
  name: string
  hostName?: string | null
  ai: "linked" | "discovered"
  guestApprovals: boolean
  defaultRole?: "viewer" | "member" | "helper" | "cohost" | null
  directory?: string | null
  open?: boolean | null
  rules?: RoomRules1 | null
  created: number | "Infinity" | "-Infinity" | "NaN"
}

export type RoomMeshSnapshot = {
  nodeID: string
  status: "unconfigured" | "forming" | "active"
  clusterID?: string | undefined
  ownerNodeID?: string | undefined
  currentTerm: number
  leaderID?: string | undefined
  members: Array<RoomMeshNode>
  voters: Array<string>
  voter: boolean
  logIndex: number
  commitIndex: number
  quorum: number
  leader: boolean
  writable: boolean
}

export type RoomMeshFeed = { data: Array<RoomMeshEntry>; commitIndex: number }

export type RoomMeshRpcResponse = {
  ok: boolean
  currentTerm?: number | undefined
  granted?: boolean | undefined
  success?: boolean | undefined
  matchIndex?: number | undefined
  clusterID?: string | undefined
  ownerNodeID?: string | undefined
  leaderID?: string | undefined
  status?: "unconfigured" | "forming" | "active" | undefined
  voters?: Array<string> | undefined
  members?: Array<RoomMeshNode> | undefined
  entry?: RoomMeshEntry | undefined
  commitIndex?: number | undefined
  text?: string | undefined
  message?: string | undefined
}

export type OrchestraSandbox = { source: string; home: string; isolation: OrchestraSandboxIsolation }

export type OrchestraTemplate = {
  name: string
  description: string
  members: Array<OrchestraMember>
  playbook?: string | undefined
  id: string
  origin: OrchestraOrigin
}

export type OrchestraRole = {
  name: string
  description: string
  rules: string
  category: string
  readOnly: boolean
  model?: string | undefined
  models?: Array<string> | undefined
  tools?: Array<string> | undefined
  autoTools?: boolean | undefined
  hub?: Array<string> | undefined
  registry?: Array<string> | undefined
  id: string
  agent: string
  origin: OrchestraOrigin
}

export type SessionInboxMove = {
  id: string
  sessionID: string
  time: { created: number }
  type: "move"
  delivery: SessionInboxDelivery
  payload: SessionInboxMovePayload
}

export type ModelVariant = {
  id: string
  settings?: ModelSettings
  headers?: { [x: string]: string }
  body?: { [x: string]: any }
}

export type ProviderRequest = {
  settings: ProviderSettings
  headers: { [x: string]: string }
  body: { [x: string]: any }
}

export type ProviderInfo = {
  id: string
  canonical?: string
  integrationID?: string
  name: string
  activation: "auto" | "enabled" | "disabled"
  package: string
  settings?: ProviderSettings
  headers?: { [x: string]: string }
  body?: { [x: string]: any }
}

export type PermissionRuleset = Array<PermissionRule>

export type SessionRevertStaged = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.revert.staged"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; revert: SessionRevert }
}

export type SessionStatsInfo = {
  range: { from: number; to: number }
  sessions: number
  subagents: number
  prompts: number
  steps: number
  tokens: TokenUsageInfo
  cost: MoneyUSD
  tools: SessionStatsTools
  activeDays: number
  streak: number
  activity: Array<SessionStatsActivity>
  models: Array<SessionStatsModelUsage>
}

export type SessionMessageUser = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  skills?: Array<PromptSkillAttachment>
  type: "user"
}

export type SessionInboxUserPayload = {
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  skills?: Array<PromptSkillAttachment>
  resumeOnStart?: boolean
  metadata?: { [x: string]: JsonValue }
}

export type SessionInboxUserPayload1 = {
  text: string
  files?: Array<PromptFileAttachment>
  agents?: Array<PromptAgentAttachment>
  skills?: Array<PromptSkillAttachment>
  resumeOnStart?: boolean
  metadata?: { [x: string]: any }
}

export type SessionMessageToolStateCompleted = {
  status: "completed"
  input: { [x: string]: JsonValue }
  content: [ToolContent, ...Array<ToolContent>]
  metadata?: { [x: string]: JsonValue }
}

export type SessionMessageToolStateError = {
  status: "error"
  input: { [x: string]: JsonValue }
  error: SessionStructuredError
  content?: [ToolContent, ...Array<ToolContent>]
  metadata?: { [x: string]: JsonValue }
}

export type SessionMessageCompactionCompleted = {
  type: "compaction"
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number }
  status: "completed"
  reason: "auto" | "manual"
  model?: ModelRef
  providerState?: SessionMessageProviderState
  summary: string
  recent: string
  providerContext?: SessionProviderContext
  cost?: MoneyUSD
  tokens?: TokenUsageInfo
}

export type SessionCompactionEnded = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.compaction.ended"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    reason: "auto" | "manual"
    model?: ModelRef
    providerState?: SessionMessageProviderState1
    providerContext?: SessionProviderContext
    text: string
    recent: string
    cost?: MoneyUSD
    tokens?: TokenUsageInfo
  }
}

export type SessionForked = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.forked"
  durable: { aggregateID: string; seq: number; version: 2 }
  location?: LocationRef
  data: {
    sessionID: string
    parentID: string
    boundary: SessionForkBoundary
    instructions?: { [x: string]: string }
    instructionEntries?: InstructionEntrySnapshot
  }
}

export type SessionToolSuccess = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.success"
  durable: { aggregateID: string; seq: number; version: 2 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    id: string
    content: [ToolContent1, ...Array<ToolContent1>]
    metadata?: { [x: string]: JsonValue }
    executed: boolean
    resultState?: SessionMessageProviderState1
  }
}

export type SessionToolFailed = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.tool.failed"
  durable: { aggregateID: string; seq: number; version: 2 }
  location?: LocationRef
  data: {
    sessionID: string
    assistantMessageID: string
    id: string
    error: SessionStructuredError
    content?: [ToolContent1, ...Array<ToolContent1>]
    metadata?: { [x: string]: JsonValue }
    executed: boolean
    resultState?: SessionMessageProviderState1
  }
}

export type SessionMessageToolStateCompleted1 = {
  status: "completed"
  input: { [x: string]: any }
  content: [ToolContent1, ...Array<ToolContent1>]
  metadata?: { [x: string]: JsonValue }
}

export type SessionMessageToolStateError1 = {
  status: "error"
  input: { [x: string]: any }
  error: SessionStructuredError
  content?: [ToolContent1, ...Array<ToolContent1>]
  metadata?: { [x: string]: JsonValue }
}

export type FormField =
  | FormStringField
  | FormNumberField
  | FormIntegerField
  | FormBooleanField
  | FormMultiselectField
  | FormExternalField

export type FormState =
  | { status: "pending" }
  | { status: "answered"; answer: FormAnswer }
  | { status: "cancelled"; message?: string }

export type CredentialKey = {
  type: "key"
  key: string
  metadata?: { [x: string]: JsonValue }
  configuration?: FormAnswer
}

export type ConnectionInfo = ConnectionCredentialInfo | ConnectionEnvInfo

export type FormField1 =
  | FormStringField1
  | FormNumberField1
  | FormIntegerField1
  | FormBooleanField1
  | FormMultiselectField1
  | FormExternalField

export type FormReplied = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "form.replied"
  location?: LocationRef
  data: { id: string; sessionID: string; answer: FormAnswer2 }
}

export type ReferenceInfo = {
  name: string
  path: string
  description?: string
  hidden?: boolean
  source: ReferenceSource
}

export type NoteInfo = {
  name: NoteSlug
  frontmatter: NoteFrontmatter
  body: string
  mtime: number | "Infinity" | "-Infinity" | "NaN"
}

export type ConfigCompatibilityReport = {
  root: string
  enabled: boolean
  order: Array<ConfigCompatibilityEcosystem>
  ecosystems: Array<ConfigCompatibilityFound>
}

export type RoomJoined = {
  token: string
  guest: RoomGuest
  role: "viewer" | "member" | "helper" | "cohost" | "trusted"
  room: RoomInfo
}

export type OrchestraProject = {
  id: string
  name: string
  directory: string
  main?: string | undefined
  created: number
  sandbox?: OrchestraSandbox | undefined
}

export type ModelInfo = {
  id: string
  modelID: string
  providerID: string
  canonical?: string
  family?: string
  name: string
  compatibility?: ModelCompatibility
  package?: string
  settings?: ModelSettings
  headers?: { [x: string]: string }
  body?: { [x: string]: any }
  capabilities: ModelCapabilities
  variants: Array<ModelVariant>
  time: { released: number }
  cost: Array<ModelCost>
  status: "alpha" | "beta" | "deprecated" | "active"
  enabled: boolean
  limit: { context: number; input?: number; output: number }
}

export type AgentInfo = {
  id: string
  name: string
  model?: ModelRef
  request: ProviderRequest
  system?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  color?: AgentColor
  steps?: number
  permissions: PermissionRuleset
}

export type SessionPermissions = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.permissions"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; permissions: PermissionRuleset }
}

export type SessionInfo = {
  id: string
  parentID?: string
  fork?: { sessionID: string; boundary: SessionForkBoundary }
  projectID: string
  agent?: string
  model?: ModelRef
  cost: MoneyUSD
  tokens: TokenUsageInfo
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number; idle?: number; viewed?: number; archived?: number }
  title?: string
  subpath?: string
  metadata?: SessionMetadata
  permissions?: PermissionRuleset
  revert?: SessionRevert
  location: LocationPublicRef
}

export type SessionCreated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.created"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: {
    sessionID: string
    projectID: string
    location: LocationRef
    subpath?: string
    parentID?: string
    slug: string
    title?: string
    agent?: string
    model?: ModelRef
    metadata?: SessionMetadata
    permissions?: PermissionRuleset
    version: string
  }
}

export type ConfigEntry =
  | {
      type: "document"
      path?: string
      info: {
        $schema?: string
        shell?: string
        model?: string | { providerID: string; model: string; variant?: string }
        default_agent?: string
        proxy?: ConfigProxy
        update?: "disable" | "notify" | "auto"
        share?: "manual" | "auto" | "disabled"
        enterprise?: { url?: string }
        username?: string
        permissions?: PermissionRuleset
        agents?: {
          [x: string]: {
            model?: string | { providerID: string; model: string; variant?: string }
            request?: { headers?: { [x: string]: string }; body?: { [x: string]: JsonValue } }
            system?: string
            description?: string
            mode?: "subagent" | "primary" | "all"
            hidden?: boolean
            color?: string
            steps?: number
            disabled?: boolean
            permissions?: PermissionRuleset
          }
        }
        snapshots?: boolean
        watcher?: { ignore?: Array<string> }
        formatter?:
          | boolean
          | {
              [x: string]: {
                disabled?: boolean
                command?: Array<string>
                environment?: { [x: string]: string }
                extensions?: Array<string>
              }
            }
        lsp?:
          | boolean
          | {
              [x: string]:
                | { disabled: true }
                | {
                    command: Array<string>
                    extensions?: Array<string>
                    disabled?: boolean
                    env?: { [x: string]: string }
                    initialization?: { [x: string]: JsonValue }
                  }
            }
        media?: {
          image?: { auto_resize?: boolean; max_width?: number; max_height?: number; max_base64_bytes?: number }
        }
        tool_output?: { max_lines?: number; max_bytes?: number }
        mcp?: {
          timeout?: { startup?: number; catalog?: number; execution?: number }
          servers?: {
            [x: string]:
              | {
                  type: "local"
                  command: Array<string>
                  cwd?: string
                  environment?: { [x: string]: string }
                  disabled?: boolean
                  codemode?: boolean
                  timeout?: { startup?: number; catalog?: number; execution?: number }
                  protocol?: McpProtocol
                }
              | {
                  type: "remote"
                  url: string
                  headers?: { [x: string]: string }
                  oauth?:
                    | {
                        client_id?: string
                        client_secret?: string
                        scope?: string
                        callback_port?: number
                        redirect_uri?: string
                        auth_server_metadata_url?: string
                      }
                    | false
                  disabled?: boolean
                  codemode?: boolean
                  timeout?: { startup?: number; catalog?: number; execution?: number }
                  protocol?: McpProtocol
                }
          }
        }
        compaction?: { auto?: boolean; keep?: { tokens?: number }; buffer?: number }
        skills?: Array<string>
        commands?: {
          [x: string]: {
            template: string
            description?: string
            agent?: string
            model?: string | { providerID: string; model: string; variant?: string }
            subagent?: boolean
            subtask?: boolean
          }
        }
        instructions?: Array<string>
        references?: {
          [x: string]:
            | string
            | { repository: string; branch?: string; description?: string; hidden?: boolean }
            | { path: string; description?: string; hidden?: boolean }
        }
        websearch?: false | { provider: "random" | (string & {}) }
        plugins?: Array<string | { package: string; options?: { [x: string]: JsonValue } }>
        worktree?: ConfigWorktree
        warming?: boolean | { prompt?: string; interval?: string; duration?: string }
        compatibility?: ConfigCompatibility
        providers?: {
          [x: string]: {
            canonical?: string
            name?: string
            env?: Array<string>
            package?: string
            settings?: ConfigProviderSettings
            headers?: { [x: string]: string }
            body?: { [x: string]: JsonValue }
            models?: {
              [x: string]: {
                modelID?: string
                family?: string
                name?: string
                compatibility?: ModelCompatibility
                package?: string
                settings?: ConfigModelSettings
                headers?: { [x: string]: string }
                body?: { [x: string]: JsonValue }
                capabilities?: ConfigModelCapabilities
                variants?: Array<{
                  id: string
                  settings?: ConfigModelSettings
                  headers?: { [x: string]: string }
                  body?: { [x: string]: JsonValue }
                }>
                cost?:
                  | {
                      tier?: { type: "context"; size: number }
                      input: MoneyUSDPerMillionTokens
                      output: MoneyUSDPerMillionTokens
                      cache?: { read?: MoneyUSDPerMillionTokens; write?: MoneyUSDPerMillionTokens }
                    }
                  | Array<{
                      tier?: { type: "context"; size: number }
                      input: MoneyUSDPerMillionTokens
                      output: MoneyUSDPerMillionTokens
                      cache?: { read?: MoneyUSDPerMillionTokens; write?: MoneyUSDPerMillionTokens }
                    }>
                disabled?: boolean
                limit?: { context?: number; input?: number; output?: number }
              }
            }
          }
        }
        experimental?: {
          portable_shell_scanner?: boolean
          subagent_depth?: number
          policies?: Array<{
            action: "provider.use" | "tool.use" | "integration.use"
            resource: string
            effect: "allow" | "deny"
          }>
        }
      }
    }
  | { type: "directory"; path: string }

export type SessionInfo1 = {
  id: string
  parentID?: string
  fork?: { sessionID: string; boundary: SessionForkBoundary }
  projectID: string
  agent?: string
  model?: ModelRef
  cost: MoneyUSD
  tokens: TokenUsageInfo
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number; idle?: number; viewed?: number; archived?: number }
  title?: string
  location: LocationRef
  subpath?: string
  metadata?: SessionMetadata
  permissions?: PermissionRuleset
  revert?: SessionRevert
}

export type SessionInboxUser = {
  id: string
  sessionID: string
  time: { created: number }
  type: "user"
  payload: SessionInboxUserPayload
  delivery: SessionInboxDelivery
}

export type SessionInboxItem =
  | { type: "user"; payload: SessionInboxUserPayload1; delivery: SessionInboxDelivery }
  | { type: "synthetic"; payload: SessionInboxSyntheticPayload1; delivery: SessionInboxDelivery }
  | { type: "compaction"; payload: SessionInboxCompactionPayload; delivery: SessionInboxDelivery }
  | { type: "move"; payload: SessionInboxMovePayload1; delivery: SessionInboxDelivery }

export type SessionMessageAssistantTool = {
  type: "tool"
  id: string
  name: string
  executed?: boolean
  providerState?: SessionMessageProviderState
  providerResultState?: SessionMessageProviderState
  state:
    | SessionMessageToolStateStreaming
    | SessionMessageToolStateRunning
    | SessionMessageToolStateCompleted
    | SessionMessageToolStateError
  time: { created: number; ran?: number; completed?: number }
}

export type SessionMessageCompaction =
  | SessionMessageCompactionRunning
  | SessionMessageCompactionCompleted
  | SessionMessageCompactionFailed

export type SessionMessageAssistantTool1 = {
  type: "tool"
  id: string
  name: string
  executed?: boolean
  providerState?: SessionMessageProviderState1
  providerResultState?: SessionMessageProviderState1
  state:
    | SessionMessageToolStateStreaming
    | SessionMessageToolStateRunning1
    | SessionMessageToolStateCompleted1
    | SessionMessageToolStateError1
  time: { created: number; ran?: number; completed?: number }
}

export type FormFields = [FormField, ...Array<FormField>]

export type CredentialValue = CredentialOAuth | CredentialKey | CredentialExternal

export type FormFields2 = [FormField1, ...Array<FormField1>]

export type SessionsResponse = { data: Array<SessionInfo>; cursor: { previous?: string | null; next?: string | null } }

export type SessionInboxInfo = SessionInboxUser | SessionInboxSynthetic | SessionInboxCompaction | SessionInboxMove

export type SessionInboxEnqueued = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.inbox.enqueued"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; inboxID: string; item: SessionInboxItem }
}

export type SessionMessageAssistant = {
  id: string
  metadata?: { [x: string]: JsonValue }
  time: { created: number; streamed?: number; completed?: number }
  type: "assistant"
  agent: string
  model: ModelRef
  content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>
  snapshot?: { start?: string; end?: string; files?: Array<string> }
  finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
  rawFinish?: string
  providerState?: SessionMessageProviderState
  cost?: MoneyUSD
  tokens?: TokenUsageInfo
  error?: SessionStructuredError
  retry?: SessionMessageAssistantRetry
}

export type SessionMessageAssistantContentEncoded =
  | SessionMessageAssistantText1
  | SessionMessageAssistantReasoning1
  | SessionMessageAssistantTool1

export type FormInfo = { id: string; sessionID: string; title: string; metadata?: FormMetadata; fields: FormFields }

export type FormDetail = {
  id: string
  sessionID: string
  title: string
  metadata?: FormMetadata
  fields: FormFields
  state: FormState
}

export type IntegrationOAuthMethod = { id: string; type: "oauth"; label: string; form?: FormFields }

export type IntegrationKeyMethod = { type: "key"; label?: string; form?: FormFields }

export type IntegrationExternalMethod = { id: string; type: "external"; label: string; form?: FormFields }

export type CredentialEntry = {
  id: string
  integrationID: string
  label: string
  active: boolean
  value: CredentialValue
}

export type FormInfo1 = { id: string; sessionID: string; title: string; metadata?: FormMetadata1; fields: FormFields2 }

export type SessionMessageInfo =
  | SessionMessageAgentSelected
  | SessionMessageModelSelected
  | SessionMessageLocationSwitched
  | SessionMessageUser
  | SessionMessageSynthetic
  | SessionMessageSystem
  | SessionMessageSkill
  | SessionMessageShell
  | SessionMessageAssistant
  | SessionMessageCompaction
  | SessionMessageIdle

export type SessionMessageContentUpdated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "session.message.content.updated"
  durable: { aggregateID: string; seq: number; version: 1 }
  location?: LocationRef
  data: { sessionID: string; messageID: string; content: Array<SessionMessageAssistantContentEncoded> }
}

export type IntegrationMethod =
  | IntegrationOAuthMethod
  | IntegrationCommandMethod
  | IntegrationKeyMethod
  | IntegrationExternalMethod
  | IntegrationEnvMethod

export type FormCreated = {
  id: string
  created: number
  metadata?: { [x: string]: any }
  type: "form.created"
  location?: LocationRef
  data: { form: FormInfo1 }
}

export type SessionTransferData = { info: SessionInfo; messages: Array<SessionMessageInfo> }

export type SessionMessagesResponse = {
  data: Array<SessionMessageInfo>
  cursor: { previous?: string | null; next?: string | null }
}

export type SessionEventDurable =
  | SessionCreated
  | SessionAgentSelected
  | SessionModelSelected
  | SessionMoved
  | SessionRenamed
  | SessionMetadataUpdated
  | SessionPermissions
  | SessionViewed
  | SessionDeleted
  | SessionForked
  | SessionInboxDelivered
  | SessionInboxEnqueued
  | SessionInboxCancelled
  | SessionInboxDeliveryChanged
  | SessionExecutionStarted
  | SessionExecutionSucceeded
  | SessionExecutionFailed
  | SessionExecutionInterrupted
  | SessionInstructionsUpdated
  | SessionSynthetic
  | SessionSkillActivated
  | SessionShellStarted
  | SessionShellEnded
  | SessionStepStarted
  | SessionStepStreamed
  | SessionStepEnded
  | SessionStepFailed
  | SessionTextStarted
  | SessionTextEnded
  | SessionReasoningStarted
  | SessionReasoningEnded
  | SessionToolInputStarted
  | SessionToolInputEnded
  | SessionToolCalled
  | SessionToolSuccess
  | SessionToolFailed
  | SessionRetryScheduled
  | SessionCompactionStarted
  | SessionCompactionEnded
  | SessionCompactionFailed
  | SessionRevertStaged
  | SessionRevertCleared
  | SessionRevertCommitted
  | SessionUsageRecorded
  | SessionMessageContentUpdated

export type IntegrationInfo = {
  id: string
  name: string
  metadata?: { [x: string]: any }
  methods: Array<IntegrationMethod>
  connections: Array<ConnectionInfo>
}

export type V2Event =
  | LocationShutdown
  | ModelsDevRefreshed
  | CredentialUpdated
  | CredentialSwitched
  | IntegrationUpdated
  | ProviderUpdated
  | ModelUpdated
  | AgentUpdated
  | SessionCreated
  | SessionAgentSelected
  | SessionModelSelected
  | SessionMoved
  | SessionRenamed
  | SessionMetadataUpdated
  | SessionPermissions
  | SessionViewed
  | SessionUsageUpdated
  | SessionDeleted
  | SessionForked
  | SessionInboxDelivered
  | SessionInboxEnqueued
  | SessionInboxCancelled
  | SessionInboxDeliveryChanged
  | SessionExecutionStarted
  | SessionExecutionSucceeded
  | SessionExecutionFailed
  | SessionExecutionInterrupted
  | SessionInstructionsUpdated
  | SessionSynthetic
  | SessionSkillActivated
  | SessionShellStarted
  | SessionShellEnded
  | SessionStepStarted
  | SessionStepStreamed
  | SessionStepEnded
  | SessionStepFailed
  | SessionTextStarted
  | SessionTextDelta
  | SessionTextEnded
  | SessionReasoningStarted
  | SessionReasoningDelta
  | SessionReasoningEnded
  | SessionToolInputStarted
  | SessionToolInputDelta
  | SessionToolInputEnded
  | SessionToolCalled
  | SessionToolProgress
  | SessionToolSuccess
  | SessionToolFailed
  | SessionRetryScheduled
  | SessionCompactionStarted
  | SessionCompactionDelta
  | SessionCompactionEnded
  | SessionCompactionFailed
  | SessionRevertStaged
  | SessionRevertCleared
  | SessionRevertCommitted
  | FilesystemChanged
  | ReferenceUpdated
  | PermissionAsked
  | PermissionReplied
  | PluginUpdated
  | ProjectUpdated
  | WorktreeUpdated
  | WorktreeResolved
  | CommandUpdated
  | ConfigUpdated
  | SkillUpdated
  | PtyCreated
  | PtyUpdated
  | PtyExited
  | PtyDeleted
  | PersistentPtyAdded
  | PersistentPtyRemoved
  | ShellCreated
  | ShellExited
  | ShellDeleted
  | FormCreated
  | FormReplied
  | FormCancelled
  | WebsearchUpdated
  | NoteUpdated
  | SessionStatusUpdated
  | SessionIdle
  | TuiPromptAppend
  | TuiCommandExecute
  | TuiToastShow
  | TuiSessionSelect
  | InstallationUpdated
  | InstallationUpdateAvailable
  | VcsBranchUpdated
  | McpStatusChanged
  | McpResourcesChanged
  | V2EventRpc
  | V2EventServerConnected

export type SessionLogItem = SessionEventDurable | EventLogSynced

export type RoomLogItem =
  | SessionEventDurable
  | SessionUsageUpdated
  | SessionTextDelta
  | SessionReasoningDelta
  | SessionToolInputDelta
  | SessionToolProgress
  | SessionCompactionDelta
  | EventLogSynced
  | PermissionAsked
  | PermissionReplied

export type InvalidRequestError = {
  readonly _tag: "InvalidRequestError"
  readonly message: string
  readonly kind?: string | undefined
  readonly field?: string | undefined
}
export const isInvalidRequestError = (value: unknown): value is InvalidRequestError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidRequestError"

export type UnauthorizedError = { readonly _tag: "UnauthorizedError"; readonly message: string }
export const isUnauthorizedError = (value: unknown): value is UnauthorizedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnauthorizedError"

export type LocationNotFoundError = {
  readonly _tag: "LocationNotFoundError"
  readonly location: { readonly directory: string }
  readonly message: string
}
export const isLocationNotFoundError = (value: unknown): value is LocationNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "LocationNotFoundError"

export type ServiceUnavailableError = {
  readonly _tag: "ServiceUnavailableError"
  readonly message: string
  readonly service?: string | undefined
}
export const isServiceUnavailableError = (value: unknown): value is ServiceUnavailableError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ServiceUnavailableError"

export type AgentNotFoundError = {
  readonly _tag: "AgentNotFoundError"
  readonly agentID: string
  readonly message: string
}
export const isAgentNotFoundError = (value: unknown): value is AgentNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "AgentNotFoundError"

export type InvalidCursorError = { readonly _tag: "InvalidCursorError"; readonly message: string }
export const isInvalidCursorError = (value: unknown): value is InvalidCursorError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "InvalidCursorError"

export type SessionNotFoundError = {
  readonly _tag: "SessionNotFoundError"
  readonly sessionID: string
  readonly message: string
}
export const isSessionNotFoundError = (value: unknown): value is SessionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionNotFoundError"

export type ConflictError = {
  readonly _tag: "ConflictError"
  readonly message: string
  readonly resource?: string | undefined
}
export const isConflictError = (value: unknown): value is ConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ConflictError"

export type UnknownError = {
  readonly _tag: "UnknownError"
  readonly message: string
  readonly ref?: string | undefined
}
export const isUnknownError = (value: unknown): value is UnknownError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "UnknownError"

export type MessageNotFoundError = {
  readonly _tag: "MessageNotFoundError"
  readonly sessionID: string
  readonly messageID: string
  readonly message: string
}
export const isMessageNotFoundError = (value: unknown): value is MessageNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "MessageNotFoundError"

export type PromptRejectedError = {
  readonly _tag: "PromptRejectedError"
  readonly message: string
  readonly reason: string
  readonly source?: string | undefined
}
export const isPromptRejectedError = (value: unknown): value is PromptRejectedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PromptRejectedError"

export type CommandNotFoundError = {
  readonly _tag: "CommandNotFoundError"
  readonly command: string
  readonly message: string
}
export const isCommandNotFoundError = (value: unknown): value is CommandNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "CommandNotFoundError"

export type CommandExecutionError = {
  readonly _tag: "CommandExecutionError"
  readonly command: string
  readonly message: string
}
export const isCommandExecutionError = (value: unknown): value is CommandExecutionError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "CommandExecutionError"

export type SkillNotFoundError = {
  readonly _tag: "SkillNotFoundError"
  readonly skill: string
  readonly message: string
}
export const isSkillNotFoundError = (value: unknown): value is SkillNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SkillNotFoundError"

export type SessionBusyError = {
  readonly _tag: "SessionBusyError"
  readonly sessionID: string
  readonly message: string
}
export const isSessionBusyError = (value: unknown): value is SessionBusyError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "SessionBusyError"

export type InstructionEntryValueTooLargeError = {
  readonly _tag: "InstructionEntryValueTooLargeError"
  readonly actualBytes: number
  readonly maxBytes: number
  readonly message: string
}
export const isInstructionEntryValueTooLargeError = (value: unknown): value is InstructionEntryValueTooLargeError =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value["_tag"] === "InstructionEntryValueTooLargeError"

export type FormNotFoundError = { readonly _tag: "FormNotFoundError"; readonly id: string; readonly message: string }
export const isFormNotFoundError = (value: unknown): value is FormNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormNotFoundError"

export type FormInvalidAnswerError = {
  readonly _tag: "FormInvalidAnswerError"
  readonly id: string
  readonly message: string
}
export const isFormInvalidAnswerError = (value: unknown): value is FormInvalidAnswerError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormInvalidAnswerError"

export type FormAlreadySettledError = {
  readonly _tag: "FormAlreadySettledError"
  readonly id: string
  readonly message: string
}
export const isFormAlreadySettledError = (value: unknown): value is FormAlreadySettledError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FormAlreadySettledError"

export type ProviderNotFoundError = {
  readonly _tag: "ProviderNotFoundError"
  readonly providerID: string
  readonly message: string
}
export const isProviderNotFoundError = (value: unknown): value is ProviderNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProviderNotFoundError"

export type IntegrationNotFoundError = {
  readonly _tag: "IntegrationNotFoundError"
  readonly integrationID: string
  readonly message: string
}
export const isIntegrationNotFoundError = (value: unknown): value is IntegrationNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "IntegrationNotFoundError"

export type IntegrationAttemptNotFoundError = {
  readonly _tag: "IntegrationAttemptNotFoundError"
  readonly integrationID: string
  readonly attemptID: string
  readonly message: string
}
export const isIntegrationAttemptNotFoundError = (value: unknown): value is IntegrationAttemptNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "IntegrationAttemptNotFoundError"

export type IntegrationMethodNotFoundError = {
  readonly _tag: "IntegrationMethodNotFoundError"
  readonly integrationID: string
  readonly methodID: string
  readonly message: string
}
export const isIntegrationMethodNotFoundError = (value: unknown): value is IntegrationMethodNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "IntegrationMethodNotFoundError"

export type McpServerNotFoundError = {
  readonly _tag: "McpServerNotFoundError"
  readonly server: string
  readonly message: string
}
export const isMcpServerNotFoundError = (value: unknown): value is McpServerNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "McpServerNotFoundError"

export type ProjectNotFoundError = {
  readonly _tag: "ProjectNotFoundError"
  readonly projectID: string
  readonly message: string
}
export const isProjectNotFoundError = (value: unknown): value is ProjectNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ProjectNotFoundError"

export type PermissionNotFoundError = {
  readonly _tag: "PermissionNotFoundError"
  readonly requestID: string
  readonly message: string
}
export const isPermissionNotFoundError = (value: unknown): value is PermissionNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PermissionNotFoundError"

export type FileNotFoundError = { readonly _tag: "FileNotFoundError"; readonly path: string; readonly message: string }
export const isFileNotFoundError = (value: unknown): value is FileNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "FileNotFoundError"

export type RpcError = {
  readonly _tag: "RpcError"
  readonly type: string
  readonly message: string
  readonly data?: unknown | undefined
}
export const isRpcError = (value: unknown): value is RpcError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "RpcError"

export type RpcInternalError = {
  readonly _tag: "RpcInternalError"
  readonly type: "rpc.internal" | "rpc.invalid_output"
  readonly message: string
  readonly data?: unknown | undefined
}
export const isRpcInternalError = (value: unknown): value is RpcInternalError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "RpcInternalError"

export type PtyNotFoundError = { readonly _tag: "PtyNotFoundError"; readonly ptyID: string; readonly message: string }
export const isPtyNotFoundError = (value: unknown): value is PtyNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "PtyNotFoundError"

export type ForbiddenError = { readonly _tag: "ForbiddenError"; readonly message: string }
export const isForbiddenError = (value: unknown): value is ForbiddenError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ForbiddenError"

export type ShellNotFoundError = { readonly _tag: "ShellNotFoundError"; readonly id: string; readonly message: string }
export const isShellNotFoundError = (value: unknown): value is ShellNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "ShellNotFoundError"

export type WorktreeError = {
  readonly _tag: "WorktreeError"
  readonly name: "WorktreeError"
  readonly data: { readonly message: string; readonly forceRequired?: boolean | undefined }
}
export const isWorktreeError = (value: unknown): value is WorktreeError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "WorktreeError"

export type VcsInitNotSupportedError = {
  readonly _tag: "VcsInitNotSupportedError"
  readonly providerID: string
  readonly message: string
}
export const isVcsInitNotSupportedError = (value: unknown): value is VcsInitNotSupportedError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "VcsInitNotSupportedError"

export type NoteNotFoundError = { readonly _tag: "NoteNotFoundError"; readonly name: string; readonly message: string }
export const isNoteNotFoundError = (value: unknown): value is NoteNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "NoteNotFoundError"

export type NoteConflictError = {
  readonly _tag: "NoteConflictError"
  readonly name: string
  readonly expected: number
  readonly actual: number
  readonly message: string
}
export const isNoteConflictError = (value: unknown): value is NoteConflictError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "NoteConflictError"

export type RoomNotFoundError = {
  readonly _tag: "RoomNotFoundError"
  readonly roomID: string
  readonly message: string
}
export const isRoomNotFoundError = (value: unknown): value is RoomNotFoundError =>
  typeof value === "object" && value !== null && "_tag" in value && value["_tag"] === "RoomNotFoundError"

export type ServerInfoOutput = ServerInfo

export type ServerPairOutput = PairingCode

export type ServerConnectInput = { readonly code: { readonly code: string }["code"] }

export type ServerConnectOutput = PairingSession

export type LocationGetInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type LocationGetOutput = LocationPublicInfo

export type LocationReloadOutput = void

export type AgentListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type AgentListOutput = { location: LocationPublicRef; data: Array<AgentInfo> }

export type AgentGetInput = {
  readonly agentID: { readonly agentID: string }["agentID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type AgentGetOutput = { location: LocationPublicRef; data: AgentInfo }

export type PluginListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type PluginListOutput = { location: LocationPublicRef; data: Array<PluginInfo> }

export type PluginCheckInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly target?: { readonly target?: string | undefined }["target"]
}

export type PluginCheckOutput = { location: LocationPublicRef; data: Array<PluginInfo> }

export type PluginUpdateInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly targets: { readonly targets: ReadonlyArray<string> }["targets"]
}

export type PluginUpdateOutput = void

export type SessionListInput = {
  readonly limit?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["limit"]
  readonly order?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["order"]
  readonly search?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["search"]
  readonly parentID?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["parentID"]
  readonly directory?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["directory"]
  readonly project?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["project"]
  readonly subpath?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["subpath"]
  readonly cursor?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly search?: string | undefined
    readonly parentID?: string | null | undefined
    readonly directory?: string | undefined
    readonly project?: string | undefined
    readonly subpath?: string | undefined
    readonly cursor?: string | undefined
  }["cursor"]
}

export type SessionListOutput = SessionsResponse

export type SessionStatsInput = {
  readonly from?: {
    readonly from?: number | undefined
    readonly to?: number | undefined
    readonly project?: string | undefined
    readonly timezone?: string | undefined
    readonly tools?: "none" | "summary" | "detail" | undefined
  }["from"]
  readonly to?: {
    readonly from?: number | undefined
    readonly to?: number | undefined
    readonly project?: string | undefined
    readonly timezone?: string | undefined
    readonly tools?: "none" | "summary" | "detail" | undefined
  }["to"]
  readonly project?: {
    readonly from?: number | undefined
    readonly to?: number | undefined
    readonly project?: string | undefined
    readonly timezone?: string | undefined
    readonly tools?: "none" | "summary" | "detail" | undefined
  }["project"]
  readonly timezone?: {
    readonly from?: number | undefined
    readonly to?: number | undefined
    readonly project?: string | undefined
    readonly timezone?: string | undefined
    readonly tools?: "none" | "summary" | "detail" | undefined
  }["timezone"]
  readonly tools?: {
    readonly from?: number | undefined
    readonly to?: number | undefined
    readonly project?: string | undefined
    readonly timezone?: string | undefined
    readonly tools?: "none" | "summary" | "detail" | undefined
  }["tools"]
}

export type SessionStatsOutput = { data: SessionStatsInfo }["data"]

export type SessionCreateInput = {
  readonly id?: {
    readonly id?: string | null
    readonly parentID?: string | null
    readonly title?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string } | null
    readonly metadata?: { readonly [x: string]: JsonValue } | null
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }> | null
  }["id"]
  readonly parentID?: {
    readonly id?: string | null
    readonly parentID?: string | null
    readonly title?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string } | null
    readonly metadata?: { readonly [x: string]: JsonValue } | null
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }> | null
  }["parentID"]
  readonly title?: {
    readonly id?: string | null
    readonly parentID?: string | null
    readonly title?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string } | null
    readonly metadata?: { readonly [x: string]: JsonValue } | null
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }> | null
  }["title"]
  readonly agent?: {
    readonly id?: string | null
    readonly parentID?: string | null
    readonly title?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string } | null
    readonly metadata?: { readonly [x: string]: JsonValue } | null
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }> | null
  }["agent"]
  readonly model?: {
    readonly id?: string | null
    readonly parentID?: string | null
    readonly title?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string } | null
    readonly metadata?: { readonly [x: string]: JsonValue } | null
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }> | null
  }["model"]
  readonly location?: {
    readonly id?: string | null
    readonly parentID?: string | null
    readonly title?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string } | null
    readonly metadata?: { readonly [x: string]: JsonValue } | null
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }> | null
  }["location"]
  readonly metadata?: {
    readonly id?: string | null
    readonly parentID?: string | null
    readonly title?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string } | null
    readonly metadata?: { readonly [x: string]: JsonValue } | null
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }> | null
  }["metadata"]
  readonly permissions?: {
    readonly id?: string | null
    readonly parentID?: string | null
    readonly title?: string | null
    readonly agent?: string | null
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
    readonly location?: { readonly directory: string } | null
    readonly metadata?: { readonly [x: string]: JsonValue } | null
    readonly permissions?: ReadonlyArray<{
      readonly action: string
      readonly resource: string
      readonly effect: "allow" | "deny" | "ask"
    }> | null
  }["permissions"]
}

export type SessionCreateOutput = { data: SessionInfo }["data"]

export type SessionImportInput = {
  readonly info: {
    readonly info: {
      readonly id: string
      readonly parentID?: string
      readonly fork?: {
        readonly sessionID: string
        readonly boundary:
          | { readonly type: "before"; readonly messageID: string }
          | { readonly type: "through"; readonly messageID: string }
      }
      readonly projectID: string
      readonly agent?: string
      readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
      readonly cost: number
      readonly tokens: {
        readonly input: number
        readonly output: number
        readonly reasoning: number
        readonly cache: { readonly read: number; readonly write: number }
      }
      readonly outcome?: "succeeded" | "failed" | "interrupted"
      readonly time: {
        readonly created: number
        readonly updated: number
        readonly idle?: number
        readonly viewed?: number
        readonly archived?: number
      }
      readonly title?: string
      readonly subpath?: string
      readonly metadata?: { readonly [x: string]: JsonValue }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "allow" | "deny" | "ask"
      }>
      readonly revert?: {
        readonly messageID: string
        readonly partID?: string
        readonly snapshot?: string
        readonly files?: ReadonlyArray<{
          readonly file: string
          readonly patch: string
          readonly additions: number
          readonly deletions: number
          readonly status: "added" | "deleted" | "modified"
        }>
      }
      readonly location: { readonly directory: string }
    }
    readonly messages: ReadonlyArray<
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "agent-switched"
          readonly agent: string
          readonly previous?: string
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "model-switched"
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly previous?: { readonly id: string; readonly providerID: string; readonly variant?: string }
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "location-switched"
          readonly projectID?: string
          readonly subpath?: string
          readonly location: { readonly directory: string }
          readonly previous?: {
            readonly location: { readonly directory: string }
            readonly projectID?: string
            readonly subpath?: string
          } | null
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly data: string
            readonly mime: string
            readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
            readonly name?: string
            readonly description?: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly skills?: ReadonlyArray<{
            readonly id: string
            readonly name: string
            readonly text?: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly type: "user"
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly text: string
          readonly description?: string
          readonly type: "synthetic"
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "system"
          readonly text: string
          readonly description?: string
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "skill"
          readonly skill: string
          readonly name: string
          readonly text: string
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number; readonly completed?: number }
          readonly type: "shell"
          readonly shellID: string
          readonly command: string
          readonly status: "running" | "exited" | "timeout" | "killed"
          readonly exit?: number | "Infinity" | "-Infinity" | "NaN"
          readonly output?: {
            readonly output: string
            readonly cursor: number
            readonly size: number
            readonly truncated: boolean
          }
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number; readonly streamed?: number; readonly completed?: number }
          readonly type: "assistant"
          readonly agent: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string; readonly state?: { readonly [x: string]: JsonValue } }
            | {
                readonly type: "reasoning"
                readonly text: string
                readonly state?: { readonly [x: string]: JsonValue }
                readonly time?: { readonly created: number; readonly completed?: number }
              }
            | {
                readonly type: "tool"
                readonly id: string
                readonly name: string
                readonly executed?: boolean
                readonly providerState?: { readonly [x: string]: JsonValue }
                readonly providerResultState?: { readonly [x: string]: JsonValue }
                readonly state:
                  | { readonly status: "streaming"; readonly input: string }
                  | {
                      readonly status: "running"
                      readonly input: { readonly [x: string]: JsonValue }
                      readonly metadata: { readonly [x: string]: JsonValue }
                    }
                  | {
                      readonly status: "completed"
                      readonly input: { readonly [x: string]: JsonValue }
                      readonly content: readonly [
                        (
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        ),
                        ...Array<
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        >,
                      ]
                      readonly metadata?: { readonly [x: string]: JsonValue }
                    }
                  | {
                      readonly status: "error"
                      readonly input: { readonly [x: string]: JsonValue }
                      readonly error: {
                        readonly type: string
                        readonly message: string
                        readonly status?: number
                        readonly response?: { readonly body: string }
                      }
                      readonly content?: readonly [
                        (
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        ),
                        ...Array<
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        >,
                      ]
                      readonly metadata?: { readonly [x: string]: JsonValue }
                    }
                readonly time: { readonly created: number; readonly ran?: number; readonly completed?: number }
              }
          >
          readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
          readonly finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
          readonly rawFinish?: string
          readonly providerState?: { readonly [x: string]: JsonValue }
          readonly cost?: number
          readonly tokens?: {
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
          readonly error?: {
            readonly type: string
            readonly message: string
            readonly status?: number
            readonly response?: { readonly body: string }
          }
          readonly retry?: {
            readonly attempt: number
            readonly at: number
            readonly error: {
              readonly type: string
              readonly message: string
              readonly status?: number
              readonly response?: { readonly body: string }
            }
          }
        }
      | (
          | {
              readonly type: "compaction"
              readonly id: string
              readonly metadata?: { readonly [x: string]: JsonValue }
              readonly time: { readonly created: number }
              readonly status: "running"
              readonly reason: "auto" | "manual"
              readonly summary: string
              readonly recent: string
            }
          | {
              readonly type: "compaction"
              readonly id: string
              readonly metadata?: { readonly [x: string]: JsonValue }
              readonly time: { readonly created: number }
              readonly status: "completed"
              readonly reason: "auto" | "manual"
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly providerState?: { readonly [x: string]: JsonValue }
              readonly summary: string
              readonly recent: string
              readonly providerContext?: {
                readonly version: 1
                readonly provenance: {
                  readonly providerID: string
                  readonly provider: string
                  readonly modelID: string
                  readonly route: string
                  readonly protocol: string
                  readonly endpoint: string
                }
                readonly messages: JsonValue
              }
              readonly cost?: number
              readonly tokens?: {
                readonly input: number
                readonly output: number
                readonly reasoning: number
                readonly cache: { readonly read: number; readonly write: number }
              }
            }
          | {
              readonly type: "compaction"
              readonly id: string
              readonly metadata?: { readonly [x: string]: JsonValue }
              readonly time: { readonly created: number }
              readonly status: "failed"
              readonly reason: "auto" | "manual"
              readonly error: {
                readonly type: string
                readonly message: string
                readonly status?: number
                readonly response?: { readonly body: string }
              }
              readonly cost?: number
              readonly tokens?: {
                readonly input: number
                readonly output: number
                readonly reasoning: number
                readonly cache: { readonly read: number; readonly write: number }
              }
            }
        )
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "idle"
          readonly outcome: "succeeded" | "failed" | "interrupted"
        }
    >
    readonly location?: { readonly directory: string } | null
  }["info"]
  readonly messages: {
    readonly info: {
      readonly id: string
      readonly parentID?: string
      readonly fork?: {
        readonly sessionID: string
        readonly boundary:
          | { readonly type: "before"; readonly messageID: string }
          | { readonly type: "through"; readonly messageID: string }
      }
      readonly projectID: string
      readonly agent?: string
      readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
      readonly cost: number
      readonly tokens: {
        readonly input: number
        readonly output: number
        readonly reasoning: number
        readonly cache: { readonly read: number; readonly write: number }
      }
      readonly outcome?: "succeeded" | "failed" | "interrupted"
      readonly time: {
        readonly created: number
        readonly updated: number
        readonly idle?: number
        readonly viewed?: number
        readonly archived?: number
      }
      readonly title?: string
      readonly subpath?: string
      readonly metadata?: { readonly [x: string]: JsonValue }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "allow" | "deny" | "ask"
      }>
      readonly revert?: {
        readonly messageID: string
        readonly partID?: string
        readonly snapshot?: string
        readonly files?: ReadonlyArray<{
          readonly file: string
          readonly patch: string
          readonly additions: number
          readonly deletions: number
          readonly status: "added" | "deleted" | "modified"
        }>
      }
      readonly location: { readonly directory: string }
    }
    readonly messages: ReadonlyArray<
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "agent-switched"
          readonly agent: string
          readonly previous?: string
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "model-switched"
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly previous?: { readonly id: string; readonly providerID: string; readonly variant?: string }
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "location-switched"
          readonly projectID?: string
          readonly subpath?: string
          readonly location: { readonly directory: string }
          readonly previous?: {
            readonly location: { readonly directory: string }
            readonly projectID?: string
            readonly subpath?: string
          } | null
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly data: string
            readonly mime: string
            readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
            readonly name?: string
            readonly description?: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly skills?: ReadonlyArray<{
            readonly id: string
            readonly name: string
            readonly text?: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly type: "user"
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly text: string
          readonly description?: string
          readonly type: "synthetic"
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "system"
          readonly text: string
          readonly description?: string
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "skill"
          readonly skill: string
          readonly name: string
          readonly text: string
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number; readonly completed?: number }
          readonly type: "shell"
          readonly shellID: string
          readonly command: string
          readonly status: "running" | "exited" | "timeout" | "killed"
          readonly exit?: number | "Infinity" | "-Infinity" | "NaN"
          readonly output?: {
            readonly output: string
            readonly cursor: number
            readonly size: number
            readonly truncated: boolean
          }
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number; readonly streamed?: number; readonly completed?: number }
          readonly type: "assistant"
          readonly agent: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string; readonly state?: { readonly [x: string]: JsonValue } }
            | {
                readonly type: "reasoning"
                readonly text: string
                readonly state?: { readonly [x: string]: JsonValue }
                readonly time?: { readonly created: number; readonly completed?: number }
              }
            | {
                readonly type: "tool"
                readonly id: string
                readonly name: string
                readonly executed?: boolean
                readonly providerState?: { readonly [x: string]: JsonValue }
                readonly providerResultState?: { readonly [x: string]: JsonValue }
                readonly state:
                  | { readonly status: "streaming"; readonly input: string }
                  | {
                      readonly status: "running"
                      readonly input: { readonly [x: string]: JsonValue }
                      readonly metadata: { readonly [x: string]: JsonValue }
                    }
                  | {
                      readonly status: "completed"
                      readonly input: { readonly [x: string]: JsonValue }
                      readonly content: readonly [
                        (
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        ),
                        ...Array<
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        >,
                      ]
                      readonly metadata?: { readonly [x: string]: JsonValue }
                    }
                  | {
                      readonly status: "error"
                      readonly input: { readonly [x: string]: JsonValue }
                      readonly error: {
                        readonly type: string
                        readonly message: string
                        readonly status?: number
                        readonly response?: { readonly body: string }
                      }
                      readonly content?: readonly [
                        (
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        ),
                        ...Array<
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        >,
                      ]
                      readonly metadata?: { readonly [x: string]: JsonValue }
                    }
                readonly time: { readonly created: number; readonly ran?: number; readonly completed?: number }
              }
          >
          readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
          readonly finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
          readonly rawFinish?: string
          readonly providerState?: { readonly [x: string]: JsonValue }
          readonly cost?: number
          readonly tokens?: {
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
          readonly error?: {
            readonly type: string
            readonly message: string
            readonly status?: number
            readonly response?: { readonly body: string }
          }
          readonly retry?: {
            readonly attempt: number
            readonly at: number
            readonly error: {
              readonly type: string
              readonly message: string
              readonly status?: number
              readonly response?: { readonly body: string }
            }
          }
        }
      | (
          | {
              readonly type: "compaction"
              readonly id: string
              readonly metadata?: { readonly [x: string]: JsonValue }
              readonly time: { readonly created: number }
              readonly status: "running"
              readonly reason: "auto" | "manual"
              readonly summary: string
              readonly recent: string
            }
          | {
              readonly type: "compaction"
              readonly id: string
              readonly metadata?: { readonly [x: string]: JsonValue }
              readonly time: { readonly created: number }
              readonly status: "completed"
              readonly reason: "auto" | "manual"
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly providerState?: { readonly [x: string]: JsonValue }
              readonly summary: string
              readonly recent: string
              readonly providerContext?: {
                readonly version: 1
                readonly provenance: {
                  readonly providerID: string
                  readonly provider: string
                  readonly modelID: string
                  readonly route: string
                  readonly protocol: string
                  readonly endpoint: string
                }
                readonly messages: JsonValue
              }
              readonly cost?: number
              readonly tokens?: {
                readonly input: number
                readonly output: number
                readonly reasoning: number
                readonly cache: { readonly read: number; readonly write: number }
              }
            }
          | {
              readonly type: "compaction"
              readonly id: string
              readonly metadata?: { readonly [x: string]: JsonValue }
              readonly time: { readonly created: number }
              readonly status: "failed"
              readonly reason: "auto" | "manual"
              readonly error: {
                readonly type: string
                readonly message: string
                readonly status?: number
                readonly response?: { readonly body: string }
              }
              readonly cost?: number
              readonly tokens?: {
                readonly input: number
                readonly output: number
                readonly reasoning: number
                readonly cache: { readonly read: number; readonly write: number }
              }
            }
        )
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "idle"
          readonly outcome: "succeeded" | "failed" | "interrupted"
        }
    >
    readonly location?: { readonly directory: string } | null
  }["messages"]
  readonly location?: {
    readonly info: {
      readonly id: string
      readonly parentID?: string
      readonly fork?: {
        readonly sessionID: string
        readonly boundary:
          | { readonly type: "before"; readonly messageID: string }
          | { readonly type: "through"; readonly messageID: string }
      }
      readonly projectID: string
      readonly agent?: string
      readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
      readonly cost: number
      readonly tokens: {
        readonly input: number
        readonly output: number
        readonly reasoning: number
        readonly cache: { readonly read: number; readonly write: number }
      }
      readonly outcome?: "succeeded" | "failed" | "interrupted"
      readonly time: {
        readonly created: number
        readonly updated: number
        readonly idle?: number
        readonly viewed?: number
        readonly archived?: number
      }
      readonly title?: string
      readonly subpath?: string
      readonly metadata?: { readonly [x: string]: JsonValue }
      readonly permissions?: ReadonlyArray<{
        readonly action: string
        readonly resource: string
        readonly effect: "allow" | "deny" | "ask"
      }>
      readonly revert?: {
        readonly messageID: string
        readonly partID?: string
        readonly snapshot?: string
        readonly files?: ReadonlyArray<{
          readonly file: string
          readonly patch: string
          readonly additions: number
          readonly deletions: number
          readonly status: "added" | "deleted" | "modified"
        }>
      }
      readonly location: { readonly directory: string }
    }
    readonly messages: ReadonlyArray<
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "agent-switched"
          readonly agent: string
          readonly previous?: string
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "model-switched"
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly previous?: { readonly id: string; readonly providerID: string; readonly variant?: string }
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "location-switched"
          readonly projectID?: string
          readonly subpath?: string
          readonly location: { readonly directory: string }
          readonly previous?: {
            readonly location: { readonly directory: string }
            readonly projectID?: string
            readonly subpath?: string
          } | null
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly text: string
          readonly files?: ReadonlyArray<{
            readonly data: string
            readonly mime: string
            readonly source: { readonly type: "inline" } | { readonly type: "uri"; readonly uri: string }
            readonly name?: string
            readonly description?: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly agents?: ReadonlyArray<{
            readonly name: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly skills?: ReadonlyArray<{
            readonly id: string
            readonly name: string
            readonly text?: string
            readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
          }>
          readonly type: "user"
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly text: string
          readonly description?: string
          readonly type: "synthetic"
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "system"
          readonly text: string
          readonly description?: string
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "skill"
          readonly skill: string
          readonly name: string
          readonly text: string
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number; readonly completed?: number }
          readonly type: "shell"
          readonly shellID: string
          readonly command: string
          readonly status: "running" | "exited" | "timeout" | "killed"
          readonly exit?: number | "Infinity" | "-Infinity" | "NaN"
          readonly output?: {
            readonly output: string
            readonly cursor: number
            readonly size: number
            readonly truncated: boolean
          }
        }
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number; readonly streamed?: number; readonly completed?: number }
          readonly type: "assistant"
          readonly agent: string
          readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
          readonly content: ReadonlyArray<
            | { readonly type: "text"; readonly text: string; readonly state?: { readonly [x: string]: JsonValue } }
            | {
                readonly type: "reasoning"
                readonly text: string
                readonly state?: { readonly [x: string]: JsonValue }
                readonly time?: { readonly created: number; readonly completed?: number }
              }
            | {
                readonly type: "tool"
                readonly id: string
                readonly name: string
                readonly executed?: boolean
                readonly providerState?: { readonly [x: string]: JsonValue }
                readonly providerResultState?: { readonly [x: string]: JsonValue }
                readonly state:
                  | { readonly status: "streaming"; readonly input: string }
                  | {
                      readonly status: "running"
                      readonly input: { readonly [x: string]: JsonValue }
                      readonly metadata: { readonly [x: string]: JsonValue }
                    }
                  | {
                      readonly status: "completed"
                      readonly input: { readonly [x: string]: JsonValue }
                      readonly content: readonly [
                        (
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        ),
                        ...Array<
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        >,
                      ]
                      readonly metadata?: { readonly [x: string]: JsonValue }
                    }
                  | {
                      readonly status: "error"
                      readonly input: { readonly [x: string]: JsonValue }
                      readonly error: {
                        readonly type: string
                        readonly message: string
                        readonly status?: number
                        readonly response?: { readonly body: string }
                      }
                      readonly content?: readonly [
                        (
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        ),
                        ...Array<
                          | { readonly type: "text"; readonly text: string }
                          | {
                              readonly type: "file"
                              readonly uri: string
                              readonly mime: string
                              readonly name?: string | null
                            }
                        >,
                      ]
                      readonly metadata?: { readonly [x: string]: JsonValue }
                    }
                readonly time: { readonly created: number; readonly ran?: number; readonly completed?: number }
              }
          >
          readonly snapshot?: { readonly start?: string; readonly end?: string; readonly files?: ReadonlyArray<string> }
          readonly finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown"
          readonly rawFinish?: string
          readonly providerState?: { readonly [x: string]: JsonValue }
          readonly cost?: number
          readonly tokens?: {
            readonly input: number
            readonly output: number
            readonly reasoning: number
            readonly cache: { readonly read: number; readonly write: number }
          }
          readonly error?: {
            readonly type: string
            readonly message: string
            readonly status?: number
            readonly response?: { readonly body: string }
          }
          readonly retry?: {
            readonly attempt: number
            readonly at: number
            readonly error: {
              readonly type: string
              readonly message: string
              readonly status?: number
              readonly response?: { readonly body: string }
            }
          }
        }
      | (
          | {
              readonly type: "compaction"
              readonly id: string
              readonly metadata?: { readonly [x: string]: JsonValue }
              readonly time: { readonly created: number }
              readonly status: "running"
              readonly reason: "auto" | "manual"
              readonly summary: string
              readonly recent: string
            }
          | {
              readonly type: "compaction"
              readonly id: string
              readonly metadata?: { readonly [x: string]: JsonValue }
              readonly time: { readonly created: number }
              readonly status: "completed"
              readonly reason: "auto" | "manual"
              readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string }
              readonly providerState?: { readonly [x: string]: JsonValue }
              readonly summary: string
              readonly recent: string
              readonly providerContext?: {
                readonly version: 1
                readonly provenance: {
                  readonly providerID: string
                  readonly provider: string
                  readonly modelID: string
                  readonly route: string
                  readonly protocol: string
                  readonly endpoint: string
                }
                readonly messages: JsonValue
              }
              readonly cost?: number
              readonly tokens?: {
                readonly input: number
                readonly output: number
                readonly reasoning: number
                readonly cache: { readonly read: number; readonly write: number }
              }
            }
          | {
              readonly type: "compaction"
              readonly id: string
              readonly metadata?: { readonly [x: string]: JsonValue }
              readonly time: { readonly created: number }
              readonly status: "failed"
              readonly reason: "auto" | "manual"
              readonly error: {
                readonly type: string
                readonly message: string
                readonly status?: number
                readonly response?: { readonly body: string }
              }
              readonly cost?: number
              readonly tokens?: {
                readonly input: number
                readonly output: number
                readonly reasoning: number
                readonly cache: { readonly read: number; readonly write: number }
              }
            }
        )
      | {
          readonly id: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly time: { readonly created: number }
          readonly type: "idle"
          readonly outcome: "succeeded" | "failed" | "interrupted"
        }
    >
    readonly location?: { readonly directory: string } | null
  }["location"]
}

export type SessionImportOutput = { data: SessionInfo }["data"]

export type SessionExportInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly sanitize?: { readonly sanitize?: boolean | undefined }["sanitize"]
}

export type SessionExportOutput = { data: SessionTransferData }["data"]

export type SessionActiveOutput = { data: { [x: string]: SessionActive } }["data"]

export type SessionGetInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionGetOutput = { data: SessionInfo }["data"]

export type SessionRemoveInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRemoveOutput = void

export type SessionForkInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly before?: { readonly before?: string | undefined }["before"]
}

export type SessionForkOutput = { data: SessionInfo }["data"]

export type SessionSwitchAgentInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly agent: { readonly agent: string }["agent"]
}

export type SessionSwitchAgentOutput = void

export type SessionSwitchModelInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly model: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
  }["model"]
}

export type SessionSwitchModelOutput = void

export type SessionUpdateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly title?: {
    readonly title?: string | undefined
    readonly metadata?: { readonly [x: string]: JsonValue } | undefined
    readonly permissions?:
      | ReadonlyArray<{ readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }>
      | undefined
  }["title"]
  readonly metadata?: {
    readonly title?: string | undefined
    readonly metadata?: { readonly [x: string]: JsonValue } | undefined
    readonly permissions?:
      | ReadonlyArray<{ readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }>
      | undefined
  }["metadata"]
  readonly permissions?: {
    readonly title?: string | undefined
    readonly metadata?: { readonly [x: string]: JsonValue } | undefined
    readonly permissions?:
      | ReadonlyArray<{ readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }>
      | undefined
  }["permissions"]
}

export type SessionUpdateOutput = void

export type SessionMoveInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly directory: { readonly directory: string; readonly delivery?: ("steer" | "queue") | undefined }["directory"]
  readonly delivery?: { readonly directory: string; readonly delivery?: ("steer" | "queue") | undefined }["delivery"]
}

export type SessionMoveOutput = void

export type SessionPromptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["id"]
  readonly text: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["text"]
  readonly files?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["files"]
  readonly agents?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["agents"]
  readonly skills?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["skills"]
  readonly metadata?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["metadata"]
  readonly delivery?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["delivery"]
  readonly resume?: {
    readonly id?: string | null
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["resume"]
}

export type SessionPromptOutput = { data: SessionInboxUser }["data"]

export type SessionCommandInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly name: {
    readonly name: string
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: ("steer" | "queue") | null
  }["name"]
  readonly text: {
    readonly name: string
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: ("steer" | "queue") | null
  }["text"]
  readonly files?: {
    readonly name: string
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: ("steer" | "queue") | null
  }["files"]
  readonly agents?: {
    readonly name: string
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: ("steer" | "queue") | null
  }["agents"]
  readonly skills?: {
    readonly name: string
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: ("steer" | "queue") | null
  }["skills"]
  readonly delivery?: {
    readonly name: string
    readonly text: string
    readonly files?: ReadonlyArray<{
      readonly uri: string
      readonly name?: string
      readonly description?: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly agents?: ReadonlyArray<{
      readonly name: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly skills?: ReadonlyArray<{
      readonly id: string
      readonly mention?: { readonly start: number; readonly end: number; readonly text: string }
    }>
    readonly delivery?: ("steer" | "queue") | null
  }["delivery"]
}

export type SessionCommandOutput = void

export type SessionSkillInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id: { readonly id: string; readonly resume?: boolean | undefined }["id"]
  readonly resume?: { readonly id: string; readonly resume?: boolean | undefined }["resume"]
}

export type SessionSkillOutput = void

export type SessionSyntheticInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["id"]
  readonly text: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["text"]
  readonly description?: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["description"]
  readonly metadata?: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["metadata"]
  readonly delivery?: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["delivery"]
  readonly resume?: {
    readonly id?: string | null
    readonly text: string
    readonly description?: string | null
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly delivery?: ("steer" | "queue") | null
    readonly resume?: boolean | null
  }["resume"]
}

export type SessionSyntheticOutput = { data: SessionInboxSynthetic }["data"]

export type SessionShellInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: { readonly id?: string | undefined; readonly command: string }["id"]
  readonly command: { readonly id?: string | undefined; readonly command: string }["command"]
}

export type SessionShellOutput = void

export type SessionCompactInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: { readonly id?: string | undefined; readonly delivery?: ("steer" | "queue") | undefined }["id"]
  readonly delivery?: {
    readonly id?: string | undefined
    readonly delivery?: ("steer" | "queue") | undefined
  }["delivery"]
}

export type SessionCompactOutput = { data: SessionInboxCompaction }["data"]

export type SessionWaitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionWaitOutput = void

export type SessionRevertStageInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly messageID: { readonly messageID: string; readonly files?: boolean | undefined }["messageID"]
  readonly files?: { readonly messageID: string; readonly files?: boolean | undefined }["files"]
}

export type SessionRevertStageOutput = { data: SessionRevert }["data"]

export type SessionRevertClearInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRevertClearOutput = void

export type SessionRevertCommitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionRevertCommitOutput = void

export type SessionContextInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionContextOutput = { data: Array<SessionMessageInfo> }["data"]

export type SessionDiffInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly from?: {
    readonly from?: string | undefined
    readonly to?: string | undefined
    readonly context?: number | undefined
  }["from"]
  readonly to?: {
    readonly from?: string | undefined
    readonly to?: string | undefined
    readonly context?: number | undefined
  }["to"]
  readonly context?: {
    readonly from?: string | undefined
    readonly to?: string | undefined
    readonly context?: number | undefined
  }["context"]
}

export type SessionDiffOutput = { data: Array<FileDiffInfo> }["data"]

export type SessionInboxListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInboxListOutput = { data: Array<SessionInboxInfo> }["data"]

export type SessionInboxCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly inboxID: string }["sessionID"]
  readonly inboxID: { readonly sessionID: string; readonly inboxID: string }["inboxID"]
}

export type SessionInboxCancelOutput = void

export type SessionInboxUpdateInput = {
  readonly sessionID: { readonly sessionID: string; readonly inboxID: string }["sessionID"]
  readonly inboxID: { readonly sessionID: string; readonly inboxID: string }["inboxID"]
  readonly delivery: { readonly delivery: "steer" | "queue" }["delivery"]
}

export type SessionInboxUpdateOutput = void

export type SessionInstructionsEntryListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionInstructionsEntryListOutput = { data: Array<InstructionEntryInfo> }["data"]

export type SessionInstructionsEntryPutInput = {
  readonly sessionID: { readonly sessionID: string; readonly key: string }["sessionID"]
  readonly key: { readonly sessionID: string; readonly key: string }["key"]
  readonly value: { readonly value: JsonValue }["value"]
}

export type SessionInstructionsEntryPutOutput = void

export type SessionInstructionsEntryRemoveInput = {
  readonly sessionID: { readonly sessionID: string; readonly key: string }["sessionID"]
  readonly key: { readonly sessionID: string; readonly key: string }["key"]
}

export type SessionInstructionsEntryRemoveOutput = void

export type SessionGenerateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly prompt: { readonly prompt: string }["prompt"]
}

export type SessionGenerateOutput = SessionGenerateResponse["data"]

export type SessionLogInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly after?: { readonly after?: number | undefined; readonly follow?: boolean | undefined }["after"]
  readonly follow?: { readonly after?: number | undefined; readonly follow?: boolean | undefined }["follow"]
}

export type SessionLogOutput = SessionLogItem

export type SessionInterruptInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly resume?: { readonly resume?: boolean | undefined }["resume"]
}

export type SessionInterruptOutput = SessionInterruptResponse

export type SessionBackgroundInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionBackgroundOutput = void

export type SessionMessageGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly messageID: string }["sessionID"]
  readonly messageID: { readonly sessionID: string; readonly messageID: string }["messageID"]
}

export type SessionMessageGetOutput = { data: SessionMessageInfo }["data"]

export type SessionFormListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type SessionFormListOutput = { data: Array<FormInfo> }["data"]

export type SessionFormCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "string"
            readonly format?: "email" | "uri" | "date" | "date-time"
            readonly minLength?: number
            readonly maxLength?: number
            readonly pattern?: string
            readonly placeholder?: string
            readonly default?: string
            readonly options?: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly custom?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "number"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "integer"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "boolean"
            readonly default?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly minItems?: number
            readonly maxItems?: number
            readonly custom?: boolean
            readonly default?: ReadonlyArray<string>
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string
            readonly description?: string
          }
      ),
      ...Array<
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "string"
            readonly format?: "email" | "uri" | "date" | "date-time"
            readonly minLength?: number
            readonly maxLength?: number
            readonly pattern?: string
            readonly placeholder?: string
            readonly default?: string
            readonly options?: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly custom?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "number"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "integer"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "boolean"
            readonly default?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly minItems?: number
            readonly maxItems?: number
            readonly custom?: boolean
            readonly default?: ReadonlyArray<string>
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string
            readonly description?: string
          }
      >,
    ]
  }["id"]
  readonly title: {
    readonly id?: string | null
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "string"
            readonly format?: "email" | "uri" | "date" | "date-time"
            readonly minLength?: number
            readonly maxLength?: number
            readonly pattern?: string
            readonly placeholder?: string
            readonly default?: string
            readonly options?: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly custom?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "number"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "integer"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "boolean"
            readonly default?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly minItems?: number
            readonly maxItems?: number
            readonly custom?: boolean
            readonly default?: ReadonlyArray<string>
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string
            readonly description?: string
          }
      ),
      ...Array<
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "string"
            readonly format?: "email" | "uri" | "date" | "date-time"
            readonly minLength?: number
            readonly maxLength?: number
            readonly pattern?: string
            readonly placeholder?: string
            readonly default?: string
            readonly options?: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly custom?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "number"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "integer"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "boolean"
            readonly default?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly minItems?: number
            readonly maxItems?: number
            readonly custom?: boolean
            readonly default?: ReadonlyArray<string>
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string
            readonly description?: string
          }
      >,
    ]
  }["title"]
  readonly metadata?: {
    readonly id?: string | null
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "string"
            readonly format?: "email" | "uri" | "date" | "date-time"
            readonly minLength?: number
            readonly maxLength?: number
            readonly pattern?: string
            readonly placeholder?: string
            readonly default?: string
            readonly options?: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly custom?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "number"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "integer"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "boolean"
            readonly default?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly minItems?: number
            readonly maxItems?: number
            readonly custom?: boolean
            readonly default?: ReadonlyArray<string>
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string
            readonly description?: string
          }
      ),
      ...Array<
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "string"
            readonly format?: "email" | "uri" | "date" | "date-time"
            readonly minLength?: number
            readonly maxLength?: number
            readonly pattern?: string
            readonly placeholder?: string
            readonly default?: string
            readonly options?: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly custom?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "number"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "integer"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "boolean"
            readonly default?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly minItems?: number
            readonly maxItems?: number
            readonly custom?: boolean
            readonly default?: ReadonlyArray<string>
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string
            readonly description?: string
          }
      >,
    ]
  }["metadata"]
  readonly fields: {
    readonly id?: string | null
    readonly title: string
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly fields: readonly [
      (
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "string"
            readonly format?: "email" | "uri" | "date" | "date-time"
            readonly minLength?: number
            readonly maxLength?: number
            readonly pattern?: string
            readonly placeholder?: string
            readonly default?: string
            readonly options?: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly custom?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "number"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "integer"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "boolean"
            readonly default?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly minItems?: number
            readonly maxItems?: number
            readonly custom?: boolean
            readonly default?: ReadonlyArray<string>
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string
            readonly description?: string
          }
      ),
      ...Array<
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "string"
            readonly format?: "email" | "uri" | "date" | "date-time"
            readonly minLength?: number
            readonly maxLength?: number
            readonly pattern?: string
            readonly placeholder?: string
            readonly default?: string
            readonly options?: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly custom?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "number"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "integer"
            readonly minimum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly maximum?: number | "Infinity" | "-Infinity" | "NaN"
            readonly default?: number | "Infinity" | "-Infinity" | "NaN"
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "boolean"
            readonly default?: boolean
          }
        | {
            readonly key: string
            readonly title?: string
            readonly description?: string
            readonly required?: boolean
            readonly hidden?: boolean
            readonly when?: ReadonlyArray<{
              readonly key: string
              readonly op: "eq" | "neq"
              readonly value: string | number | "Infinity" | "-Infinity" | "NaN" | boolean
            }>
            readonly type: "multiselect"
            readonly options: ReadonlyArray<{
              readonly value: string
              readonly label: string
              readonly description?: string
            }>
            readonly minItems?: number
            readonly maxItems?: number
            readonly custom?: boolean
            readonly default?: ReadonlyArray<string>
          }
        | {
            readonly key: string
            readonly type: "external"
            readonly url: string
            readonly title?: string
            readonly description?: string
          }
      >,
    ]
  }["fields"]
}

export type SessionFormCreateOutput = { data: FormInfo }["data"]

export type SessionFormGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
}

export type SessionFormGetOutput = { data: FormDetail }["data"]

export type SessionFormReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
  readonly answer: {
    readonly answer: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> }
  }["answer"]
}

export type SessionFormReplyOutput = void

export type SessionFormCancelInput = {
  readonly sessionID: { readonly sessionID: string; readonly formID: string }["sessionID"]
  readonly formID: { readonly sessionID: string; readonly formID: string }["formID"]
  readonly message?: { readonly message?: string | undefined }["message"]
}

export type SessionFormCancelOutput = void

export type SessionEnvironmentInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly variables: { readonly variables: { readonly [x: string]: string } }["variables"]
}

export type SessionEnvironmentOutput = void

export type SessionViewInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly idle: { readonly idle: number }["idle"]
}

export type SessionViewOutput = void

export type MessageListInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly limit?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
    readonly type?:
      | "agent-switched"
      | "model-switched"
      | "location-switched"
      | "user"
      | "synthetic"
      | "system"
      | "skill"
      | "shell"
      | "assistant"
      | "compaction"
      | undefined
  }["limit"]
  readonly order?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
    readonly type?:
      | "agent-switched"
      | "model-switched"
      | "location-switched"
      | "user"
      | "synthetic"
      | "system"
      | "skill"
      | "shell"
      | "assistant"
      | "compaction"
      | undefined
  }["order"]
  readonly cursor?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
    readonly type?:
      | "agent-switched"
      | "model-switched"
      | "location-switched"
      | "user"
      | "synthetic"
      | "system"
      | "skill"
      | "shell"
      | "assistant"
      | "compaction"
      | undefined
  }["cursor"]
  readonly type?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
    readonly type?:
      | "agent-switched"
      | "model-switched"
      | "location-switched"
      | "user"
      | "synthetic"
      | "system"
      | "skill"
      | "shell"
      | "assistant"
      | "compaction"
      | undefined
  }["type"]
}

export type MessageListOutput = SessionMessagesResponse

export type ModelListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type ModelListOutput = { location: LocationPublicRef; data: Array<ModelInfo> }

export type ModelDefaultInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type ModelDefaultOutput = { location: LocationPublicRef; data: ModelInfo | null }

export type GenerateTextInput = {
  readonly prompt: {
    readonly prompt: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
  }["prompt"]
  readonly model?: {
    readonly prompt: string
    readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null
  }["model"]
}

export type GenerateTextOutput = GenerateTextResponse["data"]

export type ProviderListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type ProviderListOutput = { location: LocationPublicRef; data: Array<ProviderInfo> }

export type ProviderGetInput = {
  readonly providerID: { readonly providerID: string }["providerID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type ProviderGetOutput = { location: LocationPublicRef; data: ProviderInfo }

export type IntegrationListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type IntegrationListOutput = { location: LocationPublicRef; data: Array<IntegrationInfo> }

export type IntegrationGetInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type IntegrationGetOutput = { location: LocationPublicRef; data: IntegrationInfo }

export type IntegrationWellknownAddInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly url: { readonly url: string }["url"]
}

export type IntegrationWellknownAddOutput = void

export type IntegrationConnectKeyInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly key: {
    readonly key: string
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
  }["key"]
  readonly answer?: {
    readonly key: string
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
  }["answer"]
  readonly label?: {
    readonly key: string
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
  }["label"]
}

export type IntegrationConnectKeyOutput = void

export type IntegrationConnectExternalInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly methodID: {
    readonly methodID: string
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
  }["methodID"]
  readonly answer?: {
    readonly methodID: string
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
  }["answer"]
  readonly label?: {
    readonly methodID: string
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
  }["label"]
}

export type IntegrationConnectExternalOutput = void

export type IntegrationOauthConnectInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly methodID: {
    readonly methodID: string
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
  }["methodID"]
  readonly answer?: {
    readonly methodID: string
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
  }["answer"]
  readonly label?: {
    readonly methodID: string
    readonly answer?: { readonly [x: string]: string | number | boolean | ReadonlyArray<string> } | undefined
    readonly label?: string | undefined
  }["label"]
}

export type IntegrationOauthConnectOutput = { location: LocationPublicRef; data: IntegrationAttempt }

export type IntegrationOauthStatusInput = {
  readonly integrationID: { readonly integrationID: string; readonly attemptID: string }["integrationID"]
  readonly attemptID: { readonly integrationID: string; readonly attemptID: string }["attemptID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type IntegrationOauthStatusOutput = { location: LocationPublicRef; data: IntegrationAttemptStatus }

export type IntegrationOauthCompleteInput = {
  readonly integrationID: { readonly integrationID: string; readonly attemptID: string }["integrationID"]
  readonly attemptID: { readonly integrationID: string; readonly attemptID: string }["attemptID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly code?: { readonly code?: string | undefined }["code"]
}

export type IntegrationOauthCompleteOutput = void

export type IntegrationOauthCancelInput = {
  readonly integrationID: { readonly integrationID: string; readonly attemptID: string }["integrationID"]
  readonly attemptID: { readonly integrationID: string; readonly attemptID: string }["attemptID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type IntegrationOauthCancelOutput = void

export type IntegrationCommandConnectInput = {
  readonly integrationID: { readonly integrationID: string }["integrationID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly methodID: { readonly methodID: string; readonly label?: string | undefined }["methodID"]
  readonly label?: { readonly methodID: string; readonly label?: string | undefined }["label"]
}

export type IntegrationCommandConnectOutput = { location: LocationPublicRef; data: IntegrationCommandAttempt }

export type IntegrationCommandStatusInput = {
  readonly integrationID: { readonly integrationID: string; readonly attemptID: string }["integrationID"]
  readonly attemptID: { readonly integrationID: string; readonly attemptID: string }["attemptID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type IntegrationCommandStatusOutput = { location: LocationPublicRef; data: IntegrationCommandAttemptStatus }

export type IntegrationCommandCancelInput = {
  readonly integrationID: { readonly integrationID: string; readonly attemptID: string }["integrationID"]
  readonly attemptID: { readonly integrationID: string; readonly attemptID: string }["attemptID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type IntegrationCommandCancelOutput = void

export type McpListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type McpListOutput = { location: LocationPublicRef; data: Array<McpServer> }

export type McpAddInput = {
  readonly server: { readonly server: string }["server"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly config: {
    readonly config:
      | {
          readonly type: "local"
          readonly command: ReadonlyArray<string>
          readonly cwd?: string
          readonly environment?: { readonly [x: string]: string }
          readonly disabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly protocol?: "legacy" | "auto" | "2026-07-28"
        }
      | {
          readonly type: "remote"
          readonly url: string
          readonly headers?: { readonly [x: string]: string }
          readonly oauth?:
            | {
                readonly client_id?: string
                readonly client_secret?: string
                readonly scope?: string
                readonly callback_port?: number
                readonly redirect_uri?: string
                readonly auth_server_metadata_url?: string
              }
            | false
          readonly disabled?: boolean
          readonly codemode?: boolean
          readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
          readonly protocol?: "legacy" | "auto" | "2026-07-28"
        }
  }["config"]
}

export type McpAddOutput = void

export type McpRemoveInput = {
  readonly server: { readonly server: string }["server"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type McpRemoveOutput = void

export type McpConnectInput = {
  readonly server: { readonly server: string }["server"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type McpConnectOutput = void

export type McpDisconnectInput = {
  readonly server: { readonly server: string }["server"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type McpDisconnectOutput = void

export type McpResourceCatalogInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type McpResourceCatalogOutput = { location: LocationPublicRef; data: McpResourceCatalog }

export type CredentialListOutput = { data: Array<CredentialEntry> }["data"]

export type CredentialCreateInput = {
  readonly id?: {
    readonly id?: string
    readonly integrationID: string
    readonly label?: string
    readonly value:
      | {
          readonly type: "oauth"
          readonly methodID: string
          readonly refresh: string
          readonly access: string
          readonly expires: number
          readonly metadata?: { readonly [x: string]: JsonValue }
        }
      | {
          readonly type: "key"
          readonly key: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly configuration?: {
            readonly [x: string]: string | number | "Infinity" | "-Infinity" | "NaN" | boolean | ReadonlyArray<string>
          }
        }
      | {
          readonly type: "external"
          readonly methodID: string
          readonly metadata?: { readonly [x: string]: JsonValue }
        }
    readonly activate?: boolean
  }["id"]
  readonly integrationID: {
    readonly id?: string
    readonly integrationID: string
    readonly label?: string
    readonly value:
      | {
          readonly type: "oauth"
          readonly methodID: string
          readonly refresh: string
          readonly access: string
          readonly expires: number
          readonly metadata?: { readonly [x: string]: JsonValue }
        }
      | {
          readonly type: "key"
          readonly key: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly configuration?: {
            readonly [x: string]: string | number | "Infinity" | "-Infinity" | "NaN" | boolean | ReadonlyArray<string>
          }
        }
      | {
          readonly type: "external"
          readonly methodID: string
          readonly metadata?: { readonly [x: string]: JsonValue }
        }
    readonly activate?: boolean
  }["integrationID"]
  readonly label?: {
    readonly id?: string
    readonly integrationID: string
    readonly label?: string
    readonly value:
      | {
          readonly type: "oauth"
          readonly methodID: string
          readonly refresh: string
          readonly access: string
          readonly expires: number
          readonly metadata?: { readonly [x: string]: JsonValue }
        }
      | {
          readonly type: "key"
          readonly key: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly configuration?: {
            readonly [x: string]: string | number | "Infinity" | "-Infinity" | "NaN" | boolean | ReadonlyArray<string>
          }
        }
      | {
          readonly type: "external"
          readonly methodID: string
          readonly metadata?: { readonly [x: string]: JsonValue }
        }
    readonly activate?: boolean
  }["label"]
  readonly value: {
    readonly id?: string
    readonly integrationID: string
    readonly label?: string
    readonly value:
      | {
          readonly type: "oauth"
          readonly methodID: string
          readonly refresh: string
          readonly access: string
          readonly expires: number
          readonly metadata?: { readonly [x: string]: JsonValue }
        }
      | {
          readonly type: "key"
          readonly key: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly configuration?: {
            readonly [x: string]: string | number | "Infinity" | "-Infinity" | "NaN" | boolean | ReadonlyArray<string>
          }
        }
      | {
          readonly type: "external"
          readonly methodID: string
          readonly metadata?: { readonly [x: string]: JsonValue }
        }
    readonly activate?: boolean
  }["value"]
  readonly activate?: {
    readonly id?: string
    readonly integrationID: string
    readonly label?: string
    readonly value:
      | {
          readonly type: "oauth"
          readonly methodID: string
          readonly refresh: string
          readonly access: string
          readonly expires: number
          readonly metadata?: { readonly [x: string]: JsonValue }
        }
      | {
          readonly type: "key"
          readonly key: string
          readonly metadata?: { readonly [x: string]: JsonValue }
          readonly configuration?: {
            readonly [x: string]: string | number | "Infinity" | "-Infinity" | "NaN" | boolean | ReadonlyArray<string>
          }
        }
      | {
          readonly type: "external"
          readonly methodID: string
          readonly metadata?: { readonly [x: string]: JsonValue }
        }
    readonly activate?: boolean
  }["activate"]
}

export type CredentialCreateOutput = { data: CredentialEntry }["data"]

export type CredentialUpdateInput = {
  readonly credentialID: { readonly credentialID: string }["credentialID"]
  readonly label: { readonly label: string }["label"]
}

export type CredentialUpdateOutput = void

export type CredentialActivateInput = { readonly credentialID: { readonly credentialID: string }["credentialID"] }

export type CredentialActivateOutput = void

export type CredentialRemoveInput = { readonly credentialID: { readonly credentialID: string }["credentialID"] }

export type CredentialRemoveOutput = void

export type ProjectListOutput = Array<Project>

export type ProjectUpdateInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly canonical?: {
    readonly canonical?: string
    readonly name?: string
    readonly icon?: { readonly url?: string; readonly override?: string; readonly color?: string }
    readonly commands?: { readonly start?: string }
  }["canonical"]
  readonly name?: {
    readonly canonical?: string
    readonly name?: string
    readonly icon?: { readonly url?: string; readonly override?: string; readonly color?: string }
    readonly commands?: { readonly start?: string }
  }["name"]
  readonly icon?: {
    readonly canonical?: string
    readonly name?: string
    readonly icon?: { readonly url?: string; readonly override?: string; readonly color?: string }
    readonly commands?: { readonly start?: string }
  }["icon"]
  readonly commands?: {
    readonly canonical?: string
    readonly name?: string
    readonly icon?: { readonly url?: string; readonly override?: string; readonly color?: string }
    readonly commands?: { readonly start?: string }
  }["commands"]
}

export type ProjectUpdateOutput = Project

export type FormListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type FormListOutput = { location: LocationPublicRef; data: Array<FormInfo> }

export type PermissionRequestListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type PermissionRequestListOutput = { location: LocationPublicRef; data: Array<PermissionRequest> }

export type PermissionSavedListInput = { readonly projectID?: { readonly projectID?: string | undefined }["projectID"] }

export type PermissionSavedListOutput = { data: Array<PermissionSavedInfo> }["data"]

export type PermissionSavedRemoveInput = { readonly id: { readonly id: string }["id"] }

export type PermissionSavedRemoveOutput = void

export type PermissionCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly id?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
    readonly agent?: string | null
  }["id"]
  readonly action: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
    readonly agent?: string | null
  }["action"]
  readonly resources: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
    readonly agent?: string | null
  }["resources"]
  readonly save?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
    readonly agent?: string | null
  }["save"]
  readonly metadata?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
    readonly agent?: string | null
  }["metadata"]
  readonly source?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
    readonly agent?: string | null
  }["source"]
  readonly agent?: {
    readonly id?: string | null
    readonly action: string
    readonly resources: ReadonlyArray<string>
    readonly save?: ReadonlyArray<string>
    readonly metadata?: { readonly [x: string]: JsonValue }
    readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
    readonly agent?: string | null
  }["agent"]
}

export type PermissionCreateOutput = { data: { id: string; effect: PermissionEffect } }["data"]

export type PermissionListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type PermissionListOutput = { data: Array<PermissionRequest> }["data"]

export type PermissionGetInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
}

export type PermissionGetOutput = { data: PermissionRequest }["data"]

export type PermissionReplyInput = {
  readonly sessionID: { readonly sessionID: string; readonly requestID: string }["sessionID"]
  readonly requestID: { readonly sessionID: string; readonly requestID: string }["requestID"]
  readonly decision: {
    readonly decision: "once" | "always" | "reject"
    readonly message?: string | undefined
  }["decision"]
  readonly message?: {
    readonly decision: "once" | "always" | "reject"
    readonly message?: string | undefined
  }["message"]
}

export type PermissionReplyOutput = void

export type FileReadInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly path: string
}

export type FileReadOutput = globalThis.Uint8Array

export type FileListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly path?: string | undefined
  }["location"]
  readonly path?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly path?: string | undefined
  }["path"]
}

export type FileListOutput = { location: LocationPublicRef; data: Array<FileSystemEntry> }

export type FileFindInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["location"]
  readonly query: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["query"]
  readonly type?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["type"]
  readonly limit?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly query: string
    readonly type?: "file" | "directory" | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type FileFindOutput = { location: LocationPublicRef; data: Array<FileSystemEntry> }

export type FileWriteInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly path: string
  }["location"]
  readonly path: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly path: string
  }["path"]
  readonly payload: globalThis.Uint8Array
}

export type FileWriteOutput = { location: LocationPublicRef; data: FileSystemWrite }

export type CommandListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type CommandListOutput = { location: LocationPublicRef; data: Array<CommandInfo> }

export type SkillListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type SkillListOutput = { location: LocationPublicRef; data: Array<SkillInfo> }

export type RpcCallInput = {
  readonly rpcID: { readonly rpcID: string; readonly method: string }["rpcID"]
  readonly method: { readonly rpcID: string; readonly method: string }["method"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly input?: { readonly input: JsonValue }["input"]
}

export type RpcCallOutput = RpcOutput

export type EventSubscribeOutput = V2Event

export type PtyListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type PtyListOutput = { location: LocationPublicRef; data: Array<Pty> }

export type PtyCreateInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly command?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["command"]
  readonly args?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["args"]
  readonly cwd?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["cwd"]
  readonly title?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["title"]
  readonly env?: {
    readonly command?: string
    readonly args?: ReadonlyArray<string>
    readonly cwd?: string
    readonly title?: string
    readonly env?: { readonly [x: string]: string }
  }["env"]
}

export type PtyCreateOutput = { location: LocationPublicRef; data: Pty }

export type PtyGetInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type PtyGetOutput = { location: LocationPublicRef; data: Pty }

export type PtyUpdateInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly title?: {
    readonly title?: string
    readonly size?: { readonly rows: number; readonly cols: number }
  }["title"]
  readonly size?: { readonly title?: string; readonly size?: { readonly rows: number; readonly cols: number } }["size"]
}

export type PtyUpdateOutput = { location: LocationPublicRef; data: Pty }

export type PtyRemoveInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type PtyRemoveOutput = void

export type PtyConnectTokenInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly "x-opencode-ticket"?: { readonly "x-opencode-ticket"?: string | undefined }["x-opencode-ticket"]
}

export type PtyConnectTokenOutput = { location: LocationPublicRef; data: PtyTicketConnectToken }

export type ExperimentalPersistentPtyReadInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly lines?: { readonly lines?: number | undefined }["lines"]
}

export type ExperimentalPersistentPtyReadOutput = { data: PersistentPtyReadResult | null }["data"]

export type ExperimentalPersistentPtyListInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }

export type ExperimentalPersistentPtyListOutput = { data: Array<PersistentPtyInfo> }["data"]

export type ExperimentalPersistentPtyCreateInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly command?: {
    readonly command?: string
    readonly args: ReadonlyArray<string>
    readonly cwd?: string
    readonly title: string
    readonly env: { readonly [x: string]: string }
    readonly size?: { readonly cols: number; readonly rows: number }
  }["command"]
  readonly args: {
    readonly command?: string
    readonly args: ReadonlyArray<string>
    readonly cwd?: string
    readonly title: string
    readonly env: { readonly [x: string]: string }
    readonly size?: { readonly cols: number; readonly rows: number }
  }["args"]
  readonly cwd?: {
    readonly command?: string
    readonly args: ReadonlyArray<string>
    readonly cwd?: string
    readonly title: string
    readonly env: { readonly [x: string]: string }
    readonly size?: { readonly cols: number; readonly rows: number }
  }["cwd"]
  readonly title: {
    readonly command?: string
    readonly args: ReadonlyArray<string>
    readonly cwd?: string
    readonly title: string
    readonly env: { readonly [x: string]: string }
    readonly size?: { readonly cols: number; readonly rows: number }
  }["title"]
  readonly env: {
    readonly command?: string
    readonly args: ReadonlyArray<string>
    readonly cwd?: string
    readonly title: string
    readonly env: { readonly [x: string]: string }
    readonly size?: { readonly cols: number; readonly rows: number }
  }["env"]
  readonly size?: {
    readonly command?: string
    readonly args: ReadonlyArray<string>
    readonly cwd?: string
    readonly title: string
    readonly env: { readonly [x: string]: string }
    readonly size?: { readonly cols: number; readonly rows: number }
  }["size"]
}

export type ExperimentalPersistentPtyCreateOutput = { data: PersistentPtyInfo }["data"]

export type ExperimentalPersistentPtyShutdownOutput = void

export type ExperimentalPersistentPtyHandoffOutput = { handoff: PersistentPtyHandoff | null }

export type ExperimentalPersistentPtyGetInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type ExperimentalPersistentPtyGetOutput = { data: PersistentPtyInfo }["data"]

export type ExperimentalPersistentPtyUpdateInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly attachmentID?: {
    readonly attachmentID?: string
    readonly size: { readonly cols: number; readonly rows: number }
  }["attachmentID"]
  readonly size: {
    readonly attachmentID?: string
    readonly size: { readonly cols: number; readonly rows: number }
  }["size"]
}

export type ExperimentalPersistentPtyUpdateOutput = { data: PersistentPtyInfo }["data"]

export type ExperimentalPersistentPtySnapshotInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type ExperimentalPersistentPtySnapshotOutput = { data: PersistentPtySnapshot }["data"]

export type ExperimentalPersistentPtyRemoveInput = { readonly ptyID: { readonly ptyID: string }["ptyID"] }

export type ExperimentalPersistentPtyRemoveOutput = void

export type ExperimentalPersistentPtyConnectTokenInput = {
  readonly ptyID: { readonly ptyID: string }["ptyID"]
  readonly "x-opencode-ticket"?: { readonly "x-opencode-ticket"?: string | undefined }["x-opencode-ticket"]
}

export type ExperimentalPersistentPtyConnectTokenOutput = { data: PtyTicketConnectToken }["data"]

export type ShellListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type ShellListOutput = { location: LocationPublicRef; data: Array<ShellInfo1> }

export type ShellCreateInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly command: {
    readonly command: string
    readonly cwd?: string
    readonly timeout?: number
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["command"]
  readonly cwd?: {
    readonly command: string
    readonly cwd?: string
    readonly timeout?: number
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["cwd"]
  readonly timeout?: {
    readonly command: string
    readonly cwd?: string
    readonly timeout?: number
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["timeout"]
  readonly metadata?: {
    readonly command: string
    readonly cwd?: string
    readonly timeout?: number
    readonly metadata?: { readonly [x: string]: JsonValue }
  }["metadata"]
}

export type ShellCreateOutput = { location: LocationPublicRef; data: ShellInfo1 }

export type ShellGetInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type ShellGetOutput = { location: LocationPublicRef; data: ShellInfo1 }

export type ShellOutputInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly cursor?: number | undefined
    readonly limit?: number | undefined
  }["location"]
  readonly cursor?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly cursor?: number | undefined
    readonly limit?: number | undefined
  }["cursor"]
  readonly limit?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly cursor?: number | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type ShellOutputOutput = {
  location: LocationPublicRef
  data: { output: string; cursor: number; size: number; truncated: boolean }
}

export type ShellRemoveInput = {
  readonly id: { readonly id: string }["id"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type ShellRemoveOutput = void

export type ReferenceListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type ReferenceListOutput = { location: LocationPublicRef; data: Array<ReferenceInfo> }

export type WorktreeListInput = { readonly projectID: { readonly projectID: string }["projectID"] }

export type WorktreeListOutput = WorktreeList

export type WorktreeCreateInput = {
  readonly projectID: {
    readonly projectID: string
    readonly from?: string
    readonly branch?: string
    readonly directory?: string
    readonly name?: string
  }["projectID"]
  readonly from?: {
    readonly projectID: string
    readonly from?: string
    readonly branch?: string
    readonly directory?: string
    readonly name?: string
  }["from"]
  readonly branch?: {
    readonly projectID: string
    readonly from?: string
    readonly branch?: string
    readonly directory?: string
    readonly name?: string
  }["branch"]
  readonly directory?: {
    readonly projectID: string
    readonly from?: string
    readonly branch?: string
    readonly directory?: string
    readonly name?: string
  }["directory"]
  readonly name?: {
    readonly projectID: string
    readonly from?: string
    readonly branch?: string
    readonly directory?: string
    readonly name?: string
  }["name"]
}

export type WorktreeCreateOutput = WorktreeInfo

export type WorktreeRemoveInput = {
  readonly projectID: { readonly projectID: string; readonly directory: string; readonly force: boolean }["projectID"]
  readonly directory: { readonly projectID: string; readonly directory: string; readonly force: boolean }["directory"]
  readonly force: { readonly projectID: string; readonly directory: string; readonly force: boolean }["force"]
}

export type WorktreeRemoveOutput = void

export type WorktreeRefreshInput = { readonly projectID: { readonly projectID: string }["projectID"] }

export type WorktreeRefreshOutput = void

export type VcsInitInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly provider?: string | undefined
  }["location"]
  readonly provider?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly provider?: string | undefined
  }["provider"]
}

export type VcsInitOutput = void

export type VcsGetInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type VcsGetOutput = { location: LocationPublicRef; data: VcsInfo }

export type VcsBaseInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type VcsBaseOutput = { location: LocationPublicRef; data: VcsBase | null }

export type VcsStatusInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type VcsStatusOutput = { location: LocationPublicRef; data: Array<VcsFileStatus> }

export type VcsBranchListInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["location"]
  readonly search?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["search"]
  readonly limit?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly search?: string | undefined
    readonly limit?: number | undefined
  }["limit"]
}

export type VcsBranchListOutput = { location: LocationPublicRef; data: VcsBranchList }

export type VcsDiffInput = {
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly mode: "working" | "branch" | "committed"
    readonly base?: string | undefined
    readonly context?: number | undefined
  }["location"]
  readonly mode: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly mode: "working" | "branch" | "committed"
    readonly base?: string | undefined
    readonly context?: number | undefined
  }["mode"]
  readonly base?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly mode: "working" | "branch" | "committed"
    readonly base?: string | undefined
    readonly context?: number | undefined
  }["base"]
  readonly context?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly mode: "working" | "branch" | "committed"
    readonly base?: string | undefined
    readonly context?: number | undefined
  }["context"]
}

export type VcsDiffOutput = { location: LocationPublicRef; data: Array<FileDiffInfo> }

export type NoteListInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type NoteListOutput = { location: LocationPublicRef; data: Array<NoteInfo> }

export type NoteGetInput = {
  readonly name: { readonly name: string }["name"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type NoteGetOutput = { location: LocationPublicRef; data: NoteInfo }

export type NoteBoundInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type NoteBoundOutput = { location: LocationPublicRef; data: NoteInfo | null }

export type NoteCreateInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly name?: {
    readonly name?: string
    readonly title: string
    readonly body?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly session?: string
  }["name"]
  readonly title: {
    readonly name?: string
    readonly title: string
    readonly body?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly session?: string
  }["title"]
  readonly body?: {
    readonly name?: string
    readonly title: string
    readonly body?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly session?: string
  }["body"]
  readonly status?: {
    readonly name?: string
    readonly title: string
    readonly body?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly session?: string
  }["status"]
  readonly tags?: {
    readonly name?: string
    readonly title: string
    readonly body?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly session?: string
  }["tags"]
  readonly length?: {
    readonly name?: string
    readonly title: string
    readonly body?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly session?: string
  }["length"]
  readonly session?: {
    readonly name?: string
    readonly title: string
    readonly body?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly session?: string
  }["session"]
}

export type NoteCreateOutput = { location: LocationPublicRef; data: NoteInfo }

export type NoteEditInput = {
  readonly name: { readonly name: string }["name"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly body: {
    readonly body: string
    readonly mode?: "replace" | "append"
    readonly expectedMtime: number | "Infinity" | "-Infinity" | "NaN"
  }["body"]
  readonly mode?: {
    readonly body: string
    readonly mode?: "replace" | "append"
    readonly expectedMtime: number | "Infinity" | "-Infinity" | "NaN"
  }["mode"]
  readonly expectedMtime: {
    readonly body: string
    readonly mode?: "replace" | "append"
    readonly expectedMtime: number | "Infinity" | "-Infinity" | "NaN"
  }["expectedMtime"]
}

export type NoteEditOutput = { location: LocationPublicRef; data: NoteInfo }

export type NoteUpdateInput = {
  readonly name: { readonly name: string }["name"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly title?: {
    readonly title?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly expectedMtime: number | "Infinity" | "-Infinity" | "NaN"
  }["title"]
  readonly status?: {
    readonly title?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly expectedMtime: number | "Infinity" | "-Infinity" | "NaN"
  }["status"]
  readonly tags?: {
    readonly title?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly expectedMtime: number | "Infinity" | "-Infinity" | "NaN"
  }["tags"]
  readonly length?: {
    readonly title?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly expectedMtime: number | "Infinity" | "-Infinity" | "NaN"
  }["length"]
  readonly expectedMtime: {
    readonly title?: string
    readonly status?: "inbox" | "active" | "done" | "archived"
    readonly tags?: ReadonlyArray<string>
    readonly length?: "brief" | "balanced" | "detailed"
    readonly expectedMtime: number | "Infinity" | "-Infinity" | "NaN"
  }["expectedMtime"]
}

export type NoteUpdateOutput = { location: LocationPublicRef; data: NoteInfo }

export type NoteLinkInput = {
  readonly name: { readonly name: string }["name"]
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly session?: {
    readonly session?: string
    readonly expectedMtime: number | "Infinity" | "-Infinity" | "NaN"
  }["session"]
  readonly expectedMtime: {
    readonly session?: string
    readonly expectedMtime: number | "Infinity" | "-Infinity" | "NaN"
  }["expectedMtime"]
}

export type NoteLinkOutput = { location: LocationPublicRef; data: NoteInfo }

export type NoteRemoveInput = {
  readonly name: { readonly name: string }["name"]
  readonly location?: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly expectedMtime: number
  }["location"]
  readonly expectedMtime: {
    readonly location?: { readonly directory?: string | undefined } | undefined
    readonly expectedMtime: number
  }["expectedMtime"]
}

export type NoteRemoveOutput = void

export type DebugLocationListOutput = Array<LocationPublicRef>

export type DebugLocationEvictInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type DebugLocationEvictOutput = void

export type MigrationV1StatusOutput =
  | { status: "required" | "completed" }
  | { status: "running"; progress: { label: string; numerator?: number | undefined; denominator?: number | undefined } }
  | { status: "error"; error: string }

export type WebsearchProvidersInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type WebsearchProvidersOutput = { location: LocationPublicRef; data: Array<WebSearchProvider> }

export type WebsearchQueryInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly query: { readonly query: string; readonly providerID?: string }["query"]
  readonly providerID?: { readonly query: string; readonly providerID?: string }["providerID"]
}

export type WebsearchQueryOutput = {
  location: LocationPublicRef
  data: { providerID: string; results: Array<WebSearchResult> }
}

export type ConfigGetInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type ConfigGetOutput = Array<ConfigEntry>

export type ConfigShellsOutput = Array<ConfigShellOption>

export type ConfigUpdateInput = {
  readonly shell?: {
    readonly shell?: string | null
    readonly model?: string | null
    readonly mcpServers?: {
      readonly [x: string]:
        | {
            readonly type: "local"
            readonly command: ReadonlyArray<string>
            readonly cwd?: string
            readonly environment?: { readonly [x: string]: string }
            readonly disabled?: boolean
            readonly codemode?: boolean
            readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
            readonly protocol?: "legacy" | "auto" | "2026-07-28"
          }
        | {
            readonly type: "remote"
            readonly url: string
            readonly headers?: { readonly [x: string]: string }
            readonly oauth?:
              | {
                  readonly client_id?: string
                  readonly client_secret?: string
                  readonly scope?: string
                  readonly callback_port?: number
                  readonly redirect_uri?: string
                  readonly auth_server_metadata_url?: string
                }
              | false
            readonly disabled?: boolean
            readonly codemode?: boolean
            readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
            readonly protocol?: "legacy" | "auto" | "2026-07-28"
          }
        | null
    }
    readonly proxy?: {
      readonly http?: string
      readonly https?: string
      readonly no_proxy?: ReadonlyArray<string>
    } | null
    readonly compatibilityEnabled?: boolean | null
  }["shell"]
  readonly model?: {
    readonly shell?: string | null
    readonly model?: string | null
    readonly mcpServers?: {
      readonly [x: string]:
        | {
            readonly type: "local"
            readonly command: ReadonlyArray<string>
            readonly cwd?: string
            readonly environment?: { readonly [x: string]: string }
            readonly disabled?: boolean
            readonly codemode?: boolean
            readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
            readonly protocol?: "legacy" | "auto" | "2026-07-28"
          }
        | {
            readonly type: "remote"
            readonly url: string
            readonly headers?: { readonly [x: string]: string }
            readonly oauth?:
              | {
                  readonly client_id?: string
                  readonly client_secret?: string
                  readonly scope?: string
                  readonly callback_port?: number
                  readonly redirect_uri?: string
                  readonly auth_server_metadata_url?: string
                }
              | false
            readonly disabled?: boolean
            readonly codemode?: boolean
            readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
            readonly protocol?: "legacy" | "auto" | "2026-07-28"
          }
        | null
    }
    readonly proxy?: {
      readonly http?: string
      readonly https?: string
      readonly no_proxy?: ReadonlyArray<string>
    } | null
    readonly compatibilityEnabled?: boolean | null
  }["model"]
  readonly mcpServers?: {
    readonly shell?: string | null
    readonly model?: string | null
    readonly mcpServers?: {
      readonly [x: string]:
        | {
            readonly type: "local"
            readonly command: ReadonlyArray<string>
            readonly cwd?: string
            readonly environment?: { readonly [x: string]: string }
            readonly disabled?: boolean
            readonly codemode?: boolean
            readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
            readonly protocol?: "legacy" | "auto" | "2026-07-28"
          }
        | {
            readonly type: "remote"
            readonly url: string
            readonly headers?: { readonly [x: string]: string }
            readonly oauth?:
              | {
                  readonly client_id?: string
                  readonly client_secret?: string
                  readonly scope?: string
                  readonly callback_port?: number
                  readonly redirect_uri?: string
                  readonly auth_server_metadata_url?: string
                }
              | false
            readonly disabled?: boolean
            readonly codemode?: boolean
            readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
            readonly protocol?: "legacy" | "auto" | "2026-07-28"
          }
        | null
    }
    readonly proxy?: {
      readonly http?: string
      readonly https?: string
      readonly no_proxy?: ReadonlyArray<string>
    } | null
    readonly compatibilityEnabled?: boolean | null
  }["mcpServers"]
  readonly proxy?: {
    readonly shell?: string | null
    readonly model?: string | null
    readonly mcpServers?: {
      readonly [x: string]:
        | {
            readonly type: "local"
            readonly command: ReadonlyArray<string>
            readonly cwd?: string
            readonly environment?: { readonly [x: string]: string }
            readonly disabled?: boolean
            readonly codemode?: boolean
            readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
            readonly protocol?: "legacy" | "auto" | "2026-07-28"
          }
        | {
            readonly type: "remote"
            readonly url: string
            readonly headers?: { readonly [x: string]: string }
            readonly oauth?:
              | {
                  readonly client_id?: string
                  readonly client_secret?: string
                  readonly scope?: string
                  readonly callback_port?: number
                  readonly redirect_uri?: string
                  readonly auth_server_metadata_url?: string
                }
              | false
            readonly disabled?: boolean
            readonly codemode?: boolean
            readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
            readonly protocol?: "legacy" | "auto" | "2026-07-28"
          }
        | null
    }
    readonly proxy?: {
      readonly http?: string
      readonly https?: string
      readonly no_proxy?: ReadonlyArray<string>
    } | null
    readonly compatibilityEnabled?: boolean | null
  }["proxy"]
  readonly compatibilityEnabled?: {
    readonly shell?: string | null
    readonly model?: string | null
    readonly mcpServers?: {
      readonly [x: string]:
        | {
            readonly type: "local"
            readonly command: ReadonlyArray<string>
            readonly cwd?: string
            readonly environment?: { readonly [x: string]: string }
            readonly disabled?: boolean
            readonly codemode?: boolean
            readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
            readonly protocol?: "legacy" | "auto" | "2026-07-28"
          }
        | {
            readonly type: "remote"
            readonly url: string
            readonly headers?: { readonly [x: string]: string }
            readonly oauth?:
              | {
                  readonly client_id?: string
                  readonly client_secret?: string
                  readonly scope?: string
                  readonly callback_port?: number
                  readonly redirect_uri?: string
                  readonly auth_server_metadata_url?: string
                }
              | false
            readonly disabled?: boolean
            readonly codemode?: boolean
            readonly timeout?: { readonly startup?: number; readonly catalog?: number; readonly execution?: number }
            readonly protocol?: "legacy" | "auto" | "2026-07-28"
          }
        | null
    }
    readonly proxy?: {
      readonly http?: string
      readonly https?: string
      readonly no_proxy?: ReadonlyArray<string>
    } | null
    readonly compatibilityEnabled?: boolean | null
  }["compatibilityEnabled"]
}

export type ConfigUpdateOutput = void

export type ConfigCompatibilityGetInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
}

export type ConfigCompatibilityGetOutput = ConfigCompatibilityReport

export type ConfigCompatibilityUpdateInput = {
  readonly location?: { readonly location?: { readonly directory?: string | undefined } | undefined }["location"]
  readonly ecosystem: {
    readonly ecosystem: "agents" | "claude" | "codex" | "gemini" | "cursor"
    readonly enabled?: boolean | null
    readonly trusted?: boolean
  }["ecosystem"]
  readonly enabled?: {
    readonly ecosystem: "agents" | "claude" | "codex" | "gemini" | "cursor"
    readonly enabled?: boolean | null
    readonly trusted?: boolean
  }["enabled"]
  readonly trusted?: {
    readonly ecosystem: "agents" | "claude" | "codex" | "gemini" | "cursor"
    readonly enabled?: boolean | null
    readonly trusted?: boolean
  }["trusted"]
}

export type ConfigCompatibilityUpdateOutput = ConfigCompatibilityReport

export type RoomListOutput = { data: Array<RoomInfo> }["data"]

export type RoomCreateInput = {
  readonly sessionID: {
    readonly sessionID: string
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
    readonly directory?: string | undefined
  }["sessionID"]
  readonly name?: {
    readonly sessionID: string
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
    readonly directory?: string | undefined
  }["name"]
  readonly hostName?: {
    readonly sessionID: string
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
    readonly directory?: string | undefined
  }["hostName"]
  readonly ai?: {
    readonly sessionID: string
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
    readonly directory?: string | undefined
  }["ai"]
  readonly guestApprovals?: {
    readonly sessionID: string
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
    readonly directory?: string | undefined
  }["guestApprovals"]
  readonly defaultRole?: {
    readonly sessionID: string
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
    readonly directory?: string | undefined
  }["defaultRole"]
  readonly open?: {
    readonly sessionID: string
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
    readonly directory?: string | undefined
  }["open"]
  readonly rules?: {
    readonly sessionID: string
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
    readonly directory?: string | undefined
  }["rules"]
  readonly directory?: {
    readonly sessionID: string
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
    readonly directory?: string | undefined
  }["directory"]
}

export type RoomCreateOutput = { data: RoomInfo }["data"]

export type RoomUpdateInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly name?: {
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
  }["name"]
  readonly hostName?: {
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
  }["hostName"]
  readonly ai?: {
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
  }["ai"]
  readonly guestApprovals?: {
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
  }["guestApprovals"]
  readonly defaultRole?: {
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
  }["defaultRole"]
  readonly open?: {
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
  }["open"]
  readonly rules?: {
    readonly name?: string | undefined
    readonly hostName?: string | undefined
    readonly ai?: "linked" | "discovered" | undefined
    readonly guestApprovals?: boolean | undefined
    readonly defaultRole?: "viewer" | "member" | "helper" | "cohost" | undefined
    readonly open?: boolean | undefined
    readonly rules?:
      | {
          readonly hidePaths?: boolean | undefined
          readonly blockCommands?: ReadonlyArray<string> | undefined
          readonly protectedFiles?: ReadonlyArray<string> | undefined
          readonly noOutbound?: boolean | undefined
        }
      | undefined
  }["rules"]
}

export type RoomUpdateOutput = { data: RoomInfo }["data"]

export type RoomRemoveInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomRemoveOutput = void

export type RoomDodGetInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomDodGetOutput = RoomDod

export type RoomDodReleaseInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly id: { readonly id: string }["id"]
}

export type RoomDodReleaseOutput = RoomDod

export type RoomFeedInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly after?: { readonly after?: number | undefined; readonly wait?: number | undefined }["after"]
  readonly wait?: { readonly after?: number | undefined; readonly wait?: number | undefined }["wait"]
}

export type RoomFeedOutput = RoomFeed

export type RoomCodeInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomCodeOutput = RoomJoinCode

export type RoomPublicOutput = {
  host: string
  rooms: Array<{ id: string; name?: string; open: boolean }>
  mesh?: {
    clusterID: string
    status: "forming" | "active"
    name: string
    ownerURL: string
    isOwner: boolean
    memberCount: number
  } | null
}

export type RoomJoinInput = {
  readonly code?: {
    readonly code?: string | undefined
    readonly roomID?: string | undefined
    readonly name: string
    readonly device?: string | undefined
  }["code"]
  readonly roomID?: {
    readonly code?: string | undefined
    readonly roomID?: string | undefined
    readonly name: string
    readonly device?: string | undefined
  }["roomID"]
  readonly name: {
    readonly code?: string | undefined
    readonly roomID?: string | undefined
    readonly name: string
    readonly device?: string | undefined
  }["name"]
  readonly device?: {
    readonly code?: string | undefined
    readonly roomID?: string | undefined
    readonly name: string
    readonly device?: string | undefined
  }["device"]
}

export type RoomJoinOutput = RoomJoined

export type RoomGuestGetInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly sessionID?: { readonly sessionID?: string | undefined }["sessionID"]
}

export type RoomGuestGetOutput = {
  room: RoomInfo1
  guest: RoomGuest
  role: "viewer" | "member" | "helper" | "cohost" | "trusted"
  session: SessionInfo1
}

export type RoomGuestSessionMessagesInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly limit?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
    readonly type?:
      | "agent-switched"
      | "model-switched"
      | "location-switched"
      | "user"
      | "synthetic"
      | "system"
      | "skill"
      | "shell"
      | "assistant"
      | "compaction"
      | undefined
    readonly sessionID?: string | undefined
  }["limit"]
  readonly order?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
    readonly type?:
      | "agent-switched"
      | "model-switched"
      | "location-switched"
      | "user"
      | "synthetic"
      | "system"
      | "skill"
      | "shell"
      | "assistant"
      | "compaction"
      | undefined
    readonly sessionID?: string | undefined
  }["order"]
  readonly cursor?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
    readonly type?:
      | "agent-switched"
      | "model-switched"
      | "location-switched"
      | "user"
      | "synthetic"
      | "system"
      | "skill"
      | "shell"
      | "assistant"
      | "compaction"
      | undefined
    readonly sessionID?: string | undefined
  }["cursor"]
  readonly type?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
    readonly type?:
      | "agent-switched"
      | "model-switched"
      | "location-switched"
      | "user"
      | "synthetic"
      | "system"
      | "skill"
      | "shell"
      | "assistant"
      | "compaction"
      | undefined
    readonly sessionID?: string | undefined
  }["type"]
  readonly sessionID?: {
    readonly limit?: number | undefined
    readonly order?: "asc" | "desc" | undefined
    readonly cursor?: string | undefined
    readonly type?:
      | "agent-switched"
      | "model-switched"
      | "location-switched"
      | "user"
      | "synthetic"
      | "system"
      | "skill"
      | "shell"
      | "assistant"
      | "compaction"
      | undefined
    readonly sessionID?: string | undefined
  }["sessionID"]
}

export type RoomGuestSessionMessagesOutput = {
  data: Array<SessionMessageInfo>
  cursor: { previous?: string | null; next?: string | null }
}

export type RoomLinkListOutput = { data: Array<RoomLink> }["data"]

export type RoomLinkSaveInput = {
  readonly url: {
    readonly url: string
    readonly roomID: string
    readonly token: string
    readonly name: string
    readonly guest: string
  }["url"]
  readonly roomID: {
    readonly url: string
    readonly roomID: string
    readonly token: string
    readonly name: string
    readonly guest: string
  }["roomID"]
  readonly token: {
    readonly url: string
    readonly roomID: string
    readonly token: string
    readonly name: string
    readonly guest: string
  }["token"]
  readonly name: {
    readonly url: string
    readonly roomID: string
    readonly token: string
    readonly name: string
    readonly guest: string
  }["name"]
  readonly guest: {
    readonly url: string
    readonly roomID: string
    readonly token: string
    readonly name: string
    readonly guest: string
  }["guest"]
}

export type RoomLinkSaveOutput = void

export type RoomLinkRemoveInput = {
  readonly url: { readonly url: string; readonly roomID: string }["url"]
  readonly roomID: { readonly url: string; readonly roomID: string }["roomID"]
}

export type RoomLinkRemoveOutput = void

export type RoomGuestPassportInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomGuestPassportOutput = RoomPassport

export type RoomGuestRunInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly command: { readonly command: string; readonly sessionID?: string | undefined }["command"]
  readonly sessionID?: { readonly command: string; readonly sessionID?: string | undefined }["sessionID"]
}

export type RoomGuestRunOutput = RoomRunResult

export type RoomGuestDodGetInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomGuestDodGetOutput = RoomDod

export type RoomGuestDodClaimInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly id?: {
    readonly id?: string | undefined
    readonly next?: boolean | undefined
    readonly take: boolean
    readonly handover?: string | undefined
    readonly sessionID?: string | undefined
    readonly paths?: ReadonlyArray<string> | undefined
  }["id"]
  readonly next?: {
    readonly id?: string | undefined
    readonly next?: boolean | undefined
    readonly take: boolean
    readonly handover?: string | undefined
    readonly sessionID?: string | undefined
    readonly paths?: ReadonlyArray<string> | undefined
  }["next"]
  readonly take: {
    readonly id?: string | undefined
    readonly next?: boolean | undefined
    readonly take: boolean
    readonly handover?: string | undefined
    readonly sessionID?: string | undefined
    readonly paths?: ReadonlyArray<string> | undefined
  }["take"]
  readonly handover?: {
    readonly id?: string | undefined
    readonly next?: boolean | undefined
    readonly take: boolean
    readonly handover?: string | undefined
    readonly sessionID?: string | undefined
    readonly paths?: ReadonlyArray<string> | undefined
  }["handover"]
  readonly sessionID?: {
    readonly id?: string | undefined
    readonly next?: boolean | undefined
    readonly take: boolean
    readonly handover?: string | undefined
    readonly sessionID?: string | undefined
    readonly paths?: ReadonlyArray<string> | undefined
  }["sessionID"]
  readonly paths?: {
    readonly id?: string | undefined
    readonly next?: boolean | undefined
    readonly take: boolean
    readonly handover?: string | undefined
    readonly sessionID?: string | undefined
    readonly paths?: ReadonlyArray<string> | undefined
  }["paths"]
}

export type RoomGuestDodClaimOutput = RoomDod

export type RoomGuestDodSubmitInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly id: { readonly id: string; readonly handover?: string | undefined }["id"]
  readonly handover?: { readonly id: string; readonly handover?: string | undefined }["handover"]
}

export type RoomGuestDodSubmitOutput = RoomDod

export type RoomGuestFeedInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly after?: { readonly after?: number | undefined; readonly wait?: number | undefined }["after"]
  readonly wait?: { readonly after?: number | undefined; readonly wait?: number | undefined }["wait"]
}

export type RoomGuestFeedOutput = RoomFeed

export type RoomGuestLeaveInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomGuestLeaveOutput = void

export type RoomGuestSessionListInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomGuestSessionListOutput = { data: Array<SessionInfo1>; category?: { [x: string]: string } | null }

export type RoomGuestSessionCreateInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly title?: { readonly title?: string | undefined }["title"]
}

export type RoomGuestSessionCreateOutput = { data: SessionInfo1 }["data"]

export type RoomGuestModelListInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomGuestModelListOutput = { data: Array<ModelInfo> }["data"]

export type RoomGuestAgentListInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomGuestAgentListOutput = { data: Array<AgentInfo> }["data"]

export type RoomGuestMcpListInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomGuestMcpListOutput = {
  data: Array<{ name: string; status: "connected" | "pending" | "disabled" | "failed" | "needs_auth" }>
}["data"]

export type RoomGuestCommandListInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomGuestCommandListOutput = { data: Array<CommandInfo> }["data"]

export type RoomGuestSessionModelInput = {
  readonly roomID: { readonly roomID: string; readonly sessionID: string }["roomID"]
  readonly sessionID: { readonly roomID: string; readonly sessionID: string }["sessionID"]
  readonly model: {
    readonly model: { readonly id: string; readonly providerID: string; readonly variant?: string }
  }["model"]
}

export type RoomGuestSessionModelOutput = void

export type RoomGuestSessionAgentInput = {
  readonly roomID: { readonly roomID: string; readonly sessionID: string }["roomID"]
  readonly sessionID: { readonly roomID: string; readonly sessionID: string }["sessionID"]
  readonly agent: { readonly agent: string }["agent"]
}

export type RoomGuestSessionAgentOutput = void

export type RoomGuestSessionCommandInput = {
  readonly roomID: { readonly roomID: string; readonly sessionID: string }["roomID"]
  readonly sessionID: { readonly roomID: string; readonly sessionID: string }["sessionID"]
  readonly name: { readonly name: string; readonly text: string }["name"]
  readonly text: { readonly name: string; readonly text: string }["text"]
}

export type RoomGuestSessionCommandOutput = void

export type RoomMemberListInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomMemberListOutput = { data: Array<RoomMemberView> }["data"]

export type RoomMemberUpdateInput = {
  readonly roomID: { readonly roomID: string; readonly guestID: string }["roomID"]
  readonly guestID: { readonly roomID: string; readonly guestID: string }["guestID"]
  readonly role: { readonly role: "viewer" | "member" | "helper" | "cohost" | "trusted" }["role"]
}

export type RoomMemberUpdateOutput = { data: RoomMember }["data"]

export type RoomMemberRemoveInput = {
  readonly roomID: { readonly roomID: string; readonly guestID: string }["roomID"]
  readonly guestID: { readonly roomID: string; readonly guestID: string }["guestID"]
}

export type RoomMemberRemoveOutput = void

export type RoomMemberBanInput = {
  readonly roomID: { readonly roomID: string; readonly guestID: string }["roomID"]
  readonly guestID: { readonly roomID: string; readonly guestID: string }["guestID"]
}

export type RoomMemberBanOutput = { data: RoomBan }["data"]

export type RoomBanListInput = { readonly roomID: { readonly roomID: string }["roomID"] }

export type RoomBanListOutput = { data: Array<RoomBan> }["data"]

export type RoomBanRemoveInput = {
  readonly roomID: { readonly roomID: string; readonly banID: string }["roomID"]
  readonly banID: { readonly roomID: string; readonly banID: string }["banID"]
}

export type RoomBanRemoveOutput = void

export type RoomGuestLogInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly sessionID?: {
    readonly sessionID?: string | undefined
    readonly after?: number | undefined
    readonly follow?: boolean | undefined
  }["sessionID"]
  readonly after?: {
    readonly sessionID?: string | undefined
    readonly after?: number | undefined
    readonly follow?: boolean | undefined
  }["after"]
  readonly follow?: {
    readonly sessionID?: string | undefined
    readonly after?: number | undefined
    readonly follow?: boolean | undefined
  }["follow"]
}

export type RoomGuestLogOutput = RoomLogItem

export type RoomGuestMessagesInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly sessionID?: { readonly sessionID?: string | undefined }["sessionID"]
}

export type RoomGuestMessagesOutput = {
  data: Array<RoomMessage>
  running: boolean
  note?: { name: NoteSlug; title: string }
}

export type RoomGuestNoteInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly sessionID?: { readonly sessionID?: string | undefined }["sessionID"]
}

export type RoomGuestNoteOutput = { data: NoteInfo | null }["data"]

export type RoomGuestPromptInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly id?: {
    readonly id?: string | undefined
    readonly text: string
    readonly sessionID?: string | undefined
    readonly ai?: boolean | undefined
  }["id"]
  readonly text: {
    readonly id?: string | undefined
    readonly text: string
    readonly sessionID?: string | undefined
    readonly ai?: boolean | undefined
  }["text"]
  readonly sessionID?: {
    readonly id?: string | undefined
    readonly text: string
    readonly sessionID?: string | undefined
    readonly ai?: boolean | undefined
  }["sessionID"]
  readonly ai?: {
    readonly id?: string | undefined
    readonly text: string
    readonly sessionID?: string | undefined
    readonly ai?: boolean | undefined
  }["ai"]
}

export type RoomGuestPromptOutput = { data: SessionInboxUser }["data"]

export type RoomGuestPermissionListInput = {
  readonly roomID: { readonly roomID: string }["roomID"]
  readonly sessionID?: { readonly sessionID?: string | undefined }["sessionID"]
}

export type RoomGuestPermissionListOutput = { data: Array<PermissionRequest> }["data"]

export type RoomGuestPermissionReplyInput = {
  readonly roomID: { readonly roomID: string; readonly requestID: string }["roomID"]
  readonly requestID: { readonly roomID: string; readonly requestID: string }["requestID"]
  readonly decision: {
    readonly decision: "once" | "always" | "reject"
    readonly message?: string | undefined
    readonly sessionID?: string | undefined
  }["decision"]
  readonly message?: {
    readonly decision: "once" | "always" | "reject"
    readonly message?: string | undefined
    readonly sessionID?: string | undefined
  }["message"]
  readonly sessionID?: {
    readonly decision: "once" | "always" | "reject"
    readonly message?: string | undefined
    readonly sessionID?: string | undefined
  }["sessionID"]
}

export type RoomGuestPermissionReplyOutput = void

export type RoomMeshStatusOutput = RoomMeshSnapshot

export type RoomMeshInviteOutput = { token: string }

export type RoomMeshCreateInput = {
  readonly url: {
    readonly url: string
    readonly name?: string | undefined
    readonly directory?: string | undefined
  }["url"]
  readonly name?: {
    readonly url: string
    readonly name?: string | undefined
    readonly directory?: string | undefined
  }["name"]
  readonly directory?: {
    readonly url: string
    readonly name?: string | undefined
    readonly directory?: string | undefined
  }["directory"]
}

export type RoomMeshCreateOutput = { data: RoomMeshSnapshot; token: string }

export type RoomMeshJoinInput = {
  readonly seedURL: {
    readonly seedURL: string
    readonly token: string
    readonly url: string
    readonly name?: string | undefined
    readonly directory?: string | undefined
  }["seedURL"]
  readonly token: {
    readonly seedURL: string
    readonly token: string
    readonly url: string
    readonly name?: string | undefined
    readonly directory?: string | undefined
  }["token"]
  readonly url: {
    readonly seedURL: string
    readonly token: string
    readonly url: string
    readonly name?: string | undefined
    readonly directory?: string | undefined
  }["url"]
  readonly name?: {
    readonly seedURL: string
    readonly token: string
    readonly url: string
    readonly name?: string | undefined
    readonly directory?: string | undefined
  }["name"]
  readonly directory?: {
    readonly seedURL: string
    readonly token: string
    readonly url: string
    readonly name?: string | undefined
    readonly directory?: string | undefined
  }["directory"]
}

export type RoomMeshJoinOutput = RoomMeshSnapshot

export type RoomMeshLeaveOutput = RoomMeshSnapshot

export type RoomMeshActivateOutput = RoomMeshSnapshot

export type RoomMeshAppendInput = {
  readonly id?: {
    readonly id?: string | undefined
    readonly kind: "message" | "task"
    readonly payload: JsonValue
  }["id"]
  readonly kind: {
    readonly id?: string | undefined
    readonly kind: "message" | "task"
    readonly payload: JsonValue
  }["kind"]
  readonly payload: {
    readonly id?: string | undefined
    readonly kind: "message" | "task"
    readonly payload: JsonValue
  }["payload"]
}

export type RoomMeshAppendOutput = RoomMeshEntry

export type RoomMeshFeedInput = { readonly after?: { readonly after?: number | undefined }["after"] }

export type RoomMeshFeedOutput = RoomMeshFeed

export type RoomMeshRpcInput = {
  readonly payload:
    | {
        readonly type: "enroll"
        readonly node: {
          readonly id: string
          readonly url: string
          readonly name: string
          readonly joined: number
          readonly directory?: string | undefined
        }
      }
    | {
        readonly type: "add-learner"
        readonly clusterID: string
        readonly fromNodeID: string
        readonly node: {
          readonly id: string
          readonly url: string
          readonly name: string
          readonly joined: number
          readonly directory?: string | undefined
        }
      }
    | {
        readonly type: "remove-learner"
        readonly clusterID: string
        readonly fromNodeID: string
        readonly nodeID: string
      }
    | {
        readonly type: "prepare"
        readonly clusterID: string
        readonly fromNodeID: string
        readonly members: ReadonlyArray<{
          readonly id: string
          readonly url: string
          readonly name: string
          readonly joined: number
          readonly directory?: string | undefined
        }>
      }
    | {
        readonly type: "activate"
        readonly clusterID: string
        readonly fromNodeID: string
        readonly members: ReadonlyArray<{
          readonly id: string
          readonly url: string
          readonly name: string
          readonly joined: number
          readonly directory?: string | undefined
        }>
      }
    | {
        readonly type: "request-vote"
        readonly clusterID: string
        readonly fromNodeID: string
        readonly term: number
        readonly lastLogIndex: number
        readonly lastLogTerm: number
      }
    | {
        readonly type: "append-entries"
        readonly clusterID: string
        readonly fromNodeID: string
        readonly term: number
        readonly leaderID: string
        readonly prevLogIndex: number
        readonly prevLogTerm: number
        readonly entries: ReadonlyArray<{
          readonly id: string
          readonly index: number
          readonly term: number
          readonly kind: "message" | "task"
          readonly payload: JsonValue
          readonly originID: string
          readonly created: number
        }>
        readonly leaderCommit: number
      }
    | {
        readonly type: "propose"
        readonly clusterID: string
        readonly fromNodeID: string
        readonly entry: { readonly id: string; readonly kind: "message" | "task"; readonly payload: JsonValue }
      }
    | {
        readonly type: "run-ai"
        readonly clusterID: string
        readonly fromNodeID: string
        readonly targetNodeID: string
        readonly requestID: string
        readonly prompt: string
        readonly directory: string
        readonly agent?: string | undefined
        readonly providerID?: string | undefined
        readonly modelID?: string | undefined
      }
}

export type RoomMeshRpcOutput = RoomMeshRpcResponse

export type OrchestraProjectListOutput = Array<OrchestraProject>

export type OrchestraTemplateListOutput = Array<OrchestraTemplate>

export type OrchestraTemplateCreateInput = {
  readonly name: {
    readonly name: string
    readonly description: string
    readonly members: ReadonlyArray<{ readonly agent: string; readonly title: string; readonly category: string }>
    readonly playbook?: string | undefined
  }["name"]
  readonly description: {
    readonly name: string
    readonly description: string
    readonly members: ReadonlyArray<{ readonly agent: string; readonly title: string; readonly category: string }>
    readonly playbook?: string | undefined
  }["description"]
  readonly members: {
    readonly name: string
    readonly description: string
    readonly members: ReadonlyArray<{ readonly agent: string; readonly title: string; readonly category: string }>
    readonly playbook?: string | undefined
  }["members"]
  readonly playbook?: {
    readonly name: string
    readonly description: string
    readonly members: ReadonlyArray<{ readonly agent: string; readonly title: string; readonly category: string }>
    readonly playbook?: string | undefined
  }["playbook"]
}

export type OrchestraTemplateCreateOutput = OrchestraTemplate

export type OrchestraTemplateUpdateInput = {
  readonly templateID: { readonly templateID: string }["templateID"]
  readonly name: {
    readonly name: string
    readonly description: string
    readonly members: ReadonlyArray<{ readonly agent: string; readonly title: string; readonly category: string }>
    readonly playbook?: string | undefined
  }["name"]
  readonly description: {
    readonly name: string
    readonly description: string
    readonly members: ReadonlyArray<{ readonly agent: string; readonly title: string; readonly category: string }>
    readonly playbook?: string | undefined
  }["description"]
  readonly members: {
    readonly name: string
    readonly description: string
    readonly members: ReadonlyArray<{ readonly agent: string; readonly title: string; readonly category: string }>
    readonly playbook?: string | undefined
  }["members"]
  readonly playbook?: {
    readonly name: string
    readonly description: string
    readonly members: ReadonlyArray<{ readonly agent: string; readonly title: string; readonly category: string }>
    readonly playbook?: string | undefined
  }["playbook"]
}

export type OrchestraTemplateUpdateOutput = OrchestraTemplate

export type OrchestraTemplateRemoveInput = { readonly templateID: { readonly templateID: string }["templateID"] }

export type OrchestraTemplateRemoveOutput = void

export type OrchestraRoleListOutput = Array<OrchestraRole>

export type OrchestraRoleCreateInput = {
  readonly name: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["name"]
  readonly description: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["description"]
  readonly rules: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["rules"]
  readonly category: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["category"]
  readonly readOnly: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["readOnly"]
  readonly model?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["model"]
  readonly models?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["models"]
  readonly tools?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["tools"]
  readonly autoTools?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["autoTools"]
  readonly hub?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["hub"]
  readonly registry?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["registry"]
}

export type OrchestraRoleCreateOutput = OrchestraRole

export type OrchestraRoleUpdateInput = {
  readonly roleID: { readonly roleID: string }["roleID"]
  readonly name: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["name"]
  readonly description: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["description"]
  readonly rules: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["rules"]
  readonly category: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["category"]
  readonly readOnly: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["readOnly"]
  readonly model?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["model"]
  readonly models?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["models"]
  readonly tools?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["tools"]
  readonly autoTools?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["autoTools"]
  readonly hub?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["hub"]
  readonly registry?: {
    readonly name: string
    readonly description: string
    readonly rules: string
    readonly category: string
    readonly readOnly: boolean
    readonly model?: string | undefined
    readonly models?: ReadonlyArray<string> | undefined
    readonly tools?: ReadonlyArray<string> | undefined
    readonly autoTools?: boolean | undefined
    readonly hub?: ReadonlyArray<string> | undefined
    readonly registry?: ReadonlyArray<string> | undefined
  }["registry"]
}

export type OrchestraRoleUpdateOutput = OrchestraRole

export type OrchestraRoleRemoveInput = { readonly roleID: { readonly roleID: string }["roleID"] }

export type OrchestraRoleRemoveOutput = void

export type OrchestraProjectCreateInput = {
  readonly name: {
    readonly name: string
    readonly directory: string
    readonly template?: string | undefined
    readonly isolation?: ("environment" | "strict") | undefined
  }["name"]
  readonly directory: {
    readonly name: string
    readonly directory: string
    readonly template?: string | undefined
    readonly isolation?: ("environment" | "strict") | undefined
  }["directory"]
  readonly template?: {
    readonly name: string
    readonly directory: string
    readonly template?: string | undefined
    readonly isolation?: ("environment" | "strict") | undefined
  }["template"]
  readonly isolation?: {
    readonly name: string
    readonly directory: string
    readonly template?: string | undefined
    readonly isolation?: ("environment" | "strict") | undefined
  }["isolation"]
}

export type OrchestraProjectCreateOutput = OrchestraProject

export type OrchestraProjectUpdateInput = {
  readonly projectID: { readonly projectID: string }["projectID"]
  readonly name?: { readonly name?: string | undefined; readonly directory?: string | undefined }["name"]
  readonly directory?: { readonly name?: string | undefined; readonly directory?: string | undefined }["directory"]
}

export type OrchestraProjectUpdateOutput = OrchestraProject

export type OrchestraProjectRemoveInput = { readonly projectID: { readonly projectID: string }["projectID"] }

export type OrchestraProjectRemoveOutput = void

export type OrchestraProjectMainInput = { readonly projectID: { readonly projectID: string }["projectID"] }

export type OrchestraProjectMainOutput = SessionInfo1

export type OrchestraProjectSessionsInput = { readonly projectID: { readonly projectID: string }["projectID"] }

export type OrchestraProjectSessionsOutput = {
  data: Array<SessionInfo1>
  access: { [x: string]: OrchestraAccess }
  category: { [x: string]: string }
}

export type OrchestraOwnerListOutput = { [x: string]: string }

export type OrchestraOwnerSetInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly projectID: { readonly projectID: string }["projectID"]
}

export type OrchestraOwnerSetOutput = void

export type OrchestraAccessInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly access: { readonly access: "hidden" | "read" | "write" | "full" }["access"]
}

export type OrchestraAccessOutput = void

export type OrchestraCategoryInput = {
  readonly sessionID: { readonly sessionID: string }["sessionID"]
  readonly category: { readonly category: string }["category"]
}

export type OrchestraCategoryOutput = void

export type OrchestraGroupListOutput = Array<FederationGroup>

export type OrchestraGroupSaveInput = {
  readonly name: { readonly name: string; readonly projects: ReadonlyArray<string>; readonly supervisor?: string | undefined }["name"]
  readonly projects: { readonly name: string; readonly projects: ReadonlyArray<string>; readonly supervisor?: string | undefined }["projects"]
  readonly supervisor?: { readonly name: string; readonly projects: ReadonlyArray<string>; readonly supervisor?: string | undefined }["supervisor"]
}

export type OrchestraGroupSaveOutput = void

export type OrchestraGroupRemoveInput = { readonly name: { readonly name: string }["name"] }

export type OrchestraGroupRemoveOutput = void

export type OrchestraGroupLinkInput = { readonly name: { readonly name: string }["name"] }

export type OrchestraGroupLinkOutput = { pairs: number }

export type OrchestraLinkSetInput = {
  readonly a: { readonly a: string; readonly b: string; readonly linked: boolean }["a"]
  readonly b: { readonly a: string; readonly b: string; readonly linked: boolean }["b"]
  readonly linked: { readonly a: string; readonly b: string; readonly linked: boolean }["linked"]
}

export type OrchestraLinkSetOutput = void

export type OrchestraLinkListInput = { readonly projectID: { readonly projectID: string }["projectID"] }

export type OrchestraLinkListOutput = Array<{ id: string; name: string }>
