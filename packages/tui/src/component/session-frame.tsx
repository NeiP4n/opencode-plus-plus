import {
  CliRenderEvents,
  RGBA,
  MouseEvent,
  type BoxRenderable,
  type Renderable,
  type ScrollBoxRenderable,
} from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createResource, createSignal, on, onCleanup, Show } from "solid-js"
import { useConfig } from "../config"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { InteractivityProvider } from "../context/interactivity"
import { useSessionTerminals } from "../context/session-terminals"
import { usePromptRef } from "../context/prompt"
import { usePanel } from "../context/panel"
import { useStorage } from "../context/storage"
import { useNotes } from "../context/notes"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { Session } from "../routes/session"
import { Sidebar } from "../routes/session/sidebar"
import {
  clampNoteChatWidth,
  clampSessionPaneWidth,
  clampSessionSidebarWidth,
  defaultSessionPaneWidth,
  noteCanvasFlexGrow,
  sessionPaneBoxWidth,
  sessionPanesStacked,
  sessionTranscriptWidth,
  sessionSidebarDocks,
} from "../ui/layout"
import { useCompactLayout } from "../ui/compact-layout"
import { createPaneResize } from "../ui/pane-resize"
import { PaneResizeHandle } from "../ui/pane-resize-handle"
import { useToast } from "../ui/toast"
import { TerminalPane } from "./terminal-pane"
import { PanelHost } from "./panel-host"
import { HoverAction } from "./hover-action"
import { NoteCanvas } from "./note-canvas"

