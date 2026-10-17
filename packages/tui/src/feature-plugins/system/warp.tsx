import { execFile } from "node:child_process"
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { hoverBackground } from "../../ui/hover"
import { parseWarpStatus, warpCliUnavailable, warpStatusError, type WarpConnectionState, type WarpStatus } from "./warp-status"

type WarpAction = "refresh" | "connect" | "disconnect" | "reconnect" | "reset"
type SharedBusy = { action: WarpAction | null }

const RESET_DELAY_MS = 900
const STATUS_REFRESH_MS = 30_000

function language(context: Plugin.Context) {
  return context.ui.language() === "ru" ? "ru" : "en"
}

function text(context: Plugin.Context, en: string, ru: string) {
  return language(context) === "ru" ? ru : en
}

function statusLabel(context: Plugin.Context, state: WarpConnectionState) {
  const ru = language(context) === "ru"
  switch (state) {
    case "checking":
      return ru ? "Проверка…" : "Checking…"
    case "connected":
      return ru ? "Подключено" : "Connected"
    case "disconnected":
      return ru ? "Отключено" : "Disconnected"
    case "unavailable":
      return ru ? "WARP CLI не найден" : "WARP CLI not found"
    default:
      return ru ? "Статус неизвестен" : "Status unknown"
  }
}

function statusColor(context: Plugin.Context, state: WarpConnectionState) {
  const theme = context.theme
  if (state === "connected") return theme.text.feedback.success.base
  if (state === "disconnected") return theme.text.feedback.warning.base
  if (state === "unavailable" || state === "unknown") return theme.text.feedback.error.base
  return theme.text.muted
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Execute fixed warp-cli arguments without a shell, so nothing from the chat is interpreted as a command. */
function runWarp(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "warp-cli",
      [...args],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 128 * 1024,
      },
      (error, stdout, stderr) => {
        const output = [String(stdout ?? "").trim(), String(stderr ?? "").trim()].filter(Boolean).join("\n")
        if (error) {
          reject(new Error(output || error.message))
          return
        }
        resolve(output)
      },
    )
  })
}

