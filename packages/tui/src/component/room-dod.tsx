import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import type { RoomDod, RoomDodItem, RoomEvent, RoomFeed } from "@opencode/client/promise"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { Row } from "./panel-row"
import { HoverAction } from "./hover-action"

const FINISHED = new Set(["DONE", "OUT_OF_SCOPE"])
const MARK: Record<string, string> = { DONE: "✓", IN_PROGRESS: "●", BLOCKED: "!", FAILED: "✗", OUT_OF_SCOPE: "–" }
const BAR = 8
// How many of the room's latest events show under the DoD.
const FEED_SHOWN = 5
// An empty feed answer waits this long on the host for the next event.
const FEED_WAIT_MS = 20_000
const FEED_RETRY_MS = 5_000

type PanelState =
  | { type: "starting" }
  | { type: "ready" }
  | { type: "disabled" }
  | { type: "stale"; reason: string }
  | { type: "connection-error"; reason: string }
  | { type: "unknown"; reason: string }

// The shared project's Definition of Done under a room in the Multiplayer panel: the
// room's work queue, with who took each open item. A guest takes a free item or the next
// ready one, submits its own to the host's check and gives it back; the host frees an item
// a guest left behind. Finished items only count toward the bar, so a long DoD stays a
// short list. The room's latest events follow, and each one reloads the list at once.
// A project without a DoD shows nothing.
export function RoomDodRows(props: {
  id: string
  load: () => Promise<RoomDod>
  // Guests only; absent on the host, which frees instead of taking. Without an item, takes the next ready one.
  take?: (item?: string) => Promise<RoomDod>
  submit?: (item: string) => Promise<RoomDod>
  release: (item: string) => Promise<RoomDod>
  feed: (after: number, wait: number) => Promise<RoomFeed>
  hover: () => string | undefined
  setHover: (id: string | undefined) => void
}) {
  const theme = useTheme()
  const toast = useToast()
  const t = useT()
  const [items, setItems] = createSignal<readonly RoomDodItem[]>([])
  const [open, setOpen] = createSignal(false)
  const [armed, setArmed] = createSignal<string>()
  const [events, setEvents] = createSignal<readonly RoomEvent[]>([])
  const [status, setStatus] = createSignal<PanelState>({ type: "starting" })
  // Retain the last usable payload after a failed refresh, but never mark it as current.
  const [loadedAt, setLoadedAt] = createSignal<number>()
  let generation = 0
  const read = () => {
    const request = ++generation
    const projectID = props.id
    if (loadedAt() === undefined) setStatus({ type: "starting" })
    void Promise.resolve()
      .then(() => props.load())
      .then((dod) => {
        // A late response from the previous room/project must not overwrite the selected one.
        if (request !== generation || projectID !== props.id) return
        if (!dod || !Array.isArray(dod.items)) {
          setStatus({ type: "unknown", reason: "The service returned an invalid DoD response." })
          return
        }
        setItems(dod.items)
        setLoadedAt(Date.now())
        if (dod.status === "disabled") {
          setItems([])
          setStatus({ type: "disabled" })
          return
        }
        if (dod.status === "ready") {
          setStatus({ type: "ready" })
          return
        }
        // An older server may return items without a status. The data can be shown, but
        // the service state is unknown and must not be promoted to READY.
        setStatus({
          type: "unknown",
          reason: "The response omitted the explicit service state; it is not being treated as ready.",
        })
      })
      .catch((error: unknown) => {
        if (request !== generation || projectID !== props.id) return
        const reason = errorMessage(error)
        if (loadedAt() !== undefined) {
          setStatus({ type: "stale", reason })
        } else if (/service did not answer|state unknown|unknown state/i.test(reason)) {
          setStatus({ type: "unknown", reason })
        } else {
          setStatus({ type: "connection-error", reason })
        }
      })
  }

  createEffect(
    on(
      () => props.id,
      () => {
        generation++
        setItems([])
        setEvents([])
        setLoadedAt(undefined)
        setStatus({ type: "starting" })
        read()
      },
      { defer: false },
    ),
  )

  const statusText = () => {
    const current = status()
    if (current.type === "ready") return
    if (current.type === "starting") return t("DoD service is starting or checking the active project…")
    if (current.type === "disabled") return t("DoD is disabled for this project: .opencode/dod.yaml is missing.")
    if (current.type === "stale")
      return t("DoD response is stale; last response at {time}. Refresh failed: {reason}", {
        time: loadedAt() === undefined ? "unknown" : new Date(loadedAt()!).toLocaleTimeString(),
        reason: current.reason,
      })
    if (current.type === "connection-error") return t("DoD connection error: {reason}", { reason: current.reason })
    return t("DoD state unknown: {reason}", { reason: current.reason })
  }
  const showBoard = () =>
    status().type === "ready" || (items().length > 0 && ["stale", "unknown"].includes(status().type))

  onMount(() => {
    // Leases run out without an event, so the list still refreshes now and then.
    const timer = setInterval(read, 5000)
    const state = { alive: true, after: 0 }
    onCleanup(() => {
      clearInterval(timer)
      state.alive = false
      generation++
    })
    const follow = async () => {
      while (state.alive) {
        // A custom fetch or adapter may throw before it returns its Promise.
        const feed = await Promise.resolve()
          .then(() => props.feed(state.after, FEED_WAIT_MS))
          .catch(() => undefined)
        if (!state.alive) return
        if (!feed) {
          await Bun.sleep(FEED_RETRY_MS)
          continue
        }
        if (feed.events.length === 0) {
          // A host normally long-polls; back off if an adapter returns an empty feed immediately.
          await Bun.sleep(FEED_RETRY_MS)
          continue
        }
        // A host that restarted numbers its events anew, so its feed replaces what was shown.
        const fresh = feed.events[0].seq <= state.after
        state.after = feed.events.at(-1)!.seq
        setEvents((shown) => [...(fresh ? [] : shown), ...feed.events].slice(-FEED_SHOWN))
        read()
      }
    }
    void follow()
  })
  const act = (action: () => Promise<RoomDod>, done?: (dod: RoomDod) => void) =>
    void action()
      .then((dod) => {
        setItems(dod.items)
        done?.(dod)
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  const submitted = (item: string) => (dod: RoomDod) =>
    toast.show({
      message:
        dod.check?.exitCode === 0
          ? t("{item} passed the host's check", { item })
          : t("{item} failed the host's check (exit code {code})", { item, code: dod.check?.exitCode ?? "?" }),
      variant: dod.check?.exitCode === 0 ? "success" : "error",
    })
  const verb = (event: RoomEvent) => t(VERB[event.kind])

  const finished = () => items().filter((item) => FINISHED.has(item.state)).length
  const remaining = () => items().filter((item) => !FINISHED.has(item.state))
  const taken = () => items().filter((item) => item.owner && !item.stale && !FINISHED.has(item.state)).length
  const ready = () => items().some((item) => !FINISHED.has(item.state) && (!item.owner || item.stale) && !item.waits)
  const bar = () => {
    const filled = items().length === 0 ? 0 : Math.round((finished() / items().length) * BAR)
    return "█".repeat(filled) + "░".repeat(BAR - filled)
  }
  const color = (state: string) =>
    state === "DONE"
      ? theme.text.feedback.success.base
      : state === "IN_PROGRESS"
        ? theme.text.feedback.info.base
        : state === "BLOCKED"
          ? theme.text.feedback.warning.base
          : state === "FAILED"
            ? theme.text.feedback.error.base
            : theme.text.muted
  const actionId = (item: RoomDodItem) => `${props.id}:dod:${item.id}`

  return (
    <>
      <Show when={statusText()}>
        {(message) => (
          <box paddingLeft={6}>
            <text
              fg={
                status().type === "starting"
                  ? theme.text.muted
                  : status().type === "disabled"
                    ? theme.text.feedback.warning.base
                    : theme.text.feedback.error.base
              }
              wrapMode="word"
            >
              {message()}
            </text>
          </box>
        )}
      </Show>
      <Show when={showBoard()}>
        <Row id={`${props.id}:dod`} hover={props.hover} setHover={props.setHover} onClick={() => setOpen(!open())}>
          <text flexShrink={0} fg={theme.text.muted}>
            {open() ? "    ▾ " : "    ▸ "}
          </text>
          <box flexGrow={1} minWidth={0}>
            <text fg={theme.text.base} wrapMode="none" truncate>
              {t("DoD")}
              <span style={{ fg: theme.text.muted }}>
                {` ${finished()}/${items().length}`}
                {taken() > 0 ? ` · ${t("{count} taken", { count: taken() })}` : ""}
              </span>
              {/* Last, so a narrow panel cuts the bar before the numbers. */}
              <span style={{ fg: theme.text.feedback.success.base }}>{` ${bar()}`}</span>
            </text>
          </box>
          <Show when={props.take && ready()}>
            <HoverAction
              id={`${props.id}:dod:next`}
              onMouseEnter={() => props.setHover(`${props.id}:dod`)}
              onMouseLeave={() => props.setHover(`${props.id}:dod`)}
              onClick={() =>
                act(
                  () => props.take!(),
                  (dod) =>
                    dod.taken && toast.show({ message: t("{item} is yours", { item: dod.taken }), variant: "info" }),
                )
              }
            >
              <text fg={theme.text.action.primary.base}>{` ${t("next")}`}</text>
            </HoverAction>
          </Show>
        </Row>
        <Show when={open()}>
          <For each={remaining()}>
            {(item) => {
              const mine = () => item.mine === true
              const free = () => !item.owner || item.stale === true
              return (
                <box flexDirection="row" paddingLeft={7} paddingRight={1}>
                  <text flexShrink={0} fg={color(item.state)}>
                    {`${MARK[item.state] ?? "·"} `}
                  </text>
                  <box flexGrow={1} minWidth={0}>
                    <text fg={theme.text.base} wrapMode="none" truncate>
                      <span style={{ fg: theme.text.muted }}>{`${item.id} `}</span>
                      {item.what || item.id}
                      <span style={{ fg: theme.text.muted }}>{item.total > 0 ? ` ${item.done}/${item.total}` : ""}</span>
                    </text>
                  </box>
                  <Show when={item.stale && item.owner}>
                    <text flexShrink={0} fg={theme.text.muted}>
                      {` ${t("{name}, lease ran out", { name: item.owner ?? "" })}`}
                    </text>
                  </Show>
                  <Show
                    when={!free()}
                    fallback={
                      <Show
                        when={!item.waits}
                        fallback={
                          <text flexShrink={0} fg={theme.text.muted}>
                            {` ${t("waits for {items}", { items: item.waits?.join(", ") ?? "" })}`}
                          </text>
                        }
                      >
                        <Show when={props.take}>
                          {(take) => (
                            <HoverAction id={`${actionId(item)}:take`} onClick={() => act(() => take()(item.id))}>
                              <text fg={theme.text.action.primary.base}>{` ${t("take")}`}</text>
                            </HoverAction>
                          )}
                        </Show>
                      </Show>
                    }
                  >
                    <text flexShrink={0} fg={mine() ? theme.text.formfield.base : theme.text.muted}>
                      {` ${mine() ? t("you") : item.owner}`}
                    </text>
                    <Show when={mine() && item.verify ? props.submit : undefined}>
                      {(submit) => (
                        <HoverAction
                          id={`${actionId(item)}:submit`}
                          onClick={() => act(() => submit()(item.id), submitted(item.id))}
                        >
                          <text fg={theme.text.action.primary.base}>{` ${t("submit")}`}</text>
                        </HoverAction>
                      )}
                    </Show>
                    <Show when={mine() || !props.take}>
                      <HoverAction
                        id={`${actionId(item)}:release`}
                        onMouseLeave={() => setArmed()}
                        onClick={() => {
                          // Freeing another person's item needs a second click; giving back your own does not.
                          if (!mine() && armed() !== actionId(item)) return setArmed(actionId(item))
                          setArmed()
                          act(() => props.release(item.id))
                        }}
                      >
                        <text
                          fg={
                            armed() === actionId(item)
                              ? theme.text.action.destructive.focused
                              : theme.text.action.destructive.base
                          }
                        >
                          {armed() === actionId(item) ? ` ${t("free?")}` : mine() ? ` ${t("release")}` : " ×"}
                        </text>
                      </HoverAction>
                    </Show>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={items().length > 0 && remaining().length === 0}>
            <box paddingLeft={7} paddingRight={1}>
              <text fg={theme.text.feedback.success.base}>{t("Everything is done.")}</text>
            </box>
          </Show>
          <Show when={items().length === 0}>
            <box paddingLeft={7} paddingRight={1}>
              <text fg={theme.text.muted}>{t("The DoD file exists but contains no tasks.")}</text>
            </box>
          </Show>
          <For each={events()}>
            {(event) => (
              <box paddingLeft={7} paddingRight={1}>
                <text fg={theme.text.muted} wrapMode="none" truncate>
                  {`${new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} `}
                  <span style={{ fg: theme.text.base }}>{event.who === "host" ? t("host") : event.who}</span>
                  {` ${verb(event)}${event.item ? ` ${event.item}` : ""}${event.detail ? `: ${event.detail}` : ""}`}
                </text>
              </box>
            )}
          </For>
        </Show>
      </Show>
    </>
  )
}

const VERB: Record<RoomEvent["kind"], string> = {
  join: "joined",
  leave: "left",
  remove: "was removed",
  ban: "was banned",
  take: "took",
  release: "gave back",
  expire: "lost by lease",
  pass: "passed",
  fail: "failed",
  run: "ran",
}
