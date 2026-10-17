import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useData } from "../context/data"
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

// session.generate shows the session's tools but runs no tool loop, so a tool call would come back empty.
const instructions = (language: string) =>
  [
    "The user wants a short cheat sheet about the project this session works in.",
    "From the project instructions, environment, and conversation you already have, list the 5 to 8 definitions and facts a person working on this project most needs to know: what the project is, its key terms, where important things live, and rules that must not be broken.",
    `Write in ${language === "ru" ? "Russian" : "English"}, in plain words a newcomer understands, avoiding jargon, one short line per item, formatted as \`Term — explanation\`, with no headings or other markdown.`,
    "State only what the context actually shows; leave out anything you would have to guess.",
    "Do not call any tools and do not take any actions.",
  ].join(" ")

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
    const id = sessionID()
    const dir = directory()
    if (id === undefined || dir === undefined || loading()) return
    const lang = language()
    setLoading(true)
    setError(undefined)
    void client.api.session
      .generate({ sessionID: id, prompt: instructions(lang) })
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
    if (loading() || error() !== undefined || sessionID() === undefined) return
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
        <Show when={sessionID() !== undefined && !loading()}>
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
              {t("Open a session in this project to collect its facts.")}
            </text>
          </Match>
        </Switch>
      </scrollbox>
    </box>
  )
}
