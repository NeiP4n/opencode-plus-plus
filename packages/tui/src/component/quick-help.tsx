import { TextAttributes, type InputRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocal } from "../context/local"
import { useLocation } from "../context/location"
import { useRoute } from "../context/route"
import { useTheme, useThemes } from "../context/theme"
import { SplitBorder } from "../ui/border"
import { modelErrorText, withModelWarmup } from "../util/model-error"
import { useT } from "../util/i18n"
import { getScrollAcceleration } from "../util/scroll"
import { readProjectSources } from "./project-facts"
import { Spinner } from "./spinner"

export type QuickMode = "explain" | "essence" | "chat"

// Only one of these windows is open at a time and none of them outlives the process, so plain signals are enough.
const [mode, setMode] = createSignal<QuickMode>()
// The text that was selected when Explain was pressed; clicking the bar clears the live selection first.
const [quoted, setQuoted] = createSignal("")
export const quickMode = mode
export const setQuickMode = setMode
export const explainSelection = (text: string) => {
  setQuoted(text.trim().slice(0, SELECTION_LIMIT))
  setMode("explain")
}

const SELECTION_LIMIT = 4_000
const HISTORY_LIMIT = 12
type ChatMessage = { role: "user" | "assistant"; text: string }
// The mini chat keeps its conversation while the window is closed and reopened.
const [chat, setChat] = createSignal<readonly ChatMessage[]>([])

const languageName = (language: string) => (language === "ru" ? "Russian" : "English")

const explainPrompt = (language: string, text: string) =>
  [
    "The person is reading a chat with an AI coding assistant and selected the fragment below. Explain what it means in plain words a newcomer understands.",
    "Lead with the answer in one or two sentences, then add up to five short bullet points with the key terms, what the code or command does, and anything they should watch out for.",
    `Write in ${languageName(language)}. Put file paths, code and commands in \`backticks\`. No headings, no intro, no closing line.`,
    "",
    "--- selected fragment ---",
    text,
  ].join("\n")

const essencePrompt = (language: string, sources: string) =>
  [
    "Below are excerpts of a software project's files and its top-level file list. Explain the essence of the project to someone who has just joined it.",
    "Cover, in this order: what problem the project solves and for whom; how it works in broad strokes; its main parts and where they live; and where to start reading or running it.",
    `Write in ${languageName(language)}, in plain words, at most 200 words. Use a few short paragraphs or bullet points, \`backticks\` for paths and commands, no headings.`,
    "State only what the excerpts show; leave out anything you would have to guess.",
    "",
    sources,
  ].join("\n")

const chatPrompt = (language: string, directory: string | undefined, history: readonly ChatMessage[]) =>
  [
    "You are a quick helper in a side window of a coding tool. Answer the last message briefly and directly, in a few sentences or a short list.",
    `Answer in ${languageName(language)} unless the person writes in another language.`,
    directory ? `The person is working in the project folder \`${directory}\`.` : "",
    "",
    ...history.map((message) => `${message.role === "user" ? "Person" : "You"}: ${message.text}`),
    "You:",
  ].join("\n")

/** Windows above the bottom bar's right edge: explain a selection, the project's essence, and a mini chat. */
export function QuickHelp() {
  return (
    <Show when={mode()}>
      {(current) => <QuickWindow mode={current()} />}
    </Show>
  )
}

