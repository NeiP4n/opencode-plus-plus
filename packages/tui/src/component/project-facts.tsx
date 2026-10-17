import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocal } from "../context/local"
import { useLocation } from "../context/location"
import { useRoute } from "../context/route"
import { useStorage } from "../context/storage"
import { useTheme, useThemes } from "../context/theme"
import { SplitBorder } from "../ui/border"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { getScrollAcceleration } from "../util/scroll"
import { Spinner } from "./spinner"

type FactsState = {
  open: boolean
  projects: Record<string, { text: string; language: string; time: number; format?: number }>
}

// Bump when the prompt's output format changes so facts saved in the old format are collected again.
const FORMAT = 2

export function useProjectFacts() {
  return useStorage().store<FactsState>("project-facts", { initial: { open: false, projects: {} } })
}

// The window is a light reminder of what the project is about, so it reads short excerpts of the first few
// describing files that exist plus the top-level file list, and makes one stateless call: no history, no tools.
const SOURCES = [
  "README.md",
  "readme.md",
  "README",
  "AGENTS.md",
  "CLAUDE.md",
  ".opencode/plan.md",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
]
const SOURCE_LIMIT = 1_500
const SOURCE_COUNT = 3
const LISTING_LIMIT = 60

const instructions = (language: string, sources: string) =>
  [
    "Below are excerpts of a software project's files and its top-level file list. The person working on it wants a short cheat sheet so they keep understanding what the project is about.",
    "Pick only the 4 to 6 facts that matter most: what the project is, its one or two key terms, and a rule that must not be broken. Skip details such as versions, scripts, and file lists unless they are essential.",
    `Write in ${language === "ru" ? "Russian" : "English"}, in plain words a newcomer understands, avoiding jargon.`,
    "Format each fact as one markdown list item of at most 12 words: `- **Term** — explanation`. Put file paths and commands in `backticks` and use *italics* sparingly for emphasis. No headings, no intro, no closing line.",
    "State only what the excerpts show; leave out anything you would have to guess.",
    "",
    sources,
  ].join("\n")

/** A small window above the bottom bar's right edge with plain-language facts about the current project. */
export function ProjectFacts() {
  const [state] = useProjectFacts()
  // Nothing below runs while the window is closed, so the bar costs no session lookups.
  return (
    <Show when={state.open}>
      <FactsWindow />
    </Show>
  )
}

function FactsWindow() {
  const [state, update] = useProjectFacts()
  const client = useClient()
  const data = useData()
  const local = useLocal()
  const route = useRoute()
  const location = useLocation()
  const theme = useTheme()
  const syntax = useThemes().currentSyntax
  const config = useConfig().data
  const t = useT()
  const dimensions = useTerminalDimensions()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()
  // A folder with none of the source files is a normal case, not a failure.
  const [empty, setEmpty] = createSignal(false)

  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const directory = createMemo(() => {
    const id = sessionID()
    return (id ? data.session.get(id)?.location.directory : undefined) ?? location.current?.directory
  })
  const language = () => config.language ?? "en"
  const entry = createMemo(() => {
    const dir = directory()
    return dir === undefined ? undefined : state.projects[dir]
  })

  const collect = () => {
    const dir = directory()
    if (dir === undefined || loading()) return
    const lang = language()
    const selected = local.model.current()
    setLoading(true)
    setError(undefined)
    setEmpty(false)
    void Promise.all([
      ...SOURCES.map((path) =>
        client.api.file
          .read({ path, location: { directory: dir } })
          .then((bytes) => `--- ${path} ---\n${new TextDecoder().decode(bytes).slice(0, SOURCE_LIMIT)}`)
          .catch(() => undefined),
      ),
      client.api.file
        .list({ location: { directory: dir } })
        .then((listing) =>
          listing.data.length === 0
            ? undefined
            : `--- top-level files ---\n${listing.data
                .slice(0, LISTING_LIMIT)
                .map((entry) => (entry.type === "directory" ? `${entry.path}/` : entry.path))
                .join("\n")}`,
        )
        .catch(() => undefined),
    ])
      .then((found) => {
        const files = found.slice(0, -1).filter((excerpt) => excerpt !== undefined)
        const sources = [...files.slice(0, SOURCE_COUNT), found.at(-1)].filter((excerpt) => excerpt !== undefined)
        if (sources.length === 0) {
          setEmpty(true)
          return undefined
        }
        return client.api.generate.text({
          prompt: instructions(lang, sources.join("\n\n")),
          model: selected && {
            providerID: selected.providerID,
            id: selected.modelID,
            variant: local.model.variant.current(),
          },
        })
      })
      .then((result) => {
        if (result === undefined) return
        return update((draft) => {
          draft.projects[dir] = { text: result.text.trim(), language: lang, time: Date.now(), format: FORMAT }
        })
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setLoading(false))
  }

  // Collect once per project and language when the window is open; a failure waits for an explicit refresh.
  createEffect(() => {
    if (loading() || empty() || error() !== undefined || directory() === undefined) return
    const current = entry()
    if (current === undefined || current.language !== language() || current.format !== FORMAT) collect()
  })

  return (
    <box
      id="project-facts"
      position="absolute"
      zIndex={2300}
      right={0}
      bottom={1}
      width={Math.max(24, Math.min(64, dimensions().width - 2))}
      maxHeight={Math.max(6, Math.floor(dimensions().height * 0.5))}
      flexDirection="column"
      backgroundColor={theme.background.raised.base}
      border={["left"]}
      borderColor={theme.background.action.primary.focused}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={1} paddingTop={1} flexShrink={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexGrow={1}>
          {t("Project facts")}
        </text>
        <Show when={directory() !== undefined && !loading()}>
          <text fg={theme.text.action.primary.base} onMouseUp={collect}>
            {t("refresh")}
          </text>
        </Show>
        <text
          fg={theme.text.muted}
          onMouseUp={() =>
            update((draft) => {
              draft.open = false
            })
          }
        >
          {t("hide")}
        </text>
      </box>
      <scrollbox
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        scrollAcceleration={getScrollAcceleration(config)}
        verticalScrollbarOptions={{
          visible: true,
          trackOptions: { backgroundColor: theme.background.base, foregroundColor: theme.scrollbar.base },
        }}
      >
        <Switch>
          <Match when={loading()}>
            <Spinner color={theme.text.muted}>{t("Collecting project facts…")}</Spinner>
          </Match>
          <Match when={empty()}>
            <text fg={theme.text.muted} wrapMode="word">
              {t("Nothing in this folder to learn from.")}
            </text>
          </Match>
          <Match when={error()}>
            {(message) => (
              <text fg={theme.text.feedback.error.base} wrapMode="word">
                {t("Could not collect facts: {error}", { error: message() })}
              </text>
            )}
          </Match>
          <Match when={entry()}>
            {(facts) => (
              <markdown
                syntaxStyle={syntax()}
                content={facts().text}
                conceal
                internalBlockMode="top-level"
                fg={theme.markdown.text}
                bg={theme.background.raised.base}
              />
            )}
          </Match>
          <Match when={true}>
            <text fg={theme.text.muted} wrapMode="word">
              {t("Open a project to collect its facts.")}
            </text>
          </Match>
        </Switch>
      </scrollbox>
    </box>
  )
}
