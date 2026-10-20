import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { contextUsage, formatContextUsage } from "../../util/session"
import { useTerminalDimensions } from "@opentui/solid"
import { stringWidth } from "../../util/string-width"
import { translate, useT } from "../../util/i18n"
import { hoverBackground } from "../../ui/hover"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

// The status call reaches Freebuff's API, so refresh slowly and let the local clock
// move the countdowns in between.
const FREEBUFF_RPC = "opencode.freebuff"
const FREEBUFF_REFRESH_MS = 20_000
const FREEBUFF_BAR_WIDTH = 10

// Mirrors the core contract in `@opencode/core/plugin/provider/freebuff-rpc`.
export interface FreebuffStatus {
  readonly loggedIn: boolean
  readonly balance?: number
  readonly spent?: number
  readonly limit?: number
  /** Milliseconds until the daily freebucks reset. */
  readonly resetIn?: number
  /** Milliseconds until the active session expires. */
  readonly sessionEndsIn?: number
  readonly tier?: string
}

// `label` is the muted wording, `value` the numbers it names. `critical` warns that the
// daily budget is nearly spent.
export type FreebuffSegment = {
  readonly text: string
  readonly tone: "label" | "value" | "bar" | "critical"
}

type Translate = (text: string, values?: Record<string, string | number>) => string

export function freebuffFooter(
  status: FreebuffStatus,
  now: number,
  fetchedAt: number,
  t: Translate = (text, values) => translate(undefined, text, values),
): FreebuffSegment[] | undefined {
  if (!status.loggedIn) return undefined
  const parts: FreebuffSegment[] = [{ text: "Freebuff", tone: "value" }]
  if (status.tier) parts.push({ text: ` ${status.tier}`, tone: "label" })
  if (status.balance !== undefined) {
    push(parts, [
      { text: String(status.balance), tone: "value" },
      { text: ` ${t("freebucks")}`, tone: "label" },
    ])
  }
  if (status.spent !== undefined && status.limit !== undefined && status.limit > 0) {
    const ratio = status.spent / status.limit
    const filled = Math.min(FREEBUFF_BAR_WIDTH, Math.max(0, Math.round(ratio * FREEBUFF_BAR_WIDTH)))
    push(parts, [
      { text: `${status.spent}/${status.limit}`, tone: "value" },
      {
        text: ` ${"█".repeat(filled)}${"░".repeat(FREEBUFF_BAR_WIDTH - filled)}`,
        tone: ratio >= 0.9 ? "critical" : "bar",
      },
    ])
  }
  const elapsed = Math.max(0, now - fetchedAt)
  if (status.resetIn !== undefined) {
    push(parts, [
      { text: t("reset in"), tone: "label" },
      { text: ` ${freebuffCountdown(status.resetIn - elapsed)}`, tone: "value" },
    ])
  }
  if (status.sessionEndsIn !== undefined) {
    push(parts, [
      { text: t("session ends in"), tone: "label" },
      { text: ` ${freebuffCountdown(status.sessionEndsIn - elapsed)}`, tone: "value" },
    ])
  }
  if (parts.length === 1) return undefined
  return parts
}

function push(parts: FreebuffSegment[], segments: FreebuffSegment[]) {
  segments.forEach((segment, index) => {
    parts.push({ text: (index === 0 ? " · " : "") + segment.text, tone: segment.tone })
  })
}

// Same format as the Freebuff plugin's dialog; the plugin is a separate module and does
// not export it, so the few lines are repeated here rather than crossing modules.
function freebuffCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1_000))
  const minutes = Math.floor(total / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const seconds = total % 60
  if (days >= 1) return `${days}d ${hours % 24}h`
  if (hours >= 1) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
  if (minutes >= 1) return `${minutes}m ${String(seconds).padStart(2, "0")}s`
  return `${seconds}s`
}

