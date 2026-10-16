import { expect, test } from "bun:test"
import {
  clampHomeProjectPanelWidth,
  compactLayout,
  mobileLayout,
  clampNoteChatWidth,
  clampSessionPaneWidth,
  clampSessionSidebarWidth,
  noteCanvasFlexGrow,
  clampSessionTabsWidth,
  defaultSessionPaneWidth,
  homeProjectPanelWidth,
  sessionPaneBoxWidth,
  sessionPanesStacked,
  sessionSidebarDocks,
  resolveSessionPaneWidth,
  sessionTranscriptWidth,
  sessionTabsFitVertically,
  SESSION_SIDEBAR_MAX_WIDTH,
  SESSION_SIDEBAR_MIN_WIDTH,
  SESSION_SIDEBAR_WIDTH,
  SESSION_TABS_COMPACT_WIDTH,
} from "../../src/ui/layout"

test("vertical tabs match the session sidebar and preserve readable content width", () => {
  expect(SESSION_SIDEBAR_WIDTH).toBe(42)
  expect(sessionTabsFitVertically(106)).toBe(true)
  expect(sessionTabsFitVertically(105)).toBe(false)
})

test("vertical tabs account for a resized width", () => {
  expect(sessionTabsFitVertically(124, 60)).toBe(true)
  expect(sessionTabsFitVertically(123, 60)).toBe(false)
})

test("project tree width is bounded and stays readable on a normal terminal", () => {
  expect(SESSION_SIDEBAR_MIN_WIDTH).toBe(34)
  expect(SESSION_SIDEBAR_MAX_WIDTH).toBe(56)
  expect(clampSessionTabsWidth(0, 120)).toBe(SESSION_SIDEBAR_MIN_WIDTH)
  expect(clampSessionTabsWidth(11, 120)).toBe(SESSION_SIDEBAR_MIN_WIDTH)
  expect(clampSessionTabsWidth(42, 120)).toBe(42)
  expect(clampSessionTabsWidth(100, 120)).toBe(SESSION_SIDEBAR_MAX_WIDTH)
  expect(clampSessionTabsWidth(100, 100)).toBe(SESSION_SIDEBAR_MAX_WIDTH)
})

test("a compact rail is allowed only when the terminal cannot fit both readable panes", () => {
  expect(clampSessionTabsWidth(0, 77)).toBe(SESSION_TABS_COMPACT_WIDTH)
  expect(clampSessionTabsWidth(12, 77)).toBe(12)
  expect(clampSessionTabsWidth(42, 54)).toBe(10)
  expect(sessionTabsFitVertically(69, SESSION_TABS_COMPACT_WIDTH)).toBe(true)
  expect(sessionTabsFitVertically(68, SESSION_TABS_COMPACT_WIDTH)).toBe(false)
})

test("the session sidebar docks without covering chat as soon as both minimum widths fit", () => {
  // The right pane can shrink to 28 columns while keeping at least 56 for chat.
  expect(sessionSidebarDocks(94, false)).toBe(true)
  expect(sessionSidebarDocks(93, false)).toBe(true)
  expect(sessionSidebarDocks(84, false)).toBe(true)
  expect(sessionSidebarDocks(83, false)).toBe(false)
  expect(sessionSidebarDocks(102, true)).toBe(true)
  expect(sessionSidebarDocks(84, true)).toBe(true)
  expect(sessionSidebarDocks(83, true)).toBe(false)
})

test("home project panel respects width bounds and preserves usable prompt space", () => {
  expect(homeProjectPanelWidth(160, 42)).toBe(42)
  expect(homeProjectPanelWidth(130, 34)).toBe(32)
  expect(homeProjectPanelWidth(128, 34)).toBe(30)
  expect(homeProjectPanelWidth(127, 34)).toBe(0)
  expect(homeProjectPanelWidth(90, 0)).toBe(0)
})

test("right panel resizing keeps the chat readable and allows useful width changes", () => {
  expect(clampSessionPaneWidth(10, 108)).toBe(28)
  expect(clampSessionPaneWidth(43, 108)).toBe(43)
  expect(clampSessionPaneWidth(100, 108)).toBe(52)
  expect(clampSessionPaneWidth(100, 90)).toBe(34)
  expect(clampSessionPaneWidth(30, 54)).toBe(1)
  expect(defaultSessionPaneWidth(108, false)).toBe(43)
  expect(defaultSessionPaneWidth(108, true)).toBe(38)
})

