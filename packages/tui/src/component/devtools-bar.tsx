import { CliRenderEvents, TextAttributes, type Renderable } from "@opentui/core"
import { TimeToFirstDraw, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { open } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX, type ParentProps } from "solid-js"
import { useClient } from "../context/client"
import { useConfig } from "../config"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useRoute } from "../context/route"
import { Keymap } from "../context/keymap"
import { useTheme, useThemes } from "../context/theme"
import { hoverBackground } from "../ui/hover"
import { useClipboard } from "../context/clipboard"
import { useTuiPaths } from "../context/runtime"
import { DialogHelp } from "../ui/dialog-help"
import { CommandPaletteDialog } from "./command-palette"
import { DevTools } from "../devtools"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { PanelBox, PanelTitle, Row } from "./devtools-panel"
import { RegistryPanel } from "./devtools-registry"
import { openProjectDialog } from "./dialog-project"
import { openTeamEditor } from "./dialog-teams"
import { useProjects } from "../context/projects"
import { DialogExperiments } from "./dialog-experiments"
import { DialogIdeaBank } from "./dialog-idea-bank"
import { ProjectFacts, useProjectFacts } from "./project-facts"
import { explainSelection, QuickHelp, quickMode, setQuickMode, type QuickMode } from "./quick-help"
import { usePromptRef } from "../context/prompt"
import { usePlugin } from "../plugin/context"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { stringWidth } from "../util/string-width"

const graphWidth = 23
const sampleIntervalMilliseconds = 2_000
const sampleRetentionMilliseconds = 30_000
const statusWindowMilliseconds = 6_000
type Panel = "server" | "theme" | "tools" | "ui"
type ProcessSample = Readonly<{ cpu: number; memory: number; delay: number; time: number }>
export type RuntimeStatus = "normal" | "medium" | "high"

