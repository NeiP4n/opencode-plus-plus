export * as OptimizePlugin from "./optimize.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { Effect } from "effect"
import { SessionSystemPrompt } from "../session/system-prompt.js"

import PROMPT_DEEPSEEK from "./system-prompt/deepseek.txt"
import PROMPT_GPT from "./system-prompt/gpt.txt"
import PROMPT_ASTRA from "./system-prompt/gpt-astra.txt"
import PROMPT_KIMI from "./system-prompt/kimi.txt"
import PROMPT_META from "./system-prompt/meta.txt"
import PROMPT_TRINITY from "./system-prompt/trinity.txt"
import PROMPT_ANTHROPIC from "./system-prompt/anthropic.txt"
import PROMPT_WORKSTYLE from "./system-prompt/workstyle.txt"

export const OpenAIPlugin = make("opencode.prompt.openai", (model) => {
  const id = model.id.toLowerCase()
  if (!id.includes("gpt")) return undefined
  return id.includes("astra") ? PROMPT_ASTRA : PROMPT_GPT
})

export const AnthropicPlugin = make(
  "opencode.prompt.anthropic",
  (model) => {
    const id = model.id.toLowerCase()
    if (!id.includes("claude")) return undefined
    return PROMPT_ANTHROPIC
  },
  "append",
)

// Both OpenAIToolsPlugin and AnthropicToolsPlugin are disabled intentionally until we can figure out a good ux for displaying
// heavy grep/glob usage done via shell or other mechanisms

export const OpenAIToolsPlugin = make("opencode.optimize.openai.tools", (model, tools) => {
  const ids = [model.id, model.modelID, model.family].join(" ").toLowerCase()
  if (!ids.includes("gpt")) return undefined
  delete tools.grep
  delete tools.glob
  return undefined
})

export const AnthropicToolsPlugin = make("opencode.optimize.anthropic.tools", (model, tools) => {
  const ids = [model.id, model.modelID, model.family].join(" ").toLowerCase()
  if (!ids.includes("claude")) return undefined
  delete tools.grep
  delete tools.glob
  return undefined
})

export const DeepSeekPlugin = make("opencode.prompt.deepseek", (model) => {
  const ids = [model.id, model.modelID, model.family].join(" ").toLowerCase()
  if (!ids.includes("deepseek")) return undefined
  return PROMPT_DEEPSEEK.replaceAll("{{MODEL_NAME}}", model.name)
})
export const KimiPlugin = make("opencode.prompt.kimi", (model) =>
  model.id.toLowerCase().includes("kimi") ? PROMPT_KIMI : undefined,
)
export const ArceePlugin = make("opencode.prompt.arcee", (model) =>
  model.id.toLowerCase().includes("trinity") ? PROMPT_TRINITY : undefined,
)
export const MetaPlugin = make("opencode.prompt.meta", (model) => {
  if (!model.id.toLowerCase().includes("muse")) return undefined
  return PROMPT_META.replaceAll("{{MODEL_NAME}}", model.name)
})

// Models without a tuned prompt took several times the steps of Claude on the same task: long
// shell chains instead of parallel reads, re-reading files, retrying a failed edit blind. This
// short block reaches them even under an agent's own system prompt, which replaces the family one.
export const WorkstylePlugin = define({
  id: "opencode.prompt.workstyle",
  effect: Effect.fn("OptimizePlugin.workstyle")(function* (ctx) {
    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => {
        const id = event.model.id.toLowerCase()
        if (id.includes("claude") || id.includes("gpt")) return
        event.system.push({ type: "text", text: PROMPT_WORKSTYLE })
      }),
    )
  }),
})

export const Plugins = [
  OpenAIPlugin,
  AnthropicPlugin,
  DeepSeekPlugin,
  KimiPlugin,
  ArceePlugin,
  MetaPlugin,
] as const

function make(
  id: string,
  optimize: (model: Model.Info, tools: SessionHooks["context"]["tools"]) => string | undefined,
  mode: "override" | "append" = "override",
) {
  return define({
    id,
    effect: Effect.fn(`OptimizePlugin.${id}`)(function* (ctx) {
      const hook = (event: SessionHooks["context"]) =>
        Effect.gen(function* () {
          const model =
            (yield* ctx.model.list()).data.find(
              (model) => model.providerID === event.model.providerID && model.id === event.model.id,
            ) ?? Model.Info.default(event.model.providerID, event.model.id)
          // Curate tools before rendering their guidance, including for agents with a custom system prompt.
          const template = optimize(model, event.tools)
          if (!template) return
          if ((yield* ctx.agent.get({ agentID: event.agent })).data.system) return
          const system = event.system[0]
          if (!system) return
          const rendered = SessionSystemPrompt.render(template, Object.keys(event.tools))
          const text = mode === "append" ? `${system.text}\n\n${rendered}` : rendered
          event.system[0] = { ...system, text }
        }).pipe(Effect.catch(() => Effect.void))
      yield* ctx.session.hook("context", hook)
      yield* ctx.session.hook("compaction", hook)
      yield* ctx.session.hook("generate", hook)
    }),
  })
}
