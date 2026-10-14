import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useData } from "../context/data"
import { useEvent } from "../context/event"
import { useStorage } from "../context/storage"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useTerminalDimensions } from "@opentui/solid"
import { useT } from "../util/i18n"
import { HoverAction } from "./hover-action"
import { classifyIdeaSignal } from "../util/idea-bank-rules"

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
  lastProcessedBySession: Record<string, { messageID: string; createdAt: number }>
  ideas: IdeaSignal[]
}

const STORE_KEY = "idea-bank"
const INITIAL: IdeaBankState = {
  autoCapture: false,
  autoCaptureSince: 0,
  lastProcessedBySession: {},
  ideas: [],
}

function createdMillis(value: unknown) {
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  return Date.parse(String(value))
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
  const [clearArmed, setClearArmed] = createSignal(false)
  const bodyHeight = () => Math.max(5, Math.min(18, dimensions().height - 12))

  const clearLocalData = async () => {
    if (!clearArmed()) {
      setClearArmed(true)
      return
    }
    try {
      await update((draft) => {
        draft.autoCapture = false
        draft.autoCaptureSince = 0
        draft.lastProcessedBySession = {}
        draft.ideas = []
      })
      setClearArmed(false)
      toast.show({ variant: "success", message: t("Local Idea Bank data cleared") })
    } catch {
      setClearArmed(false)
      toast.show({ variant: "error", message: t("Could not clear local Idea Bank data") })
    }
  }

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
        <HoverAction id="idea-bank.clear" onClick={() => void clearLocalData()} paddingLeft={1} paddingRight={1}>
          <text fg={clearArmed() ? theme.text.feedback.warning.base : theme.text.muted}>
            {clearArmed() ? t("Confirm clear") : t("Clear local data")}
          </text>
        </HoverAction>
      </box>
      <Show when={clearArmed()}>
        <text fg={theme.text.feedback.warning.base} wrapMode="word">
          {t("Click again to erase all local ideas and stop collection.")}
        </text>
      </Show>
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
                <box height={1} border={["bottom"]} borderColor={theme.border.base} />
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
      if (!state.autoCapture || messages.length === 0) return
      const since = state.autoCaptureSince
      const cursor = state.lastProcessedBySession[sessionID]
      let fresh = messages.slice(0)

      // Walk backward from the end and stop at the last cursor (or the consent time).
      // This avoids rescanning the entire transcript after every turn.
      if (cursor) {
        let index = messages.length - 1
        while (index >= 0 && messages[index].id !== cursor.messageID) index--
        if (index >= 0) {
          fresh = messages.slice(index + 1)
        } else {
          let start = messages.length
          while (start > 0 && createdMillis(messages[start - 1].time.created) > cursor.createdAt) start--
          fresh = messages.slice(start)
        }
      } else {
        let start = messages.length
        while (start > 0 && createdMillis(messages[start - 1].time.created) >= since) start--
        fresh = messages.slice(start)
      }
      if (fresh.length === 0) return

      const candidates = fresh.flatMap((message) => {
        if (message.type !== "user") return []
        const created = createdMillis(message.time.created)
        if (!Number.isFinite(created) || created < since) return []
        return [{ signal: classifyIdeaSignal(message.text) }]
      })
      const lastMessage = messages[messages.length - 1]
      const lastCreatedAt = createdMillis(lastMessage.time.created)
      const nextCursor = {
        messageID: lastMessage.id,
        createdAt: Number.isFinite(lastCreatedAt) ? lastCreatedAt : since,
      }

      await update((draft) => {
        if (!draft.autoCapture) return
        for (const candidate of candidates) {
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
        draft.lastProcessedBySession[sessionID] = nextCursor
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