export function DevToolsBar() {
  const client = useClient()
  const config = useConfig()
  const dialog = useDialog()
  const promptRef = usePromptRef()
  const toast = useToast()
  const projects = useProjects()
  const data = useData()
  const location = useLocation()
  const route = useRoute()
  const plugins = usePlugin()
  const themes = useThemes()
  const keymap = Keymap.use()
  const t = useT()
  const [facts, updateFacts] = useProjectFacts()
  const clipboard = useClipboard()
  const paths = useTuiPaths()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const { current: theme, mode, supports, setMode } = themes
  const elevatedTheme = useTheme()
  const [panel, setPanel] = createSignal<Panel>()
  const [dumping, setDumping] = createSignal(false)
  const [dumpPath, setDumpPath] = createSignal<string>()
  const [dumpError, setDumpError] = createSignal<string>()
  const [frontendSamples, setFrontendSamples] = createSignal<readonly ProcessSample[]>([])
  const [debugOverlay, setDebugOverlay] = createSignal(renderer.debugOverlay.enabled)
  let focus: Renderable | null
  const connected = createMemo(() => client.connection.status() === "connected")
  const serverIndicator = createMemo(() => connectionIndicator(client.connection.status(), client.connection.attempt()))
  const themePerformance = createMemo(
    () => DevTools.data().find((group) => group.id === "theme-performance")?.entries ?? [],
  )
  const groups = createMemo(() => DevTools.data().filter((group) => group.id !== "theme-performance"))
  const [server] = createResource(connected, async () => {
    const info = await client.api.server.info()
    return {
      health: info,
      address: info.urls[0] ? new URL(info.urls[0]).host : "Unknown",
    }
  })
  const close = () => {
    setPanel()
    setTimeout(() => {
      if (panel() || !focus || focus.isDestroyed) return
      focus.focus()
      focus = null
    }, 1)
  }
  const toggle = (next: Panel) => {
    if (panel() === next) return close()
    if (!panel()) {
      focus = renderer.currentFocusedRenderable
      focus?.blur()
    }
    setPanel(next)
  }
  const nextMode = () => (mode() === "dark" ? "light" : "dark")
  const canSwitchMode = () => supports(nextMode())
  const runtime = createMemo(() => runtimeStatus(frontendSamples()))
  const timing = () => config.data.debug?.timing ?? false
  const turnTokens = () => config.data.debug?.turn_tokens ?? false
  const verboseTurnTokens = () => turnTokens() === "verbose"

  const offEscape = keymap.intercept(
    "key",
    ({ event }) => {
      if (!panel() || keymap.mode.current() !== "base") return
      if (event.name !== "escape" && !(event.ctrl && event.name === "c")) return
      if (renderer.getSelection()?.getSelectedText()) {
        if ((config.data.terminal?.copy ?? (process.platform === "win32" ? "manual" : "select")) !== "select") return
        renderer.clearSelection()
        event.preventDefault()
        event.stopPropagation()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      close()
    },
    { priority: 10 },
  )
  onCleanup(offEscape)

  const onDebugOverlayToggle = (enabled: boolean) => setDebugOverlay(enabled)
  renderer.on(CliRenderEvents.DEBUG_OVERLAY_TOGGLE, onDebugOverlayToggle)
  onCleanup(() => renderer.off(CliRenderEvents.DEBUG_OVERLAY_TOGGLE, onDebugOverlayToggle))

  // Pressing Explain starts a new (empty) selection on the bar, so the last non-empty one is kept here.
  let selected = ""
  const onSelection = (selection: { getSelectedText(): string } | null) => {
    const text = selection?.getSelectedText() ?? ""
    if (text.trim()) selected = text
  }
  renderer.on(CliRenderEvents.SELECTION, onSelection)
  onCleanup(() => renderer.off(CliRenderEvents.SELECTION, onSelection))
  // The windows share the corner above the bar, so opening one closes the others.
  const toggleQuick = (next: QuickMode) => {
    if (quickMode() === next) return setQuickMode()
    if (facts.open) void updateFacts((draft) => void (draft.open = false)).catch(toast.error)
    if (next === "explain") return explainSelection(renderer.getSelection()?.getSelectedText() || selected)
    setQuickMode(next)
  }

  onMount(() => {
    const eventLoop = monitorEventLoopDelay({ resolution: 20 })
    let frontendCPU = process.cpuUsage()
    let frontendTime = performance.now()
    let frontendReady = false
    eventLoop.enable()
    const sample = () => {
      const now = performance.now()
      const cpu = process.cpuUsage(frontendCPU)
      frontendCPU = process.cpuUsage()
      setFrontendSamples((samples) =>
        [
          ...samples,
          {
            cpu: frontendReady ? cpuPercent(cpu.user + cpu.system, now - frontendTime) : 0,
            memory: process.memoryUsage().rss,
            delay: eventLoop.percentile(99) / 1_000_000,
            time: now,
          },
        ].filter((sample) => sample.time >= now - sampleRetentionMilliseconds),
      )
      eventLoop.reset()
      frontendReady = true
      frontendTime = now
    }
    sample()
    const timer = setInterval(sample, sampleIntervalMilliseconds)
    onCleanup(() => {
      clearInterval(timer)
      eventLoop.disable()
    })
  })

  // Everything a bug report or a shell next to opencode usually asks for, one click away.
  const copies = createMemo(() =>
    [
      { label: "Session ID", value: route.data.type === "session" ? route.data.sessionID : undefined },
      { label: "Directory", value: location.current?.directory },
      { label: "Server address", value: server()?.health.urls[0] },
      { label: "Config file", value: config.path },
      { label: "State directory", value: paths.state },
    ].filter((item): item is { label: string; value: string } => Boolean(item.value)),
  )
  const copy = (label: string, value: string) =>
    clipboard
      .write(value)
      .then(() => toast.show({ message: t("{name} copied", { name: t(label) }), variant: "success" }))
      .catch(toast.error)
  const openDialog = (view: () => JSX.Element) => {
    close()
    dialog.replace(view)
  }
  const openIdeaBank = () => {
    close()
    dialog.replace(() => <DialogIdeaBank prompt={promptRef} />, undefined, { size: "xlarge" })
    dialog.setCentered(true)
  }
  const reload = () => {
    close()
    toast.show({ variant: "info", message: t("Reloading configuration…"), duration: 30000 })
    void client.api.location
      .reload()
      .then(() => toast.show({ variant: "success", message: t("Configuration reloaded") }))
      .catch(toast.error)
  }

  async function dump() {
    setDumping(true)
    setDumpPath()
    setDumpError()
    const routeData = route.data
    const sessionID = routeData.type === "session" ? routeData.sessionID : undefined
    const info = sessionID ? data.session.get(sessionID) : undefined
    const sessionLocation = info?.location ?? (location.current ? { directory: location.current.directory } : undefined)
    const details = server()
    const backend = {
      connected: connected(),
      version: details?.health.version,
      pid: details?.health.pid,
      error: client.connection.error(),
    }
    const events = await (sessionID
      ? (async () => {
          const events: { readonly created: number }[] = []
          for await (const event of client.api.session.log({ sessionID, follow: false })) {
            if (event.type !== "log.synced") events.push(event)
          }
          // Durable events stay in aggregate order even when their wall-clock timestamps differ.
          client.connection.internal.history().forEach((event) => {
            const index = events.findIndex((item) => item.created > event.created)
            if (index === -1) {
              events.push(event)
              return
            }
            events.splice(index, 0, event)
          })
          return events.slice(-100)
        })().catch(() => client.connection.internal.history())
      : Promise.resolve([]))
    const file = path.join(tmpdir(), `opencode-debug-${crypto.randomUUID()}.json`)
    const output =
      JSON.stringify(
        {
          backend,
          session: sessionID
            ? {
                ...info,
                id: sessionID,
                projectID: info?.projectID ?? location.current?.project.id,
                location: sessionLocation,
                status: data.session.status(sessionID),
                pending: data.session.pending.list(sessionID),
                inboxIDs: data.session.input.list(sessionID),
                permissions: data.session.permission.list(sessionID) ?? [],
                forms: data.session.form.list(sessionID) ?? [],
              }
            : undefined,
          events,
          mcp: {
            servers: sessionLocation
              ? (data.location.mcp.server.list(sessionLocation) ?? [])
              : (data.location.mcp.server.list() ?? []),
            resources: sessionLocation
              ? (data.location.mcp.resource.list(sessionLocation) ?? [])
              : (data.location.mcp.resource.list() ?? []),
          },
          plugins: {
            ready: plugins.ready(),
            list: plugins.list().map((plugin) => ({
              name: "id" in plugin ? plugin.id : plugin.target,
              ...plugin,
            })),
          },
          theme: {
            name: themes.selected,
            mode: themes.mode(),
          },
        },
        null,
        2,
      ) + "\n"
    await open(file, "wx", 0o600)
      .then((handle) => handle.writeFile(output).finally(() => handle.close()))
      .then(
        () => setDumpPath(file),
        (error) => setDumpError(errorMessage(error)),
      )
    setDumping(false)
  }

  // A phone-width terminal cannot fit every item, and an item past the edge is unreachable. The
  // ones with their own commands (/themes, /teams, /tools…) fold away first, in this order.
  const hidden = createMemo(() => {
    const label = (text: string) => stringWidth(text) + 2
    const widths: Record<string, number> = {
      experiments: label(t("Experiments")),
      theme: label(t("Theme")),
      ui: label(`○ ${t("UI")}`),
      teams: label(t("Teams")),
      tools: label(t("Tools")),
      registry: label(t("Registry")),
    }
    const fixed =
      label(`✓ ${t("Server")}`) +
      label(`✦ ${t("Ideas")}`) +
      label(`${t("Language")} EN`) +
      label(t("Facts")) +
      label(t("Explain")) +
      label(t("Essence")) +
      label(t("Chat")) +
      (projects.loaded() && projects.list().length === 0 ? label(t("+ Project")) : 0)
    const total = fixed + Object.values(widths).reduce((sum, width) => sum + width, 0)
    return Object.keys(widths).reduce(
      (fold, id) => {
        if (fold.width <= dimensions().width) return fold
        fold.ids.add(id)
        return { ids: fold.ids, width: fold.width - widths[id]! }
      },
      { ids: new Set<string>(), width: total },
    ).ids
  })

  return (
    <box height={1} flexShrink={0} flexDirection="row" backgroundColor={theme.decrease(theme.background.base)}>
      <Show when={panel()}>
        <box
          position="absolute"
          zIndex={2400}
          left={0}
          bottom={1}
          width={dimensions().width}
          height={Math.max(0, dimensions().height - 1)}
          backgroundColor="transparent"
          onMouseUp={close}
        />
      </Show>
      <BarItem active={panel() === "server"} onClick={() => toggle("server")}>
        <text
          fg={
            panel() === "server"
              ? theme.text.action.primary.focused
              : serverIndicator().state === "connected"
                ? theme.text.feedback.success.base
                : serverIndicator().state === "disconnected"
                  ? theme.text.feedback.error.base
                  : theme.text.base
          }
        >
          {serverIndicator().icon}
        </text>
        <text
          fg={
            panel() === "server"
              ? theme.text.action.primary.focused
              : serverIndicator().state === "disconnected"
                ? theme.text.feedback.error.base
                : theme.text.muted
          }
        >
          {" " + t("Server")}
        </text>
        <Show when={panel() === "server"}>
          <PanelBox>
            <PanelTitle>{t("Server")}</PanelTitle>
            <Row label={t("Status")} value={connected() ? t("Connected") : client.connection.status()} />
            <Show when={client.connection.attempt() > 0}>
              <Row label={t("Reconnect")} value={String(client.connection.attempt())} />
            </Show>
            <Show when={client.connection.error()}>{(error) => <Row label={t("Last error")} value={error()} />}</Show>
            <Show when={server()}>
              {(value) => (
                <>
                  <Row label={t("Version")} value={value().health.version} />
                  <Row label="PID" value={String(value().health.pid)} />
                  <Row label={t("Address")} value={value().address} />
                </>
              )}
            </Show>
            <Show when={server.error}>
              <text fg={elevatedTheme.text.feedback.error.base}>{t("Server details unavailable")}</text>
            </Show>
          </PanelBox>
        </Show>
      </BarItem>
      <BarItem active={false} onClick={openIdeaBank}>
        <text fg={theme.text.muted}>✦ {t("Ideas")}</text>
      </BarItem>
      <BarItem hidden={hidden().has("ui")} active={panel() === "ui"} onClick={() => toggle("ui")}>
        <text
          fg={
            panel() === "ui"
              ? theme.text.action.primary.focused
              : runtime() === "high"
                ? theme.text.feedback.error.base
                : theme.text.muted
          }
        >
          {statusIcon(runtime())}
        </text>
        <text
          fg={
            panel() === "ui"
              ? theme.text.action.primary.focused
              : runtime() === "high"
                ? theme.text.feedback.error.base
                : theme.text.muted
          }
        >
          {" " + t("UI")}
        </text>
        <Show when={panel() === "ui"}>
          <PanelBox>
            <PanelTitle>{t("UI")}</PanelTitle>
            <Row label={t("Status")} value={runtime()} />
            <ProcessStat
              label={t("Loop")}
              values={frontendSamples().map((sample) => sample.delay)}
              unit=" ms"
              decimals={1}
            />
            <ProcessStat label="CPU" values={frontendSamples().map((sample) => sample.cpu)} unit="%" />
            <ProcessStat
              label={t("Memory")}
              values={frontendSamples().map((sample) => sample.memory / 1024 / 1024)}
              unit=" MB"
              decimals={0}
            />
            <Action onClick={() => renderer.toggleDebugOverlay()} hoverBackground>
              {debugOverlay() ? "[x]" : "[ ]"} {t("Debug overlay")}
            </Action>
          </PanelBox>
        </Show>
      </BarItem>
      <BarItem hidden={hidden().has("theme")} active={panel() === "theme"} onClick={() => toggle("theme")}>
        <text fg={panel() === "theme" ? theme.text.action.primary.focused : theme.text.muted}>{t("Theme")}</text>
        <Show when={panel() === "theme"}>
          <PanelBox>
            <PanelTitle>{t("Theme")}</PanelTitle>
            <Row label={t("Name")} value={themes.selected} />
            <Row label={t("Mode")} value={mode()} />
            <For each={themePerformance()}>{(entry) => <Row label={entry.key} value={String(entry.value)} />}</For>
            <Show when={canSwitchMode()}>
              <Action onClick={() => setMode(nextMode())} hoverBackground>
                {t("Switch to {mode}", { mode: nextMode() })}
              </Action>
            </Show>
          </PanelBox>
        </Show>
      </BarItem>
      <BarItem hidden={hidden().has("tools")} active={panel() === "tools"} onClick={() => toggle("tools")}>
        <text fg={panel() === "tools" ? theme.text.action.primary.focused : theme.text.muted}>{t("Tools")}</text>
        <Show when={panel() === "tools"}>
          <PanelBox>
            <PanelTitle>{t("Tools")}</PanelTitle>
            <Action onClick={() => void dump()} disabled={dumping()} hoverBackground>
              {dumping() ? t("Writing debug snapshot…") : t("Write debug snapshot")}
            </Action>
            <Show when={dumpPath()}>
              {(file) => (
                <Action onClick={() => void copy("Snapshot path", file())} hoverBackground>
                  {t("Copy {file}", { file: file() })}
                </Action>
              )}
            </Show>
            <Show when={dumpError()}>
              {(error) => (
                <text fg={elevatedTheme.text.feedback.error.base} wrapMode="word">
                  {error()}
                </text>
              )}
            </Show>
            <Action onClick={reload} hoverBackground>
              {t("Reload configuration")}
            </Action>
            <Action onClick={() => openDialog(() => <CommandPaletteDialog />)} hoverBackground>
              {t("Command palette")}
            </Action>
            <Action onClick={() => openDialog(() => <DialogHelp />)} hoverBackground>
              {t("Keyboard shortcuts")}
            </Action>
            <box marginTop={1}>
              <text fg={elevatedTheme.text.base} attributes={TextAttributes.BOLD}>
                {t("Copy")}
              </text>
              <For each={copies()}>
                {(item) => (
                  <Action onClick={() => void copy(item.label, item.value)} hoverBackground>
                    {t(item.label)}
                  </Action>
                )}
              </For>
            </box>
            <box marginTop={1}>
              <text fg={elevatedTheme.text.base} attributes={TextAttributes.BOLD}>
                {t("Render")}
              </text>
              <Action
                onClick={() =>
                  void config.update((draft) => {
                    draft.debug = { ...draft.debug, timing: !timing() }
                  })
                }
                hoverBackground
              >
                {timing() ? "[x]" : "[ ]"} {t("Time to first draw")}
              </Action>
              <Action
                onClick={() =>
                  void config.update((draft) => {
                    draft.debug = { ...draft.debug, turn_tokens: !turnTokens() }
                  })
                }
                hoverBackground
              >
                {turnTokens() ? "[x]" : "[ ]"} {t("Turn token usage")}
              </Action>
              <Show when={Boolean(turnTokens())}>
                <Action
                  onClick={() =>
                    void config.update((draft) => {
                      draft.debug = { ...draft.debug, turn_tokens: verboseTurnTokens() ? true : "verbose" }
                    })
                  }
                  hoverBackground
                >
                  {verboseTurnTokens() ? "[x]" : "[ ]"} {t("Turn token usage (verbose)")}
                </Action>
              </Show>
            </box>
            <For each={groups()}>
              {(group) => (
                <box marginTop={1}>
                  <text fg={elevatedTheme.text.base} attributes={TextAttributes.BOLD}>
                    {group.title}
                  </text>
                  <For each={group.entries}>{(entry) => <Row label={entry.key} value={String(entry.value)} />}</For>
                </box>
              )}
            </For>
          </PanelBox>
        </Show>
      </BarItem>
      <BarItem
        hidden={hidden().has("registry")}
        active={false}
        onClick={() => {
          close()
          dialog.replace(
            () => (
              <RegistryPanel
                onClose={() => dialog.clear()}
                onShell={(shell) => void client.api.config.update({ shell }).catch(toast.error)}
                aiTools={{
                  installed: () =>
                    (data.location.mcp.server.list(location.ref ?? data.location.default()) ?? []).map(
                      (server) => server.name,
                    ),
                  set: (id, config) => client.api.config.update({ mcpServers: { [id]: config } }),
                }}
                plugins={plugins}
              />
            ),
            undefined,
            { size: "large" },
          )
          dialog.setCentered(true)
        }}
      >
        <text fg={theme.text.muted}>{t("Registry")}</text>
      </BarItem>
      <BarItem
        hidden={hidden().has("teams")}
        active={false}
        onClick={() => {
          close()
          openTeamEditor(dialog)
        }}
      >
        <text fg={theme.text.muted}>{t("Teams")}</text>
      </BarItem>
      {/* A hidden Show leaves a Solid slot node without a zIndex among the bar's children, and opentui's
          zIndex sort then let the backdrop land above the open panel and take its clicks. The wrapper keeps
          that slot node out of the bar. */}
      <box flexDirection="row">
        <Show when={projects.loaded() && projects.list().length === 0}>
          <BarItem
            active={false}
            onClick={() => {
              close()
              openProjectDialog(dialog, projects.refetch)
            }}
          >
            <text fg={theme.text.action.primary.base}>{t("+ Project")}</text>
          </BarItem>
        </Show>
      </box>
      <BarItem
        hidden={hidden().has("experiments")}
        active={false}
        onClick={() => {
          close()
          dialog.replace(() => <DialogExperiments />)
        }}
      >
        <text fg={theme.text.muted}>{t("Experiments")}</text>
      </BarItem>
      <box flexGrow={1} minWidth={0}>
        <TimeToFirstDraw visible={timing()} width="100%" fg={theme.text.muted} label="Time to first draw" />
      </box>
      <BarItem active={quickMode() === "explain"} onClick={() => toggleQuick("explain")} selecting>
        <text fg={quickMode() === "explain" ? theme.text.action.primary.focused : theme.text.muted}>{t("Explain")}</text>
      </BarItem>
      <BarItem active={quickMode() === "essence"} onClick={() => toggleQuick("essence")}>
        <text fg={quickMode() === "essence" ? theme.text.action.primary.focused : theme.text.muted}>{t("Essence")}</text>
      </BarItem>
      <BarItem active={quickMode() === "chat"} onClick={() => toggleQuick("chat")}>
        <text fg={quickMode() === "chat" ? theme.text.action.primary.focused : theme.text.muted}>{t("Chat")}</text>
      </BarItem>
      <BarItem
        active={facts.open}
        onClick={() => {
          if (!facts.open) setQuickMode()
          void updateFacts((draft) => {
            draft.open = !draft.open
          }).catch(toast.error)
        }}
      >
        <text fg={facts.open ? theme.text.action.primary.focused : theme.text.muted}>{t("Facts")}</text>
      </BarItem>
      <BarItem
        active={false}
        onClick={() =>
          void config
            .update((draft) => {
              draft.language = config.data.language === "ru" ? "en" : "ru"
            })
            .catch(toast.error)
        }
      >
        <text fg={theme.text.muted}>{t("Language")}</text>
        <text fg={theme.text.action.primary.base}>{" " + (config.data.language === "ru" ? "RU" : "EN")}</text>
      </BarItem>
      {/* Like the slot wrapper above: a stable node keeps the window out of the bar's zIndex re-sort. */}
      <box flexDirection="row">
        <ProjectFacts />
        <QuickHelp />
      </box>
    </box>
  )
}

// `selecting` items act on the text selected in the chat, so a live selection does not swallow their click.
function BarItem(props: ParentProps<{ active: boolean; onClick: () => void; hidden?: boolean; selecting?: boolean }>) {
  const theme = useTheme()
  const renderer = useRenderer()
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      visible={!props.hidden}
      position="relative"
      zIndex={props.active ? 2500 : 0}
      height={1}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        props.active
          ? theme.background.action.primary.focused
          : hovered()
            ? hoverBackground(theme)
            : undefined
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => {
        if (!props.selecting && renderer.getSelection()?.getSelectedText()) return
        props.onClick()
      }}
    >
      <box flexDirection="row">{props.children}</box>
    </box>
  )
}