function QuickWindow(props: { mode: QuickMode }) {
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
  const [answer, setAnswer] = createSignal<string>()
  let input: InputRenderable | undefined

  const directory = createMemo(() => {
    const id = route.data.type === "session" ? route.data.sessionID : undefined
    return (id ? data.session.get(id)?.location.directory : undefined) ?? location.current?.directory
  })
  const language = () => config.language ?? "en"

  const ask = (prompt: () => Promise<string | undefined>, done: (text: string) => void) => {
    const selected = local.model.current()
    const variant = local.model.variant.current()
    setLoading(true)
    setError(undefined)
    void prompt()
      .then((text) =>
        text === undefined
          ? undefined
          : withModelWarmup(() =>
              client.api.generate.text({
                prompt: text,
                model: selected && { providerID: selected.providerID, id: selected.modelID, variant },
              }),
            ),
      )
      .then((result) => result && done(result.text.trim()))
      .catch((cause: unknown) => setError(modelErrorText(cause, t)))
      .finally(() => setLoading(false))
  }

  const run = () => {
    if (loading()) return
    setAnswer(undefined)
    if (props.mode === "explain") {
      const text = quoted()
      if (!text) return
      return ask(
        () => Promise.resolve(explainPrompt(language(), text)),
        (result) => setAnswer(result),
      )
    }
    if (props.mode === "essence") {
      const dir = directory()
      if (dir === undefined) return
      return ask(
        () =>
          readProjectSources(client, dir).then((sources) =>
            sources.length === 0 ? undefined : essencePrompt(language(), sources.join("\n\n")),
          ),
        (result) => setAnswer(result),
      )
    }
  }

  const send = () => {
    const text = input?.value.trim()
    if (!text || loading() || !input) return
    input.value = ""
    const history = [...chat(), { role: "user" as const, text }].slice(-HISTORY_LIMIT)
    setChat(history)
    ask(
      () => Promise.resolve(chatPrompt(language(), directory(), history)),
      (result) => setChat((messages) => [...messages, { role: "assistant", text: result }]),
    )
  }

  // A new selection or another project asks again; the chat only answers what is sent.
  createEffect(on([() => props.mode, quoted, directory], () => run()))

  const title = () =>
    props.mode === "explain" ? t("Explain selection") : props.mode === "essence" ? t("Project essence") : t("Quick chat")
  const markdown = (content: string) => (
    <markdown
      content={content}
      syntaxStyle={syntax()}
      conceal
      fg={theme.markdown.text}
      bg={theme.background.raised.base}
    />
  )

  return (
    <box
      id="quick-help"
      position="absolute"
      zIndex={2300}
      right={0}
      bottom={1}
      width={Math.max(24, Math.min(64, dimensions().width - 2))}
      maxHeight={Math.max(8, Math.floor(dimensions().height * 0.6))}
      flexDirection="column"
      backgroundColor={theme.background.raised.base}
      border={["left"]}
      borderColor={theme.background.action.primary.focused}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={1} paddingTop={1} flexShrink={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexGrow={1}>
          {title()}
        </text>
        <Show when={props.mode !== "chat" && !loading()}>
          <text fg={theme.text.action.primary.base} onMouseUp={run}>
            {t("refresh")}
          </text>
        </Show>
        <Show when={props.mode === "chat" && chat().length > 0 && !loading()}>
          <text fg={theme.text.action.primary.base} onMouseUp={() => setChat([])}>
            {t("clear")}
          </text>
        </Show>
        <text fg={theme.text.muted} onMouseUp={() => setMode()}>
          {t("hide")}
        </text>
      </box>
      <scrollbox
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        stickyScroll={props.mode === "chat"}
        stickyStart="bottom"
        scrollAcceleration={getScrollAcceleration(config)}
        verticalScrollbarOptions={{
          visible: true,
          trackOptions: { backgroundColor: theme.background.base, foregroundColor: theme.scrollbar.base },
        }}
      >
        <Show when={props.mode === "explain" && quoted()}>
          <box border={["left"]} borderColor={theme.text.muted} paddingLeft={1} marginBottom={1}>
            <text fg={theme.text.muted} wrapMode="word">
              {quoted().split("\n").slice(0, 4).join("\n").slice(0, 280)}
            </text>
          </box>
        </Show>
        <Show when={props.mode === "chat"}>
          <For each={chat()}>
            {(message) => (
              <box marginBottom={1}>
                <Show when={message.role === "user"} fallback={markdown(message.text)}>
                  <text fg={theme.text.action.primary.base} wrapMode="word">
                    {"› " + message.text}
                  </text>
                </Show>
              </box>
            )}
          </For>
        </Show>
        <Switch>
          <Match when={loading()}>
            <Spinner color={theme.text.muted}>{t("Thinking…")}</Spinner>
          </Match>
          <Match when={error()}>
            {(message) => (
              <text fg={theme.text.feedback.error.base} wrapMode="word">
                {message()}
              </text>
            )}
          </Match>
          <Match when={props.mode === "chat"}>
            <Show when={chat().length === 0}>
              <text fg={theme.text.muted} wrapMode="word">
                {t("Ask anything quick. The answer does not go into the main chat.")}
              </text>
            </Show>
          </Match>
          <Match when={answer()}>{(text) => markdown(text())}</Match>
          <Match when={props.mode === "explain"}>
            <text fg={theme.text.muted} wrapMode="word">
              {t("Select text in the chat, then press Explain.")}
            </text>
          </Match>
          <Match when={directory() === undefined}>
            <text fg={theme.text.muted} wrapMode="word">
              {t("Open a project to collect its facts.")}
            </text>
          </Match>
          <Match when={true}>
            <text fg={theme.text.muted} wrapMode="word">
              {t("Nothing in this folder to learn from.")}
            </text>
          </Match>
        </Switch>
      </scrollbox>
      <Show when={props.mode === "chat"}>
        <box paddingLeft={2} paddingRight={1} paddingBottom={1} flexShrink={0}>
          <input
            cursorStyle={config.cursor}
            ref={(element: InputRenderable) => {
              input = element
              setTimeout(() => {
                if (!element.isDestroyed) element.focus()
              }, 1)
            }}
            onMouseDown={() => input?.focus()}
            placeholder={t("Ask a question and press Enter")}
            placeholderColor={theme.text.muted}
            textColor={theme.text.formfield.base}
            focusedTextColor={theme.text.formfield.focused}
            cursorColor={theme.text.formfield.focused}
            backgroundColor={theme.background.formfield.base}
            focusedBackgroundColor={theme.background.formfield.focused}
            onSubmit={send}
          />
        </box>
      </Show>
    </box>
  )
}
