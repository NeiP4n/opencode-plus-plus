import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { stringWidth } from "../../util/string-width"

export function PromptMetadataRow(props: {
  mode: "normal" | "shell"
  agent?: string
  auto: boolean
  model: string
  provider: string
  variant?: string
  workMode?: string
  onModeClick?: () => void
  muted: boolean
  highlight: RGBA
  agentAlpha: number
  modelAlpha: number
  variantAlpha: number
}) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => {
    if (props.mode === "shell") return { agent: props.agent ?? "Shell", model: "" }
    return promptMetadataLayout({
      width: Math.max(0, dimensions().width - (dimensions().width < 44 ? 9 : 13)),
      terminalWidth: dimensions().width,
      agent: props.agent ?? "",
      auto: props.auto,
      model: props.model,
      provider: props.provider,
      variant: props.variant,
      workMode: props.workMode,
    })
  })

  return (
    <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
      <Show
        when={(props.mode === "shell" || props.agent) && (layout().agent || layout().model)}
        fallback={<box height={1} />}
      >
        <Show when={layout().agent}>
          {(agent) => (
            <text flexShrink={0} wrapMode="none" fg={fade(props.highlight, props.agentAlpha)}>
              {agent()}
            </text>
          )}
        </Show>
        <Show when={props.mode === "normal" && layout().auto}>
          <text flexShrink={0} wrapMode="none" fg={fade(theme.text.muted, props.agentAlpha)}>
            auto
          </text>
        </Show>
        <Show when={props.mode === "normal" && layout().workMode}>
          {(workMode) => (
            <box
              flexShrink={0}
              onMouseDown={(event: { stopPropagation(): void }) => {
                event.stopPropagation()
                props.onModeClick?.()
              }}
            >
              <text flexShrink={0} wrapMode="none" fg={fade(theme.text.feedback.warning.base, props.agentAlpha)}>
                {workMode()}
              </text>
            </box>
          )}
        </Show>
        <Show when={props.mode === "normal" && layout().model}>
          <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
            <Show when={layout().agent || layout().workMode}>
              <text flexShrink={0} wrapMode="none" fg={fade(theme.text.muted, props.modelAlpha)}>
                ·
              </text>
            </Show>
            <text
              flexShrink={1}
              minWidth={0}
              wrapMode="none"
              truncate
              fg={fade(props.muted ? theme.text.muted : theme.text.base, props.modelAlpha)}
            >
              {layout().model}
            </text>
            <Show when={layout().provider}>
              {(provider) => (
                <text flexShrink={1} minWidth={0} wrapMode="none" truncate fg={fade(theme.text.muted, props.modelAlpha)}>
                  {provider()}
                </text>
              )}
            </Show>
            <Show when={layout().variant}>
              {(variant) => (
                <>
                  <text flexShrink={0} wrapMode="none" fg={fade(theme.text.muted, props.variantAlpha)}>
                    ·
                  </text>
                  <text
                    flexShrink={0}
                    wrapMode="none"
                    fg={fade(theme.text.feedback.warning.base, props.variantAlpha)}
                    attributes={TextAttributes.BOLD}
                  >
                    {variant()}
                  </text>
                </>
              )}
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}

function fade(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

type Layout = {
  agent?: string
  auto?: boolean
  model: string
  provider?: string
  variant?: string
  workMode?: string
}

function promptMetadataLayout(input: {
  width: number
  terminalWidth: number
  agent: string
  auto?: boolean
  model: string
  provider: string
  variant?: string
  workMode?: string
}) {
  const agent = input.terminalWidth < 44 ? undefined : input.agent
  const provider = input.terminalWidth < 44 ? "" : input.provider
  const workMode = input.terminalWidth < 44 ? undefined : input.workMode
  const candidates: Layout[] = [
    { agent, auto: input.auto, model: input.model, provider, variant: input.variant, workMode },
    { agent, model: input.model, provider, variant: input.variant, workMode },
    {
      agent,
      model: input.model,
      provider: provider.split(" / ").at(-1) ?? provider,
      variant: input.variant,
      workMode,
    },
    { agent, model: input.model, variant: input.variant, workMode },
  ]
  const fit = candidates.find((candidate) => stringWidth(text(candidate)) <= input.width)
  if (fit) return fit

  const prefix = agent ? `${agent} · ` : ""
  const suffix = input.variant ? ` · ${input.variant}` : ""
  return {
    agent,
    model: Locale.truncateWidth(
      input.model,
      Math.max(9, input.width - stringWidth(prefix) - stringWidth(suffix)),
    ).replace(/\s+…$/, "…"),
    variant: input.variant,
  }
}

function text(input: Layout) {
  return [
    ...(input.agent ? [input.agent] : []),
    ...(input.auto ? ["auto"] : []),
    ...(input.workMode ? [input.workMode] : []),
    ...(input.model ? [...(input.agent || input.workMode ? ["·"] : []), input.model] : []),
    ...(input.provider ? [input.provider] : []),
    ...(input.variant ? ["·", input.variant] : []),
  ].join(" ")
}