function Action(props: ParentProps<{ onClick: () => void; disabled?: boolean; hoverBackground?: boolean }>) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      backgroundColor={props.hoverBackground && hovered() && !props.disabled ? hoverBackground(theme) : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        if (!props.disabled) props.onClick()
      }}
    >
      <text fg={props.disabled ? theme.text.muted : theme.text.action.primary.base}>{props.children}</text>
    </box>
  )
}

function cpuPercent(microseconds: number, milliseconds: number) {
  if (milliseconds <= 0) return 0
  return Math.max(0, microseconds / (milliseconds * 10))
}

function ProcessStat(props: { label: string; values: readonly number[]; unit: string; decimals?: number }) {
  const theme = useTheme()
  const value = () => {
    const value = props.values.at(-1)
    if (value === undefined) return "--"
    return `${value.toFixed(props.decimals ?? 1)}${props.unit}`
  }
  return (
    <box flexDirection="row">
      <box width={7}>
        <text fg={theme.text.muted}>{props.label}</text>
      </box>
      <box flexGrow={1}>
        <text fg={props.values.length ? theme.text.base : theme.text.muted}>{brailleGraph(props.values)}</text>
      </box>
      <box width={8} alignItems="flex-end">
        <text fg={props.values.length ? theme.text.base : theme.text.muted}>{value()}</text>
      </box>
    </box>
  )
}

