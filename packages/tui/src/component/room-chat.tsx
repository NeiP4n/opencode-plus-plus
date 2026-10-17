import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Predicate } from "effect"
import type { NoteInfo, PermissionRequest } from "@opencode/client"
import { useConfig } from "../config"
import { useRoute } from "../context/route"
import { ClientProvider } from "../context/client"
import { DataProvider, useData } from "../context/data"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"
import { useTheme, useThemes } from "../context/theme"
import { SessionTranscript } from "../routes/session"
import { SplitBorder } from "../ui/border"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import type { JoinedRoom } from "../util/room"
import { guestApi, ignoreGuestUnavailable, roomClient } from "../util/room-guest"

// The host polls this often for who is connected; the guest also learns of role changes and removal.
const POLL_MS = 2000

const ROLE = { viewer: "Viewer", member: "Member", helper: "Helper", cohost: "Cohost" } as const

// A joined room in the main area, drawn like a session: the host's transcript with its
// tool calls and reasoning, read through the room's guest routes. What a guest may do
// follows the role the host gave it: viewers read, members write, helpers also answer
// the host model's permission requests.
export function RoomChat(props: { room: JoinedRoom; sessionID?: string }) {
  const route = useRoute()
  const minimize = () => {
    const current = route.data
    if (current.type !== "room") return
    route.navigate(current.returnTo ? { type: "session", sessionID: current.returnTo } : { type: "home" })
  }
  const remote = roomClient(props.room)
  const roomID = props.room.roomID
  const target = props.sessionID
  // Kept in signals, not a resource: a resource read after a failed fetch throws, and a
  // host that closed the room or removed this guest answers every poll with an error.
  const [joined, setJoined] = createSignal<Awaited<ReturnType<typeof remote.room.guest.get>>>()
  const [error, setError] = createSignal<unknown>()
  const [note, setNote] = createSignal<{ name: string; title: string }>()
  // The poll replaces the answer every few seconds; only a different session remounts the view.
  const sessionID = createMemo(() => joined()?.session.id)
  // Set by the view inside the data provider; the room log calls it once it has caught up.
  let live: (() => void) | undefined

  onMount(() => {
    const poll = () => {
      void remote.room.guest
        .get({ roomID, sessionID: target })
        .then((state) => {
          setJoined(state)
          setError()
        })
        .catch((cause: unknown) => {
          setError(cause)
          // A closed room or a removed guest stays shut; a network hiccup keeps the last view.
          if (shut(cause)) setJoined()
        })
      void remote.room.guest
        .messages({ roomID, sessionID: target })
        .then((result) => setNote(result.note))
        .catch(() => undefined)
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={sessionID()} fallback={<RoomProblem room={props.room} error={error()} onMinimize={minimize} />} keyed>
      {(id) => (
        <ClientProvider api={guestApi(props.room, id, () => live?.())}>
          <DataProvider directory={joined()?.session.location.directory ?? ""} onError={ignoreGuestUnavailable}>
            <RoomView
              room={props.room}
              sessionID={id}
              role={joined()?.role ?? "viewer"}
              host={new URL(props.room.url).host}
              error={error() ? errorMessage(error()) : undefined}
              note={note()}
              onLive={(reload) => (live = reload)}
              onMinimize={minimize}
            />
          </DataProvider>
        </ClientProvider>
      )}
    </Show>
  )
}

function shut(error: unknown) {
  return (
    Predicate.hasProperty(error, "_tag") && (error._tag === "RoomNotFoundError" || error._tag === "UnauthorizedError")
  )
}

function RoomView(props: {
  room: JoinedRoom
  sessionID: string
  role: keyof typeof ROLE
  host: string
  error?: string
  note?: { name: string; title: string }
  onLive: (reload: () => void) => void
  onMinimize: () => void
}) {
  const theme = useTheme()
  const data = useData()
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const t = useT()
  const remote = roomClient(props.room)
  const [sending, setSending] = createSignal(0)
  const [failure, setFailure] = createSignal<string>()
  const [reading, setReading] = createSignal(false)
  const [document, setDocument] = createSignal<NoteInfo | null>()
  const { currentSyntax: syntax } = useThemes()
  let input: TextareaRenderable | undefined

  onMount(() => setTimeout(() => input?.focus(), 1))
  // The transcript loads while the room log replays the host's history, and events in between
  // are skipped; once the log is live, reload the transcript so nothing from that gap is missing.
  props.onLive(() => {
    data.session.message.invalidate(props.sessionID)
    void data.session.message.sync(props.sessionID).catch(ignoreGuestUnavailable)
  })
  onCleanup(() => props.onLive(() => undefined))

  // Requests asked before this view opened; later ones arrive on the room log as they are asked.
  onMount(() => void data.session.permission.sync(props.sessionID).catch(ignoreGuestUnavailable))

  // A clicked answer hides its request at once; one the host refuses comes back with the reason.
  const [answered, setAnswered] = createSignal<ReadonlySet<string>>(new Set())
  const permissions = () =>
    (data.session.permission.list(props.sessionID) ?? []).filter((request) => !answered().has(request.id))

  // The field clears at once so the next message can be typed while this one posts, and the
  // message shows in the transcript before the host answers; a failed post puts it back.
  const send = () => {
    const text = input?.plainText.trim()
    if (!text || !input) return
    input.clear()
    setSending((count) => count + 1)
    // A cohost's "/name arguments" runs the host's command; anyone else's slash is just text.
    const command = props.role === "cohost" ? /^\/(\S+)\s*([\s\S]*)$/.exec(text) : null
    void (
      command
        ? remote.room.guest.session.command({
            roomID: props.room.roomID,
            sessionID: props.sessionID,
            name: command[1],
            text: command[2],
          })
        : data.session.prompt({ sessionID: props.sessionID, text })
    )
      .then(() => setFailure())
      .catch((cause: unknown) => {
        setFailure(errorMessage(cause))
        if (input && !input.plainText) input.setText(text)
      })
      .finally(() => setSending((count) => count - 1))
  }

  const answer = (request: PermissionRequest, decision: "once" | "always" | "reject") => {
    setAnswered((ids) => new Set(ids).add(request.id))
    void data.session.permission
      .reply({ sessionID: props.sessionID, requestID: request.id, decision })
      .catch((cause: unknown) => {
        setAnswered((ids) => new Set([...ids].filter((id) => id !== request.id)))
        setFailure(errorMessage(cause))
      })
  }

  const toggleNote = () => {
    const next = !reading()
    setReading(next)
    if (next)
      void remote.room.guest
        .note({ roomID: props.room.roomID, sessionID: props.sessionID })
        .then(setDocument)
        .catch((cause: unknown) => setFailure(errorMessage(cause)))
  }

  const padding = () => (dimensions().width < 44 ? 1 : 2)
  const writes = () => props.role !== "viewer"

  const sidebar = () => dimensions().width >= SIDEBAR_FROM

  return (
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box flexGrow={1} minWidth={0} minHeight={0} paddingLeft={padding()} paddingRight={padding()} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingTop={1} flexShrink={0}>
          <text fg={theme.text.base} wrapMode="none" truncate flexShrink={1}>
            <span style={{ fg: theme.text.action.secondary.base, bold: true }}>{`⇄ ${t("Multiplayer")}`}</span>
            <span style={{ bold: true }}>{` · ${props.room.name}`}</span>
            <span style={{ fg: theme.text.muted }}>{` · ${t("host {host}", { host: props.host })}`}</span>
          </text>
          <box flexGrow={1} />
          <text
            fg={theme.text.action.secondary.base}
            flexShrink={0}
            selectable={false}
            onMouseUp={props.onMinimize}
          >
            {t("↓ Minimize")}
          </text>
          <text fg={theme.text.formfield.base} flexShrink={0}>{`[${t(ROLE[props.role])}]`}</text>
        </box>
        <Show when={props.note}>
          {(bound) => (
            <box flexDirection="row" gap={2} flexShrink={0}>
              <text fg={theme.text.base} wrapMode="none" truncate>
                {`✎ ${t("Note: {title}", { title: bound().title })}`}
                <span style={{ fg: theme.text.muted }}>{` · ${t("the host's AI writes your requests into it")}`}</span>
              </text>
              <box flexGrow={1} />
              <text fg={theme.text.action.primary.base} flexShrink={0} onMouseUp={toggleNote}>
                {reading() ? t("Back to chat") : t("Read note")}
              </text>
            </box>
          )}
        </Show>
        <Show
          when={!reading()}
          fallback={
            <scrollbox flexGrow={1} minHeight={0} paddingTop={1}>
              <Show
                when={document()?.body.trim()}
                fallback={
                  <text fg={theme.text.muted}>
                    {document() === null ? t("The note is no longer bound.") : t("The note is empty so far.")}
                  </text>
                }
              >
                {(body) => (
                  <markdown
                    syntaxStyle={syntax()}
                    content={body()}
                    conceal
                    internalBlockMode="top-level"
                    tableOptions={{ style: "grid", cellPaddingX: 1 }}
                    fg={theme.markdown.text}
                    bg={theme.background.base}
                  />
                )}
              </Show>
            </scrollbox>
          }
        >
          <SessionTranscript
            sessionID={props.sessionID}
            width={dimensions().width - padding() * 2 - (sidebar() ? SIDEBAR_WIDTH : 0)}
          />
        </Show>
        <Show when={(props.role === "helper" || props.role === "cohost") && permissions().length > 0}>
          <For each={permissions()}>
            {(request) => (
              <box
                flexShrink={0}
                marginTop={1}
                border={["left"]}
                customBorderChars={SplitBorder.customBorderChars}
                borderColor={theme.border.base}
                paddingLeft={2}
                backgroundColor={theme.background.raised.base}
              >
                <text fg={theme.text.base} wrapMode="word">
                  {request.message ?? `${request.action} ${request.resources.join(", ")}`}
                </text>
                <box flexDirection="row" gap={2}>
                  <text fg={theme.text.action.primary.base} onMouseUp={() => answer(request, "once")}>
                    {t("Allow once")}
                  </text>
                  <text fg={theme.text.action.primary.base} onMouseUp={() => answer(request, "always")}>
                    {t("Always allow")}
                  </text>
                  <text fg={theme.text.feedback.error.base} onMouseUp={() => answer(request, "reject")}>
                    {t("Deny")}
                  </text>
                </box>
              </box>
            )}
          </For>
        </Show>
        <Show when={failure() ?? props.error}>
          {(message) => (
            <text fg={theme.text.feedback.error.base} wrapMode="word" flexShrink={0}>
              {message()}
            </text>
          )}
        </Show>
        <box
          flexShrink={0}
          marginTop={1}
          border={["left"]}
          borderColor={theme.border.base}
          customBorderChars={{ ...SplitBorder.customBorderChars, bottomLeft: "╹" }}
        >
          <box
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={theme.decrease(theme.background.raised.base)}
          >
            <Show
              when={writes()}
              fallback={<text fg={theme.text.muted}>{t("You are watching this room; the host lets you write.")}</text>}
            >
              <textarea
                ref={(element: TextareaRenderable) => {
                  input = element
                }}
                minHeight={1}
                maxHeight={6}
                cursorStyle={config.cursor}
                placeholder={
                  sending() > 0
                    ? t("Sending…")
                    : props.role === "cohost"
                      ? t("Message the room or /command, enter to send")
                      : t("Message the room, enter to send")
                }
                placeholderColor={theme.text.muted}
                textColor={theme.text.formfield.base}
                focusedTextColor={theme.text.formfield.focused}
                cursorColor={theme.text.formfield.focused}
                keyBindings={[{ name: "return", action: "submit" }]}
                onSubmit={send}
              />
            </Show>
          </box>
        </box>
      </box>
      <Show when={sidebar()}>
        <RoomSidebar room={props.room} sessionID={props.sessionID} role={props.role} host={props.host} />
      </Show>
    </box>
  )
}

const SIDEBAR_WIDTH = 38
// Below this the transcript needs the room more than the details do.
const SIDEBAR_FROM = 110

// The right panel of a joined room: what the session is and runs on, what it has cost
// the host, and for a cohost the model and agent pickers the host has in its own sidebar.
function RoomSidebar(props: { room: JoinedRoom; sessionID: string; role: keyof typeof ROLE; host: string }) {
  const theme = useTheme()
  const data = useData()
  const dialog = useDialog()
  const toast = useToast()
  const t = useT()
  const remote = roomClient(props.room)
  onMount(() => void data.session.sync(props.sessionID).catch(ignoreGuestUnavailable))
  const session = () => data.session.get(props.sessionID)
  const cohost = () => props.role === "cohost"
  const fail = (error: unknown) => toast.show({ message: errorMessage(error), variant: "error" })

  const pickModel = () =>
    void remote.room.guest.model
      .list({ roomID: props.room.roomID })
      .then((models) =>
        dialog.replace(() => (
          <DialogSelect
            title={t("Host model")}
            options={models.map((model) => ({
              title: model.name,
              description: model.providerID,
              value: { providerID: model.providerID, id: model.modelID },
            }))}
            onSelect={(option) => {
              dialog.clear()
              void remote.room.guest.session
                .model({ roomID: props.room.roomID, sessionID: props.sessionID, model: option.value })
                .catch(fail)
            }}
          />
        )),
      )
      .catch(fail)

  const pickAgent = () =>
    void remote.room.guest.agent
      .list({ roomID: props.room.roomID })
      .then((agents) =>
        dialog.replace(() => (
          <DialogSelect
            title={t("Host agent")}
            options={agents
              .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
              .map((agent) => ({ title: agent.name, description: agent.description, value: agent.id }))}
            onSelect={(option) => {
              dialog.clear()
              void remote.room.guest.session
                .agent({ roomID: props.room.roomID, sessionID: props.sessionID, agent: option.value })
                .catch(fail)
            }}
          />
        )),
      )
      .catch(fail)

  const line = (label: string, value: string, pick?: () => void) => (
    <box flexDirection="row" gap={1}>
      <text fg={theme.text.muted} flexShrink={0}>
        {label}
      </text>
      <box flexGrow={1} minWidth={0}>
        <text
          fg={pick ? theme.text.action.primary.base : theme.text.base}
          wrapMode="none"
          truncate
          onMouseUp={() => pick?.()}
        >
          {value}
        </text>
      </box>
    </box>
  )

  return (
    <box
      width={SIDEBAR_WIDTH}
      flexShrink={0}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      gap={1}
      backgroundColor={theme.background.raised.base}
    >
      <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="word">
        {session()?.title || t("Untitled")}
      </text>
      <box>
        {line(t("Host"), props.host)}
        {line(t("Role"), t(ROLE[props.role]))}
      </box>
      <box>
        {line(t("Agent"), session()?.agent ?? "—", cohost() ? pickAgent : undefined)}
        {line(
          t("Model"),
          session()?.model ? `${session()!.model!.providerID}/${session()!.model!.id}` : "—",
          cohost() ? pickModel : undefined,
        )}
      </box>
      <Show when={session()}>
        {(info) => (
          <box>
            {line(t("Tokens"), `${info().tokens.input + info().tokens.output}`)}
            {line(t("Cost"), `$${info().cost.toFixed(2)}`)}
          </box>
        )}
      </Show>
      <text fg={theme.text.muted} wrapMode="word">
        {cohost()
          ? t("Click the agent or model to change it; /command runs a host command.")
          : t("The host or a cohost picks the model and agent.")}
      </text>
    </box>
  )
}

// Shown until the host answers, or when it refuses this guest.
function RoomProblem(props: { room: JoinedRoom; error: unknown; onMinimize: () => void }) {
  const theme = useTheme()
  const t = useT()
  return (
    <box flexGrow={1} paddingLeft={2} paddingTop={1}>
      <text fg={theme.text.base}>
        <span style={{ fg: theme.text.action.secondary.base, bold: true }}>{`⇄ ${t("Multiplayer")}`}</span>
        <span style={{ bold: true }}>{` · ${props.room.name}`}</span>
      </text>
      <text fg={props.error ? theme.text.feedback.error.base : theme.text.muted} wrapMode="word">
        {props.error ? errorMessage(props.error) : t("Connecting to the host…")}
      </text>
      <text fg={theme.text.action.secondary.base} selectable={false} onMouseUp={props.onMinimize}>
        {t("↓ Minimize")}
      </text>
    </box>
  )
}
