import { useTerminalDimensions } from "@opentui/solid"
import { useOptionalConfig } from "../config"
import { useOptionalPanel } from "../context/panel"
import { useStorage } from "../context/storage"
import {
  clampSessionSidebarWidth,
  compactLayout,
  SESSION_SIDEBAR_COMPACT_WIDTH,
  SESSION_SIDEBAR_WIDTH,
} from "./layout"

// Whether the panels use the compact layout right now, and the session sidebar width that goes with it.
export function useCompactLayout() {
  const config = useOptionalConfig()
  const dimensions = useTerminalDimensions()
  const panels = useOptionalPanel()
  const [layout] = useStorage().store<{ sidebarWidth?: number }>("layout", { initial: {} })
  const compact = () => compactLayout(config?.data.layout, dimensions().width)
  const sidebarWidth = () =>
    clampSessionSidebarWidth(
      layout.sidebarWidth ??
        (compact() ? SESSION_SIDEBAR_COMPACT_WIDTH : SESSION_SIDEBAR_WIDTH),
      panels?.width() || dimensions().width,
    )
  return {
    compact,
    sidebarWidth,
  }
}
