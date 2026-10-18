import type { LLM } from "@opencode/ai"
import type { ToolDefinition } from "@opencode/ai"

export type CompatibilityInput = {
  readonly providerID: string
  readonly tools?: ReadonlyArray<ToolDefinition>
  readonly toolChoice?: LLM.RequestInput["toolChoice"]
  readonly stateless?: boolean
}

export type CompatibilityOutput = {
  readonly tools: ReadonlyArray<ToolDefinition>
  readonly toolChoice: LLM.RequestInput["toolChoice"] | undefined
}

const ZEN_REQUIRED_TOOLS = [
  ["read", "Read a file.", { type: "object", properties: { path: { type: "string" } }, required: ["path"] }],
  ["bash", "Run a shell command.", { type: "object", properties: { command: { type: "string" } }, required: ["command"] }],
  ["edit", "Edit a file.", { type: "object", properties: { path: { type: "string" }, oldString: { type: "string" }, newString: { type: "string" } }, required: ["path", "oldString", "newString"] }],
  ["glob", "Find files by pattern.", { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] }],
  ["grep", "Search file contents.", { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] }],
] as const

/**
 * Applies only transport-level compatibility required by a provider. Compatibility schemas do not
 * grant execution permission: the caller's real Tool.Snapshot remains the sole executor.
 */
export function prepare(input: CompatibilityInput): CompatibilityOutput {
  const existing = input.tools ?? []
  if (input.providerID !== "opencode") return { tools: existing, toolChoice: input.toolChoice }

  const names = new Set(existing.map((tool) => tool.name))
  const tools = [...existing]
  for (const [name, description, inputSchema] of ZEN_REQUIRED_TOOLS) {
    if (names.has(name)) continue
    tools.push({ name, description, inputSchema })
  }

  return {
    tools,
    // A stateless generation never has a local executor, so compatibility schemas are advertised
    // without allowing the model to call them. Normal session requests preserve the real toolChoice.
    toolChoice: input.stateless ? "none" : input.toolChoice,
  }
}

export const zenRequiredToolNames = ZEN_REQUIRED_TOOLS.map(([name]) => name)