export function runtimeStatus(samples: readonly Readonly<{ delay: number; time: number }>[]): RuntimeStatus {
  const latest = samples.at(-1)?.time
  if (latest === undefined) return "normal"
  const delay = Math.max(
    0,
    ...samples.filter((sample) => sample.time > latest - statusWindowMilliseconds).map((sample) => sample.delay),
  )
  if (delay >= 100) return "high"
  if (delay >= 20) return "medium"
  return "normal"
}

export function statusIcon(status: RuntimeStatus) {
  if (status === "high") return "●"
  if (status === "medium") return "⦿"
  return "○"
}

export function connectionIndicator(status: "connected" | "connecting" | "reconnecting", attempt: number) {
  if (status === "connected") return { state: "connected" as const, icon: "✓" }
  if (status === "reconnecting" && attempt >= 3) return { state: "disconnected" as const, icon: "×" }
  return { state: "reconnecting" as const, icon: "↻" }
}

export function brailleGraph(values: readonly number[], width = graphWidth) {
  const min = Math.min(...values)
  const range = Math.max(...values) - min
  const points = [...Array<number | undefined>(width * 2 - values.length).fill(values.at(0)), ...values].slice(
    -width * 2,
  )
  const dots = [
    [6, 2, 1, 0],
    [7, 5, 4, 3],
  ]
  return Array.from({ length: width }, (_, index) => {
    const bits = [points[index * 2], points[index * 2 + 1]].reduce<number>((result, value, column) => {
      if (value === undefined) return result
      const height = 1 + Math.round((range === 0 ? 0 : (value - min) / range) * 3)
      return dots[column].slice(0, height).reduce<number>((bits, dot) => bits | (1 << dot), result)
    }, 0)
    return String.fromCodePoint(0x2800 + bits)
  }).join("")
}
