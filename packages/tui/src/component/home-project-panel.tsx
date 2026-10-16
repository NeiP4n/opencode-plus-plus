import { createMemo, createResource, Show } from "solid-js"
import { Orchestra } from "@opencode/schema/orchestra"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useProjects } from "../context/projects"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useT } from "../util/i18n"
import { Sidebar } from "../routes/session/sidebar"

export function HomeProjectPanel(props: {
  width: number
  collapsed?: boolean
  onHide?: () => void
  onShow?: () => void
}) {
  const theme = useTheme()
  const t = useT()
  const route = useRoute()
  const client = useClient()
  const data = useData()
  const location = useLocation()
  const projects = useProjects()

  const currentDirectory = () =>
    location.current?.directory ?? location.ref?.directory ?? data.location.default().directory

  const project = createMemo(() => {
    const all = projects.list()
    const currentRoute = route.data
    if (currentRoute.type === "home" && currentRoute.project) {
      const selected = all.find((item) => item.id === currentRoute.project)
      if (selected) return selected
    }
    const owner = Orchestra.ownerOf(all, currentDirectory())
    return owner ?? (all.length === 1 ? all[0] : undefined)
  })

  // Use the project's existing session roster; never create a session just to populate the panel.
  const [roster] = createResource(
    () => project()?.id,
    async (projectID) => {
      try {
        const result = await client.api.orchestra.project.sessions({ projectID })
        if (project()?.id !== projectID) return []
        result.data.forEach((session) => data.session.remember(session))
        return result.data
      } catch {
        return []
      }
    },
  )
  const mainSessionID = () => {
    const main = project()?.main
    return main && roster()?.some((session) => session.id === main) ? main : undefined
  }

  return (
    <Show
      when={!props.collapsed}
      fallback={
        <box
          width={props.width}
          height="100%"
          flexShrink={0}
          backgroundColor={theme.background.raised.base}
          border={["left"]}
          borderColor={theme.border.base}
          paddingTop={1}
        >
          <box
            id="home-project-panel-show"
            width={3}
            height={1}
            flexShrink={0}
            alignItems="center"
            justifyContent="center"
            backgroundColor={theme.background.raised.base}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseUp={(event) => {
              event.stopPropagation()
              props.onShow?.()
            }}
          >
            <text fg={theme.text.action.primary.base}>‹</text>
          </box>
        </box>
      }
    >
      <Show
        when={mainSessionID()}
        fallback={
          <box
            width={props.width}
            height="100%"
            position="relative"
            flexShrink={0}
            minWidth={0}
            minHeight={0}
            flexDirection="column"
            padding={1}
            gap={1}
            backgroundColor={theme.background.raised.base}
            border={["left"]}
            borderColor={theme.border.base}
          >
            <box flexDirection="column" flexShrink={0} gap={1} paddingRight={5}>
              <text fg={theme.text.base} wrapMode="none" truncate>
                <b>{t("Project overview")}</b>
              </text>
              <text fg={theme.text.muted} wrapMode="none" truncate>
                {project()?.name ?? t("Current directory")}
              </text>
              <text fg={theme.text.muted} wrapMode="none" truncate>
                {project()?.directory ?? currentDirectory()}
              </text>
            </box>
            <text fg={theme.text.muted} wrapMode="word">
              {roster.loading
                ? t("Loading project session…")
                : t("No orchestrator session is available for this project yet.")}
            </text>
            <Show when={props.onHide}>
              <box
                id="home-project-panel-hide"
                position="absolute"
                top={1}
                right={1}
                width={5}
                height={1}
                flexShrink={0}
                alignItems="center"
                justifyContent="center"
                onMouseDown={(event) => event.stopPropagation()}
                onMouseUp={(event) => {
                  event.stopPropagation()
                  props.onHide?.()
                }}
              >
                <text fg={theme.text.action.primary.base} wrapMode="none">
                  ›
                </text>
              </box>
            </Show>
          </box>
        }
      >
        {(sessionID) => (
          <Sidebar sessionID={sessionID()} width={props.width} borderLeft onHide={props.onHide} />
        )}
      </Show>
    </Show>
  )
}
