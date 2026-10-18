import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
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
import { EmptyBorder, SplitBorder } from "../ui/border"
import { createColors, createFrames } from "../ui/spinner"
import { tint } from "../theme/color"
import { useLocal } from "../context/local"
import { Locale } from "../util/locale"
import { Spinner } from "./spinner"
import { PromptMetadataRow } from "./prompt/metadata"
import { errorMessage } from "../util/error"
import { isRateLimitedTurnPending, RATE_LIMIT_CONTINUATION_PROMPT } from "../util/session"
import { useT } from "../util/i18n"
import type { JoinedRoom } from "../util/room"
import { guestApi, ignoreGuestUnavailable, roomClient } from "../util/room-guest"
import { HoverAction } from "./hover-action"
import { RoomDodRows } from "./room-dod"

// Room state changes slowly; the room log handles live transcript events. Keep polling as a
// fallback, but avoid waking the client and host every two seconds while this room is idle.
const POLL_MS = 5000

const ROLE = { viewer: "Viewer", member: "Member", helper: "Helper", cohost: "Cohost", trusted: "Trusted" } as const

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
  // Read before the room's providers wrap the view: inside them the data layer is the host's.
  const home = useData()
  const remote = roomClient(props.room)
  const roomID = props.room.roomID
  const target = props.sessionID
  // Kept in signals, not a resource: a resource read after a failed fetch throws, and a
  // host that closed the room or removed this guest answers every poll with an error.
  const [joined, setJoined] = createSignal<Awaited<ReturnType<typeof remote.room.guest.get>>>()
  const [error, setError] = createSignal<unknown>()
  const [note, setNote] = createSignal<{ name: string; title: string }>()
  const [running, setRunning] = createSignal(false)
  // The poll replaces the answer every few seconds; only a different session remounts the view.
  const sessionID = createMemo(() => joined()?.session.id)
  // Set by the view inside the data provider; the room log calls it once it has caught up, and
  // the poll whenever the host's transcript moves.
  let live: (() => void) | undefined
  let pollSequence = 0
  // A host keeps no durable events unless configured to, and hosts before live streaming send
  // only permission requests, so the room log can stay silent while the host answers. The
  // poll sees the newest message and the running state; when either moves, the view reloads.
  let latest: string | undefined
  let stopped = false
  let checking = false
  let timer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    // Use a self-scheduling timeout instead of setInterval: slow host responses must not
    // accumulate overlapping requests. A 5-second delay also caps idle background traffic.
    const poll = async () => {
      if (stopped || checking) return
      checking = true
      const sequence = ++pollSequence
      try {
        const [state, result] = await Promise.all([
          remote.room.guest.get({ roomID, sessionID: target }),
          remote.room.guest.messages({ roomID, sessionID: target }),
        ])
        if (stopped || sequence !== pollSequence) return
        setJoined(state)
        setError()
        setNote(result.note)
        setRunning(result.running)
        const last = result.data.at(-1)
        const next = `${last?.id}:${last?.text.length}:${result.running}`
        if (latest !== undefined && latest !== next) live?.()
        latest = next
      } catch (cause: unknown) {
        if (stopped) return
        setError(cause)
        // A closed room or a removed guest stays shut; a network hiccup keeps the last view.
        if (shut(cause)) setJoined()
      } finally {
        checking = false
        if (!stopped) timer = setTimeout(poll, POLL_MS)
      }
    }
    void poll()
    onCleanup(() => {
      stopped = true
      pollSequence++
      if (timer) clearTimeout(timer)
    })
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
              guest={joined()?.guest}
              home={home}
              host={new URL(props.room.url).host}
              error={error() ? errorMessage(error()) : undefined}
              note={note()}
              running={running()}
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
  guest?: { id: string; name: string }
  // This computer's own data layer, for the sidebar's Client side; useData here reads the host.
  home: ReturnType<typeof useData>
  host: string
  error?: string
  note?: { name: string; title: string }
  running: boolean
  onLive: (reload: () => void) => void
  onMinimize: () => void
}) {
  const theme = useTheme()
  const data = useData()
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const t = useT()
  const toast = useToast()
  const remote = roomClient(props.room)
  const [sending, setSending] = createSignal(0)
  const [failure, setFailure] = createSignal<string>()
  const [awaitingAI, setAwaitingAI] = createSignal(false)
  let awaitingTimer: ReturnType<typeof setTimeout> | undefined
  const waitForAI = () => {
    setAwaitingAI(true)
    if (awaitingTimer) clearTimeout(awaitingTimer)
    // The host's running poll is authoritative once it sees execution start. This
    // timeout only prevents a missed event or a run that never starts sticking forever.
    awaitingTimer = setTimeout(() => {
      setAwaitingAI(false)
      awaitingTimer = undefined
    }, 15_000)
  }
  const stopWaitingForAI = () => {
    if (awaitingTimer) clearTimeout(awaitingTimer)
    awaitingTimer = undefined
    setAwaitingAI(false)
  }
  createEffect(() => {
    // Once the server confirms execution is running, its state takes over the indicator.
    if (props.running && awaitingAI()) stopWaitingForAI()
  })
  onCleanup(() => {
    if (awaitingTimer) clearTimeout(awaitingTimer)
  })
  const executionEnded = (event: { data: { sessionID: string } }) => {
    if (event.data.sessionID === props.sessionID) stopWaitingForAI()
  }
  const endSubscriptions = [
    data.on("session.execution.succeeded", executionEnded),
    data.on("session.execution.failed", executionEnded),
    data.on("session.execution.interrupted", executionEnded),
  ]
  onCleanup(() => endSubscriptions.forEach((unsubscribe) => unsubscribe()))
  const [reading, setReading] = createSignal(false)
  const [document, setDocument] = createSignal<NoteInfo | null>()
  const { currentSyntax: syntax } = useThemes()
  let input: TextareaRenderable | undefined

  onMount(() => setTimeout(() => input?.focus(), 1))
  // The transcript loads while the room log replays the host's history, and events in between
  // are skipped; once the log is live, reload the transcript so nothing from that gap is missing.
  // The transcript's rows are built from events and rebuilt only when user or idle messages
  // change, so a reloaded reply would keep the empty rows its stream left; a fresh mount
  // rebuilds them from the reloaded messages.
  const [generation, setGeneration] = createSignal(1)
  props.onLive(() => {
    data.session.message.invalidate(props.sessionID)
    void data.session.message
      .sync(props.sessionID)
      .then(() => setGeneration((count) => count + 1))
      .catch(ignoreGuestUnavailable)
  })
  onCleanup(() => props.onLive(() => undefined))

  // Requests asked before this view opened; later ones arrive on the room log as they are asked.
  onMount(() => void data.session.permission.sync(props.sessionID).catch(ignoreGuestUnavailable))

  // A clicked answer hides its request at once; one the host refuses comes back with the reason.
  const [answered, setAnswered] = createSignal<ReadonlySet<string>>(new Set())
  const permissions = () =>
    (data.session.permission.list(props.sessionID) ?? []).filter((request) => !answered().has(request.id))

  // Keep the optimistic indicator only until the host's running poll takes over.
  // The fallback timer prevents missed status transitions from leaving it stuck.

  // The field clears at once so the next message can be typed while this one posts, and the
  // message shows in the transcript before the host answers; a failed post puts it back.
  const send = () => {
    const text = input?.plainText.trim()
    if (!text || !input) return
    input.clear()
    setSending((count) => count + 1)
    // A cohost's "/name arguments" runs a host command rather than prompting the model.
    const command = props.role === "cohost" ? /^\/(\S+)\s*([\s\S]*)$/.exec(text) : null
    if (!command) waitForAI()
    void (
      command
        ? remote.room.guest.session.command({
            roomID: props.room.roomID,
            sessionID: props.sessionID,
            name: command[1],
            text: command[2],
          })
        : data.session.prompt({
            sessionID: props.sessionID,
            text,
            // Only the shown row carries it, so the message is signed before the host echoes it;
            // the host stamps the real author from the room token.
            metadata: props.guest && { room: { id: props.room.roomID, guest: props.guest } },
          })
    )
      .then(() => {
        setFailure()
        // RoomChat polls the host's running/note state; this view has no local setters.
      })
      .catch((cause: unknown) => {
        stopWaitingForAI()
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
  const [rateLimitedSessions, setRateLimitedSessions] = createSignal<
    Array<{ id: string; title: string; stamp: string }>
  >([])
  const [resumingAll, setResumingAll] = createSignal(false)
  const rateLimitChecks = new Map<string, { stamp: string; limited: boolean; title: string }>()
  onMount(() => {
    let disposed = false
    let checking = false
    const read = async () => {
      if (disposed || checking || !writes()) return
      checking = true
      try {
        const result = await remote.room.guest.session.list({ roomID: props.room.roomID })
        if (disposed) return
        const sessions = result.data
        const publish = () => {
          setRateLimitedSessions(
            sessions.flatMap((item) => {
              const checked = rateLimitChecks.get(item.id)
              return checked?.limited ? [{ id: item.id, title: checked.title, stamp: checked.stamp }] : []
            }),
          )
        }
        const sessionIDs = new Set(sessions.map((item) => item.id))
        for (const id of rateLimitChecks.keys()) if (!sessionIDs.has(id)) rateLimitChecks.delete(id)
        const changed = sessions.filter((item) => rateLimitChecks.get(item.id)?.stamp !== String(item.time.updated))
        for (let offset = 0; offset < changed.length; offset += 8) {
          await Promise.all(
            changed.slice(offset, offset + 8).map(async (item) => {
              const stamp = String(item.time.updated)
              try {
                const response = await remote.room.guest.session.messages({
                  roomID: props.room.roomID,
                  sessionID: item.id,
                  limit: 30,
                  order: "desc",
                })
                const chronological = response.data.toReversed()
                const latestAssistant = chronological.findLast((message) => message.type === "assistant")
                rateLimitChecks.set(item.id, {
                  stamp,
                  limited: latestAssistant ? isRateLimitedTurnPending(chronological, latestAssistant.id) : false,
                  title: item.title?.trim() || item.id,
                })
              } catch {
                // Keep the prior result and retry on the next pass after a transient error.
              }
            }),
          )
          if (disposed) return
          publish()
        }
        publish()
      } catch {
        // A temporary host disconnect should not erase already detected rate limits.
      } finally {
        checking = false
      }
    }
    void read()
    const timer = setInterval(() => void read(), 10_000)
    onCleanup(() => {
      disposed = true
      clearInterval(timer)
    })
  })

  const resumeAll = async () => {
    if (resumingAll() || rateLimitedSessions().length === 0) return
    setResumingAll(true)
    const succeeded = new Set<string>()
    const stale = new Set<string>()
    const failures: unknown[] = []
    const targets = rateLimitedSessions()
    try {
      for (let offset = 0; offset < targets.length; offset += 4) {
        await Promise.all(
          targets.slice(offset, offset + 4).map(async (target) => {
            try {
              // Recheck before sending so a newer user prompt is never duplicated.
              const response = await remote.room.guest.session.messages({
                roomID: props.room.roomID,
                sessionID: target.id,
                limit: 30,
                order: "desc",
              })
              const chronological = response.data.toReversed()
              const latestAssistant = chronological.findLast((message) => message.type === "assistant")
              if (!latestAssistant || !isRateLimitedTurnPending(chronological, latestAssistant.id)) {
                stale.add(target.id)
                return
              }
              await remote.room.guest.prompt({
                roomID: props.room.roomID,
                sessionID: target.id,
                text: RATE_LIMIT_CONTINUATION_PROMPT,
              })
              succeeded.add(target.id)
              const checked = rateLimitChecks.get(target.id)
              if (checked) rateLimitChecks.set(target.id, { ...checked, limited: false })
            } catch (error) {
              failures.push(error)
            }
          }),
        )
      }
      setRateLimitedSessions((current) =>
        current.filter((item) => !succeeded.has(item.id) && !stale.has(item.id)),
      )
      if (succeeded.size > 0)
        toast.show({
          message: t("Continue requests sent to {count} sessions", { count: succeeded.size }),
          variant: "success",
        })
      if (failures.length > 0) {
        setFailure(t("{count} sessions could not be continued", { count: failures.length }))
        toast.error(failures[0])
      }
    } finally {
      setResumingAll(false)
    }
  }

  // The prompt takes the host agent's color, as a session's prompt takes its own agent's.
  const local = useLocal()
  const session = () => data.session.get(props.sessionID)
  const accentColor = createMemo(() => {
    const agent = session()?.agent
    return agent ? local.agent.color(agent) : theme.border.base
  })
  const accent = createMemo(() => tint(theme.border.base, accentColor(), 1))
  // Named as a session's prompt names them: the host's model list has the model's name, and this
  // computer's provider list the provider's; a model or provider unknown here keeps its ID.
  const [hostModels, setHostModels] = createSignal<readonly { name: string; providerID: string; modelID: string }[]>([])
  onMount(() => void remote.room.guest.model.list({ roomID: props.room.roomID }).then(setHostModels).catch(() => undefined))
  const modelLabel = () => {
    const model = session()?.model
    if (!model) return ""
    return hostModels().find((item) => item.providerID === model.providerID && item.modelID === model.id)?.name ?? model.id
  }
  const providerLabel = () => {
    const providerID = session()?.model?.providerID
    if (!providerID) return ""
    return props.home.location.provider.list()?.find((item) => item.id === providerID)?.name ?? providerID
  }
  const promptBg = createMemo(() => theme.decrease(theme.background.raised.base))
  const spinner = createMemo(() => {
    const options = { color: accentColor(), style: "blocks" as const, inactiveFactor: 0.6, minAlpha: 0.3 }
    return { frames: createFrames(options), color: createColors(options) }
  })
  const busy = () => props.running || awaitingAI() || sending() > 0
  // Once the reply streams in, its own rows show the work; a host without live events never streams.
  const thinking = () => {
    if (!props.running && !awaitingAI()) return false
    const last = data.session.message.list(props.sessionID).at(-1)
    return !(last?.type === "assistant" && last.time.completed === undefined)
  }

  const sidebar = () => dimensions().width >= SIDEBAR_FROM

  return (
    <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box flexGrow={1} minWidth={0} minHeight={0} paddingLeft={padding()} paddingRight={padding()} paddingBottom={1}>
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
          <Show when={generation()} keyed>
            <SessionTranscript
              sessionID={props.sessionID}
              width={dimensions().width - padding() * 2 - (sidebar() ? SIDEBAR_WIDTH : 0)}
              canResumeRateLimited={writes()}
            />
          </Show>
        </Show>
        {/* Drawn like the transcript's own reasoning row until the host's reply starts streaming in. */}
        <Show when={!reading() && thinking()}>
          <box marginTop={1} paddingLeft={3} flexShrink={0} flexDirection="row">
            <Spinner color={theme.text.feedback.warning.base}>Thinking</Spinner>
          </box>
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
            <text fg={theme.text.feedback.error.base} wrapMode="word" flexShrink={0} marginTop={1}>
              {message()}
            </text>
          )}
        </Show>
        {/* The room's line, where a session shows its note and room chips above the prompt. */}
        <box height={1} flexShrink={0} flexDirection="row" gap={2} marginTop={1}>
          <text fg={theme.text.base} wrapMode="none" truncate flexShrink={1}>
            <span style={{ fg: theme.text.action.secondary.base }}>{`⇄ ${props.room.name}`}</span>
            <span style={{ fg: theme.text.muted }}>{` · ${t("host {host}", { host: props.host })}`}</span>
            <span style={{ fg: theme.text.muted }}>{` · ${t(ROLE[props.role])}`}</span>
          </text>
          <box flexGrow={1} />
          <Show when={props.note}>
            {(bound) => (
              <text
                fg={theme.text.action.primary.base}
                wrapMode="none"
                truncate
                flexShrink={1}
                selectable={false}
                onMouseUp={toggleNote}
              >
                {reading() ? t("Back to chat") : `✎ ${bound().title}`}
              </text>
            )}
          </Show>
          <text fg={theme.text.action.secondary.base} flexShrink={0} selectable={false} onMouseUp={props.onMinimize}>
            {t("↓ Minimize")}
          </text>
        </box>
        <box
          flexShrink={0}
          border={["left"]}
          borderColor={accent()}
          customBorderChars={{ ...SplitBorder.customBorderChars, bottomLeft: "╹" }}
        >
          <box
            paddingLeft={padding()}
            paddingRight={padding()}
            paddingTop={1}
            flexGrow={1}
            backgroundColor={promptBg()}
          >
            <Show when={writes() && rateLimitedSessions().length > 0}>
              <box flexDirection="row" gap={2} flexShrink={0} paddingBottom={1}>
                <text
                  fg={theme.text.action.primary.base}
                  selectable={false}
                  onMouseUp={() => void resumeAll()}
                >
                  {resumingAll()
                    ? t("Continuing {count} sessions…", { count: rateLimitedSessions().length })
                    : `↻ ${t("Continue all {count} sessions", { count: rateLimitedSessions().length })}`}
                </text>
                <text fg={theme.text.muted}>{t("Across this room")}</text>
              </box>
            </Show>
            <Show
              when={writes()}
              fallback={<text fg={theme.text.muted}>{t("You are watching this room; the host lets you write.")}</text>}
            >
              <textarea
                ref={(element: TextareaRenderable) => {
                  input = element
                }}
                width="100%"
                minHeight={1}
                maxHeight={Math.max(6, Math.floor(dimensions().height / 3))}
                cursorStyle={config.cursor}
                placeholder={
                  sending() > 0
                    ? t("Sending…")
                    : props.role === "cohost"
                      ? t("Message the room or /command, enter to send")
                      : t("Message the room, enter to send")
                }
                placeholderColor={theme.text.muted}
                textColor={theme.text.base}
                focusedTextColor={theme.text.base}
                cursorColor={theme.text.base}
                focusedBackgroundColor="transparent"
                keyBindings={[{ name: "return", action: "submit" }]}
                onSubmit={send}
              />
            </Show>
            <box flexDirection="row" flexShrink={0} paddingTop={1}>
              <PromptMetadataRow
                mode="normal"
                agent={session()?.agent ? Locale.titlecase(session()!.agent!) : undefined}
                auto={false}
                model={modelLabel()}
                provider={providerLabel()}
                variant={session()?.model?.variant === "default" ? undefined : session()?.model?.variant}
                muted={false}
                highlight={accentColor()}
                agentAlpha={1}
                modelAlpha={1}
                variantAlpha={1}
              />
            </box>
          </box>
        </box>
        <box height={1} border={["left"]} borderColor={accent()} customBorderChars={{ ...EmptyBorder, vertical: "╹" }}>
          <box
            height={1}
            border={["bottom"]}
            borderColor={promptBg()}
            customBorderChars={{ ...EmptyBorder, horizontal: "▀" }}
          />
        </box>
        {/* The prompt's footer: the same working spinner a session shows while its model runs. */}
        <box height={1} flexShrink={0} flexDirection="row" gap={1}>
          <Show
            when={busy()}
            fallback={
              <text fg={theme.text.muted} wrapMode="none" truncate>
                {session()?.location.directory ?? ""}
              </text>
            }
          >
            <box marginLeft={1}>
              <Show when={config.animations ?? true} fallback={<text fg={theme.text.muted}>[⋯]</text>}>
                <spinner color={spinner().color} frames={spinner().frames} interval={40} />
              </Show>
            </box>
            <text fg={theme.text.muted} wrapMode="none" truncate>
              {sending() > 0 && !props.running ? t("Sending…") : t("the host's model is working")}
            </text>
          </Show>
        </box>
      </box>
      <Show when={sidebar()}>
        <RoomSidebar
          room={props.room}
          sessionID={props.sessionID}
          role={props.role}
          host={props.host}
          guest={props.guest?.name}
          home={props.home}
        />
      </Show>
    </box>
  )
}

const SIDEBAR_WIDTH = 42
// Below this the transcript needs the room more than the details do.
const SIDEBAR_FROM = 110
// The host's MCP servers connect and fail on their own; the list is read again this often.
const MCP_POLL_MS = 10_000

type McpRow = { name: string; status: "connected" | "pending" | "disabled" | "failed" | "needs_auth" }

// The right panel of a joined room. Server is the host's side: the session, its model and
// agent (a cohost picks them here), its cost, the room's DoD queue and the MCP servers the
// host's model can use. Client is this computer's side: its own MCP servers, which its own AI
// uses when it works with the room. The two sets differ, so they are not mixed in one list.
function RoomSidebar(props: {
  room: JoinedRoom
  sessionID: string
  role: keyof typeof ROLE
  host: string
  guest?: string
  home: ReturnType<typeof useData>
}) {
  const theme = useTheme()
  const data = useData()
  const dialog = useDialog()
  const toast = useToast()
  const t = useT()
  const remote = roomClient(props.room)
  const [tab, setTab] = createSignal<"server" | "client">("server")
  const [hover, setHover] = createSignal<string>()
  onMount(() => void data.session.sync(props.sessionID).catch(ignoreGuestUnavailable))
  const session = () => data.session.get(props.sessionID)
  const cohost = () => props.role === "cohost"
  const fail = (error: unknown) => toast.show({ message: errorMessage(error), variant: "error" })

  // Undefined while the first answer is out; null when the host is too old to share the list.
  const [hostMcp, setHostMcp] = createSignal<readonly McpRow[] | null>()
  onMount(() => {
    const read = () =>
      void remote.room.guest.mcp
        .list({ roomID: props.room.roomID })
        .then(setHostMcp)
        .catch(() => setHostMcp((current) => current ?? null))
    read()
    const timer = setInterval(read, MCP_POLL_MS)
    onCleanup(() => clearInterval(timer))
  })
  onMount(() => void props.home.location.mcp.server.sync().catch(() => undefined))
  const ownMcp = () =>
    (props.home.location.mcp.server.list() ?? []).map((item) => ({ name: item.name, status: item.status.status }))

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

  const tabButton = (id: "server" | "client", label: string) => (
    <HoverAction
      id={`room-sidebar:${id}`}
      paddingLeft={1}
      paddingRight={1}
      onMouseEnter={() => setHover(`tab:${id}`)}
      onMouseLeave={() => setHover()}
      onClick={() => setTab(id)}
    >
      <text
        fg={
          tab() === id
            ? theme.text.action.primary.selected
            : hover() === `tab:${id}`
              ? theme.text.action.secondary.hovered
              : theme.text.muted
        }
        attributes={tab() === id ? TextAttributes.BOLD | TextAttributes.UNDERLINE : undefined}
      >
        {label}
      </text>
    </HoverAction>
  )

  return (
    <box width={SIDEBAR_WIDTH} flexShrink={0} paddingTop={1} paddingBottom={1} backgroundColor={theme.background.raised.base}>
      <box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={1}>
        {tabButton("server", t("Server"))}
        <text fg={theme.text.muted}>│</text>
        {tabButton("client", t("Client"))}
      </box>
      <scrollbox flexGrow={1} minHeight={0} horizontalScrollbarOptions={{ visible: false }}>
        <Show
          when={tab() === "server"}
          fallback={
            <box gap={1} paddingLeft={2} paddingRight={2}>
              <box>
                {line(t("You"), props.guest ?? "—")}
                {line(t("Role"), t(ROLE[props.role]))}
              </box>
              <McpList title={t("Your MCP")} items={ownMcp()} empty={t("No MCP servers on this computer.")} />
              <text fg={theme.text.muted} wrapMode="word">
                {t("Your AI uses these when it works with the room; the host's model uses its own.")}
              </text>
            </box>
          }
        >
          <box gap={1} paddingLeft={2} paddingRight={2}>
            <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="word">
              {session()?.title || t("Untitled")}
            </text>
            <box>
              {line(t("Host"), props.host)}
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
            <Show
              when={hostMcp() !== null}
              fallback={
                <box>
                  <text fg={theme.text.base}>
                    <b>MCP</b>
                  </text>
                  <text fg={theme.text.muted} wrapMode="word">
                    {t("The host's version does not share its MCP servers yet.")}
                  </text>
                </box>
              }
            >
              <McpList title={t("Host MCP")} items={hostMcp() ?? []} empty={t("The host has no MCP servers.")} />
            </Show>
            <text fg={theme.text.muted} wrapMode="word">
              {cohost()
                ? t("Click the agent or model to change it; /command runs a host command.")
                : t("The host or a cohost picks the model and agent.")}
            </text>
          </box>
          {/* The room's work queue, the same rows the Multiplayer panel shows under the room. */}
          <box marginTop={1}>
            <RoomDodRows
              id={`room-sidebar:${props.room.roomID}`}
              indent={1}
              open
              disabledNote={t("DoD: the host has not set one up for this project.")}
              hover={hover}
              setHover={setHover}
              load={() => remote.room.guest.dod.get({ roomID: props.room.roomID })}
              take={(id) =>
                remote.room.guest.dod.claim(
                  id
                    ? { roomID: props.room.roomID, id, take: true }
                    : { roomID: props.room.roomID, next: true, take: true },
                )
              }
              submit={(id) => remote.room.guest.dod.submit({ roomID: props.room.roomID, id })}
              release={(id) => remote.room.guest.dod.claim({ roomID: props.room.roomID, id, take: false })}
              feed={(after, wait) => remote.room.guest.feed({ roomID: props.room.roomID, after, wait })}
            />
          </box>
        </Show>
      </scrollbox>
    </box>
  )
}

// One side's MCP servers, drawn like the session sidebar's MCP block.
function McpList(props: { title: string; items: readonly McpRow[]; empty: string }) {
  const theme = useTheme()
  const t = useT()
  const dot = (status: McpRow["status"]) => {
    if (status === "connected") return theme.text.feedback.success.base
    if (status === "failed") return theme.text.feedback.error.base
    if (status === "needs_auth") return theme.text.feedback.warning.base
    return theme.text.muted
  }
  const label: Record<McpRow["status"], string> = {
    connected: "Connected",
    pending: "Connecting",
    failed: "Error",
    disabled: "Disabled",
    needs_auth: "Sign in",
  }
  return (
    <box>
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <text fg={theme.text.base} flexShrink={0}>
          <b>{props.title}</b>
        </text>
        <Show when={props.items.length > 0}>
          <text fg={theme.text.muted} wrapMode="none">
            {t("{count}/{total} connected", {
              count: props.items.filter((item) => item.status === "connected").length,
              total: props.items.length,
            })}
          </text>
        </Show>
      </box>
      <Show when={props.items.length > 0} fallback={<text fg={theme.text.muted}>{props.empty}</text>}>
        <For each={props.items}>
          {(item) => (
            <box flexDirection="row" gap={1} minWidth={0}>
              <text flexShrink={0} fg={dot(item.status)}>
                •
              </text>
              <text fg={theme.text.base} wrapMode="none" truncate flexGrow={1} flexShrink={1} minWidth={0}>
                <b>{item.name}</b>
              </text>
              <text
                fg={item.status === "failed" ? theme.text.feedback.error.base : theme.text.muted}
                wrapMode="none"
                flexShrink={0}
              >
                {t(label[item.status])}
              </text>
            </box>
          )}
        </For>
      </Show>
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
