export const SESSION_SIDEBAR_WIDTH = 42
export const SESSION_TABS_COMPACT_WIDTH = 5
export const SESSION_TABS_COMPACT_BREAKPOINT = 12
export const SESSION_SIDEBAR_MIN_WIDTH = 34
export const SESSION_SIDEBAR_MAX_WIDTH = 56
const SESSION_CONTENT_MIN_WIDTH = 44
const SESSION_CONTENT_PREFERRED_WIDTH = 64

export function sessionTabsFitVertically(total: number, width = SESSION_SIDEBAR_WIDTH) {
  return total >= width + SESSION_CONTENT_PREFERRED_WIDTH
}

export function clampSessionTabsWidth(width: number, total: number) {
  const max = Math.max(
    SESSION_TABS_COMPACT_WIDTH,
    Math.min(SESSION_SIDEBAR_MAX_WIDTH, total - SESSION_CONTENT_MIN_WIDTH),
  )
  // On a normally sized terminal, keep the project tree wide enough for actual names.
  // Collapse to the compact rail only when a wider sidebar would starve the main content.
  const min =
    total >= SESSION_SIDEBAR_MIN_WIDTH + SESSION_CONTENT_MIN_WIDTH
      ? SESSION_SIDEBAR_MIN_WIDTH
      : SESSION_TABS_COMPACT_WIDTH
  return Math.max(Math.min(min, max), Math.min(width, max))
}

export const SESSION_PANEL_MIN_WIDTH = 28
export const SESSION_CHAT_MIN_WIDTH = 56
export const SESSION_SIDEBAR_MIN_DOCKED_WIDTH = 38

// When a note is open, prefer the intended document-left/chat-right layout at
// compact terminal widths; normal sessions still stack their auxiliary content sooner.
export const NOTE_CANVAS_MIN_WIDTH = 40
export const NOTE_CHAT_MIN_WIDTH = 40

// A canvas hidden in full-chat mode must not keep a flex share and leave a
// blank column beside the chat.
export function noteCanvasFlexGrow(hasCanvas: boolean, stacked: boolean) {
  if (!hasCanvas) return 0
  return stacked ? 3 : 0
}

export function clampNoteChatWidth(width: number, available: number) {
  const max = Math.max(1, available - NOTE_CANVAS_MIN_WIDTH)
  const min = Math.min(NOTE_CHAT_MIN_WIDTH, max)
  return Math.max(min, Math.min(width, max))
}

export function sessionPanesStacked(available: number, hasNoteCanvas: boolean) {
  return available < (hasNoteCanvas ? NOTE_CANVAS_MIN_WIDTH + NOTE_CHAT_MIN_WIDTH : 100)
}

export function clampSessionPaneWidth(width: number, total: number) {
  // The right pane can never take the chat below its readable minimum. On very
  // narrow terminals it shrinks with the available space instead of covering chat.
  const max = Math.max(1, total - SESSION_CHAT_MIN_WIDTH)
  const min = Math.min(SESSION_PANEL_MIN_WIDTH, max)
  return Math.max(min, Math.min(width, max))
}

export function resolveSessionPaneWidth(
  measured: { width: number; hasCanvas: boolean } | undefined,
  initial: number,
  hasCanvas: boolean,
) {
  // A measurement belongs to the layout mode it was taken in. Never apply a narrow
  // Notes measurement to Projects; use the current allocation when OpenTUI relayouts.
  if (!measured || measured.width <= 0 || measured.hasCanvas !== hasCanvas) return initial
  return measured.width
}

export function sessionPaneBoxWidth(input: {
  fullscreen: boolean
  fullscreenWidth: number
  hasCanvas: boolean
  stacked: boolean
  noteChatWidth: number
}): number | `${number}%` {
  if (input.fullscreen) return Math.max(0, input.fullscreenWidth)
  if (input.hasCanvas && !input.stacked) return Math.max(0, input.noteChatWidth)
  // Never transition from a numeric width to undefined: OpenTUI may keep the old
  // width after switching Notes -> Projects. Explicit 100% releases the stale split.
  return "100%"
}

