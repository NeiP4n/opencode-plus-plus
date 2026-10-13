import { Plugin } from "@opencode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { FilePath } from "../../ui/file-path"
import { useWorkingDirectoryActions } from "../../ui/working-directory-actions"
import { usePromptMove } from "../../component/prompt/move"
import { hasConnectedProvider } from "../../util/connected-provider"
import { useCompactLayout } from "../../ui/compact-layout"
import { useT } from "../../util/i18n"
import { HoverAction } from "../../component/hover-action"

export function SidebarOnboarding(props: { context: Plugin.Context; sessionID: string }) {
  const t = useT()
  const dimensions = useTerminalDimensions()
  const [onboarding, updateOnboarding] = props.context.storage.store("getting-started", {
    initial: { dismissed: false },
  })
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const integrations = createMemo(() =>
    props.context.data.location.integration.list(session()?.location ?? props.context.location),
  )
  const showOnboarding = createMemo(() => {
    if (dimensions().height < 22) return false
    const list = integrations()
    if (!list) return false
    return !onboarding.dismissed && !hasConnectedProvider(list)
  })

  return (
    <Show when={showOnboarding()}>
      <box
        id="sidebar.footer.getting-started"
        backgroundColor={props.context.theme.background.raised.high}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        gap={1}
      >
        <text flexShrink={0} fg={props.context.theme.text.base}>
          ⬖
        </text>
        <box flexGrow={1} gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={props.context.theme.text.base}>
              <b>{t("Getting started")}</b>
            </text>
            <HoverAction
              id="sidebar.footer.getting-started.dismiss"
              paddingLeft={1}
              paddingRight={1}
              onClick={() => {
                void updateOnboarding((draft) => {
                  draft.dismissed = true
                }).catch((error) => console.error("Failed to dismiss sidebar onboarding", error))
              }}
            >
              <text fg={props.context.theme.text.muted}>✕</text>
            </HoverAction>
          </box>
          <text fg={props.context.theme.text.muted}>
            {t("Opencode++ includes free models so you can start immediately.")}
          </text>
          <text fg={props.context.theme.text.muted}>
            {t("Connect one of 75+ providers to use other models, including Claude, GPT and Gemini.")}
          </text>
          <HoverAction
            id="sidebar.footer.getting-started.connect"
            flexGrow={1}
            flexShrink={1}
            gap={1}
            justifyContent="space-between"
            onClick={() => props.context.keymap.dispatch("provider.connect")}
          >
            <text fg={props.context.theme.text.base}>{t("Connect provider")}</text>
            <text fg={props.context.theme.text.muted}>/connect</text>
          </HoverAction>
        </box>
      </box>
    </Show>
  )
}

function SidebarFooter(props: { context: Plugin.Context; sessionID: string }) {
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const layout = useCompactLayout()
  const move = usePromptMove({
    projectID: () => session()?.projectID,
    sessionID: () => props.sessionID,
  })
  const actions = useWorkingDirectoryActions({
    directory: () => props.context.location?.directory,
    onMove: () => void move.open(),
  })
  const directory = createMemo(() => {
    if (!props.context.location) return undefined
    const value = props.context.ui.format.path(props.context.location.directory)
    const branch = props.context.data.location.vcs.info(props.context.location)?.branch.current
    return branch ? `${value}:${branch}` : value
  })
  return (
    <box gap={1}>
      <SidebarOnboarding context={props.context} sessionID={props.sessionID} />
      <Show when={directory()}>
        {(value) => (
          <box
            id="sidebar.footer.location"
            onMouseOver={actions.onMouseOver}
            onMouseOut={actions.onMouseOut}
            onMouseUp={actions.onMouseUp}
          >
            <FilePath
              value={value()}
              maxWidth={layout.sidebarWidth() - (layout.compact() ? 2 : 4)}
              fg={actions.hovered() ? props.context.theme.text.base : props.context.theme.text.muted}
            />
          </box>
        )}
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.footer",
  setup(context) {
    // Append keeps the path open to additive plugin claims; an external
    // replace still takes the boundary over.
    context.ui.slot({
      append: "sidebar.footer",
      render: (props) => <SidebarFooter context={context} sessionID={props.sessionID} />,
    })
  },
})