export function PromptFooter(props: {
  context: Plugin.Context
  sessionID?: string
  mode: "normal" | "shell"
  showDetails: boolean
}) {
  const dimensions = useTerminalDimensions()
  const t = useT()
  const [liveHovered, setLiveHovered] = createSignal(false)
  const subagents = createMemo(() => {
    if (!props.sessionID) return 0
    const count = props.context.data.session
      .family(props.sessionID)
      .filter((id) => id !== props.sessionID && props.context.data.session.status(id) === "running").length
    return count ? `${count} subagent${count === 1 ? "" : "s"}` : undefined
  })
  const shells = createMemo(() => {
    if (!props.sessionID) return 0
    const count = props.context.data.shell
      .list(props.context.location)
      .filter((shell) => shell.metadata.sessionID === props.sessionID).length
    return count ? `${count} shell${count === 1 ? "" : "s"}` : undefined
  })
  const status = createMemo(() => {
    if (!props.sessionID) return []
    const session = props.context.data.session.get(props.sessionID)
    if (!session) return []
    const usage = contextUsage(
      props.context.data.session.message.list(props.sessionID),
      props.context.data.location.model.list(session.location),
      session.revert?.messageID,
    )
    const cost = props.context.data.session.cost(props.sessionID)
    return [
      usage ? formatContextUsage(usage.tokens, usage.percent) : undefined,
      cost > 0 ? money.format(cost) : undefined,
    ].filter((item): item is string => Boolean(item))
  })
  const live = createMemo(() => Boolean(subagents() || shells()))
  const shortcut = (id: string) => props.context.keymap.shortcuts(id)[0]
  const layout = createMemo(() => {
    const command = shortcut("command.palette.show")
    if (status().length === 0) return { usage: false, shortcuts: dimensions().width >= 44 }
    return promptFooterLayout({
      width: Math.max(0, dimensions().width - 8),
      usage: status(),
      shortcuts: command ? [`${command} commands`] : [],
    })
  })
  // The strip follows the composer's selected model, so it appears as soon as a Freebuff
  // model is picked, before the first message and on the home screen, and also for a
  // session already committed to one.
  const [now, setNow] = createSignal(Date.now())
  const [freebuff, setFreebuff] = createSignal<{ readonly status: FreebuffStatus; readonly fetchedAt: number }>()
  const freebuffModel = createMemo(() => {
    const selected = props.context.ui.model.current()
    if (selected?.providerID === "freebuff") return selected
    if (!props.sessionID) return
    const committed = props.context.data.session.get(props.sessionID)?.model
    if (committed?.providerID === "freebuff") return { providerID: committed.providerID, modelID: committed.id }
  })
  const freebuffActive = createMemo(() => props.mode === "normal" && freebuffModel() !== undefined)
  createEffect(() => {
    if (!freebuffActive()) {
      setFreebuff(undefined)
      return
    }
    let cancelled = false
    const load = () => {
      props.context.client.rpc
        .call({ rpcID: FREEBUFF_RPC, method: "status", input: {} })
        .then((result) => {
          if (cancelled) return
          const output = result.output as FreebuffStatus | undefined
          if (output) setFreebuff({ status: output, fetchedAt: Date.now() })
        })
        .catch(() => undefined)
    }
    setNow(Date.now())
    load()
    const refresh = setInterval(load, FREEBUFF_REFRESH_MS)
    const tick = setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => {
      cancelled = true
      clearInterval(refresh)
      clearInterval(tick)
    })
  })
  const freebuffStrip = createMemo(() => {
    const snapshot = freebuff()
    if (!snapshot) return undefined
    return freebuffFooter(snapshot.status, now(), snapshot.fetchedAt, t)
  })
  // The catalog name is the provider's display name, e.g. "DeepSeek V4.1 Flash 10/17".
  const freebuffName = createMemo(() => {
    const model = freebuffModel()
    if (!model) return
    const location = props.sessionID ? props.context.data.session.get(props.sessionID)?.location : undefined
    return props.context.data.location.model
      .list(location)
      ?.find((item) => item.providerID === model.providerID && item.id === model.modelID)?.name
  })
  const freebuffColor = (segment: FreebuffSegment) => {
    if (segment.tone === "critical") return props.context.theme.text.feedback.warning.base
    if (segment.tone === "value") return props.context.theme.text.base
    return props.context.theme.text.muted
  }

  return (
    <Switch>
      <Match when={props.mode === "normal"}>
        <Switch>
          <Match when={live() || status().length > 0}>
            <box flexDirection="row" flexShrink={props.showDetails && layout().usage ? 0 : 1} minWidth={0}>
              <Show when={live()}>
                <box
                  id="prompt.footer.live"
                  flexShrink={0}
                  backgroundColor={liveHovered() ? hoverBackground(props.context.theme) : undefined}
                  onMouseOver={(event) => {
                    event.stopPropagation()
                    setLiveHovered(true)
                  }}
                  onMouseOut={(event) => {
                    event.stopPropagation()
                    setLiveHovered(false)
                  }}
                  onMouseUp={(event) => {
                    event.stopPropagation()
                    props.context.keymap.dispatch("session.child.first")
                  }}
                >
                  <text
                    fg={liveHovered() ? props.context.theme.text.base : props.context.theme.text.muted}
                    wrapMode="none"
                  >
                    <Show when={shortcut("session.child.first")}>
                      {(value) => <span style={{ fg: props.context.theme.text.base }}>{value()} </span>}
                    </Show>
                    <Show when={subagents()}>{(value) => <>{value()}</>}</Show>
                    <Show when={subagents() && shells()}> · </Show>
                    <Show when={shells()}>{(value) => <>{value()}</>}</Show>
                  </text>
                </box>
              </Show>
              <Show when={props.showDetails && layout().usage && status().length > 0}>
                <text fg={props.context.theme.text.muted} wrapMode="none" flexShrink={0}>
                  <Show when={live()}> · </Show>
                  {status().join(" · ")}
                </text>
              </Show>
            </box>
          </Match>
          <Match when={props.showDetails && layout().shortcuts}>
            <text fg={props.context.theme.text.base} flexShrink={0}>
              {shortcut("agent.cycle")} <span style={{ fg: props.context.theme.text.muted }}>{t("agents")}</span>
            </text>
          </Match>
        </Switch>
        <Show when={props.showDetails && layout().shortcuts}>
          <text fg={props.context.theme.text.base} wrapMode="none" flexShrink={0}>
            {shortcut("command.palette.show")} <span style={{ fg: props.context.theme.text.muted }}>{t("commands")}</span>
          </text>
        </Show>
        <Show when={freebuffStrip()}>
          {/* width 100% makes the strip land on its own wrapped line in the footer row. */}
          <box id="prompt.footer.freebuff" width="100%" flexDirection="row" flexShrink={1} minWidth={0}>
            <text wrapMode="none">
              <Show when={freebuffName()}>
                {(name) => <span style={{ fg: props.context.theme.text.muted }}>{name()} · </span>}
              </Show>
              <For each={freebuffStrip() ?? []}>
                {(segment) => <span style={{ fg: freebuffColor(segment) }}>{segment.text}</span>}
              </For>
            </text>
          </box>
        </Show>
      </Match>
      <Match when={props.mode === "shell"}>
        <text fg={props.context.theme.text.base} flexShrink={0}>
          esc{" "}
          <span style={{ fg: props.context.theme.text.muted }}>
            {dimensions().width < 44 ? "shell" : "exit shell mode"}
          </span>
        </text>
      </Match>
    </Switch>
  )
}

export default Plugin.define({
  id: "opencode.prompt.footer",
  setup(context) {
    context.ui.slot({
      append: "prompt.footer",
      render: (props) => (
        <PromptFooter context={context} sessionID={props.sessionID} mode={props.mode} showDetails={props.showDetails} />
      ),
    })
  },
})

function promptFooterLayout(input: { width: number; usage: string[]; shortcuts: string[] }) {
  const usage = input.usage.join(" · ")
  const shortcuts = input.shortcuts.join(" · ")
  const available = Math.max(0, input.width - Math.min(28, Math.floor(input.width / 2)))
  if (usage && shortcuts && stringWidth(`${usage} · ${shortcuts}`) <= available) {
    return { usage: true, shortcuts: true }
  }
  if (usage && stringWidth(usage) <= available) return { usage: true, shortcuts: false }
  if (!usage && shortcuts && stringWidth(shortcuts) <= available) return { usage: false, shortcuts: true }
  return { usage: false, shortcuts: false }
}