export function sessionTranscriptWidth(input: {
  availableWidth: number
  hasCanvas: boolean
  stacked: boolean
  canvasHostWidth: number
  noteChatWidth: number
  rightPaneVisible: boolean
  rightPaneWidth: number
  revealRailVisible: boolean
  revealRailWidth: number
  fullscreenContentWidth: number
  fullscreen: boolean
}) {
  if (input.fullscreen) return Math.max(0, input.fullscreenContentWidth)
  // In a horizontal note layout, the saved divider explicitly controls the chat width.
  if (input.hasCanvas && !input.stacked) return Math.max(0, input.noteChatWidth)

  // availableWidth is the measured full SessionFrame width; its right pane is a
  // sibling of the chat host. canvasHostWidth can retain an old Notes measurement
  // after switching tabs, so never use it to size the Projects chat.
  const occupiedRight = input.rightPaneVisible
    ? input.rightPaneWidth
    : input.revealRailVisible
      ? input.revealRailWidth
      : 0
  return Math.max(0, input.availableWidth - occupiedRight)
}

export function clampSessionSidebarWidth(width: number, total: number) {
  // Docked session sidebars contain names and live statuses, so don't let a drag
  // shrink them into a clipped unreadable strip. Docking thresholds guarantee
  // there is normally room for this minimum while preserving the chat width.
  const max = Math.max(1, total - SESSION_CHAT_MIN_WIDTH)
  const min = Math.min(SESSION_SIDEBAR_MIN_DOCKED_WIDTH, max)
  return Math.max(min, Math.min(width, max))
}

// Compact layout keeps both side panels open on a laptop-sized terminal: the
// project panel gets its own narrower width and the session sidebar docks beside
// the chat as long as the chat keeps its preferred width.
// Full layout uses the normal-width sidebar, but may dock it once the chat can still
// retain its readable minimum. Otherwise the sidebar remains available via its toggle.
export const SESSION_TABS_COMPACT_LAYOUT_WIDTH = 34
export const SESSION_SIDEBAR_COMPACT_WIDTH = 38
const SESSION_SIDEBAR_DOCK_GUTTER = 8
const COMPACT_LAYOUT_AUTO_FROM = 110
const COMPACT_LAYOUT_AUTO_BELOW = 170

export function compactLayout(mode: "auto" | "compact" | "full" | undefined, total: number) {
  if (mode === "compact") return true
  if (mode === "full") return false
  return total >= COMPACT_LAYOUT_AUTO_FROM && total < COMPACT_LAYOUT_AUTO_BELOW
}

export function sessionSidebarDocks(available: number, compact: boolean) {
  if (compact) return available >= SESSION_SIDEBAR_COMPACT_WIDTH + SESSION_CONTENT_PREFERRED_WIDTH
  return available >= SESSION_SIDEBAR_WIDTH + SESSION_CONTENT_MIN_WIDTH + SESSION_SIDEBAR_DOCK_GUTTER
}

// Home's right project dashboard is optional at narrow widths: reserve enough space
// for the centered prompt and cap the panel so it cannot swallow the main content.
export const HOME_PROJECT_PANEL_MIN_WIDTH = 30
export const HOME_PROJECT_PANEL_WIDTH = 42
export const HOME_PROJECT_PANEL_MAX_WIDTH = 64
export const HOME_CONTENT_MIN_WIDTH = 64

export function clampHomeProjectPanelWidth(width: number, available: number) {
  const max = Math.max(1, Math.min(HOME_PROJECT_PANEL_MAX_WIDTH, available - HOME_CONTENT_MIN_WIDTH))
  const min = Math.min(HOME_PROJECT_PANEL_MIN_WIDTH, max)
  return Math.max(min, Math.min(width, max))
}

export function homeProjectPanelWidth(total: number, leftPanelWidth: number) {
  const available = total - leftPanelWidth - HOME_CONTENT_MIN_WIDTH
  if (available < HOME_PROJECT_PANEL_MIN_WIDTH) return 0
  return Math.min(HOME_PROJECT_PANEL_WIDTH, available)
}

// A terminal or plugin panel opens at half the room in the full layout and at
// two fifths in the compact one, so the chat beside it stays readable.
export function defaultSessionPaneWidth(total: number, compact: boolean) {
  // Leave more room to the conversation by default; users can drag the divider
  // to widen the task board when they need it.
  return Math.max(1, Math.floor(compact ? total * 0.36 : total * 0.4))
}
