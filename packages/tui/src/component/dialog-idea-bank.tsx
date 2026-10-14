import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useData } from "../context/data"
import type { PromptRef } from "../component/prompt"
import { appendPrompt, emptyPrompt } from "../prompt/history"
import { useEvent } from "../context/event"
import { useStorage } from "../context/storage"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"
import { useTerminalDimensions } from "@opentui/solid"
import { useT } from "../util/i18n"
import { buildIdeaPrompt } from "../util/idea-bank-prompt"
import { HoverAction } from "./hover-action"
import { classifyIdeaSignal, shouldAttemptGlobalShare } from "../util/idea-bank-rules"

export type IdeaSignal = {
  id: string
  title: string
  category: string
  kind: string
  description: string
  signalCount: number
  createdAt: number
  updatedAt: number
  starter?: boolean
  global?: boolean
  nextStep?: string
}

type IdeaBankState = {
  autoCapture: boolean
  autoCaptureSince: number
  autoShareSignals?: boolean
  lastSharedSignalAt?: Record<string, number>
  lastSharedAttemptAt?: Record<string, number>
  lastProcessedBySession: Record<string, { messageID: string; createdAt: number }>
  ideas: IdeaSignal[]
  // Migration from earlier development snapshots; removed after state is next saved.
  processedMessageIDs?: string[]
}

const STORE_KEY = "idea-bank"
const INITIAL: IdeaBankState = {
  autoCapture: false,
  autoCaptureSince: 0,
  autoShareSignals: false,
  lastSharedSignalAt: {},
  lastSharedAttemptAt: {},
  lastProcessedBySession: {},
  ideas: [],
}

const STARTER_IDEAS: IdeaSignal[] = [
  {
    id: "starter-accessibility-audit",
    title: "Accessibility audit for small interfaces",
    category: "Accessibility",
    kind: "CLI tool",
    description: "Find common keyboard, contrast, and labeling issues and create a practical repair checklist.",
    signalCount: 0,
    createdAt: 0,
    updatedAt: 0,
    starter: true,
    nextStep: "Test the report against a few open-source interfaces and compare it with a manual audit.",
  },
  {
    id: "starter-open-source-revival",
    title: "Open-source project revival radar",
    category: "Open source",
    kind: "Research tool",
    description: "Find useful projects that are neglected, have unresolved user problems, or need maintainers.",
    signalCount: 0,
    createdAt: 0,
    updatedAt: 0,
    starter: true,
    nextStep: "Choose one ecosystem and rank public repositories using activity, open issues, and dependency health.",
  },
  {
    id: "starter-game-localization",
    title: "Toolkit for translating older games",
    category: "Games and creativity",
    kind: "CLI tool and plugin",
    description: "Help locate text resources, preserve formatting, check translation context, and package language patches.",
    signalCount: 0,
    createdAt: 0,
    updatedAt: 0,
    starter: true,
    nextStep: "Validate one game format end to end before trying to support every engine.",
  },
  {
    id: "starter-docs-navigator",
    title: "Offline documentation navigator",
    category: "Education",
    kind: "Desktop utility",
    description: "Search local documentation, connect related pages, and show exact source passages instead of unsupported answers.",
    signalCount: 0,
    createdAt: 0,
    updatedAt: 0,
    starter: true,
    nextStep: "Index one documentation set with full-text search and verify that every result points to its source.",
  },
  {
    id: "starter-science-reproducibility",
    title: "Reproducibility checklist for research",
    category: "Science",
    kind: "Research workflow",
    description: "Help researchers record data versions, dependencies, parameters, and steps needed to repeat an experiment.",
    signalCount: 0,
    createdAt: 0,
    updatedAt: 0,
    starter: true,
    nextStep: "Try a template against a public paper with available code and note which steps are missing.",
  },
  {
    id: "starter-local-energy",
    title: "Private home-energy explainer",
    category: "Environment",
    kind: "Local dashboard",
    description: "Turn a user's own electricity readings into understandable trends and possible waste indicators without cloud uploads.",
    signalCount: 0,
    createdAt: 0,
    updatedAt: 0,
    starter: true,
    nextStep: "Start by importing a CSV and explaining peaks without making claims about their cause.",
  },
  {
    id: "starter-note-garden",
    title: "Local knowledge garden",
    category: "Productivity",
    kind: "Desktop utility",
    description: "Find duplicate notes, stale instructions, and disconnected pieces of personal knowledge while keeping them on-device.",
    signalCount: 0,
    createdAt: 0,
    updatedAt: 0,
    starter: true,
    nextStep: "Prototype duplicate detection with local full-text search before adding embeddings.",
  },
  {
    id: "starter-agent-audit",
    title: "AI-agent permissions auditor",
    category: "Developer tools",
    kind: "Open-source developer tool",
    description: "Explain which actions an agent can perform, identify broad permissions, and show a readable history of risky operations.",
    signalCount: 0,
    createdAt: 0,
    updatedAt: 0,
    starter: true,
    nextStep: "Create a read-only report for one agent configuration and verify it against actual runtime behavior.",
  },
]

