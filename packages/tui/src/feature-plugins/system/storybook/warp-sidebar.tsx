import { useTerminalDimensions } from "@opentui/solid"
import type { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { WarpSidebar } from "../warp"
import type { WarpConnectionState } from "../warp-status"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

// The session sidebar is a narrow column: the block gets the sidebar width minus its own
// padding (2 + 2), the content padding (1) and the scrollbar column (1).
const NARROW = 39
const WIDE = 46
const CHROME = 6

type Scenario = {
  label: string
  state: WarpConnectionState
  proxyEnabled: boolean
  autoRotateEnabled: boolean
  exitIp: string
  directIp: string
}

const scenarios: Scenario[] = [
  {
    label: "маршрут через WARP, IPv4",
    state: "connected",
    proxyEnabled: true,
    autoRotateEnabled: true,
    exitIp: "104.28.218.14 · WARP",
    directIp: "89.106.72.63 · DE",
  },
  {
    label: "маршрут через WARP, IPv6",
    state: "connected",
    proxyEnabled: true,
    autoRotateEnabled: true,
    exitIp: "2a09:bac1:1e20:798:: · WARP",
    directIp: "89.106.72.63 · DE",
  },
  {
    label: "маршрут напрямую",
    state: "connected",
    proxyEnabled: false,
    autoRotateEnabled: false,
    exitIp: "",
    directIp: "89.106.72.63 · DE",
  },
  {
    label: "WARP отключён",
    state: "disconnected",
    proxyEnabled: false,
    autoRotateEnabled: false,
    exitIp: "",
    directIp: "89.106.72.63 · DE",
  },
  {
    label: "WARP CLI не найден",
    state: "unavailable",
    proxyEnabled: false,
    autoRotateEnabled: false,
    exitIp: "",
    directIp: "89.106.72.63 · DE",
  },
]

function WarpSidebarStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [scenario, setScenario] = createSignal(0)
  const [width, setWidth] = createSignal(NARROW)
  const current = () => scenarios[scenario()]
  const columns = () => width() - CHROME

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      ...scenarios.map((item, index) => ({
        bind: ["a", "b", "c", "d", "e"][index],
        title: item.label,
        group: "Storybook",
        run: () => setScenario(index),
      })),
      {
        bind: "w",
        title: "Toggle the sidebar width",
        group: "Storybook",
        run: () => setWidth((value) => (value === NARROW ? WIDE : NARROW)),
      },
      {
        bind: "r",
        title: "Reset",
        group: "Storybook",
        run: () => {
          setScenario(0)
          setWidth(NARROW)
        },
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.base} flexDirection="column">
      <box flexDirection="row" flexGrow={1}>
        <box
          width={width()}
          flexShrink={0}
          backgroundColor={theme.background.raised.base}
          flexDirection="column"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
        >
          <box paddingRight={1}>
            <WarpSidebar
              context={props.context}
              status={{ state: current().state, details: "Fixture" }}
              busy={{ action: null }}
              proxyEnabled={current().proxyEnabled}
              autoRotateEnabled={current().autoRotateEnabled}
              exitIp={current().exitIp}
              directIp={current().directIp}
              open={() => {}}
              toggleProxy={() => setScenario((value) => (value === 2 ? 0 : 2))}
              toggleAutoRotate={() => {}}
            />
          </box>
          <box flexGrow={1} />
          {/* The ruler marks the exact width the block may use; a line that runs past it is cut. */}
          <text fg={theme.text.muted} wrapMode="none">
            {"0123456789".repeat(6).slice(0, columns())}
          </text>
        </box>
        <box flexGrow={1} />
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / warp sidebar"
        status={current().label}
        details={[`${columns()} колонок`]}
        controls={[
          { shortcut: "a-e", label: "сценарий" },
          { shortcut: "w", label: "ширина" },
          { shortcut: "r", label: "сброс" },
          { shortcut: "esc", label: "назад" },
        ]}
      />
    </box>
  )
}

export const warpSidebarStory: Story = {
  id: "warp-sidebar",
  title: "WARP sidebar block",
  render: (context) => <WarpSidebarStory context={context} />,
}