export function SessionFrame(props: { sessionID: string; verticalTabsWidth: number }) {
  const sessions = useSessionTerminals()
  const prompt = usePromptRef()
  const config = useConfig()
  const data = useData()
  const toast = useToast()
  const terminalError = () => toast.show({ variant: "error", message: "Unable to load terminal" })
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const panels = usePanel()
  const dialog = useDialog()
  const notes = useNotes()
  const theme = useTheme()
  // Derive the frame's current width from live terminal and left-rail dimensions.
  // Cached width stayed at the note split size after switching back to Projects.
  // SessionFrame is already rendered to the right of the project tree. Measure its
  // actual allocation rather than subtracting the left panel from the terminal twice.
  const [frameWidth, setFrameWidth] = createSignal(Math.max(0, dimensions().width - props.verticalTabsWidth))
  const availableWidth = () => frameWidth()
  const [canvasHostWidth, setCanvasHostWidth] = createSignal(availableWidth())
  const compactLayout = useCompactLayout()
  const activePanel = createMemo(() => {
    const current = panels.current()
    if (current?.sessionID === props.sessionID) return current
  })
  const fullscreen = () => activePanel() !== undefined && panels.presentation() === "fullscreen"
  // A session bound to a note in Notes mode shows the note as its document, with the chat beside it.
  const canvas = createMemo(() => (fullscreen() ? undefined : notes.canvas(props.sessionID)))
  // Keep a bound note in the center with its chat on the right on narrow terminals;
  // only stack them when there is not enough room for two usable columns.
  const stacked = () => sessionPanesStacked(availableWidth(), canvas() !== undefined)
  const defaultPaneWidth = () => defaultSessionPaneWidth(panels.width(), compactLayout.compact())
  const [layout, updateLayout] = useStorage().store<{
    paneWidth?: number
    terminalWidth?: number
    compactPaneWidth?: number
    sidebarWidth?: number
    noteChatWidth?: number
  }>("layout", {
    initial: {},
  })
  // The compact layout remembers its own panel width so switching back restores the full one.
  const paneResize = createPaneResize({
    value: () =>
      (compactLayout.compact() ? layout.compactPaneWidth : (layout.paneWidth ?? layout.terminalWidth)) ??
      defaultPaneWidth(),
    defaultValue: defaultPaneWidth,
    clamp: (width) => clampSessionPaneWidth(width, panels.width()),
    fromMouse: (event) => availableWidth() - (event.x - props.verticalTabsWidth) - 1,
    contains: (event, width) => {
      const boundary = props.verticalTabsWidth + availableWidth() - width
      return event.x >= boundary - 1 && event.x <= boundary
    },
    onCommit: (width) => {
      void updateLayout((draft) => {
        if (compactLayout.compact()) draft.compactPaneWidth = width
        else draft.paneWidth = width
      }).catch((error) => console.error("Failed to persist TUI layout", error))
    },
  })
  // The session sidebar has an independent width preference so resizing MCP/DoD
  // does not silently change the width of terminal or plugin panels.
  const defaultSidebarWidth = () => compactLayout.sidebarWidth()
  const sidebarResize = createPaneResize({
    value: () => layout.sidebarWidth ?? defaultSidebarWidth(),
    defaultValue: defaultSidebarWidth,
    clamp: (width) => clampSessionSidebarWidth(width, panels.width()),
    fromMouse: (event) => availableWidth() - (event.x - props.verticalTabsWidth) - 1,
    contains: (event, width) => {
      const boundary = props.verticalTabsWidth + availableWidth() - width
      return event.x >= boundary - 1 && event.x <= boundary
    },
    onCommit: (width) => {
      void updateLayout((draft) => {
        draft.sidebarWidth = width
      }).catch((error) => console.error("Failed to persist sidebar width", error))
    },
  })
  const defaultNoteChatWidth = () =>
    defaultSessionPaneWidth(canvasHostWidth(), compactLayout.compact())
  const noteChatResize = createPaneResize({
    value: () => layout.noteChatWidth ?? defaultNoteChatWidth(),
    defaultValue: defaultNoteChatWidth,
    clamp: (width) => clampNoteChatWidth(width, canvasHostWidth()),
    // Mouse coordinates are terminal-global; translate x to this split container before resizing.
    fromMouse: (event) => canvasHostWidth() - (event.x - props.verticalTabsWidth) - 1,
    contains: (event, width) => {
      const boundary = props.verticalTabsWidth + canvasHostWidth() - width
      return event.x >= boundary - 1 && event.x <= boundary
    },
    onCommit: (width) => {
      void updateLayout((draft) => {
        draft.noteChatWidth = width
      }).catch((error) => console.error("Failed to persist note/chat width", error))
    },
  })
  const rightPaneResize = () => (rightPane() === "sidebar" ? sidebarResize : paneResize)

  let resizeRelease = false
  const finishPaneResize = (event: MouseEvent) => {
    if (paneResize.resizing() || sidebarResize.resizing() || noteChatResize.resizing()) {
      // A captured drag-end can be followed by mouse-up on the focus overlay.
      resizeRelease = true
      queueMicrotask(() => {
        resizeRelease = false
      })
    }
    paneResize.onMouseUp(event)
    sidebarResize.onMouseUp(event)
    noteChatResize.onMouseUp(event)
  }
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [activePane, setActivePane] = createSignal<"session" | "right">("session")
  const [rightPaneHidden, setRightPaneHidden] = createSignal(false)
  const [restoreTerminalFocus, setRestoreTerminalFocus] = createSignal(false)
  let focusTerminal: (() => void) | undefined
  let showTerminals: (() => void) | undefined
  let sessionScroll: ScrollBoxRenderable | undefined
  let sessionNode: BoxRenderable | undefined
  let rightNode: BoxRenderable | undefined
  let panelNode: BoxRenderable | undefined
  createResource(
    () => (sessions.available() ? props.sessionID : undefined),
    (sessionID) => sessions.refresh(sessionID).catch(() => undefined),
  )
  const session = () => sessions.get(props.sessionID)
  const selectedTerminal = () => {
    if (!sessions.available()) return
    const value = session()
    return value.terminals.find((terminal) => terminal.id === value.selectedTerminalID)
  }
  createEffect(
    on([activePanel, () => selectedTerminal()?.id], ([panel, terminal], previous) => {
      if (panel && panel !== previous?.[0]) {
        setRightPaneHidden(false)
        setSidebarOpen(false)
        if (terminal) void sessions.selectTerminal(props.sessionID, null).catch(toast.error)
        return
      }
      if (terminal && terminal !== previous?.[1]) {
        setRightPaneHidden(false)
        setSidebarOpen(false)
        if (panel) panels.close()
      }
    }),
  )
  const wide = createMemo(() => sessionSidebarDocks(availableWidth(), compactLayout.compact()))
  const sidebarVisible = createMemo(() => {
    if (data.session.get(props.sessionID)?.parentID) return false
    if (sidebarOpen()) return true
    // The document and its chat need the room the automatic sidebar would take.
    if (canvas()) return false
    return (config.data.session?.sidebar ?? "auto") === "auto" && wide()
  })
  const rightPane = createMemo(() => {
    if (activePanel()) return "panel"
    if (sidebarOpen() && sidebarVisible()) return "sidebar"
    if (selectedTerminal()) return "terminal"
    if (sidebarVisible()) return "sidebar"
  })

  // Use the formula only for the very first render. Once OpenTUI lays out the
  // session pane, its measured width is the source of truth. A createMemo here
  // eagerly evaluated canvas() in older builds before canvas was initialized.
  const initialSessionTranscriptWidth = () =>
    sessionTranscriptWidth({
      availableWidth: availableWidth(),
      hasCanvas: canvas() !== undefined,
      stacked: stacked(),
      canvasHostWidth: canvasHostWidth(),
      noteChatWidth: noteChatResize.size(),
      rightPaneVisible:
        !rightPaneHidden() &&
        (rightPane() === "terminal" || rightPane() === "panel" || (rightPane() === "sidebar" && wide())),
      rightPaneWidth: rightPaneResize().size(),
      revealRailVisible:
        !fullscreen() &&
        (rightPaneHidden() ||
          (rightPane() === undefined &&
            !canvas() &&
            !activePanel() &&
            !selectedTerminal() &&
            !data.session.get(props.sessionID)?.parentID)),
      revealRailWidth: 3,
      fullscreenContentWidth: Math.max(0, panels.width() - paneResize.size()),
      fullscreen: fullscreen(),
    })

  // Derive the transcript width from the current layout every time. The measured
  // parent host remains mounted across tabs; caching the inner pane can preserve a
  // Notes width after Projects returns.
  const transcriptWidth = () => initialSessionTranscriptWidth()

  const toggleSidebar = () => {
    batch(() => {
      const visible = rightPane() === "sidebar"
      void config
        .update((draft) => {
          draft.session = { ...draft.session, sidebar: visible ? "hide" : "auto" }
        })
        .catch(toast.error)
      setSidebarOpen(!visible)
      if (!visible && activePanel()) panels.close()
      if (!visible && selectedTerminal()) void sessions.selectTerminal(props.sessionID, null).catch(toast.error)
    })
  }
  const focusSession = () => {
    if (fullscreen()) return
    // Permission prompts replace the input, so returning focus must not depend on it.
    if (activePane() === "right") renderer.currentFocusedRenderable?.blur()
    setActivePane("session")
    prompt.current?.focus()
  }
  const focusRightPane = () => {
    setActivePane("right")
    if (activePanel()) {
      panelNode?.focus()
      return
    }
    focusTerminal?.()
  }
  const hideRightPane = () => {
    // A hidden full-screen panel must not continue covering the chat.
    if (fullscreen()) panels.toggleFullscreen()
    setRightPaneHidden(true)
    setActivePane("session")
    prompt.current?.focus()
  }
  const showRightPane = () => {
    if (!rightPaneHidden()) {
      toggleSidebar()
      return
    }
    setRightPaneHidden(false)
    if (activePanel() || selectedTerminal()) queueMicrotask(focusRightPane)
  }
  const onFocused = () => {
    const current = renderer.currentFocusedRenderable
    if (rightPane() !== "sidebar" && within(current, rightNode)) setActivePane("right")
    if (!fullscreen() && within(current, sessionNode)) setActivePane("session")
  }
  renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, onFocused)
  onCleanup(() => renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, onFocused))
  createEffect(() => {
    if (fullscreen()) focusRightPane()
  })
  createEffect(() => {
    if (rightPane() !== "terminal" && rightPane() !== "panel") setActivePane("session")
  })
  createEffect(() => {
    if (!restoreTerminalFocus() || selectedTerminal()) return
    setRestoreTerminalFocus(false)
    focusSession()
  })
  Keymap.createLayer(() => ({
    mode: "global",
    enabled: () => (rightPane() === "terminal" || activePanel() !== undefined) && dialog.stack.length === 0,
    commands: [
      {
        id: "pane.focus.left",
        title: "Focus session pane",
        enabled: () => !fullscreen(),
        run: focusSession,
      },
      {
        id: "pane.focus.right",
        title: "Focus right pane",
        run: focusRightPane,
      },
    ],
  }))

  // Pane management stays reachable from either input scope.
  Keymap.createLayer(() => ({
    mode: "global",
    commands: [
      {
        id: "session.sidebar.toggle",
        title: rightPane() === "sidebar" ? "Hide sidebar" : "Show sidebar",
        group: "Session",
        palette: true,
        run: () => {
          toggleSidebar()
          dialog.clear()
        },
      },
      ...(sessions.available()
        ? [
            {
              id: "terminal.toggle",
              title: rightPane() === "terminal" ? "Hide terminal pane" : "Show terminal pane",
              group: "Session",
              palette: true as const,
              run: () => {
                dialog.clear()
                if (rightPane() === "terminal") {
                  focusSession()
                  void sessions.selectTerminal(props.sessionID, null).catch(toast.error)
                  return
                }
                void sessions
                  .refresh(props.sessionID)
                  .then(async () => {
                    const terminal = sessions.get(props.sessionID).terminals.at(-1)
                    if (terminal) return sessions.selectTerminal(props.sessionID, terminal.id)
                    await sessions.newTerminal(props.sessionID)
                  })
                  .catch(terminalError)
              },
            },
            {
              id: "terminal.select",
              title: "Select terminal",
              group: "Session",
              palette: true as const,
              run: () => {
                dialog.clear()
                if (fullscreen()) panels.close()
                focusSession()
                showTerminals?.()
                void sessions.refresh(props.sessionID).catch(terminalError)
              },
            },
            {
              id: "terminal.close",
              title: "Close terminal pane",
              group: "Session",
              palette: true as const,
              enabled: rightPane() === "terminal",
              run: () => {
                dialog.clear()
                focusSession()
                void sessions.selectTerminal(props.sessionID, null).catch(toast.error)
              },
            },
            {
              id: "session.terminal",
              title: "New terminal",
              group: "Session",
              palette: true as const,
              slash: { name: "terminal" },
              run: async () => {
                dialog.clear()
                await sessions.newTerminal(props.sessionID).catch(terminalError)
              },
            },
          ]
        : []),
    ],
  }))

  return (
    <box
      flexGrow={1}
      minWidth={0}
      minHeight={0}
      flexDirection="row"
      position="relative"
      onSizeChange={function () {
        setFrameWidth(this.width)
      }}
      onMouseDrag={(event) => {
        paneResize.onMouseDrag(event)
        sidebarResize.onMouseDrag(event)
        noteChatResize.onMouseDrag(event)
      }}
      onMouseDragEnd={finishPaneResize}
      onMouseUp={finishPaneResize}
    >
      <box
        flexGrow={1}
        flexBasis={0}
        minWidth={0}
        minHeight={0}
        flexDirection={stacked() ? "column" : "row"}
        position="relative"
        onSizeChange={function () {
          setCanvasHostWidth(this.width)
        }}
      >
        {/* Remove the document column from flex layout when switching back to Projects.
            OpenTUI's visible=false hides drawing, but the box can still reserve width. */}
        <Show when={canvas() !== undefined}>
          <box
            id="note-canvas"
            flexGrow={noteCanvasFlexGrow(true, stacked())}
            flexBasis={stacked() ? 0 : undefined}
            width={stacked() ? "100%" : Math.max(0, canvasHostWidth() - noteChatResize.size())}
            minWidth={0}
            minHeight={0}
            border={[stacked() ? "bottom" : "right"]}
            borderColor={theme.border.base}
          >
            {/* Another note gets a fresh document, never the editor state of the previous one. */}
            <Show when={canvas()?.name} keyed>
              {(_) => (
                <Show when={canvas()}>
                  {(note) => (
                    <NoteCanvas
                      sessionID={props.sessionID}
                      note={note()}
                      directory={data.session.get(props.sessionID)?.location.directory ?? ""}
                    />
                  )}
                </Show>
              )}
            </Show>
          </box>
        </Show>
        <box
          id="session-pane"
          ref={(value: BoxRenderable) => (sessionNode = value)}
          flexGrow={canvas() && !stacked() ? 0 : canvas() ? 2 : 1}
          flexBasis={canvas() && !stacked() ? undefined : 0}
          minWidth={0}
          minHeight={0}
          position={fullscreen() ? "absolute" : "relative"}
          visible={!fullscreen()}
          width={sessionPaneBoxWidth({
            fullscreen: fullscreen(),
            fullscreenWidth: panels.width() - paneResize.size(),
            hasCanvas: canvas() !== undefined,
            stacked: stacked(),
            noteChatWidth: noteChatResize.size(),
          })}
          height="100%"
        >
          <InteractivityProvider enabled={activePane() === "session" && !fullscreen()}>
            <Session
              scrollRef={(value) => (sessionScroll = value)}
              verticalTabsWidth={props.verticalTabsWidth}
              promptMuted={activePane() !== "session"}
              sidebarVisible={rightPane() === "sidebar"}
              onToggleSidebar={toggleSidebar}
              terminals={sessions.available()}
              visibleTerminalID={rightPane() === "terminal" ? selectedTerminal()?.id : undefined}
              onTerminalPicker={(show) => (showTerminals = show)}
              width={transcriptWidth()}
            />
          </InteractivityProvider>
          <Show when={activePane() === "right"}>
            <box
              position="absolute"
              left={0}
              top={0}
              width="100%"
              height="100%"
              zIndex={1}
              onMouseScroll={(event) => {
                if (!sessionScroll || sessionScroll.isDestroyed) return
                const viewport = sessionScroll.viewport
                if (event.x < viewport.x || event.x >= viewport.x + viewport.width) return
                if (event.y < viewport.y || event.y >= viewport.y + viewport.height) return
                // Keep the focus-only click guard, but let the transcript handle its own wheel events.
                event.stopPropagation()
                sessionScroll.processMouseEvent(new MouseEvent(sessionScroll, event))
              }}
              // Consume the release before revealing permission buttons underneath.
              onMouseUp={() => {
                if (paneResize.resizing() || sidebarResize.resizing() || noteChatResize.resizing() || resizeRelease) return
                focusSession()
              }}
            />
          </Show>
        </box>
      </box>
      <Show when={!rightPaneHidden() && (rightPane() === "terminal" || rightPane() === "panel" || (rightPane() === "sidebar" && wide()))}>
        <box
          ref={(value: BoxRenderable) => (rightNode = value)}
          flexShrink={0}
          height="100%"
          flexDirection="column"
          width={fullscreen() ? availableWidth() : rightPaneResize().size()}
          minWidth={0}
          minHeight={0}
        >
          <Show when={rightPane() !== "sidebar"}>
            <box
              height={1}
              flexShrink={0}
              flexDirection="row"
              justifyContent="flex-end"
              backgroundColor={theme.background.raised.base}
            >
              <HoverAction id="right-pane.hide" onClick={hideRightPane} paddingLeft={1} paddingRight={1}>
                <text fg={theme.text.action.primary.base}>›</text>
              </HoverAction>
            </box>
          </Show>
          <box flexGrow={1} minWidth={0} minHeight={0}>
            <Show
              when={rightPane() === "sidebar"}
              fallback={
                <Show
                  keyed
                  when={activePanel()}
                  fallback={
                    <Show keyed when={selectedTerminal()?.id}>
                      {(ptyID) => (
                        <TerminalPane
                          ptyID={ptyID}
                          resizing={paneResize.resizing()}
                          autoFocus={restoreTerminalFocus() || sessions.shouldFocus(ptyID)}
                          onAutoFocus={() => {
                            sessions.clearFocus(ptyID)
                            setRestoreTerminalFocus(false)
                          }}
                          onFocusRequest={(value) => (focusTerminal = value)}
                          onDisconnect={() => setRestoreTerminalFocus(true)}
                        />
                      )}
                    </Show>
                  }
                >
                  {(item) => (
                    <PanelHost
                      panel={item}
                      width={fullscreen() ? availableWidth() : paneResize.size()}
                      focused={activePane() === "right"}
                      onFocus={focusRightPane}
                      onTarget={(node) => {
                        panelNode = node
                        if (node) {
                          focusRightPane()
                          return
                        }
                        setActivePane("session")
                      }}
                    />
                  )}
                </Show>
              }
            >
              <Sidebar sessionID={props.sessionID} onHide={hideRightPane} />
            </Show>
          </box>
        </box>
      </Show>
      <Show
        when={
          !fullscreen() &&
          (rightPaneHidden() ||
            (rightPane() === undefined &&
              !canvas() &&
              !activePanel() &&
              !selectedTerminal() &&
              !data.session.get(props.sessionID)?.parentID))
        }
      >
        <box
          width={3}
          height="100%"
          flexShrink={0}
          backgroundColor={theme.background.raised.base}
          border={["left"]}
          borderColor={theme.border.base}
          paddingTop={1}
        >
          <HoverAction
            id="session.sidebar.show"
            onClick={showRightPane}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.text.action.primary.base}>‹</text>
          </HoverAction>
        </box>
      </Show>
      <Show when={canvas() !== undefined && !stacked()}>
        <PaneResizeHandle
          resize={noteChatResize}
          left={Math.max(0, canvasHostWidth() - noteChatResize.size() - 1)}
          highlight="right"
        />
      </Show>
      <Show
        when={
          !fullscreen() &&
          !rightPaneHidden() &&
          (rightPane() === "terminal" ||
            rightPane() === "panel" ||
            (rightPane() === "sidebar" && wide())) &&
          availableWidth() >= 3
        }
      >
        <PaneResizeHandle
          resize={rightPaneResize()}
          left={availableWidth() - rightPaneResize().size() - 1}
          highlight="right"
        />
      </Show>
      <Show when={!rightPaneHidden() && rightPane() === "sidebar" && !wide()}>
        <box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          alignItems="flex-end"
          backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
        >
          <Sidebar sessionID={props.sessionID} onHide={hideRightPane} />
        </box>
      </Show>
    </box>
  )
}

function within(node: Renderable | null | undefined, root: Renderable | undefined) {
  if (!root) return false
  for (let current = node; current; current = current.parent) {
    if (current === root) return true
  }
  return false
}
