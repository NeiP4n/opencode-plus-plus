import path from "node:path"
import { access } from "node:fs/promises"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { useCompactLayout } from "../../ui/compact-layout"
import { useT } from "../../util/i18n"
import { hoverBackground } from "../../ui/hover"
import { useTheme } from "../../context/theme"

export const DOD_PANEL = "opencode.sidebar.dod"
const FILE = path.join(".opencode", "dod.yaml")
const FINISHED = new Set(["DONE", "OUT_OF_SCOPE"])

// Match the core's project-root rule: the nearest .git/.hg marker wins, otherwise
// the selected directory is a markerless project root.
async function exists(target: string) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

export async function resolveDodRoot(directory: string): Promise<string> {
  const original = path.resolve(directory)
  let current = original
  while (true) {
    if ((await exists(path.join(current, ".git"))) || (await exists(path.join(current, ".hg")))) return current
    const parent = path.dirname(current)
    if (parent === current) return original
    current = parent
  }
}
const MARK: Record<string, string> = {
  DONE: "✓",
  IN_PROGRESS: "●",
  BLOCKED: "!",
  FAILED: "✗",
  OUT_OF_SCOPE: "–",
  NOT_STARTED: "○",
}

export type DodTask = {
  id: string
  title: string
  state: string
  done: number
  total: number
  // The checklist, each step with its tick removed.
  steps: { text: string; done: boolean }[]
  // Who took the task in a room, when someone did.
  owner?: string
  // Tasks it depends on that are not finished yet.
  waits: string[]
}

type BoardState =
  { type: "loading" } | { type: "missing" } | { type: "ready"; items: DodTask[] } | { type: "error"; reason: string }

// Keep the sidebar's progress definition aligned with the project's DoD service:
// only explicitly finished or out-of-scope leaf tasks count as complete.
export function parseDodBoard(source: string): DodTask[] {
  const parsed: unknown = Bun.YAML.parse(source)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DoD must be a YAML mapping")
  }

  const leaves = (parsed as Record<string, unknown>).leaves
  if (leaves === undefined) return []
  if (!Array.isArray(leaves)) throw new Error("DoD leaves must be a list")

  const tasks = leaves.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
    const leaf = raw as Record<string, unknown>
    if (typeof leaf.id !== "string" || !leaf.id.trim()) return []
    const steps = (Array.isArray(leaf.steps) ? leaf.steps : [])
      .filter((step): step is string => typeof step === "string")
      .map((step) => ({ text: step.replace(/^\s*\[[ xX]\]\s*/, "").trim(), done: /^\s*\[(x|X)\]/.test(step) }))
    const depends = (Array.isArray(leaf.depends_on) ? leaf.depends_on : []).filter(
      (id): id is string => typeof id === "string" && id.trim() !== "",
    )
    return [
      {
        id: leaf.id.trim(),
        title: typeof leaf.what === "string" && leaf.what.trim() ? leaf.what.trim() : leaf.id.trim(),
        state: typeof leaf.task_state === "string" && leaf.task_state.trim() ? leaf.task_state.trim() : "NOT_STARTED",
        done: steps.filter((step) => step.done).length,
        total: steps.length,
        steps,
        ...(typeof leaf.owner === "string" && leaf.owner.trim() ? { owner: leaf.owner.trim() } : {}),
        depends,
      },
    ]
  })
  // A dependency the board does not list cannot hold a task back, as in the core's DoD.
  const states = new Map(tasks.map((task) => [task.id, task.state]))
  return tasks.map(({ depends, ...task }): DodTask => ({
    ...task,
    waits: depends.filter((id) => states.has(id) && !FINISHED.has(states.get(id)!)),
  }))
}

// A file caught mid-save, by an AI's edit tool or any writer without an atomic rename, reads as
// broken YAML for a moment. Read again shortly; only the same text failing twice is a real error.
const SETTLE = 250

export async function readDodBoard(file: string): Promise<DodTask[]> {
  const first = await Bun.file(file).text()
  try {
    return parseDodBoard(first)
  } catch (cause) {
    await Bun.sleep(SETTLE)
    const second = await Bun.file(file).text()
    if (second === first) throw cause
    return parseDodBoard(second)
  }
}

// What needs a look comes first: failed, blocked, in progress, then not started, with
// finished work last; tasks keep the file's order within each group.
const RANK: Record<string, number> = { FAILED: 0, BLOCKED: 1, IN_PROGRESS: 2, NOT_STARTED: 3, DONE: 4, OUT_OF_SCOPE: 5 }