async function readWarpStatus(): Promise<WarpStatus> {
  try {
    return parseWarpStatus(await runWarp(["status"]))
  } catch (cause) {
    const message = messageOf(cause)
    if (/\bENOENT\b|not recognized as an internal or external command|executable file not found|could not find.*warp-cli/i.test(message)) {
      return warpCliUnavailable(message)
    }
    return warpStatusError(message)
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function performWarpAction(action: WarpAction): Promise<WarpStatus> {
  if (action === "refresh") return readWarpStatus()

  if (action === "connect") {
    await runWarp(["connect"])
    return readWarpStatus()
  }

  if (action === "disconnect") {
    await runWarp(["disconnect"])
    return readWarpStatus()
  }

  const current = await readWarpStatus()
  if (current.state === "unavailable") throw new Error(current.details)

  if (current.state !== "disconnected") await runWarp(["disconnect"])
  await wait(RESET_DELAY_MS)

  if (action === "reconnect") {
    await runWarp(["connect"])
    return readWarpStatus()
  }

  // A registration refresh may disrupt organization-managed / Zero Trust WARP.
  // It is only exposed behind a confirmation dialog in the visual panel.
  await runWarp(["registration", "delete"])
  await runWarp(["registration", "new"])
  await runWarp(["connect"])
  return readWarpStatus()
}

function setSharedStatus(
  set: (mutation: (draft: WarpStatus) => void) => void,
  value: WarpStatus,
) {
  set((draft) => {
    draft.state = value.state
    draft.details = value.details
  })
}

function setSharedBusy(
  set: (mutation: (draft: SharedBusy) => void) => void,
  action: WarpAction | null,
) {
  set((draft) => {
    draft.action = action
  })
}

function ActionButton(props: {
  context: Plugin.Context
  id: string
  label: string
  run: () => void
  disabled?: boolean
  emphasized?: boolean
}) {
  const [hovered, setHovered] = createSignal(false)
  const theme = () => props.context.theme
  const base = () => theme().text.action?.primary?.base ?? theme().text.base
  const hover = () => theme().text.action?.primary?.hovered ?? theme().increase(base(), 2)
  return (
    <box
      id={props.id}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={hovered() && !props.disabled ? hoverBackground(theme()) : undefined}
      onMouseOver={() => setHovered(!props.disabled)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        if (!props.disabled) props.run()
      }}
    >
      <text
        fg={props.disabled ? theme().text.muted : hovered() ? hover() : props.emphasized ? base() : theme().text.muted}
        wrapMode="none"
      >
        {props.label}
      </text>
    </box>
  )
}

function WarpSidebar(props: {
  context: Plugin.Context
  status: WarpStatus
  busy: SharedBusy
  open: () => void
  refresh: () => void
}) {
  const theme = () => props.context.theme
  const ru = () => language(props.context) === "ru"
  return (
    <box gap={1}>
      <box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
        <text fg={theme().text.base}>
          <b>WARP</b>
        </text>
        <text fg={statusColor(props.context, props.status.state)} wrapMode="none">
          {statusLabel(props.context, props.status.state)}
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <ActionButton
          context={props.context}
          id="warp.sidebar.open"
          label={ru() ? "[ Управление ↗ ]" : "[ Manage ↗ ]"}
          run={props.open}
          emphasized
        />
        <ActionButton
          context={props.context}
          id="warp.sidebar.refresh"
          label={ru() ? "[ Обновить ]" : "[ Refresh ]"}
          run={props.refresh}
          disabled={props.busy.action !== null}
        />
      </box>
    </box>
  )
}

function WarpPage(props: {
  context: Plugin.Context
  status: WarpStatus
  busy: SharedBusy
  run: (action: WarpAction) => void
  onClose: () => void
}) {
  const theme = () => props.context.theme
  const ru = () => language(props.context) === "ru"
  const pending = () => props.busy.action !== null
  const working = () => {
    switch (props.busy.action) {
      case "refresh": return ru() ? "Проверка статуса…" : "Checking status…"
      case "connect": return ru() ? "Подключение WARP…" : "Connecting WARP…"
      case "disconnect": return ru() ? "Отключение WARP…" : "Disconnecting WARP…"
      case "reconnect": return ru() ? "Переподключение…" : "Reconnecting…"
      case "reset": return ru() ? "Сброс регистрации…" : "Resetting registration…"
      default: return ""
    }
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: ru() ? "Закрыть WARP" : "Close WARP",
        group: "WARP",
        run: props.onClose,
      },
    ],
  }))

  const reset = async () => {
    const accepted = await props.context.ui.dialog.confirm({
      title: ru() ? "Сбросить регистрацию WARP?" : "Reset WARP registration?",
      message: ru()
        ? "Будет удалена текущая регистрация WARP и создана новая. Не используйте это для корпоративного WARP / Zero Trust: подключение может потребовать повторной настройки. Сброс не гарантирует снятие лимита у AI-провайдера."
        : "This deletes the current WARP registration and creates a new one. Do not use it with organization-managed WARP / Zero Trust: setup may need to be repeated. This does not guarantee an AI provider's rate limit will reset.",
      label: { confirm: ru() ? "Сбросить" : "Reset", cancel: ru() ? "Отмена" : "Cancel" },
    })
    if (accepted) props.run("reset")
  }

  return (
    <box width="100%" height="100%" backgroundColor={theme().background.base} padding={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
        <box flexGrow={1} minWidth={0} gap={1}>
          <text fg={theme().text.base}>
            <b>Cloudflare WARP</b>
          </text>
          <text fg={theme().text.muted} wrapMode="word">
            {ru()
              ? "Управление VPN-подключением и восстановление регистрации после проблем с доступом."
              : "Manage the WARP connection and refresh its registration when troubleshooting access."}
          </text>
        </box>
        <ActionButton
          context={props.context}
          id="warp.close"
          label={ru() ? "[ Назад · Esc ]" : "[ Back · Esc ]"}
          run={props.onClose}
        />
      </box>

      <box padding={1} gap={1}>
        <box flexDirection="row" alignItems="center" gap={1}>
          <text fg={statusColor(props.context, props.status.state)}>●</text>
          <text fg={theme().text.base}>
            <b>{statusLabel(props.context, props.status.state)}</b>
          </text>
          <text fg={theme().text.muted}>{pending() ? working() : ""}</text>
        </box>
        <text fg={theme().text.muted} wrapMode="word">
          {props.status.details}
        </text>
      </box>

      <box flexDirection="row" gap={2} flexWrap="wrap">
        <ActionButton
          context={props.context}
          id="warp.refresh"
          label={ru() ? "Обновить статус" : "Refresh status"}
          run={() => props.run("refresh")}
          disabled={pending()}
          emphasized
        />
        <ActionButton
          context={props.context}
          id="warp.connect"
          label={ru() ? "Подключить" : "Connect"}
          run={() => props.run("connect")}
          disabled={pending() || props.status.state === "connected" || props.status.state === "unavailable"}
          emphasized
        />
        <ActionButton
          context={props.context}
          id="warp.disconnect"
          label={ru() ? "Отключить" : "Disconnect"}
          run={() => props.run("disconnect")}
          disabled={pending() || props.status.state !== "connected"}
        />
        <ActionButton
          context={props.context}
          id="warp.reconnect"
          label={ru() ? "Переподключить" : "Reconnect"}
          run={() => props.run("reconnect")}
          disabled={pending() || props.status.state === "unavailable"}
        />
        <ActionButton
          context={props.context}
          id="warp.reset"
          label={ru() ? "Сбросить регистрацию…" : "Reset registration…"}
          run={() => void reset()}
          disabled={pending() || props.status.state === "unavailable"}
        />
      </box>

      <box paddingTop={1} gap={1}>
        <text fg={theme().text.feedback.warning.base} wrapMode="word">
          {ru()
            ? "Сначала попробуйте «Переподключить». Полный сброс регистрации — только для личного WARP, не корпоративного Zero Trust."
            : "Try Reconnect first. Reset registration is for personal WARP only, not organization-managed Zero Trust."}
        </text>
        <text fg={theme().text.muted} wrapMode="word">
          {ru()
            ? "Команда /update открывает эту панель. Также можно использовать /warp или палитру команд."
            : "Use /update to open this panel. /warp and the command palette work too."}
        </text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.warp",
  setup(context) {
    const [previous, setPrevious] = createSignal({ ...context.ui.router.current() })
    const [status, updateStatus] = context.storage.memory<WarpStatus>("status", {
      initial: { state: "checking", details: "Checking Cloudflare WARP…" },
    })
    const [busy, updateBusy] = context.storage.memory<SharedBusy>("busy", { initial: { action: null } })

    const refresh = async () => {
      if (busy.action !== null) return
      setSharedStatus(updateStatus, await readWarpStatus())
    }

    const perform = async (action: WarpAction) => {
      if (busy.action !== null) return
      setSharedBusy(updateBusy, action)
      try {
        const next = await performWarpAction(action)
        setSharedStatus(updateStatus, next)
        if (action !== "refresh") {
          context.ui.toast.show({
            title: text(context, "WARP action finished", "Операция WARP завершена"),
            message: statusLabel(context, next.state) + ": " + next.details.slice(0, 240),
            variant: next.state === "connected" ? "success" : "info",
          })
        }
      } catch (cause) {
        const message = messageOf(cause)
        setSharedStatus(updateStatus, warpStatusError(message))
        context.ui.toast.show({
          title: text(context, "WARP action failed", "Ошибка WARP"),
          message,
          variant: "error",
        })
      } finally {
        setSharedBusy(updateBusy, null)
      }
    }

    const open = () => {
      const current = context.ui.router.current()
      if (current.type === "plugin" && current.name === "warp") return
      setPrevious({ ...current })
      context.ui.dialog.clear()
      context.ui.router.navigate({ type: "plugin", name: "warp" })
    }
    const close = () => context.ui.router.navigate(previous())

    context.ui.router.register({
      name: "warp",
      render: () => <WarpPage context={context} status={status} busy={busy} run={(action) => void perform(action)} onClose={close} />,
    })

    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "opencode.warp.open",
              title: text(context, "Cloudflare WARP controls", "Управление Cloudflare WARP"),
              description: text(context, "View status, connect, reconnect, or reset registration", "Статус, подключение, переподключение и сброс регистрации"),
              group: "System",
              slash: { name: "warp" },
              palette: true,
              run: open,
            },
            {
              id: "opencode.warp.update",
              title: text(context, "Refresh WARP registration", "Обновить регистрацию WARP"),
              description: text(context, "Reset and recreate the personal WARP registration, then reconnect", "Сбросить и создать заново регистрацию личного WARP, затем подключиться"),
              group: "System",
              slash: { name: "update" },
              palette: true,
              run() {
                open()
                void perform("reset")
              },
            },
          ],
        }))
        return null
      },
    })

    context.ui.slot({
      append: "sidebar.content",
      render: () => <WarpSidebar context={context} status={status} busy={busy} open={open} refresh={() => void perform("refresh")} />,
    })

    void refresh()
    const timer = setInterval(() => void refresh(), STATUS_REFRESH_MS)

    return () => clearInterval(timer)
  },
})