test("home panel resizing stays inside bounds and reserves room for the chat", () => {
  expect(clampHomeProjectPanelWidth(10, 108)).toBe(30)
  expect(clampHomeProjectPanelWidth(38, 108)).toBe(38)
  expect(clampHomeProjectPanelWidth(100, 108)).toBe(44)
  expect(clampHomeProjectPanelWidth(100, 150)).toBe(64)
  expect(clampHomeProjectPanelWidth(20, 80)).toBe(16)
})

test("a bound note stays centered with its chat on the right at compact widths", () => {
  expect(sessionPanesStacked(79, true)).toBe(true)
  expect(sessionPanesStacked(80, true)).toBe(false)
  expect(sessionPanesStacked(90, true)).toBe(false)
  expect(sessionPanesStacked(99, false)).toBe(true)
  expect(sessionPanesStacked(100, false)).toBe(false)
})

test("the note/chat divider keeps both columns readable and can move in either direction", () => {
  expect(clampNoteChatWidth(10, 100)).toBe(40)
  expect(clampNoteChatWidth(56, 100)).toBe(56)
  expect(clampNoteChatWidth(120, 100)).toBe(60)
  expect(clampNoteChatWidth(48, 80)).toBe(40)
})

test("a hidden note canvas releases its layout space to the chat", () => {
  expect(noteCanvasFlexGrow(false, false)).toBe(0)
  expect(noteCanvasFlexGrow(false, true)).toBe(0)
  expect(noteCanvasFlexGrow(true, false)).toBe(0)
  expect(noteCanvasFlexGrow(true, true)).toBe(1)
})

test("a docked session sidebar cannot be dragged into an unreadable strip", () => {
  expect(clampSessionSidebarWidth(10, 110)).toBe(38)
  expect(clampSessionSidebarWidth(32, 110)).toBe(38)
  expect(clampSessionSidebarWidth(44, 110)).toBe(44)
  expect(clampSessionSidebarWidth(90, 110)).toBe(54)
  expect(clampSessionSidebarWidth(90, 90)).toBe(34)
})

test("the transcript width is recalculated from current layout rather than a stale measured width", () => {
  const withNote = sessionTranscriptWidth({
    availableWidth: 110,
    hasCanvas: true,
    stacked: false,
    canvasHostWidth: 100,
    noteChatWidth: 42,
    rightPaneVisible: true,
    rightPaneWidth: 38,
    revealRailVisible: false,
    revealRailWidth: 3,
    fullscreenContentWidth: 0,
    fullscreen: false,
  })
  const withoutNote = sessionTranscriptWidth({
    availableWidth: 110,
    hasCanvas: false,
    stacked: false,
    canvasHostWidth: 100,
    noteChatWidth: 42,
    rightPaneVisible: true,
    rightPaneWidth: 38,
    revealRailVisible: false,
    revealRailWidth: 3,
    fullscreenContentWidth: 0,
    fullscreen: false,
  })
  expect(withNote).toBe(42)
  expect(withoutNote).toBe(72)
  expect(withoutNote).toBeGreaterThan(withNote)
  // A note split of 42 columns must not remain active when canvas is removed.
  expect(withoutNote).toBe(72)
})

test("the transcript fills the center column after switching from Notes to Projects", () => {
  expect(
    sessionTranscriptWidth({
      availableWidth: 110,
      hasCanvas: false,
      stacked: false,
      canvasHostWidth: 70,
      noteChatWidth: 40,
      rightPaneVisible: true,
      rightPaneWidth: 38,
      revealRailVisible: false,
      revealRailWidth: 3,
      fullscreenContentWidth: 0,
      fullscreen: false,
    }),
  ).toBe(72)
})

