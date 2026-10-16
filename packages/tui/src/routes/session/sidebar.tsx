import { useData } from "../../context/data"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useConfig } from "../../config"
import { HoverAction } from "../../component/hover-action"
import { Slot } from "../../plugin/render"
import { withTimestampedFallback } from "@opencode/util/session-title-fallback"
import { TextAttributes } from "@opentui/core"
import "../../component/title-shimmer"

import { getScrollAcceleration } from "../../util/scroll"
import { useCompactLayout } from "../../ui/compact-layout"

export function Sidebar(props: { sessionID: string; onHide?: () => void; width?: number; borderLeft?: boolean }) {
  const data = useData()
  const theme = useTheme()
  const config = useConfig().data
  const session = createMemo(() => data.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(config))
  const layout = useCompactLayout()
  const width = () => props.width ?? layout.sidebarWidth()

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.background.raised.base}
        width={width()}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={layout.compact() ? 1 : 2}
        paddingRight={layout.compact() ? 1 : 2}
        position="relative"
        border={props.borderLeft ? ["left"] : undefined}
        borderColor={theme.border.base}
      >
        <box flexDirection="row" alignItems="center" flexShrink={0} paddingRight={1} paddingBottom={1} gap={1}>
          <box flexGrow={1} minWidth={0}>
            <title_shimmer
              fg={theme.text.base}
              rename={{
                pending: data.session.title.pending(props.sessionID),
                title: withTimestampedFallback(session()),
              }}
              enabled={config.animations ?? true}
              backdrop={theme.background.raised.base}
              attributes={
                data.session.title.pending(props.sessionID) && config.animations === false
                  ? TextAttributes.DIM
                  : TextAttributes.BOLD
              }
            >
              {withTimestampedFallback(session())}
            </title_shimmer>
          </box>
          <Show when={props.onHide}>
            <HoverAction id="session.sidebar.hide" onClick={() => props.onHide?.()} paddingLeft={1} paddingRight={1}>
              <text fg={theme.text.action.primary.base}>›</text>
            </HoverAction>
          </Show>
        </box>
        <scrollbox
          flexGrow={1}
          minHeight={0}
          scrollAcceleration={scrollAcceleration()}
          // The sidebar only scrolls vertically; a horizontal bar steals a row during initial layout.
          horizontalScrollbarOptions={{ visible: false }}
          verticalScrollbarOptions={{
            // Use the content's reserved right padding instead of changing its width when the bar toggles.
            position: "absolute",
            right: 0,
            top: 0,
            width: 1,
            height: "100%",
            trackOptions: {
              backgroundColor: theme.background.raised.base,
              foregroundColor: theme.scrollbar.base,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <Slot path="sidebar.content" input={{ sessionID: props.sessionID }} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Slot path="sidebar.footer" input={{ sessionID: props.sessionID }} />
        </box>
      </box>
    </Show>
  )
}
