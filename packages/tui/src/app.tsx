import { render, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { registerOpencodeSpinner } from "./component/register-spinner"
import { Effect, Latch } from "effect"
import { Service, type Endpoint } from "@opencode/client/effect/service"
import { OpenCode, type SessionInfo } from "@opencode/client"
import { Global } from "@opencode/util/global"
import { ClipboardProvider, useClipboard } from "./context/clipboard"
import { LogProvider, type LogSink } from "./context/log"
import { ExitProvider, useExit } from "./context/exit"
import { EpilogueProvider } from "./context/epilogue"
import { Selection } from "./util/selection"
import {
  CliRenderEvents,
  createCliRenderer,
  MouseButton,
  type CliRenderer,
  type CliRendererConfig,
  type ThemeMode,
} from "@opentui/core"
import { RouteProvider, useRoute } from "./context/route"
import {
  Switch,
  Match,
  createEffect,
  createMemo,
  ErrorBoundary,
  createSignal,
  onMount,
  onCleanup,
  batch,
  Show,
  on,
} from "solid-js"
import {
  TuiLifecycleProvider,
  TuiAppProvider,
  TuiPathsProvider,
  TuiStartupProvider,
  TuiTerminalEnvironmentProvider,
  useTuiApp,
  useTuiStartup,
  useTuiTerminalEnvironment,
  type TuiApp,
} from "./context/runtime"
import { DialogProvider, useDialog } from "./ui/dialog"
import { DialogIntegration } from "./component/dialog-integration"
import { ErrorComponent } from "./component/error-component"
import { PluginRouteMissing } from "./component/plugin-route-missing"
import { EditorContextProvider } from "./context/editor"
import { useEvent } from "./context/event"
import { ClientProvider, useClient } from "./context/client"
import { StartupLoading } from "./component/startup-loading"
import { DevToolsBar } from "./component/devtools-bar"
import { Reconnecting } from "./component/reconnecting"
import { MigrationOverlay } from "./component/migration-overlay"
import { DataProvider, useData } from "./context/data"
import { SessionTabsProvider, useSessionTabs } from "./context/session-tabs"
import { LocationProvider, useLocation } from "./context/location"
import { LocalProvider, useLocal } from "./context/local"
import { PermissionProvider } from "./context/permission"
import { DialogModel } from "./component/dialog-model"
import { useConnected } from "./component/use-connected"
import { DialogMcp } from "./component/dialog-mcp"
import { DialogCompat } from "./component/dialog-compat"
import { DialogStatus } from "./component/dialog-status"
import { DialogConfig } from "./component/dialog-config"
import { RegistryPanel } from "./component/devtools-registry"
import { DialogDebug } from "./component/dialog-debug"
import { DialogPair } from "./component/dialog-pair"
import { DialogThemeList } from "./component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { DialogAgent } from "./component/dialog-agent"
import { DialogSessionList } from "./component/dialog-session-list"
import { DialogOpen, DialogOpenKey, moveOpenSession } from "./component/dialog-open"
import { ProjectTree } from "./component/project-tree"
import { HomeProjectPanel } from "./component/home-project-panel"
import { RoomChat } from "./component/room-chat"
import { basicSymbolsNeeded, replaceMissingGlyphs } from "./ui/console-glyphs"
import { DialogConnect, DialogHost } from "./component/dialog-rooms"
import { DialogGroups } from "./component/dialog-groups"
import { sameRoom, useJoinedRooms } from "./util/room"
import { linkRoom } from "./util/room-guest"
import { useT } from "./util/i18n"
import { openTeamEditor } from "./component/dialog-teams"
import { ProjectsProvider } from "./context/projects"
import { NotesProvider } from "./context/notes"
import { NotesCommands } from "./component/notes-commands"
import {
  clampHomeProjectPanelWidth,
  clampSessionTabsWidth,
  homeProjectPanelWidth,
  sessionTabsFitVertically,
  SESSION_SIDEBAR_WIDTH,
  SESSION_TABS_COMPACT_LAYOUT_WIDTH,
} from "./ui/layout"
import { createPaneResize } from "./ui/pane-resize"
import { useCompactLayout } from "./ui/compact-layout"
import { PaneResizeHandle } from "./ui/pane-resize-handle"
import { ThemeErrorToast } from "./component/theme-error-toast"
import { IdeaBankCapture } from "./component/dialog-idea-bank"
import { createThemeSource, ThemeProvider, useTheme, useThemes } from "./context/theme"
import { Home } from "./routes/home"
import { PromptHistoryProvider } from "./prompt/history"
import { FrecencyProvider } from "./prompt/frecency"
import { PromptStashProvider } from "./prompt/stash"
import { Toast, ToastProvider, useToast } from "./ui/toast"
import { isFallbackTitle } from "@opencode/util/session-title-fallback"
import * as Model from "./util/model"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import { openUrl } from "@opencode/util/open"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { Config, ConfigProvider, useConfig } from "./config"
import { newSessionLocation } from "./config/new-session-location"
import { UpdateNotificationProvider, useUpdateNotification, type UpdateSource } from "./context/update-notification"
import { PluginProvider, usePlugin, type PackageSource } from "./plugin/context"
import { localPluginDirectories } from "./plugin/discovery"
import { PluginRoute, Slot } from "./plugin/render"
import { CommandPaletteDialog } from "./component/command-palette"
import { COMMAND_PALETTE_COMMAND, Keymap, type KeymapCommand } from "./context/keymap"

import { DialogVariant } from "./component/dialog-variant"
import { destroyRenderer } from "./util/renderer"
import { cliErrorMessage, errorFormat } from "./util/error"
import { AttentionProvider } from "./context/attention"
import { StorageProvider, useStorage } from "./context/storage"
import { SessionTerminalsProvider } from "./context/session-terminals"
import { PanelProvider, usePanel } from "./context/panel"
import { SessionFrame } from "./component/session-frame"
import { createTuiClipboard } from "./clipboard"

registerOpencodeSpinner()

const appGlobalBindingCommands = ["session.list", "session.new", "open.menu"] as const

const PANEL_RAIL_WIDTH = 3

const sessionTabBindingCommands = [
  "session.tab.next",
  "session.tab.previous",
  "session.tab.next_unread",
  "session.tab.previous_unread",
  "session.tab.close",
  "session.tab.reopen",
  "session.tab.select.1",
  "session.tab.select.2",
  "session.tab.select.3",
  "session.tab.select.4",
  "session.tab.select.5",
  "session.tab.select.6",
  "session.tab.select.7",
  "session.tab.select.8",
  "session.tab.select.9",
  "session.tab.select.10",
] as const

const pinnedSessionBindingCommands = [
  "session.quick_switch.1",
  "session.quick_switch.2",
  "session.quick_switch.3",
  "session.quick_switch.4",
  "session.quick_switch.5",
  "session.quick_switch.6",
  "session.quick_switch.7",
  "session.quick_switch.8",
  "session.quick_switch.9",
] as const

const appBindingCommands = [
  "command.palette.show",
  "model.list",
  "model.cycle_recent",
  "model.cycle_recent_reverse",
  "model.cycle_favorite",
  "model.cycle_favorite_reverse",
  "agent.list",
  "mcp.list",
  "compat.list",
  "agent.cycle",
  "agent.cycle.reverse",
  "variant.cycle",
  "variant.list",
  "provider.connect",
  "opencode.settings",
  "opencode.status",
  "opencode.update",
  "server.pair",
  "service.restart",
  "location.reload",
  "opencode.debug",
  "theme.switch",
  "theme.switch_mode",
  "theme.mode.lock",
  "help.show",
  "docs.open",
  "diff.open",
  "app.debug",
  "app.console",
  "terminal.suspend",
  "terminal.title.toggle",
  "app.toggle.animations",
  "app.toggle.file_context",
  "app.toggle.diffwrap",
  "app.toggle.paste_summary",
] as const

export type TuiInput = {
  app: TuiApp
  server: {
    endpoint: Endpoint
    service?: {
      reconnect: (signal: AbortSignal) => Promise<Endpoint>
      restart: () => Promise<void>
      openToNetwork?: () => Promise<void>
    }
  }
  args: Args
  config: Config.Interface
  updater?: UpdateSource
  packages: PackageSource
  environment?: Readonly<Record<string, string>>
  terminalHandoff?: () => Promise<
    | {
        readonly renderer: CliRenderer
        readonly mode: ThemeMode | null
        readonly complete: () => void
      }
    | undefined
  >
  log?: LogSink
}

export const run = Effect.fn("Tui.run")(function* (input: TuiInput) {
  const log = input.log ?? (() => {})
  const global = yield* Global.Service
  const config = Config.resolve(yield* Effect.tryPromise(() => input.config.get()), {
    terminalSuspend: process.platform !== "win32",
  })
  const options = { baseUrl: input.server.endpoint.url, headers: Service.headers(input.server.endpoint) }
  const api = OpenCode.make(options)
  const location = yield* Effect.tryPromise(() => api.file.list({ location: { directory: process.cwd() } })).pipe(
    Effect.map((response) => response.location),
    Effect.catch(() => Effect.tryPromise(() => api.location.get())),
  )
  const directory = location.directory
  const pluginDirectories = yield* Effect.promise(() => localPluginDirectories(process.cwd(), global.config))
  const handoff = input.terminalHandoff ? yield* Effect.promise(input.terminalHandoff) : undefined
  const managed = input.server.service
  const service = managed
    ? {
        reconnect: async (signal: AbortSignal) => {
          const endpoint = await managed.reconnect(signal)
          const next = { baseUrl: endpoint.url, headers: Service.headers(endpoint) }
          return { api: OpenCode.make(next), url: endpoint.url }
        },
        restart: managed.restart,
        openToNetwork: managed.openToNetwork,
      }
    : undefined
  const exit = { epilogue: undefined as string | undefined, reason: undefined as unknown }
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const options = {
        externalOutputMode: "passthrough",
        targetFps: 60,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
        autoFocus: false,
        openConsoleOnError: false,
        useMouse: config.mouse,
        consoleOptions: {
          keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
        },
      } satisfies CliRendererConfig
      const renderer = yield* Effect.gen(function* () {
        if (handoff) {
          handoff.renderer.useMouse = options.useMouse
          return yield* Effect.acquireRelease(Effect.succeed(handoff.renderer), (renderer) =>
            Effect.sync(() => destroyRenderer(renderer)),
          )
        }
        if (process.env.OPENCODE_DRIVE) {
          const { Drive } = yield* Effect.promise(() => import("@opencode/simulation/frontend"))
          return yield* Drive.create(options, input.app.version)
        }
        return yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => createCliRenderer(options),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }),
          (renderer) => Effect.sync(() => destroyRenderer(renderer)),
        )
      })
      // Every mounted useTerminalDimensions adds a resize listener, and the project, notes,
      // room and mascot panels push a normal screen past upstream's 15. The budget still
      // catches a real leak, which grows without bound.
      renderer.setMaxListeners(32)
      if (basicSymbolsNeeded()) renderer.addPostProcessFn(replaceMissingGlyphs)
      const clipboard = yield* Effect.acquireRelease(
        Effect.sync(() => createTuiClipboard(renderer)),
        (clipboard) =>
          Effect.tryPromise(() => clipboard.dispose()).pipe(
            Effect.catch((error) => Effect.sync(() => log("error", "Failed to dispose TUI clipboard", { error }))),
          ),
      )
      const finalizers = new Set<() => Promise<void>>()
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          const results = await Promise.allSettled([...finalizers].reverse().map((finalizer) => finalizer()))
          results
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .forEach((result) => log("error", "Failed to dispose TUI resource", { error: result.reason }))
        }),
      )
      const shutdown = yield* Latch.make()
      const onSighup = () => destroyRenderer(renderer)
      yield* Effect.acquireRelease(
        Effect.sync(() => process.on("SIGHUP", onSighup)),
        () => Effect.sync(() => process.off("SIGHUP", onSighup)),
      )
      renderer.once("destroy", () => shutdown.openUnsafe())
      yield* Effect.tryPromise(async () => {
        const mode = handoff?.mode ?? (await renderer.waitForThemeMode(1000)) ?? "dark"
        if (renderer.isDestroyed) return

        await render(() => {
          return (
            <LogProvider log={log}>
              <ExitProvider
                exit={(reason) => {
                  if (renderer.isDestroyed) return
                  exit.reason = reason
                  destroyRenderer(renderer)
                }}
              >
                <EpilogueProvider set={(value) => (exit.epilogue = value)}>
                  <TuiAppProvider value={input.app}>
                    <ErrorBoundary
                      fallback={(error, reset) => (
                        <ClipboardProvider value={clipboard}>
                          <ErrorComponent error={error} reset={reset} mode={mode} />
                        </ClipboardProvider>
                      )}
                    >
                      <TuiPathsProvider
                        value={{
                          cwd: process.cwd(),
                          home: global.home,
                          state: global.state,
                          worktree: global.data + "/worktree",
                        }}
                      >
                        <TuiLifecycleProvider
                          value={{
                            add(finalizer) {
                              finalizers.add(finalizer)
                              return () => finalizers.delete(finalizer)
                            },
                          }}
                        >
                          <StorageProvider>
                            <TuiTerminalEnvironmentProvider
                              value={{
                                platform: process.platform,
                                variables: input.environment,
                              }}
                            >
                              <TuiStartupProvider
                                value={{
                                  initialRoute: process.env.OPENCODE_STORY
                                    ? {
                                        type: "plugin",
                                        id: "opencode.storybook",
                                        name: "storybook",
                                        // OPENCODE_STORY=1 opens the index; any other value opens that story.
                                        data:
                                          process.env.OPENCODE_STORY === "1"
                                            ? undefined
                                            : { story: process.env.OPENCODE_STORY },
                                      }
                                    : process.env.OPENCODE_ROUTE
                                      ? JSON.parse(process.env.OPENCODE_ROUTE)
                                      : undefined,
                                  skipInitialLoading: Boolean(process.env.OPENCODE_FAST_BOOT),
                                }}
                              >
                                <ClipboardProvider value={clipboard}>
                                  <ArgsProvider {...input.args}>
                                    <ConfigProvider
                                      config={config}
                                      service={input.config}
                                      options={{ terminalSuspend: process.platform !== "win32" }}
                                    >
                                      <Keymap.Provider>
                                        <ToastProvider>
                                          <RouteProvider
                                            initialRoute={
                                              input.args.continue
                                                ? {
                                                    type: "session",
                                                    sessionID: "dummy",
                                                  }
                                                : undefined
                                            }
                                          >
                                            <ClientProvider api={api} url={input.server.endpoint.url} service={service}>
                                              <PermissionProvider>
                                                <DataProvider directory={directory}>
                                                  <LocationProvider>
                                                    <ProjectsProvider>
                                                      <NotesProvider>
                                                        <SessionTabsProvider>
                                                          <SessionTerminalsProvider>
                                                            <ThemeProvider
                                                              mode={mode}
                                                              source={createThemeSource(global.config)}
                                                            >
                                                              <ThemeErrorToast />
                                                              <LocalProvider>
                                                                <PromptStashProvider>
                                                                  <DialogProvider>
                                                                    <FrecencyProvider>
                                                                      <PromptHistoryProvider>
                                                                        <PromptRefProvider>
                                                                          <EditorContextProvider>
                                                                            <AttentionProvider>
                                                                              <UpdateNotificationProvider
                                                                                updater={input.updater}
                                                                              >
                                                                                <PanelProvider>
                                                                                  <PluginProvider
                                                                                    packages={input.packages}
                                                                                    directories={pluginDirectories}
                                                                                  >
                                                                                    <App />
                                                                                  </PluginProvider>
                                                                                </PanelProvider>
                                                                              </UpdateNotificationProvider>
                                                                            </AttentionProvider>
                                                                          </EditorContextProvider>
                                                                        </PromptRefProvider>
                                                                      </PromptHistoryProvider>
                                                                    </FrecencyProvider>
                                                                  </DialogProvider>
                                                                </PromptStashProvider>
                                                              </LocalProvider>
                                                            </ThemeProvider>
                                                          </SessionTerminalsProvider>
                                                        </SessionTabsProvider>
                                                      </NotesProvider>
                                                    </ProjectsProvider>
                                                  </LocationProvider>
                                                </DataProvider>
                                              </PermissionProvider>
                                            </ClientProvider>
                                          </RouteProvider>
                                        </ToastProvider>
                                      </Keymap.Provider>
                                    </ConfigProvider>
                                  </ArgsProvider>
                                </ClipboardProvider>
                              </TuiStartupProvider>
                            </TuiTerminalEnvironmentProvider>
                          </StorageProvider>
                        </TuiLifecycleProvider>
                      </TuiPathsProvider>
                    </ErrorBoundary>
                  </TuiAppProvider>
                </EpilogueProvider>
              </ExitProvider>
            </LogProvider>
          )
        }, renderer)
        if (handoff) {
          renderer.once(CliRenderEvents.FRAME, handoff.complete)
          renderer.requestRender()
        }
      })
      yield* shutdown.await
      return { epilogue: exit.epilogue, reason: exit.reason }
    }),
  )
  yield* Effect.sync(() => {
    if (result.reason !== undefined)
      process.stderr.write((cliErrorMessage(result.reason) ?? errorFormat(result.reason)) + "\n")
    if (result.epilogue) process.stdout.write(result.epilogue + "\n")
  })
})