function createdMillis(value: unknown) {
  if (typeof value === "number") return value
  if (value instanceof Date) return value.getTime()
  return Date.parse(String(value))
}

function globalBase() {
  const configured = process.env.OPENCODE_IDEA_BANK_URL?.trim()
  if (!configured) return undefined
  try {
    const url = new URL(configured)
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        url.hostname !== "localhost" &&
        url.hostname !== "127.0.0.1" &&
        url.hostname !== "[::1]")
    )
      return undefined
    return url.origin
  } catch {
    return undefined
  }
}

export function DialogIdeaBank(props: { prompt: { current?: PromptRef }; initialQuery?: string }) {
  const theme = useTheme().surface("dialog")
  const t = useT()
  const dialog = useDialog()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const [state, update] = useStorage().store<IdeaBankState>(STORE_KEY, { initial: INITIAL, key: "id" })
  const prompt = props.prompt
  // The bundled ideas make the bank useful before any private-session signals are collected.
  // They are inspiration only: no market demand or novelty is claimed to have been verified.
  const [globalIdeas, setGlobalIdeas] = createSignal<IdeaSignal[]>([])
  const [globalQuery, setGlobalQuery] = createSignal(props.initialQuery ?? "")
  const [globalStatus, setGlobalStatus] = createSignal<"loading" | "connected" | "not-configured" | "error">("loading")
  const [globalTotal, setGlobalTotal] = createSignal(0)
  const [globalLoadingMore, setGlobalLoadingMore] = createSignal(false)
  const [shareArmed, setShareArmed] = createSignal<string>()

  const loadGlobalIdeas = async (query = globalQuery(), offset = 0, append = false) => {
    const base = globalBase()
    if (!base) {
      if (!append) {
        setGlobalStatus("not-configured")
        setGlobalIdeas([])
        setGlobalTotal(0)
      }
      setGlobalLoadingMore(false)
      return
    }
    if (append) setGlobalLoadingMore(true)
    else setGlobalStatus("loading")
    try {
      const url = new URL("/v1/ideas", base)
      url.searchParams.set("limit", "50")
      url.searchParams.set("offset", String(Math.max(0, Math.min(100_000, Math.floor(offset)))))
      if (query.trim()) url.searchParams.set("q", query.trim().slice(0, 120))
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) })
      const payload: unknown = await response.json()
      if (!response.ok) throw new Error("Global Idea Bank returned HTTP " + response.status)
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid global bank response")
      const data = payload as Record<string, unknown>
      const rows = Array.isArray(data.items) ? data.items : []
      const normalized = rows.flatMap((value): IdeaSignal[] => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return []
        const item = value as Record<string, unknown>
        if (
          typeof item.id !== "string" ||
          typeof item.title !== "string" ||
          typeof item.summary !== "string" ||
          typeof item.category !== "string"
        )
          return []
        return [{
          id: item.id,
          title: item.title,
          category: item.category,
          kind: "Community idea",
          description: item.summary,
          signalCount: typeof item.signalCount === "number" ? Math.max(0, item.signalCount) : 1,
          createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
          updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : 0,
          global: true,
        }]
      })
      setGlobalIdeas((previous) => {
        if (!append) return normalized
        const seen = new Set(previous.map((idea) => idea.id))
        return [...previous, ...normalized.filter((idea) => !seen.has(idea.id))]
      })
      setGlobalTotal(typeof data.total === "number" ? Math.max(0, data.total) : normalized.length)
      setGlobalStatus("connected")
    } catch {
      if (!append) {
        setGlobalIdeas([])
        setGlobalTotal(0)
      }
      setGlobalStatus("error")
    } finally {
      setGlobalLoadingMore(false)
    }
  }

  const loadMoreGlobalIdeas = () => {
    if (
      globalLoadingMore() ||
      globalStatus() !== "connected" ||
      globalIdeas().length >= globalTotal()
    )
      return
    void loadGlobalIdeas(globalQuery(), globalIdeas().length, true)
  }

  onMount(() => void loadGlobalIdeas())

  const ideas = createMemo(() => {
    const query = globalQuery().normalize("NFKC").toLocaleLowerCase().trim()
    const terms = query.split(/\s+/u).filter(Boolean)
    const seen = new Set<string>()
    return [...globalIdeas(), ...(state.ideas ?? []), ...STARTER_IDEAS]
      .filter((idea) => {
        // The server has already filtered and ranked community results. Do not
        // filter them a second time here: local string matching can discard valid results
        // from a multilingual/search-normalizing backend.
        if (terms.length > 0 && !idea.global) {
          const searchable = [idea.title, idea.category, idea.kind, idea.description]
            .join(" ")
            .normalize("NFKC")
            .toLocaleLowerCase()
          if (!terms.some((term) => searchable.includes(term))) return false
        }
        const key = [idea.title, idea.category]
          .map((value) => value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim())
          .join("|")
        // Prefer the shared copy when a matching local signal or starter overlaps it.
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => {
        if (a.global !== b.global) return a.global ? -1 : 1
        if (a.starter !== b.starter) return a.starter ? 1 : -1
        return b.signalCount - a.signalCount || b.updatedAt - a.updatedAt
      })
  })
  const totalSignals = createMemo(() => (state.ideas ?? []).reduce((sum, item) => sum + item.signalCount, 0))
  const [clearArmed, setClearArmed] = createSignal(false)
  // The dialog is wider and centered, so give its idea list more room while
  // reserving enough rows for the header, privacy notes, counters, and footer.
  const bodyHeight = () => Math.max(4, Math.min(24, dimensions().height - 20))

  const openGlobalSearch = () => {
    const current = globalQuery()
    dialog.replace(() => (
      <DialogPrompt
        title={t("Search global ideas")}
        placeholder={t("Search by topic, tool, or problem")}
        value={current}
        onCancel={() => dialog.replace(() => <DialogIdeaBank {...props} initialQuery={current} />)}
        onConfirm={(value) => {
          const query = value.trim()
          setGlobalQuery(query)
          dialog.replace(() => <DialogIdeaBank {...props} initialQuery={query} />)
        }}
      />
    ))
  }

  const returnToBank = (query = globalQuery()) => {
    dialog.replace(() => <DialogIdeaBank {...props} initialQuery={query} />)
  }

  const submitCustomIdeaToGlobal = async (title: string, category: string, summary: string) => {
    const base = globalBase()
    if (!base) {
      returnToBank()
      toast.show({ variant: "error", message: t("Global Idea Bank is not connected.") })
      return
    }
    try {
      const response = await fetch(new URL("/v1/ideas", base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent: true,
          title,
          category,
          summary,
          tags: category.split(/\s+/u).filter(Boolean).slice(0, 8),
          language: /[\u0400-\u04ff]/u.test(title + " " + summary) ? "ru" : "en",
        }),
        signal: AbortSignal.timeout(8_000),
      })
      const payload: unknown = await response.json()
      const data = payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
      if (!response.ok) {
        const message = typeof data.error === "string" ? data.error : t("Could not submit to global Idea Bank")
        returnToBank()
        toast.show({ variant: "error", message })
        return
      }
      returnToBank(title)
      toast.show({ variant: "success", message: t("Your idea was added to the global bank.") })
    } catch {
      returnToBank()
      toast.show({ variant: "error", message: t("Could not submit to global Idea Bank") })
    }
  }

  const openCustomShare = () => {
    if (!globalBase()) {
      setGlobalStatus("not-configured")
      toast.show({ variant: "error", message: t("Global Idea Bank is not connected.") })
      return
    }
    const back = () => returnToBank()
    dialog.replace(() => (
      <DialogPrompt
        title={t("Share an idea globally")}
        size="xlarge"
        description={() => (
          <text fg={theme.text.muted} wrapMode="word">
            {t("Only the title, category, and description you enter below will be sent. No chat history is included.")}
          </text>
        )}
        placeholder={t("Idea title")}
        onCancel={back}
        onConfirm={(rawTitle) => {
          const title = rawTitle.trim().slice(0, 120)
          if (title.length < 8) {
            toast.show({ variant: "info", message: t("The title must be at least 8 characters.") })
            return
          }
          dialog.replace(() => (
            <DialogPrompt
              title={t("Idea category")}
              size="xlarge"
              description={() => <text fg={theme.text.muted}>{t("Use a short category such as Developer tools, Productivity, Games, or Accessibility.")}</text>}
              placeholder={t("Category")}
              onCancel={back}
              onConfirm={(rawCategory) => {
                const category = rawCategory.trim().slice(0, 60)
                if (category.length < 2) {
                  toast.show({ variant: "info", message: t("The category must be at least 2 characters.") })
                  return
                }
                dialog.replace(() => (
                  <DialogPrompt
                    title={t("Short public summary")}
                    size="xlarge"
                    description={() => <text fg={theme.text.muted} wrapMode="word">{t("Write a public description of at least 30 characters. Do not include names, credentials, private links, or chat excerpts.")}</text>}
                    placeholder={t("Describe the idea in one short paragraph")}
                    onCancel={back}
                    onConfirm={(rawSummary) => {
                      const summary = rawSummary.trim().slice(0, 1800)
                      if (summary.length < 30) {
                        toast.show({ variant: "info", message: t("The summary must be at least 30 characters.") })
                        return
                      }
                      dialog.replace(() => (
                        <DialogPrompt
                          title={t("Confirm public submission")}
                          size="xlarge"
                          description={() => (
                            <box gap={1}>
                              <text fg={theme.text.muted} wrapMode="word">{t("Review the exact text that will be made public.")}</text>
                              <text fg={theme.text.base} wrapMode="word">{t("Title")}: {title}</text>
                              <text fg={theme.text.base} wrapMode="word">{t("Category")}: {category}</text>
                              <text fg={theme.text.base} wrapMode="word">{t("Summary")}: {summary}</text>
                              <text fg={theme.text.muted} wrapMode="word">{t('Type "SHARE" to confirm public submission.')}</text>
                            </box>
                          )}
                          placeholder="SHARE"
                          onCancel={back}
                          onConfirm={(confirmation) => {
                            if (confirmation.trim().toUpperCase() !== "SHARE") {
                              toast.show({ variant: "info", message: t("Public submission cancelled because SHARE was not entered.") })
                              back()
                              return
                            }
                            dialog.replace(() => (
                              <DialogPrompt
                                title={t("Submitting idea…")}
                                size="xlarge"
                                description={() => <text fg={theme.text.muted} wrapMode="word">{t("Please wait while the idea is checked and added to the global bank.")}</text>}
                                value=""
                                busy={true}
                                busyText={t("Submitting…")}
                              />
                            ))
                            void submitCustomIdeaToGlobal(title, category, summary)
                          }}
                        />
                      ))
                    }}
                  />
                ))
              }}
            />
          ))
        }}
      />
    ))
  }

  const globalStatusText = () => {
    switch (globalStatus()) {
      case "loading":
        return t("Connecting to global bank…")
      case "connected":
        return t("Global bank connected") + " · " + globalTotal()
      case "not-configured":
        return t("Global bank not configured. Set OPENCODE_IDEA_BANK_URL to use the shared catalogue.")
      case "error":
        return t("Global bank unavailable; local ideas are still available.")
    }
  }

  const clearLocalData = async () => {
    if (!clearArmed()) {
      setClearArmed(true)
      return
    }
    try {
      await update((draft) => {
        draft.autoCapture = false
        draft.autoCaptureSince = 0
        draft.autoShareSignals = false
        draft.lastSharedSignalAt = {}
        draft.lastSharedAttemptAt = {}
        draft.lastProcessedBySession = {}
        draft.ideas = []
        delete draft.processedMessageIDs
      })
      setClearArmed(false)
      setShareArmed(undefined)
      toast.show({ variant: "success", message: t("Local Idea Bank data cleared") })
    } catch {
      setClearArmed(false)
      toast.show({ variant: "error", message: t("Could not clear local Idea Bank data") })
    }
  }

  const useIdea = (idea: IdeaSignal) => {
    if (!prompt.current) {
      toast.show({ variant: "info", message: t("Open a prompt to use an idea") })
      return
    }
    const draft = emptyPrompt()
    draft.text = buildIdeaPrompt(idea)
    const current = prompt.current
    current.set(appendPrompt(current.current, draft))
    dialog.clear()
    toast.show({ variant: "info", message: t("Idea added to prompt; review it and send when ready") })
  }
  const shareIdea = async (idea: IdeaSignal) => {
    const base = globalBase()
    if (!base) {
      toast.show({ variant: "error", message: t("Global Idea Bank is not connected.") })
      setGlobalStatus("not-configured")
      return
    }
    if (idea.global) {
      toast.show({ variant: "info", message: t("This idea is already in the global bank.") })
      return
    }
    if (shareArmed() !== idea.id) {
      setShareArmed(idea.id)
      toast.show({ variant: "info", message: t("Click share again to add this idea to the public global bank. Only this generic idea text is sent.") })
      return
    }
    setShareArmed(undefined)
    try {
      const response = await fetch(new URL("/v1/ideas", base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consent: true,
          title: idea.title,
          summary: idea.description,
          category: idea.category,
          tags: [idea.category, idea.kind].map((value) => value.toLowerCase()).slice(0, 8),
          language: "en",
        }),
        signal: AbortSignal.timeout(8_000),
      })
      const payload: unknown = await response.json()
      const data = payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {}
      if (!response.ok) {
        const message = typeof data.error === "string" ? data.error : t("Could not submit to global Idea Bank")
        toast.show({ variant: "error", message })
        return
      }
      await loadGlobalIdeas()
      toast.show({ variant: "success", message: t("Idea added to the global bank.") })
    } catch {
      toast.show({ variant: "error", message: t("Could not submit to global Idea Bank") })
    }
  }

  const toggleCapture = () => {
    const enabled = !state.autoCapture
    if (!enabled) setShareArmed(undefined)
    void update((draft) => {
      draft.autoCapture = enabled
      draft.ideas ??= []
      draft.lastProcessedBySession ??= {}
      delete draft.processedMessageIDs
      // Turning local capture off also stops sharing and discards any pending confirmation.
      if (!enabled) draft.autoShareSignals = false
      // Consent applies only to future messages. Enabling never scans old chats.
      if (enabled) draft.autoCaptureSince = Date.now()
    }).catch((error) => {
      toast.show({ variant: "error", message: `Idea Bank: ${String(error)}` })
    })
  }

  const toggleGlobalSignalSharing = () => {
    if (state.autoShareSignals) {
      void update((draft) => {
        draft.autoShareSignals = false
      }).then(() => setShareArmed(undefined)).catch(() => {
        toast.show({ variant: "error", message: t("Could not update global sharing setting") })
      })
      return
    }
    if (!state.autoCapture) {
      toast.show({ variant: "info", message: t("Enable local capture before sharing anonymous signals.") })
      return
    }
    if (!globalBase()) {
      toast.show({ variant: "error", message: t("Global Idea Bank is not connected.") })
      setGlobalStatus("not-configured")
      return
    }
    if (shareArmed() !== "automatic-signals") {
      setShareArmed("automatic-signals")
      toast.show({ variant: "info", message: t("Confirm to share only generic idea categories, never chat text.") })
      return
    }
    setShareArmed(undefined)
    void update((draft) => {
      draft.autoShareSignals = true
      draft.lastSharedSignalAt ??= {}
      draft.lastSharedAttemptAt ??= {}
    }).then(() => {
      toast.show({ variant: "success", message: t("Generic global signal sharing enabled.") })
    }).catch(() => {
      toast.show({ variant: "error", message: t("Could not update global sharing setting") })
    })
  }

  return (
    <box width="100%" maxHeight={Math.max(12, dimensions().height - 2)} paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
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
      <box flexDirection="row" gap={1}>
        <text fg={state.autoShareSignals ? theme.text.feedback.success.base : theme.text.muted}>
          {state.autoShareSignals ? t("Automatic global sharing is on") : t("Automatic global sharing is off")}
        </text>
        <box flexGrow={1} />
        <HoverAction id="idea-bank.toggle-global-sharing" onClick={toggleGlobalSignalSharing} paddingLeft={1} paddingRight={1}>
          <text fg={shareArmed() === "automatic-signals" ? theme.text.feedback.warning.base : theme.text.action.primary.base}>
            {state.autoShareSignals ? t("Pause sharing") : shareArmed() === "automatic-signals" ? t("Confirm sharing") : t("Enable sharing")}
          </text>
        </HoverAction>
      </box>
      <text fg={theme.text.muted} wrapMode="word">
        {t("Sharing sends only predefined generic signal labels and summaries. It never sends original messages, excerpts, file paths, or chat history.")}
      </text>
      <text fg={theme.text.muted} wrapMode="word">
        {t("Local capture stays on this computer. Global search reads published ideas; chat text is never uploaded automatically.")}
      </text>
      <text fg={theme.text.muted} wrapMode="word">
        {t("Starter ideas are unverified prompts for exploration, not claims of market demand or originality.")}
      </text>
      <text fg={globalStatus() === "connected" ? theme.text.feedback.success.base : theme.text.muted} wrapMode="word">
        {globalStatusText()}
      </text>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text.muted}>{t("Potential directions")}: {ideas().length}</text>
        <text fg={theme.text.muted}>{t("Local signals")}: {totalSignals()}</text>
        <box flexGrow={1} />
        <HoverAction id="idea-bank.submit-global" onClick={openCustomShare} paddingLeft={1} paddingRight={1}>
          <text fg={theme.text.action.primary.base}>{t("Submit idea")}</text>
        </HoverAction>
        <HoverAction id="idea-bank.search-global" onClick={openGlobalSearch} paddingLeft={1} paddingRight={1}>
          <text fg={theme.text.action.primary.base}>{t("Search")}</text>
        </HoverAction>
        <HoverAction id="idea-bank.refresh-global" onClick={() => void loadGlobalIdeas()} paddingLeft={1} paddingRight={1}>
          <text fg={theme.text.muted}>{t("Refresh")}</text>
        </HoverAction>
        <Show when={globalQuery().length > 0}>
          <HoverAction
            id="idea-bank.clear-search"
            onClick={() => {
              setGlobalQuery("")
              dialog.replace(() => <DialogIdeaBank {...props} initialQuery="" />)
            }}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.text.muted}>{t("Clear search")}</text>
          </HoverAction>
        </Show>
      </box>
      <Show when={globalQuery().length > 0}>
        <text fg={theme.text.muted} wrapMode="word">
          {t("Search results for")}: {globalQuery()}
        </text>
      </Show>
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
                <text fg={idea.starter ? theme.text.muted : theme.text.action.primary.base} wrapMode="word">
                  {idea.global ? t("Public idea from the global bank") : idea.starter ? t("Starter idea · unverified") : t("Detected pattern · not a validated idea")}
                </text>
                <text fg={theme.text.muted} wrapMode="word">
                  {t(idea.category)} · {t(idea.kind)}
                </text>
                <Show when={idea.nextStep}>
                  {(step) => <text fg={theme.text.muted} wrapMode="word">{t("Next step")}: {t(step())}</text>}
                </Show>
                <box flexDirection="row" justifyContent="flex-end" gap={1}>
                  <Show when={!idea.global}>
                    <HoverAction
                      id={"idea-bank.share." + idea.id}
                      onClick={() => void shareIdea(idea)}
                      paddingLeft={1}
                      paddingRight={1}
                    >
                      <text fg={shareArmed() === idea.id ? theme.text.feedback.warning.base : theme.text.muted}>
                        {shareArmed() === idea.id ? t("Confirm public share") : t("Share globally")}
                      </text>
                    </HoverAction>
                  </Show>
                  <HoverAction
                    id={"idea-bank.use." + idea.id}
                    onClick={() => useIdea(idea)}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text fg={theme.text.action.primary.base}>{t("Explore")}</text>
                  </HoverAction>
                </box>
                <box height={1} border={["bottom"]} borderColor={theme.border.base} />
              </box>
            )}
          </For>
        </scrollbox>
      </Show>
      <Show when={globalStatus() === "connected" && globalIdeas().length < globalTotal()}>
        <box flexDirection="row" justifyContent="center" gap={2}>
          <HoverAction id="idea-bank.load-more" onClick={loadMoreGlobalIdeas} paddingLeft={1} paddingRight={1}>
            <text fg={globalLoadingMore() ? theme.text.muted : theme.text.action.primary.base}>
              {globalLoadingMore() ? t("Loading more ideas…") : t("Load more global ideas")}
            </text>
          </HoverAction>
          <text fg={theme.text.muted}>{globalIdeas().length} / {globalTotal()}</text>
        </box>
      </Show>
      <text fg={theme.text.muted} wrapMode="word">
        {t("Accepted ideas are published after automatic privacy, duplicate, and rate-limit checks. You can pause global sharing at any time.")}
      </text>
    </box>
  )
}

