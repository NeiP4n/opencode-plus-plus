import { createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import { useT } from "../util/i18n"
import { errorMessage } from "../util/error"
import { listEverySession, removeEverySession, type SessionCleanupApi } from "../util/clear-sessions"

type ConfirmOptions = {
  title: string
  message: string
  label: { confirm: string; cancel: string }
}

type NotifyOptions = {
  message: string
  variant: "info" | "success" | "warning" | "error"
  duration?: number
}

/**
 * The destructive action at the bottom of the left panel: it clears every
 * session on this machine, in every project. The count is taken before the
 * question is asked, so the operator sees what the answer is about.
 */
export function ClearSessionsAction(props: {
  api: SessionCleanupApi
  confirm: (options: ConfirmOptions) => Promise<boolean | undefined>
  notify: (options: NotifyOptions) => void
  currentSessionID?: string
  leaveCurrentSession: () => void
}) {
  const t = useT()
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const [busy, setBusy] = createSignal(false)

  const clear = async () => {
    if (busy()) return
    setBusy(true)
    try {
      const sessions = await listEverySession(props.api)
      if (!sessions.length) {
        props.notify({ message: t("No sessions to delete"), variant: "info" })
        return
      }
      const confirmed = await props.confirm({
        title: t("Clear all sessions"),
        message: t(
          "Delete {count} sessions on this machine, in every project? The current session is closed too. This cannot be undone.",
          { count: sessions.length },
        ),
        label: { confirm: t("Delete all"), cancel: t("Cancel") },
      })
      if (!confirmed) return
      if (props.currentSessionID && sessions.some((session) => session.id === props.currentSessionID)) {
        props.leaveCurrentSession()
      }
      const { removed, failures } = await removeEverySession(props.api, sessions)
      props.notify({
        message: failures.length
          ? t("Deleted {removed} of {total} sessions; {failed} could not be deleted.", {
              removed,
              total: sessions.length,
              failed: failures.length,
            })
          : t("Deleted {count} sessions.", { count: removed }),
        variant: failures.length ? "warning" : "success",
        duration: 6000,
      })
    } catch (error) {
      props.notify({
        message: t("Failed to clear sessions: {error}", { error: errorMessage(error) }),
        variant: "error",
        duration: 6000,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <box id="project-tree.clear-sessions" flexShrink={0} paddingLeft={1} paddingRight={1} paddingTop={1}>
      <box
        id="project-tree.clear-sessions.action"
        flexDirection="row"
        backgroundColor={hovered() ? theme.background.action.destructive.hovered : undefined}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={(event) => {
          event.stopPropagation()
          void clear()
        }}
      >
        {/* The destructive text color is drawn for the destructive background, so the hovered
            state pairs them. At rest the error color keeps the label readable on the panel. */}
        <text fg={hovered() ? theme.text.action.destructive.hovered : theme.text.feedback.error.base}>
          {busy() ? t("Clearing…") : t("Clear all sessions")}
        </text>
      </box>
    </box>
  )
}
