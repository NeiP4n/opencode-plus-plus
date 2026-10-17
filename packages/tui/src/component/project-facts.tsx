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
import { useTheme } from "../context/theme"
import { SplitBorder } from "../ui/border"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { Spinner } from "./spinner"

type FactsState = {
  open: boolean
  projects: Record<string, { text: string; language: string; time: number }>
}

export function useProjectFacts() {
  return useStorage().store<FactsState>("project-facts", { initial: { open: false, projects: {} } })
}

// The window is a light reminder of what the project is about, so it reads only a few small files and makes one
// stateless call: no session history and no tools.
const SOURCES = ["README.md", "AGENTS.md", "package.json"]
const SOURCE_LIMIT = 1_500

const instructions = (language: string, sources: string) =>
  [
    "Below are excerpts of a software project's files. The person working on it wants a short cheat sheet so they keep understanding what the project is about.",
    "List the 5 to 8 most useful definitions and facts: what the project is, its key terms, where important things live, and rules that must not be broken.",
    `Write in ${language === "ru" ? "Russian" : "English"}, in plain words a newcomer understands, avoiding jargon, one short line per item, formatted as \`Term — explanation\`, with no headings or other markdown.`,
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
  const config = useConfig().data
  const t = useT()
  const dimensions = useTerminalDimensions()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string>()

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
    void Promise.all(
      SOURCES.map((path) =>
        client.api.file
          .read({ path, location: { directory: dir } })
          .then((bytes) => `--- ${path} ---\n${new TextDecoder().decode(bytes).slice(0, SOURCE_LIMIT)}`)
          .catch(() => undefined),
      ),
    )
      .then((excerpts) => {
        const sources = excerpts.filter((excerpt) => excerpt !== undefined)
        if (sources.length === 0) throw new Error(t("No README.md, AGENTS.md or package.json to learn from."))
        return client.api.generate.text({
          prompt: instructions(lang, sources.join("\n\n")),
          model: selected && {
            providerID: selected.providerID,
            id: selected.modelID,
            variant: local.model.variant.current(),
          },
        })
      })
      .then((result) =>
        update((draft) => {
          draft.projects[dir] = { text: result.text.trim(), language: lang, time: Date.now() }
        }),
      )
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setLoading(false))
  }

  // Collect once per project and language when the window is open; a failure waits for an explicit refresh.
  createEffect(() => {
    if (loading() || error() !== undefined || directory() === undefined) return
    const current = entry()
    if (current === undefined || current.language !== language()) collect()
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
        scrollbarOptions={{ visible: false }}
      >
        <Switch>
          <Match when={loading()}>
            <Spinner color={theme.text.muted}>{t("Collecting project facts…")}</Spinner>
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
              <text fg={theme.text.base} wrapMode="word">
                {facts().text}
              </text>
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
