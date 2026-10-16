export * as ClaudeSettings from "./settings.js"

/**
 * Claude `settings.json` files: permission rules, extra directories, default mode and model. Rules that only
 * tighten (`deny`, `ask`) always apply; rules that loosen apply from a project only when it is trusted.
 */

import path from "path"
import { Schema } from "effect"
import type { Permission } from "@opencode/schema/permission"
import { CompatTools } from "../tools.js"
import { ClaudeModel } from "./model.js"
import { ClaudeContext } from "./context.js"
import { ClaudeHookConfig } from "./hooks/config.js"

export const FILES = ["settings.json", "settings.local.json"] as const

export interface Result {
  /** Ordered so that, with OpenCode's last-match-wins evaluation, `deny` beats `ask` beats `allow`. */
  readonly permissions: readonly Permission.Rule[]
  readonly model?: string
  readonly defaultAgent?: string
  readonly mcpServers?: unknown
  readonly disabledMcpServers: readonly string[]
  readonly hooks: readonly ClaudeHookConfig.Hook[]
  /** `disableAllHooks`: turns off every Claude hook, from any level. */
  readonly disableHooks: boolean
  readonly skipped: readonly ClaudeContext.Skipped[]
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

export function parse(text: string, source: string, context: ClaudeContext.Context): Result {
  const skipped: ClaudeContext.Skipped[] = []
  const parsed = decodeJson(text)
  if (parsed._tag === "None")
    return {
      permissions: [],
      disabledMcpServers: [],
      hooks: [],
      disableHooks: false,
      skipped: [{ source, reason: "settings file is not valid JSON" }],
    }
  const data = parsed.value
  if (!isRecord(data))
    return {
      permissions: [],
      disabledMcpServers: [],
      hooks: [],
      disableHooks: false,
      skipped: [{ source, reason: "settings file is not an object" }],
    }
  const loosen = ClaudeContext.allowed(context)
  const permissions = isRecord(data.permissions) ? data.permissions : {}
  const ruleContext = { directory: context.directory, settings: path.dirname(context.root), home: context.home }
  const rules = (key: "allow" | "ask" | "deny", effect: Permission.Effect) =>
    strings(permissions[key]).flatMap((rule) => {
      const parsed = CompatTools.parseRule("claude", rule, effect, ruleContext)
      if (parsed.type === "rules") return parsed.rules
      skipped.push({ source, reason: parsed.reason })
      return []
    })

  const allow: Permission.Rule[] = []
  if (loosen) {
    allow.push(...rules("allow", "allow"))
    for (const directory of strings(permissions.additionalDirectories)) {
      const absolute = path.resolve(path.dirname(context.root), directory.replace(/^~(?=$|[\/])/, context.home))
      allow.push({ action: "external_directory", resource: `${absolute.replaceAll("\\", "/")}/*`, effect: "allow" })
    }
  } else if (strings(permissions.allow).length || strings(permissions.additionalDirectories).length) {
    skipped.push({ source, reason: `allow rules ${ClaudeContext.TRUST_HINT}` })
  }

  let defaultAgent: string | undefined
  switch (permissions.defaultMode) {
    case "acceptEdits":
      if (loosen) allow.push({ action: "edit", resource: "*", effect: "allow" })
      else skipped.push({ source, reason: `defaultMode acceptEdits ${ClaudeContext.TRUST_HINT}` })
      break
    case "plan":
      defaultAgent = "plan"
      break
    case "bypassPermissions":
      skipped.push({ source, reason: "defaultMode bypassPermissions is never carried over" })
      break
  }

  const model = ClaudeModel.resolve(data.model)
  if (model.type === "unsupported") skipped.push({ source, reason: model.reason })
  if (isRecord(data.env) && Object.keys(data.env).length)
    skipped.push({ source, reason: "env has no OpenCode equivalent yet" })
  const hooks = ClaudeHookConfig.parse(data.hooks, source, context)
  skipped.push(...hooks.skipped)

  return {
    permissions: [...allow, ...rules("ask", "ask"), ...rules("deny", "deny")],
    ...(model.type === "model" ? { model: model.model } : {}),
    ...(defaultAgent ? { defaultAgent } : {}),
    ...(data.mcpServers !== undefined ? { mcpServers: data.mcpServers } : {}),
    disabledMcpServers: strings(data.disabledMcpjsonServers),
    hooks: hooks.hooks,
    disableHooks: data.disableAllHooks === true,
    skipped,
  }
}
