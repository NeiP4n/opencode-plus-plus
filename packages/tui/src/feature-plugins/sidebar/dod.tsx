import path from "node:path"
import { access } from "node:fs/promises"
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { useCompactLayout } from "../../ui/compact-layout"
import { useT } from "../../util/i18n"
import { HoverAction } from "../../component/hover-action"

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
}

type BoardState =
  | { type: "loading" }
  | { type: "missing" }
  | { type: "ready"; items: DodTask[] }
  | { type: "error"; reason: string }

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

  return leaves.flatMap((raw): DodTask[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
    const leaf = raw as Record<string, unknown>
    if (typeof leaf.id !== "string" || !leaf.id.trim()) return []
    const steps = Array.isArray(leaf.steps)
      ? leaf.steps.filter((step): step is string => typeof step === "string")
      : []
    return [
      {
        id: leaf.id.trim(),
        title: typeof leaf.what === "string" && leaf.what.trim() ? leaf.what.trim() : leaf.id.trim(),
        state: typeof leaf.task_state === "string" && leaf.task_state.trim() ? leaf.task_state.trim() : "NOT_STARTED",
        done: steps.filter((step) => /^\s*\[(x|X)\]/.test(step)).length,
        total: steps.length,
      },
    ]
  })
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
  const [hoveredAction, setHoveredAction] = createSignal<"open">()
  const actionHoverColor = () => theme.text.action?.primary?.hovered ?? theme.increase(actionColor, 2)
  let revision = 0

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
      const items = parseDodBoard(await file.text())
      if (current === revision) setBoard({ type: "ready", items })
    } catch (cause) {
      if (current !== revision) return
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
        <HoverAction
          id="sidebar.dod.preview-toggle"
          paddingLeft={0}
          paddingRight={0}
          onClick={() => setOpen((value) => !value)}
        >
          <text fg={actionColor}>{open() ? "▾" : "▸"}</text>
        </HoverAction>
        <box flexDirection="row" alignItems="center" gap={1} flexGrow={1} minWidth={0}>
          <box flexGrow={1} minWidth={0}>
            <text fg={actionColor} wrapMode="none" truncate>
              <b>{t("DoD")}</b>
            </text>
          </box>
          <text fg={theme.text.muted} wrapMode="none" truncate>
            {heading()}
          </text>
          <HoverAction
            id="sidebar.dod.open-button"
            paddingLeft={1}
            paddingRight={1}
            onMouseEnter={() => setHoveredAction("open")}
            onMouseLeave={() => setHoveredAction(undefined)}
            onClick={() => openDodPanel(props.context)}
          >
            <text fg={hoveredAction() === "open" ? actionHoverColor() : actionColor} wrapMode="none">
              {`[${t("Open")}] ↗`}
            </text>
          </HoverAction>
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
  const [board, setBoard] = createSignal<BoardState>({ type: "loading" })
  const [boardRoot, setBoardRoot] = createSignal<string>()
  let revision = 0

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
      const items = parseDodBoard(await file.text())
      if (current === revision) setBoard({ type: "ready", items })
    } catch (cause) {
      if (current !== revision) return
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
  const errorHeading = () => {
    const value = board()
    return value.type === "error" ? t("DoD read error: {reason}", { reason: value.reason }) : ""
  }

  const stateLabel = (state: string) => {
    const labels: Record<string, string> = {
      DONE: "Done",
      IN_PROGRESS: "In progress",
      BLOCKED: "Blocked",
      FAILED: "Failed",
      OUT_OF_SCOPE: "Out of scope",
      NOT_STARTED: "Not started",
    }
    return t(labels[state] ?? state)
  }

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0} padding={1} gap={1}>
      <box flexDirection="row" alignItems="center" gap={1}>
        <box flexGrow={1} minWidth={0} gap={1}>
          <text fg={theme.text.base}>
            <b>{t("Project DoD")}</b>
          </text>
          <Show when={boardRoot()}>
            {(root) => <text fg={theme.text.muted} wrapMode="none" truncate>{props.context.ui.format.path(root())}</text>}
          </Show>
        </box>
        <HoverAction id="dod.panel.close" paddingLeft={1} paddingRight={1} onClick={() => props.panel.close()}>
          <text fg={theme.text.action?.primary?.base ?? theme.text.base}>{t("Close")} ✕</text>
        </HoverAction>
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
        <box gap={1}>
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
        <box flexGrow={1} minHeight={0}>
          <scrollbox
            flexGrow={1}
            minHeight={0}
            verticalScrollbarOptions={{ visible: true }}
            horizontalScrollbarOptions={{ visible: false }}
          >
            <box gap={1} paddingRight={1}>
              <Show when={items().length === 0}>
                <text fg={theme.text.muted}>{t("No tasks yet")}</text>
              </Show>
              <For each={items()}>
                {(item) => (
                  <box
                    id={"dod.task." + item.id}
                    flexDirection="row"
                    alignItems="flex-start"
                    gap={1}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text fg={color(item.state)}>{MARK[item.state] ?? "·"}</text>
                    <box flexGrow={1} minWidth={0} gap={1}>
                      <text fg={theme.text.base} wrapMode="word">
                        <span style={{ fg: theme.text.muted }}>{item.id + " "}</span>
                        {item.title}
                      </text>
                      <text fg={color(item.state)}>{stateLabel(item.state)}</text>
                    </box>
                    <Show when={item.total > 0}>
                      <text fg={theme.text.muted} wrapMode="none">
                        {item.done}/{item.total} {t("steps")}
                      </text>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </scrollbox>
        </box>
      </Show>
    </box>
  )
}