export function orderDodTasks(items: readonly DodTask[]) {
  return items.toSorted((a, b) => (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3))
}

export type DodFilter = "active" | "all" | "done"

export function filterDodTasks(items: readonly DodTask[], filter: DodFilter) {
  const ordered = orderDodTasks(items)
  if (filter === "all") return ordered
  return ordered.filter((item) => FINISHED.has(item.state) === (filter === "done"))
}

export function summarizeDodBoard(items: readonly DodTask[]) {
  const finished = items.filter((item) => FINISHED.has(item.state)).length
  return {
    finished,
    total: items.length,
    percent: items.length === 0 ? 0 : Math.round((finished / items.length) * 100),
  }
}

export function openDodPanel(context: Pick<Plugin.Context, "ui">) {
  return context.ui.panel.open(DOD_PANEL)
}

// Project DoD in the session's right sidebar. It reads the same .opencode/dod.yaml
// that the orchestrator and room board use; this is a view, not a second task store.
export function SidebarDod(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const actionColor = theme.text.action?.primary?.base ?? theme.text.base
  const t = useT()
  const layout = useCompactLayout()
  const [board, setBoard] = createSignal<BoardState>({ type: "loading" })
  const [open, setOpen] = createSignal(false)
  const [hoveredAction, setHoveredAction] = createSignal<"open" | "toggle" | "close">()
  const actionHoverColor = () => theme.text.action?.primary?.hovered ?? theme.increase(actionColor, 2)
  let revision = 0
  let strike = false

  const directory = () =>
    props.context.data.session.get(props.sessionID)?.location?.directory ?? props.context.location?.directory

  const refresh = async (directory: string | undefined) => {
    const current = ++revision
    if (!directory) {
      setBoard({ type: "missing" })
      return
    }
    try {
      const root = await resolveDodRoot(directory)
      const file = Bun.file(path.join(root, FILE))
      if (!(await file.exists())) {
        if (current === revision) setBoard({ type: "missing" })
        return
      }
      const items = await readDodBoard(path.join(root, FILE))
      if (current === revision) setBoard({ type: "ready", items })
      strike = false
    } catch (cause) {
      if (current !== revision) return
      // One failed poll keeps the board people were looking at while the file is being rewritten;
      // the next poll decides.
      if (board().type === "ready" && !strike) {
        strike = true
        return
      }
      setBoard({ type: "error", reason: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  createEffect(() => void refresh(directory()))
  onMount(() => {
    const timer = setInterval(() => void refresh(directory()), 5_000)
    onCleanup(() => {
      revision++
      clearInterval(timer)
    })
  })

  const items = () => {
    const value = board()
    return value.type === "ready" ? value.items : []
  }
  const summary = () => summarizeDodBoard(items())
  const width = () => Math.max(6, Math.min(22, layout.sidebarWidth() - (layout.compact() ? 5 : 7)))
  const filled = () => Math.round((summary().percent / 100) * width())
  const heading = () => {
    const value = board()
    if (value.type === "loading") return t("Loading DoD…")
    if (value.type === "missing") return t("DoD file is missing")
    if (value.type === "error") return t("DoD read error: {reason}", { reason: value.reason })
    return `${summary().finished}/${summary().total} · ${summary().percent}%`
  }
  const color = (state: string) =>
    state === "DONE" || state === "OUT_OF_SCOPE"
      ? theme.text.feedback.success.base
      : state === "IN_PROGRESS"
        ? theme.text.feedback.info.base
        : state === "BLOCKED"
          ? theme.text.feedback.warning.base
          : state === "FAILED"
            ? theme.text.feedback.error.base
            : theme.text.muted

  return (
    <box gap={1}>
      <box flexDirection="row" alignItems="center" gap={1}>
        <box
          id="sidebar.dod.preview-toggle"
          flexShrink={0}
          backgroundColor={hoveredAction() === "toggle" ? hoverBackground(theme) : undefined}
          onMouseOver={() => setHoveredAction("toggle")}
          onMouseOut={() => setHoveredAction(undefined)}
          onMouseUp={(event) => {
            event.stopPropagation()
            setOpen((value) => !value)
          }}
        >
          <text fg={hoveredAction() === "toggle" ? actionHoverColor() : actionColor}>{open() ? "▾" : "▸"}</text>
        </box>
        <box flexDirection="row" alignItems="center" gap={1} flexGrow={1} minWidth={0}>
          <box flexGrow={1} minWidth={0}>
            <text fg={actionColor} wrapMode="none" truncate>
              <b>{t("DoD")}</b>
            </text>
          </box>
          <text fg={theme.text.muted} wrapMode="none" truncate>
            {heading()}
          </text>
          <box
            id="sidebar.dod.open-button"
            flexShrink={0}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={hoveredAction() === "open" ? hoverBackground(theme) : undefined}
            onMouseOver={() => setHoveredAction("open")}
            onMouseOut={() => setHoveredAction(undefined)}
            onMouseUp={(event) => {
              event.stopPropagation()
              openDodPanel(props.context)
            }}
          >
            <text fg={hoveredAction() === "open" ? actionHoverColor() : actionColor} wrapMode="none">
              {`[${t("Open")}] ↗`}
            </text>
          </box>
        </box>
      </box>

      <Show when={board().type === "ready"}>
        <text id="sidebar.dod.progress" wrapMode="none">
          <span style={{ fg: theme.text.feedback.success.base }}>{"█".repeat(filled())}</span>
          <span style={{ fg: theme.text.muted }}>{"░".repeat(Math.max(0, width() - filled()))}</span>
        </text>
      </Show>

      <Show when={open()}>
        <Show when={board().type === "loading"}>
          <text fg={theme.text.muted}>{t("Loading DoD…")}</text>
        </Show>
        <Show when={board().type === "missing"}>
          <text fg={theme.text.muted}>{t("DoD file is missing")}</text>
        </Show>
        <Show when={board().type === "error"}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {heading()}
          </text>
        </Show>
        <Show when={board().type === "ready"}>
          <Show when={items().length === 0}>
            <text fg={theme.text.muted}>{t("No tasks yet")}</text>
          </Show>
          <For each={items()}>
            {(item) => (
              <box flexDirection="row" alignItems="center" gap={1}>
                <text fg={color(item.state)}>{MARK[item.state] ?? "·"}</text>
                <box flexGrow={1} minWidth={0}>
                  <text fg={theme.text.base} wrapMode="none" truncate>
                    <span style={{ fg: theme.text.muted }}>{item.id} </span>
                    {item.title}
                  </text>
                </box>
                <Show when={item.total > 0}>
                  <text fg={theme.text.muted} wrapMode="none">
                    {item.done}/{item.total}
                  </text>
                </Show>
              </box>
            )}
          </For>
        </Show>
      </Show>
    </box>
  )
}

/**
 * Full task-board view opened from the session sidebar. It deliberately reads the
 * exact same project DoD file and uses the same parser/progress rules as the compact
 * sidebar view; it is a larger presentation, not a second task store.
 */
export function SidebarDodPanel(props: { context: Plugin.Context; panel: PanelInput }) {
  const theme = props.context.theme
  const t = useT()
  const [closeHovered, setCloseHovered] = createSignal(false)
  const closeHoverColor = () =>
    theme.text.action?.primary?.hovered ?? theme.increase(theme.text.action?.primary?.base ?? theme.text.base, 2)
  const [board, setBoard] = createSignal<BoardState>({ type: "loading" })
  const [boardRoot, setBoardRoot] = createSignal<string>()
  let revision = 0
  let strike = false

  const directory = () =>
    props.context.data.session.get(props.panel.sessionID)?.location?.directory ?? props.context.location?.directory

  const refresh = async (directory: string | undefined) => {
    const current = ++revision
    if (!directory) {
      setBoardRoot(undefined)
      setBoard({ type: "missing" })
      return
    }
    try {
      const root = await resolveDodRoot(directory)
      if (current !== revision) return
      setBoardRoot(root)
      const file = Bun.file(path.join(root, FILE))
      if (!(await file.exists())) {
        if (current === revision) setBoard({ type: "missing" })
        return
      }
      const items = await readDodBoard(path.join(root, FILE))
      if (current === revision) setBoard({ type: "ready", items })
      strike = false
    } catch (cause) {
      if (current !== revision) return
      // One failed poll keeps the board people were looking at while the file is being rewritten;
      // the next poll decides.
      if (board().type === "ready" && !strike) {
        strike = true
        return
      }
      setBoard({ type: "error", reason: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  createEffect(() => void refresh(directory()))
  onMount(() => {
    const timer = setInterval(() => void refresh(directory()), 5_000)
    onCleanup(() => {
      revision++
      clearInterval(timer)
    })
  })

  const items = () => {
    const value = board()
    return value.type === "ready" ? value.items : []
  }
  const summary = () => summarizeDodBoard(items())
  const barWidth = () => Math.max(8, Math.min(40, props.panel.width - 8))
  const filled = () => Math.round((summary().percent / 100) * barWidth())
  const errorHeading = () => {
    const value = board()
    return value.type === "error" ? t("DoD read error: {reason}", { reason: value.reason }) : ""
  }

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0} padding={1} gap={1}>
      {/* The header and the summary keep their height: squeezed by the task list below, the
          progress line would be drawn over the close control and it could not be clicked. */}
      <box flexDirection="row" alignItems="flex-start" gap={1} flexShrink={0}>
        <box flexGrow={1} minWidth={0} gap={1}>
          <text fg={theme.text.base}>
            <b>{t("Project DoD")}</b>
          </text>
          <Show when={boardRoot()}>
            {(root) => (
              <text fg={theme.text.muted} wrapMode="none" truncate>
                {props.context.ui.format.path(root())}
              </text>
            )}
          </Show>
        </box>
        <box flexShrink={0}>
          <box
            id="dod.panel.close"
            flexShrink={0}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={closeHovered() ? hoverBackground(theme) : undefined}
            onMouseOver={() => setCloseHovered(true)}
            onMouseOut={() => setCloseHovered(false)}
            onMouseUp={(event) => {
              event.stopPropagation()
              props.panel.close()
            }}
          >
            <text fg={closeHovered() ? closeHoverColor() : (theme.text.action?.primary?.base ?? theme.text.base)}>
              {t("Close")} ✕
            </text>
          </box>
        </box>
      </box>

      <Show when={board().type === "loading"}>
        <text fg={theme.text.muted}>{t("Loading DoD…")}</text>
      </Show>
      <Show when={board().type === "missing"}>
        <text fg={theme.text.muted}>{t("DoD file is missing")}</text>
      </Show>
      <Show when={board().type === "error"}>
        <text fg={theme.text.feedback.error.base} wrapMode="word">
          {errorHeading()}
        </text>
      </Show>
      <Show when={board().type === "ready"}>
        <box gap={1} flexShrink={0}>
          <box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
            <text fg={theme.text.base}>{t("Progress")}</text>
            <text fg={theme.text.feedback.success.base}>
              {summary().finished}/{summary().total} · {summary().percent}%
            </text>
          </box>
          <text id="dod.panel.progress" wrapMode="none">
            <span style={{ fg: theme.text.feedback.success.base }}>{"█".repeat(filled())}</span>
            <span style={{ fg: theme.text.muted }}>{"░".repeat(Math.max(0, barWidth() - filled()))}</span>
          </text>
          <box flexDirection="row" gap={2}>
            <text fg={theme.text.feedback.info.base}>
              {t("In progress")}: {items().filter((item) => item.state === "IN_PROGRESS").length}
            </text>
            <text fg={theme.text.feedback.warning.base}>
              {t("Blocked")}: {items().filter((item) => item.state === "BLOCKED").length}
            </text>
            <text fg={theme.text.feedback.error.base}>
              {t("Failed")}: {items().filter((item) => item.state === "FAILED").length}
            </text>
          </box>
        </box>
        <DodTaskList items={items()} />
      </Show>
    </box>
  )
}

// The task list both DoD panels show: active work first, a filter between active, all and
// finished tasks, and a task that opens on click to show its checklist, holder and blockers.
export function DodTaskList(props: { items: readonly DodTask[] }) {
  const theme = useTheme()
  const t = useT()
  const [filter, setFilter] = createSignal<DodFilter>("active")
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())
  const shown = createMemo(() => filterDodTasks(props.items, filter()))
  const count = (value: DodFilter) => filterDodTasks(props.items, value).length
  const toggle = (id: string) =>
    setOpened((current) =>
      current.has(id) ? new Set([...current].filter((item) => item !== id)) : new Set(current).add(id),
    )
  const empty = () =>
    props.items.length === 0
      ? t("No tasks yet")
      : filter() === "active"
        ? t("Every task is finished")
        : t("Nothing finished yet")

  return (
    <box flexGrow={1} minHeight={0} gap={1}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <For each={["active", "all", "done"] as const}>
          {(value) => (
            <DodFilterChip
              text={`${t(FILTER_LABEL[value])} ${count(value)}`}
              selected={filter() === value}
              onClick={() => setFilter(value)}
            />
          )}
        </For>
      </box>
      <scrollbox
        flexGrow={1}
        minHeight={0}
        verticalScrollbarOptions={{ visible: true }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <box gap={1} paddingRight={1}>
          <Show when={shown().length === 0}>
            <text fg={theme.text.muted}>{empty()}</text>
          </Show>
          <For each={shown()}>
            {(item) => <DodTaskRow item={item} open={opened().has(item.id)} onToggle={() => toggle(item.id)} />}
          </For>
        </box>
      </scrollbox>
    </box>
  )
}

const FILTER_LABEL: Record<DodFilter, string> = { active: "Unfinished", all: "All", done: "Finished" }

const STATE_LABEL: Record<string, string> = {
  DONE: "Done",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  FAILED: "Failed",
  OUT_OF_SCOPE: "Out of scope",
  NOT_STARTED: "Not started",
}

function useStateColor() {
  const theme = useTheme()
  return (state: string) =>
    state === "DONE" || state === "OUT_OF_SCOPE"
      ? theme.text.feedback.success.base
      : state === "IN_PROGRESS"
        ? theme.text.feedback.info.base
        : state === "BLOCKED"
          ? theme.text.feedback.warning.base
          : state === "FAILED"
            ? theme.text.feedback.error.base
            : theme.text.muted
}

function DodFilterChip(props: { text: string; selected: boolean; onClick: () => void }) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        props.selected
          ? theme.background.action.primary.selected
          : hovered()
            ? hoverBackground(theme)
            : theme.background.base
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        props.onClick()
      }}
    >
      <text
        fg={
          props.selected
            ? theme.text.action.primary.selected
            : hovered()
              ? theme.text.action.primary.hovered
              : theme.text.muted
        }
        selectable={false}
        wrapMode="none"
      >
        {props.text}
      </text>
    </box>
  )
}

function DodTaskRow(props: { item: DodTask; open: boolean; onToggle: () => void }) {
  const theme = useTheme()
  const t = useT()
  const color = useStateColor()
  const [hovered, setHovered] = createSignal(false)
  const details = () => props.item.steps.length > 0 || props.item.owner !== undefined || props.item.waits.length > 0

  return (
    <box gap={0} paddingLeft={1} paddingRight={1}>
      <box
        id={"dod.task." + props.item.id}
        flexDirection="row"
        alignItems="flex-start"
        gap={1}
        backgroundColor={hovered() && details() ? hoverBackground(theme) : undefined}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={(event) => {
          event.stopPropagation()
          if (details()) props.onToggle()
        }}
      >
        <text fg={color(props.item.state)} flexShrink={0} selectable={false}>
          {MARK[props.item.state] ?? "·"}
        </text>
        <box flexGrow={1} minWidth={0}>
          <text fg={theme.text.base} wrapMode="word">
            <span style={{ fg: theme.text.muted }}>{props.item.id + " "}</span>
            {props.item.title}
          </text>
        </box>
        <Show when={props.item.total > 0}>
          <text fg={theme.text.muted} wrapMode="none" flexShrink={0} selectable={false}>
            {`${props.item.done}/${props.item.total}`}
          </text>
        </Show>
        <text fg={theme.text.muted} flexShrink={0} selectable={false}>
          {details() ? (props.open ? "▾" : "▸") : " "}
        </text>
      </box>
      <Show when={props.open}>
        <box paddingLeft={2} paddingTop={1} gap={0}>
          <text fg={color(props.item.state)}>
            {t(STATE_LABEL[props.item.state] ?? props.item.state)}
            <Show when={props.item.owner}>
              {(owner) => (
                <span style={{ fg: theme.text.muted }}>{` · ${t("taken by {name}", { name: owner() })}`}</span>
              )}
            </Show>
          </text>
          <Show when={props.item.waits.length > 0}>
            <text fg={theme.text.feedback.warning.base} wrapMode="word">
              {t("Waits for {items}", { items: props.item.waits.join(", ") })}
            </text>
          </Show>
          <For each={props.item.steps}>
            {(step) => (
              <box flexDirection="row" gap={1}>
                <text fg={step.done ? theme.text.feedback.success.base : theme.text.muted} flexShrink={0}>
                  {step.done ? "✓" : "○"}
                </text>
                <box flexGrow={1} minWidth={0}>
                  <text fg={step.done ? theme.text.muted : theme.text.base} wrapMode="word">
                    {step.text}
                  </text>
                </box>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