test("the initial transcript width is superseded by the measured session-pane width", () => {
  // The actual UI passes sessionPaneMeasuredWidth() after the first layout.
  // Keep this case to document the intended fallback when layout has not run yet.
  expect(
    sessionTranscriptWidth({
      availableWidth: 110,
      hasCanvas: false,
      stacked: false,
      canvasHostWidth: 70,
      noteChatWidth: 40,
      rightPaneVisible: true,
      rightPaneWidth: 38,
      revealRailVisible: false,
      revealRailWidth: 3,
      fullscreenContentWidth: 0,
      fullscreen: false,
    }),
  ).toBe(72)
})

test("transcript width follows the active note split and visible side rail", () => {
  const base = {
    availableWidth: 110,
    hasCanvas: true,
    stacked: false,
    canvasHostWidth: 100,
    noteChatWidth: 52,
    rightPaneVisible: false,
    rightPaneWidth: 38,
    revealRailVisible: false,
    revealRailWidth: 3,
    fullscreenContentWidth: 0,
    fullscreen: false,
  }
  expect(sessionTranscriptWidth(base)).toBe(52)
  expect(sessionTranscriptWidth({ ...base, stacked: true })).toBe(110)
  expect(
    sessionTranscriptWidth({
      ...base,
      hasCanvas: false,
      rightPaneVisible: false,
      revealRailVisible: true,
    }),
  ).toBe(107)
})

test("measured transcript width is only reused in the layout mode it belongs to", () => {
  const notesMeasurement = { width: 42, hasCanvas: true }
  const projectsMeasurement = { width: 72, hasCanvas: false }

  // The last Notes measurement is discarded while Projects performs its first layout.
  expect(resolveSessionPaneWidth(notesMeasurement, 72, false)).toBe(72)
  // The new Projects measurement is then reused rather than recalculating a stale split.
  expect(resolveSessionPaneWidth(projectsMeasurement, 108, false)).toBe(72)
  // The same rule works in the other direction when Notes is opened again.
  expect(resolveSessionPaneWidth(projectsMeasurement, 42, true)).toBe(42)
  expect(resolveSessionPaneWidth(notesMeasurement, 72, true)).toBe(42)
  expect(resolveSessionPaneWidth(undefined, 72, false)).toBe(72)
})

test("switching from Notes to Projects explicitly expands the session pane", () => {
  expect(
    sessionPaneBoxWidth({
      fullscreen: false,
      fullscreenWidth: 0,
      hasCanvas: true,
      stacked: false,
      noteChatWidth: 42,
    }),
  ).toBe(42)
  expect(
    sessionPaneBoxWidth({
      fullscreen: false,
      fullscreenWidth: 0,
      hasCanvas: false,
      stacked: false,
      noteChatWidth: 42,
    }),
  ).toBe("100%")
  expect(
    sessionPaneBoxWidth({
      fullscreen: false,
      fullscreenWidth: 0,
      hasCanvas: true,
      stacked: true,
      noteChatWidth: 42,
    }),
  ).toBe("100%")
  expect(
    sessionPaneBoxWidth({
      fullscreen: true,
      fullscreenWidth: 80,
      hasCanvas: false,
      stacked: false,
      noteChatWidth: 42,
    }),
  ).toBe(80)
})

test("Projects transcript width is the actual center host, without subtracting sidebar twice", () => {
  expect(sessionTranscriptWidth({
    availableWidth: 120,
    hasCanvas: false,
    stacked: false,
    canvasHostWidth: 72,
    noteChatWidth: 40,
    rightPaneVisible: true,
    rightPaneWidth: 40,
    revealRailVisible: false,
    revealRailWidth: 3,
    fullscreenContentWidth: 0,
    fullscreen: false,
  })).toBe(80)
})

test("the mobile layout is chosen explicitly or by the Termux command until a layout is set", () => {
  expect(mobileLayout("mobile", false)).toBe(true)
  expect(mobileLayout(undefined, true)).toBe(true)
  expect(mobileLayout(undefined, false)).toBe(false)
  // Any layout picked in the settings wins over the Termux default.
  expect(mobileLayout("auto", true)).toBe(false)
  expect(mobileLayout("full", true)).toBe(false)
  // Mobile panels use the compact widths whatever the terminal size.
  expect(compactLayout("mobile", 200)).toBe(true)
})