/**
 * Lightweight background collector. It runs only after explicit opt-in and only when a
 * session reaches idle. Source text is inspected in memory for rule matching, but is never
 * stored, logged, sent to a model, or sent over the network. If global sharing is separately
 * enabled, only a fixed, generic classifier result is sent — never the original message.
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
      // Read only the transcript already cached by the TUI. Only generic classifier output
      // may be sent, and only after the separate global-sharing opt-in; no model is called.
      const messages = data.session.message.list(sessionID)
      if (!state.autoCapture || messages.length === 0) return
      const since = state.autoCaptureSince
      const cursor = state.lastProcessedBySession?.[sessionID]
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
        draft.ideas ??= []
        draft.lastProcessedBySession ??= {}
        delete draft.processedMessageIDs
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

      // Only fixed classifier output is eligible for global sharing. Never reuse the
      // user's message, its excerpt, or any transcript-derived free-form text.
      if (state.autoCapture && state.autoShareSignals && globalBase()) {
        const uniqueSignals = new Map<string, NonNullable<(typeof candidates)[number]["signal"]>>()
        for (const candidate of candidates) {
          if (candidate.signal) uniqueSignals.set(candidate.signal.id, candidate.signal)
        }
        for (const signal of uniqueSignals.values()) {
          if (!state.autoCapture || !state.autoShareSignals) break
          const now = Date.now()
          const lastSharedAt = state.lastSharedSignalAt?.[signal.id] ?? 0
          const lastAttemptAt = state.lastSharedAttemptAt?.[signal.id] ?? 0
          // Do not retry a failed network request on every chat turn.
          if (!shouldAttemptGlobalShare(now, lastSharedAt, lastAttemptAt)) continue
          await update((draft) => {
            draft.lastSharedAttemptAt ??= {}
            draft.lastSharedAttemptAt[signal.id] = now
          })
          // The user may have paused sharing while the local state write was pending.
          if (!state.autoCapture || !state.autoShareSignals) break
          try {
            const base = globalBase()
            if (!base) break
            const response = await fetch(new URL("/v1/ideas", base), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                consent: true,
                title: signal.title,
                summary: signal.description,
                category: signal.category,
                tags: [signal.category, signal.kind.toLowerCase()].slice(0, 8),
                language: "en",
              }),
              signal: AbortSignal.timeout(8_000),
            })
            if (response.ok) {
              await update((draft) => {
                draft.lastSharedSignalAt ??= {}
                draft.lastSharedSignalAt[signal.id] = Date.now()
              })
            }
          } catch {
            // Never log classifier input, submitted summaries, or service responses.
          }
        }
      }
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