function App() {
  const app = useTuiApp()
  const startup = useTuiStartup()
  const config = useConfig()
  const t = useT()
  const devtools = createMemo(() => config.data.debug?.devtools ?? app.channel === "local")
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()
  const sessionTabs = useSessionTabs()
  const [joinedRooms] = useJoinedRooms()
  const panels = usePanel()
  const keymap = Keymap.use()
  const event = useEvent()
  const client = useClient()
  // Joined rooms live in client storage; the server learns them so this computer's AI can reach them.
  createEffect(() => joinedRooms.joined.forEach((room) => void linkRoom(client.api, { ...room })))
  const toast = useToast()
  const updater = useUpdateNotification()
  const theme = useTheme()
  const { mode, supports, setMode, locked, lock, unlock, afterPaint } = useThemes()
  const data = useData()
  const location = useLocation()
  const exit = useExit()
  const promptRef = usePromptRef()
  const plugins = usePlugin()
  const clipboard = useClipboard()
  const terminalEnvironment = useTuiTerminalEnvironment()
  let paletteTimer: ReturnType<typeof setTimeout> | undefined
  const afterFrame = () => {
    // The native writer can still be flushing the frame when FRAME fires. Keep OSC probes behind visible app output.
    paletteTimer = setTimeout(afterPaint, 50)
  }
  onMount(() => renderer.once(CliRenderEvents.FRAME, afterFrame))
  onCleanup(() => {
    renderer.off(CliRenderEvents.FRAME, afterFrame)
    if (paletteTimer) clearTimeout(paletteTimer)
  })
  createEffect(() => {
    if (client.connection.status() !== "connected") return
    if (route.data.type !== "session") return
    const session = data.session.get(route.data.sessionID)
    if (!session) return
    if (data.session.creating(session.id)) return
    if (terminalEnvironment.variables === undefined) return
    void client.api.session
      .environment({ sessionID: session.id, variables: terminalEnvironment.variables })
      .catch(toast.error)
  })
  const [layout, updateLayout] = useStorage().store<{
    verticalTabsWidth?: number
    compactTabsWidth?: number
    homePanelWidth?: number
  }>(
    "layout",
    {
      initial: { verticalTabsWidth: SESSION_SIDEBAR_WIDTH },
    },
  )
  // The compact layout remembers its own project panel width so switching back restores the full one.
  const layoutMode = useCompactLayout()
  const compact = layoutMode.compact
  const mobile = layoutMode.mobile
  const defaultTabsWidth = () => (compact() ? SESSION_TABS_COMPACT_LAYOUT_WIDTH : SESSION_SIDEBAR_WIDTH)
  const tabsResize = createPaneResize({
    value: () => (compact() ? layout.compactTabsWidth : layout.verticalTabsWidth) ?? defaultTabsWidth(),
    defaultValue: defaultTabsWidth,
    clamp: (width) => clampSessionTabsWidth(width, dimensions().width),
    fromMouse: (event) => event.x + 1,
    contains: (event, width) => event.x >= width - 1 && event.x <= width,
    onCommit: (width) => {
      void updateLayout((draft) => {
        if (compact()) draft.compactTabsWidth = width
        else draft.verticalTabsWidth = width
      }).catch((error) => console.error("Failed to persist TUI layout", error))
    },
  })
  const [openSessions, setOpenSessions] = createSignal<SessionInfo[]>([])
  const [leftPanelHidden, setLeftPanelHidden] = createSignal(false)
  const [homePanelHidden, setHomePanelHidden] = createSignal(false)
  // On a phone the side panels start folded; each opens over the screen and closes the other.
  createEffect(
    on(mobile, (value) => {
      if (!value) return
      setLeftPanelHidden(true)
      setHomePanelHidden(true)
    }),
  )
  const showLeftPanel = () => {
    if (mobile()) setHomePanelHidden(true)
    setLeftPanelHidden(false)
  }
  const showHomePanel = () => {
    if (mobile()) setLeftPanelHidden(true)
    setHomePanelHidden(false)
  }
  // Picking a session or a room in the open panel goes to it, so the panel gets out of the way.
  createEffect(
    on(
      // The route is a store reconciled in place, so its serialized form is what changes.
      () => JSON.stringify(route.data),
      () => {
        if (mobile()) setLeftPanelHidden(true)
      },
      { defer: true },
    ),
  )
  // Toast once when an MCP server enters a failed or needs-auth state so the user knows to act,
  // without having to open the status panel. Tracking the last alerted status avoids re-toasting
  // the same problem on every refresh while still re-alerting if the state changes.
  // A project carrying another agent tool's hooks or MCP servers gets them only after the user trusts it;
  // say so once per project root instead of leaving it to `/compat`.
  const compatAlerted = new Set<string>()
  createEffect(() => {
    const directory = (location.ref ?? data.location.default()).directory
    void client.api.config.compatibility
      .get({ location: { directory } })
      .then((report) => {
        if (compatAlerted.has(report.root)) return
        const waiting = report.ecosystems.find((item) => item.enabled && !item.trusted && (item.awaitingTrust ?? 0) > 0)
        if (!waiting) return
        compatAlerted.add(report.root)
        toast.show({
          variant: "warning",
          title: t("Project has {name} settings that need trust", { name: waiting.label }),
          message: t("Hooks, MCP servers and allow rules stay off until you trust them."),
          action: { label: t("Review"), run: () => keymap.dispatch("compat.list") },
        })
      })
      .catch(() => undefined)
  })

  const mcpAlerted: Record<string, string> = {}
  createEffect(() => {
    for (const server of data.location.mcp.server.list() ?? []) {
      const status = server.status
      if (status.status !== "failed" && status.status !== "needs_auth") {
        delete mcpAlerted[server.name]
        continue
      }
      if (mcpAlerted[server.name] === status.status) continue
      mcpAlerted[server.name] = status.status
      if (status.status === "needs_auth")
        toast.show({
          variant: "warning",
          title: "MCP server needs authentication",
          message: `Connect "${server.name}" to use its tools.`,
          action: { label: "Open MCP servers", run: () => keymap.dispatch("mcp.list") },
        })
      else
        toast.show({
          variant: "error",
          title: `MCP server failed: ${server.name}`,
          message: "Run /mcps to view details.",
          action: { label: "Open MCP servers", run: () => keymap.dispatch("mcp.list") },
        })
    }
  })

  const copyOnSelectEnabled = () =>
    (config.data.terminal?.copy ?? (process.platform === "win32" ? "manual" : "select")) === "select"

  // Selection copy/dismiss must precede both app bindings and the terminal pane's raw key forwarding.
  const offSelectionKeys = keymap.intercept(
    "key",
    ({ event }) => {
      Selection.handleSelectionKey(renderer, toast, event, clipboard, copyOnSelectEnabled())
    },
    { priority: 101 },
  )
  onCleanup(() => {
    offSelectionKeys()
  })

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await clipboard
      .write(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)

    renderer.clearSelection()
  }
  const terminalTitleEnabled = () => config.data.terminal?.title ?? true
  const pasteSummaryEnabled = () => config.data.prompt?.paste !== "full"
  // The project tree replaces the session tabs and always sits on the left when the terminal is wide enough.
  const tabsVertical = () => sessionTabsFitVertically(dimensions().width, tabsResize.size())
  // Always offered outside plugin pages: Multiplayer's Host and Connect live in the panel too.
  const tabsAvailable = () => route.data.type !== "plugin"
  const fullscreenPanel = () =>
    route.data.type === "session" &&
    panels.current()?.sessionID === route.data.sessionID &&
    panels.presentation() === "fullscreen"
  const tabsVisible = () => tabsAvailable() && !fullscreenPanel()
  // The mobile layout always keeps the panel's rail: a phone is never wide enough for the tree beside the chat.
  const verticalTabsVisible = () => tabsVisible() && (mobile() || tabsVertical())
  const leftPanelVisible = () => verticalTabsVisible() && !leftPanelHidden()
  // An open mobile panel lies over the screen, so the content keeps the room it had beside the rail.
  const leftDrawerOpen = () => mobile() && leftPanelVisible()
  const leftPanelOccupiedWidth = () =>
    verticalTabsVisible() ? (leftPanelHidden() || mobile() ? PANEL_RAIL_WIDTH : tabsResize.size()) : 0

  // The home DoD panel has its own persisted resize boundary. Its maximum width
  // always leaves at least 64 columns for the main prompt/chat.
  const defaultHomePanelWidth = () => homeProjectPanelWidth(dimensions().width, leftPanelOccupiedWidth())
  const homePanelResize = createPaneResize({
    value: () => layout.homePanelWidth ?? defaultHomePanelWidth(),
    defaultValue: defaultHomePanelWidth,
    clamp: (width) => clampHomeProjectPanelWidth(width, dimensions().width - leftPanelOccupiedWidth()),
    fromMouse: (event) => dimensions().width - event.x - 1,
    contains: (event, width) =>
      event.x >= dimensions().width - width - 1 && event.x <= dimensions().width - width,
    onCommit: (width) => {
      void updateLayout((draft) => {
        draft.homePanelWidth = width
      }).catch((error) => console.error("Failed to persist home panel width", error))
    },
  })
  const homePanelWidth = createMemo(() => {
    if (route.data.type !== "home") return 0
    if (mobile()) return dimensions().width - leftPanelOccupiedWidth()
    if (defaultHomePanelWidth() <= 0) return 0
    return homePanelResize.size()
  })
  const homeDrawerOpen = () => mobile() && homePanelWidth() > 0 && !homePanelHidden()

  // Dispatch drag events to the active boundary. The inactive resizer ignores them,
  // so the left and right separators never resize each other.
  const onPaneMouseDrag = (event: Parameters<typeof tabsResize.onMouseDrag>[0]) => {
    tabsResize.onMouseDrag(event)
    homePanelResize.onMouseDrag(event)
  }
  const onPaneMouseDragEnd = (event: Parameters<typeof tabsResize.onMouseDragEnd>[0]) => {
    tabsResize.onMouseDragEnd(event)
    homePanelResize.onMouseDragEnd(event)
  }
  const onPaneMouseUp = (event: Parameters<typeof tabsResize.onMouseUp>[0]) => {
    tabsResize.onMouseUp(event)
    homePanelResize.onMouseUp(event)
  }

  // Measure the prospective split layout using the width the left panel currently occupies.
  createEffect(() => panels.setWidth(dimensions().width - leftPanelOccupiedWidth()))
  createEffect(() => {
    const current = panels.current()
    if (!current || (route.data.type === "session" && route.data.sessionID === current.sessionID)) return
    panels.close()
  })

  createEffect(() => {
    renderer.useMouse = config.data.mouse
  })

  let active: { id: string; title?: string } | undefined
  // Update terminal window title based on current route and session
  createEffect(() => {
    const session = route.data.type === "session" ? data.session.get(route.data.sessionID) : undefined
    if (session) active = { id: session.id, title: session.title }
    if (!terminalTitleEnabled()) return

    if (route.data.type === "home") {
      renderer.setTerminalTitle("Opencode++")
      return
    }

    if (route.data.type === "session") {
      const title = session?.title
      if (!title || isFallbackTitle(title)) {
        renderer.setTerminalTitle("Opencode++")
        return
      }

      renderer.setTerminalTitle(`OC | ${title.length > 40 ? title.slice(0, 37) + "…" : title}`)
      return
    }

    if (route.data.type === "plugin") {
      renderer.setTerminalTitle(`OC | ${route.data.name}`)
      return
    }

    if (route.data.type === "room") {
      const target = route.data
      const room = joinedRooms.joined.find((item) => sameRoom(item, target))
      renderer.setTerminalTitle(room ? `OC | ⇄ ${room.name}` : "Opencode++")
    }
  })

  const args = useArgs()
  const startupPrompt = args.prompt ? { text: args.prompt, files: [], agents: [], pasted: [] } : undefined
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Model.parse(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `Invalid model format: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
      }
      if (args.sessionID && !args.fork) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
          prompt: startupPrompt,
        })
      }
    })
  })

  let continued = false
  createEffect(() => {
    if (continued || !args.continue) return
    continued = true
    const location = data.location.default()
    void client.api.session
      .list({
        limit: 1,
        order: "desc",
        parentID: null,
        directory: location.directory,
      })
      .then((response) => {
        const match = response.data[0]?.id
        if (!match) return
        if (!args.fork) {
          route.navigate({ type: "session", sessionID: match, prompt: startupPrompt })
          return
        }
        void client.api.session
          .fork({ sessionID: match })
          .then((result) => route.navigate({ type: "session", sessionID: result.id, prompt: startupPrompt }))
          .catch(toast.error)
      })
      .catch(toast.error)
  })

  // Handle --session with --fork once.
  let forked = false
  createEffect(() => {
    if (forked || !args.sessionID || !args.fork) return
    forked = true
    void client.api.session
      .fork({ sessionID: args.sessionID })
      .then((result) => route.navigate({ type: "session", sessionID: result.id, prompt: startupPrompt }))
      .catch(toast.error)
  })

  const connected = useConnected()
  const appCommands = createMemo(() =>
    [
      {
        name: COMMAND_PALETTE_COMMAND,
        title: "Show command palette",
        category: "System",
        palette: undefined,
        run: () => {
          dialog.replace(() => <CommandPaletteDialog />)
        },
      },
      {
        name: "session.list",
        title: "Switch session",
        category: "Session",
        suggested: data.session.list().length > 0,
        slash: { name: "sessions", aliases: ["resume", "continue"] },
        run: () => {
          dialog.replace(() => <DialogSessionList />)
        },
      },
      {
        name: "session.new",
        title: "New session",
        suggested: route.data.type === "session",
        category: "Session",
        slash: { name: "new", aliases: ["clear"] },
        run: () => {
          const model = local.model.current()
          const agent = local.agent.current()
          const current =
            route.data.type === "session"
              ? (data.session.get(route.data.sessionID)?.location ?? location.ref)
              : undefined
          route.navigate({
            type: "home",
            location: newSessionLocation(
              config.data.session.new_location,
              data.location.default().directory,
              current,
              location.error?.location,
            ),
          })
          if (agent) local.agent.set(agent.id)
          if (model) local.model.set(model)
          dialog.clear()
        },
      },
      {
        name: "session.clear",
        title: "Clear session",
        category: "Session",
        run: () => {
          const model = local.model.current()
          const agent = local.agent.current()
          const current =
            route.data.type === "session"
              ? (data.session.get(route.data.sessionID)?.location ?? location.ref)
              : undefined
          sessionTabs.close()
          route.navigate({
            type: "home",
            location: newSessionLocation(
              config.data.session.new_location,
              data.location.default().directory,
              current,
              location.error?.location,
            ),
          })
          if (agent) local.agent.set(agent.id)
          if (model) local.model.set(model)
          dialog.clear()
        },
      },
      {
        name: "team.editor",
        title: "Edit teams and roles",
        category: "Session",
        slash: { name: "teams", aliases: ["team", "roles"] },
        run: () => openTeamEditor(dialog),
      },
      {
        name: "open.menu",
        title: "Open session or project",
        category: "Session",
        slash: { name: "open" },
        run: () => {
          if (dialog.key === DialogOpenKey) return
          dialog.replace(() => <DialogOpen sessions={openSessions()} onLoad={setOpenSessions} />, undefined, {
            key: DialogOpenKey,
            size: "large",
          })
        },
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        name: `session.quick_switch.${i + 1}`,
        title: `Switch to session in quick slot ${i + 1}`,
        category: "Session",
        palette: undefined,
        enabled: () => !sessionTabs.enabled(),
        run: () => local.session.quickSwitch(i + 1),
      })),
      {
        name: "session.tab.next",
        title: "Next tab",
        category: "Session",
        palette: undefined,
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.cycle(1),
      },
      {
        name: "session.tab.previous",
        title: "Previous tab",
        category: "Session",
        palette: undefined,
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.cycle(-1),
      },
      {
        name: "session.tab.next_unread",
        title: "Next unread tab",
        category: "Session",
        palette: undefined,
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.cycleUnread(1),
      },
      {
        name: "session.tab.previous_unread",
        title: "Previous unread tab",
        category: "Session",
        palette: undefined,
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.cycleUnread(-1),
      },
      {
        name: "session.tab.close",
        title: "Close tab",
        category: "Session",
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.close(),
      },
      {
        name: "session.tab.reopen",
        title: "Reopen closed tab",
        category: "Session",
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.reopen(),
      },
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `session.tab.select.${i + 1}`,
        title: `Switch to tab ${i + 1}`,
        category: "Session",
        palette: undefined,
        enabled: sessionTabs.enabled,
        run: () => sessionTabs.selectIndex(i),
      })),
      {
        name: "model.list",
        title: "Switch model",
        suggested: true,
        category: "Agent",
        slash: { name: "models" },
        run: () => {
          dialog.replace(() => <DialogModel />)
        },
      },
      {
        name: "model.default",
        title: "Set default model",
        category: "Agent",
        slash: { name: "default-model", aliases: ["default"] },
        run: () => {
          dialog.replace(() => (
            <DialogModel
              title={t("Default model for new sessions")}
              onPick={(model) =>
                void client.api.config
                  .update({ model: `${model.providerID}/${model.modelID}` })
                  .then(() =>
                    toast.show({
                      variant: "success",
                      message: `Default model: ${model.providerID}/${model.modelID}`,
                    }),
                  )
                  .catch(toast.error)
              }
            />
          ))
        },
      },
      {
        name: "model.cycle_recent",
        title: "Model cycle",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycle(1)
        },
      },
      {
        name: "model.cycle_recent_reverse",
        title: "Model cycle reverse",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycle(-1)
        },
      },
      {
        name: "model.cycle_favorite",
        title: "Favorite cycle",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycleFavorite(1)
        },
      },
      {
        name: "model.cycle_favorite_reverse",
        title: "Favorite cycle reverse",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.model.cycleFavorite(-1)
        },
      },
      {
        name: "agent.list",
        title: "Switch agent",
        category: "Agent",
        slash: { name: "agents" },
        run: () => {
          dialog.replace(() => <DialogAgent />)
        },
      },
      {
        name: "mcp.list",
        title: "MCP servers",
        category: "Agent",
        slash: { name: "mcps" },
        run: () => {
          dialog.replace(() => <DialogMcp />)
        },
      },
      {
        name: "compat.list",
        title: "Other agent tools",
        category: "Agent",
        slash: { name: "compat" },
        run: () => {
          dialog.replace(() => <DialogCompat />)
        },
      },
      {
        name: "agent.cycle",
        title: "Agent cycle",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.agent.move(1)
        },
      },
      {
        name: "variant.cycle",
        title: "Variant cycle",
        category: "Agent",
        run: () => {
          local.model.variant.cycle()
        },
      },
      {
        name: "variant.list",
        title: "Switch model variant",
        category: "Agent",
        palette: local.model.variant.list().length === 0 ? undefined : (true as const),
        slash: { name: "variants", aliases: ["thinking", "effort"] },
        run: () => {
          if (local.model.variant.list().length === 0) {
            return toast.show({
              title: "No variants available",
              message: "The current model does not support any variants.",
              variant: "info",
            })
          }
          dialog.replace(() => <DialogVariant />)
        },
      },
      {
        name: "agent.cycle.reverse",
        title: "Agent cycle reverse",
        category: "Agent",
        palette: undefined,
        run: () => {
          local.agent.move(-1)
        },
      },
      {
        name: "provider.connect",
        title: "Connect an integration",
        suggested: !connected(),
        slash: { name: "connect" },
        run: () => {
          dialog.replace(() => (
            <DialogIntegration
              onConnected={(providerID) => dialog.replace(() => <DialogModel providerID={providerID} />)}
            />
          ))
        },
        category: "Integration",
      },
      // The left panel holds these too; the palette keeps them reachable when the terminal is too narrow for it.
      {
        name: "room.host",
        title: "Host a room",
        run: () => {
          dialog.replace(() => <DialogHost onClose={() => dialog.clear()} />, undefined, { size: "large" })
          dialog.setCentered(true)
        },
        category: "Multiplayer",
      },
      {
        name: "room.connect",
        title: "Connect to a room",
        run: () => {
          dialog.replace(() => <DialogConnect onClose={() => dialog.clear()} />, undefined, { size: "large" })
          dialog.setCentered(true)
        },
        category: "Multiplayer",
      },
      {
        name: "project.groups",
        title: "Project groups",
        slash: { name: "groups" },
        run: () => {
          dialog.replace(() => <DialogGroups onClose={() => dialog.clear()} />, undefined, { size: "large" })
          dialog.setCentered(true)
        },
        category: "Multiplayer",
      },
      {
        name: "opencode.settings",
        title: "Open settings",
        suggested: true,
        slash: { name: "settings" },
        run: () => {
          dialog.replace(() => <DialogConfig />)
        },
        category: "System",
      },
      {
        name: "opencode.status",
        title: "View status",
        slash: { name: "status" },
        run: () => {
          dialog.replace(() => <DialogStatus />)
        },
        category: "System",
      },
      ...(updater.open
        ? [
            {
              name: "opencode.update",
              title: "Update Opencode++",
              slash: { name: "update", aliases: ["upgrade"] },
              run: () => updater.open?.("manual"),
              category: "System",
            },
          ]
        : []),
      {
        name: "server.pair",
        title: "Pair device",
        slash: { name: "pair" },
        run: () => {
          dialog.replace(() => <DialogPair />)
        },
        category: "System",
      },
      ...(client.restart
        ? [
            {
              name: "service.restart",
              title: "Restart service",
              slash: { name: "restart" },
              run: async () => {
                const restart = client.restart
                if (!restart) return
                dialog.clear()
                toast.show({ variant: "info", message: "Restarting service…", duration: 30000 })
                // restart resolves once the replacement service is healthy; the
                // event stream reattaches through the reconnect loop.
                await restart()
                  .then(() => toast.show({ variant: "success", message: "Service restarted" }))
                  .catch(toast.error)
              },
              category: "System",
            },
          ]
        : []),
      {
        name: "location.reload",
        title: "Reload configuration",
        slash: { name: "reload" },
        run: async () => {
          dialog.clear()
          toast.show({ variant: "info", message: "Reloading configuration…", duration: 30000 })
          await client.api.location
            .reload()
            .then(() => {
              toast.show({ variant: "success", message: "Configuration reloaded" })
            })
            .catch(toast.error)
        },
        category: "System",
      },
      {
        name: "opencode.debug",
        title: "View debug info",
        slash: { name: "debug" },
        run: () => {
          dialog.replace(() => <DialogDebug />)
        },
        category: "System",
      },
      {
        name: "theme.switch",
        title: "Switch theme",
        slash: { name: "themes" },
        run: () => {
          dialog.replace(() => <DialogThemeList />)
        },
        category: "System",
      },
      {
        name: "theme.switch_mode",
        title: mode() === "dark" ? "Switch to light mode" : "Switch to dark mode",
        palette: undefined,
        enabled: () => supports(mode() === "dark" ? "light" : "dark"),
        run: () => {
          setMode(mode() === "dark" ? "light" : "dark")
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "theme.mode.lock",
        title: locked() ? "Unlock theme mode" : "Lock theme mode",
        palette: undefined,
        run: () => {
          if (locked()) unlock()
          else lock()
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "help.show",
        title: "Help",
        slash: { name: "help" },
        run: () => {
          dialog.replace(() => <DialogHelp />)
        },
        category: "System",
      },
      {
        name: "docs.open",
        title: "Open docs",
        slash: { name: "docs" },
        run: () => {
          openUrl("https://opencode.ai/docs").catch(() => {})
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "app.language",
        title: "Switch language",
        slash: { name: "language", aliases: ["lang"] },
        run: () => {
          void config
            .update((draft) => {
              draft.language = config.data.language === "ru" ? "en" : "ru"
            })
            .catch(toast.error)
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "app.layout.mobile",
        title: "Toggle mobile layout",
        slash: { name: "mobile", aliases: ["phone"] },
        run: () => {
          void config
            .update((draft) => {
              draft.layout = mobile() ? "auto" : "mobile"
            })
            .catch(toast.error)
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "registry.open",
        title: "Open tool registry",
        slash: { name: "registry", aliases: ["tools"] },
        run: () => {
          dialog.replace(
            () => (
              <RegistryPanel
                onClose={() => dialog.clear()}
                onShell={(shell) => void client.api.config.update({ shell }).catch(toast.error)}
              />
            ),
            undefined,
            { size: "large" },
          )
          dialog.setCentered(true)
        },
        category: "System",
      },
      {
        name: "app.exit",
        title: "Exit the app",
        slash: { name: "exit", aliases: ["quit"] },
        run: () => exit(),
        category: "System",
      },
      {
        name: "app.debug",
        title: "Toggle debug panel",
        category: "System",
        palette: undefined,
        run: () => {
          renderer.toggleDebugOverlay()
          dialog.clear()
        },
      },
      {
        name: "app.console",
        title: "Toggle console",
        category: "System",
        run: () => {
          // The engine's toggle only focuses a visible console that lost focus, which left
          // it stuck on screen after an escape; a visible console always closes here.
          if (renderer.console.visible) renderer.console.hide()
          else renderer.console.toggle()
          dialog.clear()
        },
      },
      {
        name: "terminal.suspend",
        title: "Suspend terminal",
        category: "System",
        palette: undefined,
        enabled: process.platform !== "win32",
        run: () => {
          renderer.suspend()
          process.once("SIGCONT", () => renderer.resume())
          process.kill(0, "SIGTSTP")
        },
      },
      {
        name: "terminal.title.toggle",
        title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
        category: "System",
        palette: undefined,
        run: () => {
          const next = !terminalTitleEnabled()
          if (!next) renderer.setTerminalTitle("")
          void config
            .update((draft) => {
              draft.terminal = { ...draft.terminal, title: next }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.animations",
        title: (config.data.animations ?? true) ? "Disable animations" : "Enable animations",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.animations = !(config.data.animations ?? true)
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.file_context",
        title: (config.data.prompt?.editor ?? true) ? "Disable file context" : "Enable file context",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.prompt = { ...draft.prompt, editor: !(config.data.prompt?.editor ?? true) }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.diffwrap",
        title: (config.data.diffs?.wrap ?? "word") === "word" ? "Disable diff wrapping" : "Enable diff wrapping",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.diffs = {
                ...draft.diffs,
                wrap: (config.data.diffs?.wrap ?? "word") === "word" ? "none" : "word",
              }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "app.toggle.paste_summary",
        title: pasteSummaryEnabled() ? "Disable paste summary" : "Enable paste summary",
        category: "System",
        palette: undefined,
        run: () => {
          void config
            .update((draft) => {
              draft.prompt = { ...draft.prompt, paste: pasteSummaryEnabled() ? "full" : "compact" }
            })
            .catch(toast.error)
          dialog.clear()
        },
      },
      // Expose slash/custom commands in the searchable UI palette. Selecting one
      // fills the composer; the user can review arguments before submitting it.
      ...(data.location.command.list(location.ref) ?? []).map((command) => ({
        name: `custom.command.${command.name}`,
        title: `/${command.name}`,
        description: command.description ?? "Run a custom command",
        category: "Custom commands",
        run: () => {
          const prompt = promptRef.current
          if (!prompt) {
            toast.show({ variant: "warning", message: "Open the prompt before selecting a custom command." })
            return
          }
          const current = prompt.current
          if (
            current.text.trim() ||
            current.files?.length ||
            current.agents?.length ||
            current.skills?.length ||
            current.pasted.length
          ) {
            toast.show({
              variant: "warning",
              message: "Submit or clear the current draft before selecting a custom command.",
            })
            return
          }
          prompt.setMode("normal")
          prompt.set({ ...current, text: `/${command.name} ` })
          prompt.focus()
          toast.show({
            variant: "info",
            message: `Prepared /${command.name}. Review any arguments, then submit the prompt.`,
          })
        },
      })),
    ].map(
      ({ name, category, ...command }) =>
        ({
          id: name,
          group: category,
          bind: false,
          palette: true as const,
          ...command,
        }) satisfies KeymapCommand,
    ),
  )

  Keymap.createLayer(() => ({
    mode: "global",
    commands: appCommands(),
  }))

  Keymap.createLayer(() => ({
    bindings: appBindingCommands,
  }))

  Keymap.createLayer(() => ({
    mode: "global",
    bindings: appGlobalBindingCommands,
  }))

  Keymap.createLayer(() => ({
    mode: "global",
    enabled: sessionTabs.enabled,
    bindings: sessionTabBindingCommands,
  }))

  Keymap.createLayer(() => ({
    mode: "global",
    enabled: () => !sessionTabs.enabled(),
    bindings: pinnedSessionBindingCommands,
  }))

  Keymap.createLayer(() => ({
    enabled: () => {
      const current = promptRef.current
      if (!current?.focused) return true
      return current.current.text === ""
    },
    bindings: ["app.exit"],
  }))

  event.on("tui.command.execute", (evt, { directory }) => {
    if (directory !== (location.current?.directory ?? data.location.default().directory)) return
    keymap.dispatch(evt.data.command)
  })

  event.on("tui.toast.show", (evt, { directory }) => {
    if (directory !== (location.current?.directory ?? data.location.default().directory)) return
    toast.show({
      title: evt.data.title,
      message: evt.data.message,
      variant: evt.data.variant,
      duration: evt.data.duration,
    })
  })

  event.on("tui.session.select", (evt, { directory }) => {
    if (directory !== (location.current?.directory ?? data.location.default().directory)) return
    route.navigate({
      type: "session",
      sessionID: evt.data.sessionID,
    })
  })

  event.on("session.moved", (evt) => {
    setOpenSessions((sessions) =>
      sessions.map((session) => (session.id !== evt.data.sessionID ? session : moveOpenSession(session, evt))),
    )
  })

  event.on("session.deleted", (evt) => {
    setOpenSessions((sessions) => sessions.filter((session) => session.id !== evt.data.sessionID))
    if (route.data.type === "session" && route.data.sessionID === evt.data.sessionID) {
      const title = active?.id === evt.data.sessionID ? active.title : undefined
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: title ? `Session "${title}" was deleted` : "The current session was deleted",
      })
    }
  })

  // Suppress the full-screen overlay for transient startup and event-stream retry states.
  // Initial connection gets a longer grace period; retries surface more quickly.
  const [showReconnecting, setShowReconnecting] = createSignal(false)
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }
    const status = client.connection.status()
    if (status === "connected") {
      setShowReconnecting(false)
      return
    }
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = undefined
        setShowReconnecting(true)
      },
      status === "reconnecting" ? 1000 : 5000,
    ).unref()
  })
  onCleanup(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background.base}
      onMouseDown={(evt) => {
        if (copyOnSelectEnabled()) return
        if (evt.button !== MouseButton.RIGHT) return

        if (!Selection.copy(renderer, toast, clipboard)) return
        evt.preventDefault()
        evt.stopPropagation()
      }}
      onMouseUp={
        copyOnSelectEnabled() ? (event) => Selection.copyOnSelectRelease(event, renderer, toast, clipboard) : undefined
      }
    >
      <box
        flexGrow={1}
        minHeight={0}
        flexDirection="row"
        position="relative"
        onMouseDrag={onPaneMouseDrag}
        onMouseDragEnd={onPaneMouseDragEnd}
        onMouseUp={onPaneMouseUp}
      >
        <Show when={verticalTabsVisible()}>
          {/* The same tree lifts over the screen when the mobile panel opens; a spacer keeps its rail's room. */}
          <Show when={leftDrawerOpen()}>
            <box width={PANEL_RAIL_WIDTH} flexShrink={0} />
          </Show>
          <box
            position={leftDrawerOpen() ? "absolute" : "relative"}
            left={0}
            top={0}
            zIndex={leftDrawerOpen() ? 30 : 0}
            height="100%"
            flexShrink={0}
          >
            <ProjectTree
              width={leftDrawerOpen() ? dimensions().width : leftPanelHidden() ? PANEL_RAIL_WIDTH : tabsResize.size()}
              collapsed={leftPanelHidden()}
              onHide={() => setLeftPanelHidden(true)}
              onShow={showLeftPanel}
            />
          </box>
        </Show>
        <box flexGrow={1} minWidth={0} flexDirection="column">
          <Show when={plugins.ready()}>
            <box flexGrow={1} minHeight={0} flexDirection="column">
              <Switch>
                <Match when={route.data.type === "home"}>
                  <box flexDirection="row" flexGrow={1} minWidth={0} minHeight={0}>
                    <box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0}>
                      <Home />
                    </box>
                    <Show when={homePanelWidth() > 0}>
                      <Show when={homeDrawerOpen()}>
                        <box width={PANEL_RAIL_WIDTH} flexShrink={0} />
                      </Show>
                      <box
                        position={homeDrawerOpen() ? "absolute" : "relative"}
                        right={0}
                        top={0}
                        zIndex={homeDrawerOpen() ? 30 : 0}
                        height="100%"
                        flexShrink={0}
                      >
                        <HomeProjectPanel
                          width={homePanelHidden() ? PANEL_RAIL_WIDTH : homePanelWidth()}
                          collapsed={homePanelHidden()}
                          onHide={() => setHomePanelHidden(true)}
                          onShow={showHomePanel}
                        />
                      </box>
                    </Show>
                  </box>
                </Match>
                <Match when={route.data.type === "session"}>
                  <Show when={route.data.type === "session" ? route.data.sessionID : undefined} keyed>
                    {(sessionID) => (
                      <SessionFrame
                        sessionID={sessionID}
                        verticalTabsWidth={leftPanelOccupiedWidth()}
                      />
                    )}
                  </Show>
                </Match>
                <Match when={route.data.type === "room" ? route.data : undefined}>
                  {(target) => (
                    // Keyed by room and session so switching either starts a fresh view; leaving a room drops it.
                    <Show
                      when={
                        joinedRooms.joined.some((item) => sameRoom(item, target()))
                          ? `${target().url}#${target().roomID}#${target().sessionID ?? ""}`
                          : undefined
                      }
                      keyed
                    >
                      {(view) => (
                        <Show when={view ? joinedRooms.joined.find((item) => sameRoom(item, target())) : undefined}>
                          {(room) => <RoomChat room={room()} sessionID={target().sessionID} />}
                        </Show>
                      )}
                    </Show>
                  )}
                </Match>
                <Match when={route.data.type === "plugin"}>
                  <PluginRoute
                    fallback={(id, name) => (
                      <PluginRouteMissing id={id} name={name} onHome={() => route.navigate({ type: "home" })} />
                    )}
                  />
                </Match>
              </Switch>
            </box>
            <Slot path="app" />
            <NotesCommands />
          </Show>
        </box>
        <Show when={leftPanelVisible() && !mobile()}>
          <PaneResizeHandle resize={tabsResize} left={tabsResize.size() - 1} />
        </Show>
        <Show when={route.data.type === "home" && homePanelWidth() > 0 && !homePanelHidden() && !mobile()}>
          <PaneResizeHandle
            resize={homePanelResize}
            left={dimensions().width - homePanelResize.size() - 1}
            highlight="right"
          />
        </Show>
      </box>
      <Show when={devtools() && !(route.data.type === "plugin" && route.data.id === "opencode.stats")}>
        <DevToolsBar />
      </Show>
      <Show when={!startup.skipInitialLoading}>
        <StartupLoading ready={plugins.ready} />
      </Show>
      <Show when={showReconnecting()}>
        <Reconnecting managed={client.restart !== undefined} />
      </Show>
      <MigrationOverlay />
      <IdeaBankCapture />
      <Toast />
    </box>
  )
}
