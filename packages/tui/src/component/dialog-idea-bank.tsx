import { TextAttributes } from "@opentui/core"
import { createMemo, For, onCleanup, Show } from "solid-js"
import { useData } from "../context/data"
import { useEvent } from "../context/event"
import { useStorage } from "../context/storage"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useTerminalDimensions } from "@opentui/solid"
import { useT } from "../util/i18n"
import { HoverAction } from "./hover-action"

type SignalKind = {
  id: string
  title: string
  category: string
  kind: string
  description: string
  pattern: RegExp
}

export type IdeaSignal = {
  id: string
  title: string
  category: string
  kind: string
  description: string
  signalCount: number
  createdAt: number
  updatedAt: number
}

type IdeaBankState = {
  autoCapture: boolean
  autoCaptureSince: number
  processedMessageIDs: string[]
  ideas: IdeaSignal[]
}

const STORE_KEY = "idea-bank"
const INITIAL: IdeaBankState = {
  autoCapture: false,
  autoCaptureSince: 0,
  processedMessageIDs: [],
  ideas: [],
}

// Keep these intentionally broad. The first release recognizes problem patterns without
// retaining the sentence that matched or asking a language model to interpret it.
const SIGNAL_KINDS: SignalKind[] = [
  {
    id: "manual-work",
    title: "Automate repetitive work",
    category: "Automation",
    kind: "Utility or workflow",
    description: "Repeated manual work may point to an opportunity for a small automation.",
    pattern:
      /(?:\b(?:manually|by hand|every time|over and over|repetitive|tedious|keep having to)\b|вручную|каждый раз приходится|постоянно приходится|повторяющ(?:аяся|иеся|ихся)|одно и то же)/iu,
  },
  {
    id: "missing-tool",
    title: "Fill a missing tool or capability",
    category: "Developer tools",
    kind: "Tool or integration",
    description: "A missing capability may be worth exploring before proposing a solution.",
    pattern:
      /(?:\b(?:wish there were|why is there no|missing feature|need a tool|no good tool|would be useful if)\b|не хватает|почему нет|нет нормальн.{0,24}(?:инструмент|программ|способ)|хотелось бы)/iu,
  },
  {
    id: "workflow-friction",
    title: "Simplify a frustrating workflow",
    category: "Productivity",
    kind: "Workflow improvement",
    description: "Repeated friction may indicate that existing tools or steps could be simplified.",
    pattern:
      /(?:\b(?:doesn't work|does not work|tried.{0,60}but|annoying|frustrating|painful workflow)\b|не работает|неудобн|перепробовал|надоело|бесит|слишком сложно)/iu,
  },
  {
    id: "documentation",
    title: "Make instructions easier to find",
    category: "Education and documentation",
    kind: "Knowledge tool",
    description: "Difficulty finding or understanding documentation may be an opportunity to improve access to knowledge.",
    pattern:
      /(?:\b(?:no documentation|can't find.{0,30}docs|documentation is unclear|docs are confusing)\b|нет документац|не могу найти инструкц|документац.{0,30}(?:непонят|плох))/iu,
  },
  {
    id: "integration",
    title: "Connect tools that do not work well together",
    category: "Integrations",
    kind: "Integration",
    description: "Repeated problems moving information between tools may point to a missing integration.",
    pattern:
      /(?:\b(?:can't sync|doesn't sync|no integration|moving data between|integrate.{0,40}with)\b|не синхронизир|переносить данные между|интеграци)/iu,
  },
]

// Never persist or transmit message text. Also skip high-risk text before classifying it,
// so even signal processing avoids messages that look like secrets or personal data.
const SENSITIVE = [
  /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/u,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/iu,
  /\b(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|authorization|bearer)\s*[:=]/iu,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u,
  /https?:\/\/\S+/iu,
  /(?:[A-Z]:\\Users\\|\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/)/iu,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
]

function looksSensitive(text: string) {
  return SENSITIVE.some((pattern) => pattern.test(text))
}

function createdMillis(value: unknown) {
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  return Date.parse(String(value))
}

function classify(text: string) {
  if (text.length < 18 || text.length > 5000 || looksSensitive(text)) return undefined
  return SIGNAL_KINDS.find((item) => item.pattern.test(text))
}

export function DialogIdeaBank() {
  const theme = useTheme().surface("dialog")
  const t = useT()
  const dialog = useDialog()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const [state, update] = useStorage().store<IdeaBankState>(STORE_KEY, { initial: INITIAL, key: "id" })
  const ideas = createMemo(() => [...state.ideas].sort((a, b) => b.signalCount - a.signalCount || b.updatedAt - a.updatedAt))
  const totalSignals = createMemo(() => state.ideas.reduce((sum, item) => sum + item.signalCount, 0))
  const bodyHeight = () => Math.max(5, Math.min(18, dimensions().height - 12))

  const toggleCapture = () => {
    const enabled = !state.autoCapture
    void update((draft) => {
      draft.autoCapture = enabled
      // Consent applies only to future messages. Enabling the feature never scans old chats.
      if (enabled) draft.autoCaptureSince = Date.now()
    }).catch((error) => {
      toast.show({ variant: "error", message: `Idea Bank: ${String(error)}` })
    })
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          {t("Idea Bank")}
        </text>
        <HoverAction id="idea-bank.close" onClick={() => dialog.clear()} paddingLeft={1} paddingRight={1}>
          <text fg={theme.text.muted}>esc</text>
        </HoverAction>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={state.autoCapture ? theme.text.feedback.success.base : theme.text.muted}>
          {state.autoCapture ? "●" : "○"}
        </text>
        <text fg={theme.text.base}>
          {state.autoCapture ? t("Automatic local capture is on") : t("Automatic local capture is off")}
        </text>
        <box flexGrow={1} />
        <HoverAction id="idea-bank.toggle-capture" onClick={toggleCapture} paddingLeft={1} paddingRight={1}>
          <text fg={theme.text.action.primary.base}>
            {state.autoCapture ? t("Pause") : t("Enable")}
          </text>
        </HoverAction>
      </box>
      <text fg={theme.text.muted} wrapMode="word">
        {t("Local-only MVP: no LLM/API calls. Only broad problem categories are saved; original chat text is never stored or sent. Enabling applies to future messages only.")}
      </text>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text.muted}>{t("Potential directions")}: {ideas().length}</text>
        <text fg={theme.text.muted}>{t("Local signals")}: {totalSignals()}</text>
      </box>
      <box height={1} border={["bottom"]} borderColor={theme.border.base} />
      <Show
        when={ideas().length > 0}
        fallback={
          <box paddingTop={1} paddingBottom={1} gap={1}>
            <text fg={theme.text.base} attributes={TextAttributes.BOLD}>{t("No signals yet")}</text>
            <text fg={theme.text.muted} wrapMode="word">
              {t("Enable automatic local capture. After a session becomes idle, simple rules look for broad patterns such as repetitive work or missing tools. No model is run and no source sentence is kept.")}
            </text>
          </box>
        }
      >
        <scrollbox height={bodyHeight()} flexGrow={1} minHeight={0}>
          <For each={ideas()}>
            {(idea) => (
              <box paddingTop={1} paddingBottom={1} gap={1}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text.action.primary.base}>✦</text>
                  <box flexGrow={1} minWidth={0}>
                    <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="word">
                      {t(idea.title)}
                    </text>
                  </box>
                  <text fg={theme.text.muted} wrapMode="none">{idea.signalCount}×</text>
                </box>
                <text fg={theme.text.muted} wrapMode="word">{t(idea.description)}</text>
                <text fg={theme.text.muted} wrapMode="word">
                  {t(idea.category)} · {t(idea.kind)}
                </text>
                <box height={1} border={["bottom"]} borderColor={theme.border.subtle} />
              </box>
            )}
          </For>
        </scrollbox>
      </Show>
      <text fg={theme.text.muted} wrapMode="word">
        {t("This first version keeps ideas on this computer. Shared publishing and deep research are not connected yet.")}
      </text>
    </box>
  )
}

/**
 * Lightweight background collector. It runs only after explicit opt-in and only when a
 * session reaches idle. Source text exists in memory briefly for rule matching, but is
 * never written to storage, logged, sent to a model, or sent over the network by this feature.
 */
export function IdeaBankCapture() {
  const data = useData()
  const events = useEvent()
  const [state, update] = useStorage().store<IdeaBankState>(STORE_KEY, { initial: INITIAL, key: "id" })
  const busy = new Set<string>()

  const capture = async (sessionID: string) => {
    if (!state.autoCapture || busy.has(sessionID)) return
    busy.add(sessionID)
    try {
      // Read only the transcript already cached by the TUI. This feature performs no HTTP
      // requests and never asks a model to inspect the conversation.
      const messages = data.session.message.list(sessionID)
      if (!state.autoCapture) return
      const since = state.autoCaptureSince
      const candidates = messages.toReversed().flatMap((message) => {
        if (message.type !== "user" || state.processedMessageIDs.includes(message.id)) return []
        const created = createdMillis(message.time.created)
        if (!Number.isFinite(created) || created < since) return []
        return [{ id: message.id, signal: classify(message.text) }]
      })
      if (candidates.length === 0) return

      await update((draft) => {
        const processed = new Set(draft.processedMessageIDs)
        for (const candidate of candidates) {
          if (processed.has(candidate.id)) continue
          processed.add(candidate.id)
          if (!candidate.signal) continue

          const now = Date.now()
          const existing = draft.ideas.find((idea) => idea.id === candidate.signal!.id)
          if (existing) {
            existing.signalCount += 1
            existing.updatedAt = now
          } else {
            draft.ideas.push({
              id: candidate.signal.id,
              title: candidate.signal.title,
              category: candidate.signal.category,
              kind: candidate.signal.kind,
              description: candidate.signal.description,
              signalCount: 1,
              createdAt: now,
              updatedAt: now,
            })
          }
        }
        draft.processedMessageIDs = [...processed].slice(-3000)
      })
    } catch {
      // Do not log message text or prompt-derived data from background collection.
    } finally {
      busy.delete(sessionID)
    }
  }

  const unsubscribe = events.on("session.idle", (event) => {
    void capture(event.data.sessionID)
  })
  onCleanup(unsubscribe)
  return null
}
