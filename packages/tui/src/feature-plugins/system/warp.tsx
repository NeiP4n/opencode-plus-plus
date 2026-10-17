import { execFile, spawn } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { createConnection } from "node:net"
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { hoverBackground } from "../../ui/hover"
import { parseWarpStatus, warpCliUnavailable, warpStatusError, type WarpConnectionState, type WarpStatus } from "./warp-status"

type WarpAction = "refresh" | "connect" | "disconnect" | "reconnect" | "reset" | "install" | "proxy" | "disableProxy"
type SharedBusy = { action: WarpAction | null }

const RESET_DELAY_MS = 900
const STATUS_REFRESH_MS = 30_000
const WARP_PROXY_URL = "http://127.0.0.1:40000"
const WARP_PROXY_BYPASS = ["localhost", "127.0.0.1", "::1"]

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


function commandExists(command: string): Promise<boolean> {
  const checker = process.platform === "win32" ? "where.exe" : "which"
  return new Promise((resolve) => {
    execFile(checker, [command], { timeout: 5_000, windowsHide: true }, (error) => resolve(!error))
  })
}

function runInteractive(context: Plugin.Context, command: string, args: string[]): Promise<void> {
  context.renderer.suspend()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      context.renderer.resume()
      if (error) reject(error)
      else resolve()
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { stdio: "inherit", windowsHide: false })
    } catch (cause) {
      finish(cause instanceof Error ? cause : new Error(String(cause)))
      return
    }
    child.once("error", (cause) => finish(cause instanceof Error ? cause : new Error(String(cause))))
    child.once("close", (code) => {
      if (code === 0) finish()
      else finish(new Error("Installer exited with code " + String(code ?? "unknown") + "."))
    })
  })
}

function openExternal(url: string): Promise<void> {
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open"
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "start", "", url] : [url]
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

async function hasPath(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function installWarp(context: Plugin.Context): Promise<boolean> {
  const termux = Boolean(process.env.PREFIX?.includes("/com.termux/") || process.env.TERMUX_VERSION)
  const installGuide = "https://developers.cloudflare.com/warp-client/get-started/"
  let command: string | undefined
  let args: string[] = []
  let confirmation = text(context, "This will install Cloudflare WARP using the available package manager.", "Это установит Cloudflare WARP через доступный менеджер пакетов.")
  let isAUR = false

  if (termux || process.platform === "android") {
    await context.ui.dialog.alert({
      title: text(context, "WARP on Android / Termux", "WARP на Android / Termux"),
      message: text(
        context,
        "Cloudflare's Android VPN app is separate from the Termux CLI. Android does not support WARP Local Proxy mode for routing only OpenCode traffic, so installing the mobile app would not meet the per-app routing requirement.",
        "Приложение Cloudflare для Android — отдельный VPN-клиент, не CLI для Termux. Режим WARP Local Proxy для маршрутизации только OpenCode на Android не поддерживается, поэтому мобильное приложение не решит задачу изоляции трафика.",
      ),
    })
    await openExternal("https://one.one.one.one/")
    return false
  }

  if (process.platform === "win32") {
    if (!(await commandExists("winget"))) {
      await context.ui.dialog.alert({
        title: text(context, "Install WARP", "Установка WARP"),
        message: text(context, "Windows Package Manager (winget) was not found. Opening Cloudflare's official download page.", "Менеджер пакетов winget не найден. Открываю официальную страницу загрузки Cloudflare."),
      })
      await openExternal("https://one.one.one.one/")
      return false
    }
    command = "winget"
    args = ["install", "--id", "Cloudflare.Warp", "-e", "--accept-source-agreements", "--accept-package-agreements"]
  } else if (process.platform === "darwin") {
    if (!(await commandExists("brew"))) {
      await context.ui.dialog.alert({
        title: text(context, "Install WARP", "Установка WARP"),
        message: text(context, "Homebrew was not found. Opening Cloudflare's official download page.", "Homebrew не найден. Открываю официальную страницу загрузки Cloudflare."),
      })
      await openExternal("https://one.one.one.one/")
      return false
    }
    command = "brew"
    args = ["install", "--cask", "cloudflare-warp"]
  } else if (process.platform === "linux") {
    let release = ""
    try {
      release = await readFile("/etc/os-release", "utf8")
    } catch {}
    if (/ID=(arch|cachyos|manjaro|endeavouros|garuda|artix)/i.test(release) || /ID_LIKE=.*arch/i.test(release)) {
      const helper = (await commandExists("paru")) ? "paru" : (await commandExists("yay")) ? "yay" : undefined
      if (!helper) {
        await context.ui.dialog.alert({
          title: text(context, "Install WARP on Arch", "Установка WARP в Arch"),
          message: text(
            context,
            "No AUR helper (paru or yay) was found. Cloudflare does not publish an official Arch package; the commonly used cloudflare-warp-bin package is community-maintained. Install an AUR helper first, then retry.",
            "Не найден помощник AUR (paru или yay). Cloudflare не публикует официальный пакет для Arch; пакет cloudflare-warp-bin поддерживается сообществом. Сначала установи paru или yay, затем повтори попытку.",
          ),
        })
        return false
      }
      command = helper
      args = ["-S", "--needed", "cloudflare-warp-bin"]
      isAUR = true
      confirmation = text(
        context,
        "Arch/CachyOS uses the community-maintained AUR package cloudflare-warp-bin, not an official Cloudflare repository. Continue?",
        "Для Arch/CachyOS будет использован пакет cloudflare-warp-bin из AUR, поддерживаемый сообществом, а не официальный репозиторий Cloudflare. Продолжить?",
      )
    } else if (
      (await commandExists("apt-get")) &&
      ((await hasPath("/etc/apt/sources.list.d/cloudflare-client.list")) ||
        (await hasPath("/etc/apt/sources.list.d/cloudflare-client.sources")))
    ) {
      command = "sudo"
      args = ["apt-get", "install", "-y", "cloudflare-warp"]
    } else if (
      (await commandExists("dnf")) &&
      ((await hasPath("/etc/yum.repos.d/cloudflare-warp.repo")) ||
        (await hasPath("/etc/yum.repos.d/cloudflare-client.repo")))
    ) {
      command = "sudo"
      args = ["dnf", "install", "-y", "cloudflare-warp"]
    } else {
      await context.ui.dialog.alert({
        title: text(context, "Install WARP", "Установка WARP"),
        message: text(
          context,
          "This Linux distribution does not have the Cloudflare WARP repository configured. Opening the official installation guide: " + installGuide,
          "В этой Linux-системе не настроен репозиторий Cloudflare WARP. Открываю официальную инструкцию: " + installGuide,
        ),
      })
      await openExternal(installGuide)
      return false
    }
  } else {
    await context.ui.dialog.alert({
      title: text(context, "Install WARP", "Установка WARP"),
      message: text(context, "Automatic installation is not supported on this platform. See " + installGuide, "Автоматическая установка на этой платформе не поддерживается. Инструкция: " + installGuide),
    })
    await openExternal(installGuide)
    return false
  }

  const accepted = await context.ui.dialog.confirm({
    title: text(context, "Install Cloudflare WARP?", "Установить Cloudflare WARP?"),
    message: confirmation,
    label: { confirm: text(context, "Install", "Установить"), cancel: text(context, "Cancel", "Отмена") },
  })
  if (!accepted || !command) return false
  await runInteractive(context, command, args)
  if (isAUR) {
    context.ui.toast.show({
      title: text(context, "WARP installed", "WARP установлен"),
      message: text(
        context,
        "Open WARP settings and enable Local Proxy in Preferences > Advanced > Configure Proxy. Do not enable full-device WARP if you want other applications to remain unaffected.",
        "Открой настройки WARP и включи Local Proxy в Preferences > Advanced > Configure Proxy. Не включай глобальный режим WARP, если остальные приложения должны работать напрямую.",
      ),
      variant: "success",
    })
  }
  return true
}

function proxyPortOpen(port = 40000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    const done = (value: boolean) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(800, () => done(false))
    socket.once("connect", () => done(true))
    socket.once("error", () => done(false))
  })
}

async function readOpenCodeProxyEnabled(context: Plugin.Context): Promise<boolean> {
  try {
    const entries = await context.client.config.get()
    const found = entries.findLast((entry) => entry.type === "document" && entry.info.proxy !== undefined)
    if (!found || found.type !== "document") return false
    return found.info.proxy?.http === WARP_PROXY_URL && found.info.proxy?.https === WARP_PROXY_URL
  } catch {
    return false
  }
}

async function setOpenCodeProxy(context: Plugin.Context, enabled: boolean) {
  await context.client.config.update({
    proxy: enabled
      ? { http: WARP_PROXY_URL, https: WARP_PROXY_URL, no_proxy: WARP_PROXY_BYPASS }
      : null,
  })
}

async function setupLocalProxy(context: Plugin.Context): Promise<WarpStatus> {
  if (process.platform === "android" || process.env.PREFIX?.includes("/com.termux/")) {
    throw new Error(text(
      context,
      "WARP Local Proxy is available on desktop clients only. Android/Termux cannot isolate WARP traffic to OpenCode this way.",
      "WARP Local Proxy доступен только в настольном клиенте. На Android/Termux нельзя таким способом направить через WARP только трафик OpenCode.",
    ))
  }

  const help = await runWarp(["--help"]).catch(() => "")
  let configured = false
  try {
    await runWarp(["mode", "proxy"])
    configured = true
  } catch {
    try {
      await runWarp(["set-mode", "proxy"])
      configured = true
    } catch {}
  }

  if (configured) {
    if (/set-proxy-port/i.test(help)) await runWarp(["set-proxy-port", "40000"]).catch(() => undefined)
    else if (help.toLowerCase().includes("proxy") && help.toLowerCase().includes("port")) {
      await runWarp(["proxy", "port", "40000"]).catch(() => undefined)
    }
    await runWarp(["connect"])
  }

  await wait(500)
  if (!(await proxyPortOpen(40000))) {
    throw new Error(text(
      context,
      "The WARP local proxy is not listening on 127.0.0.1:40000. In Cloudflare WARP open Preferences > Advanced > Configure Proxy, enable Local Proxy and set port 40000. Choose HTTP/HTTPS (not SOCKS5), then retry. OpenCode's proxy settings were not changed.",
      "Локальный прокси WARP не слушает 127.0.0.1:40000. В Cloudflare WARP открой Preferences > Advanced > Configure Proxy, включи Local Proxy и выставь порт 40000. Выбери HTTP/HTTPS (не SOCKS5), затем повтори попытку. Настройки прокси OpenCode не менялись.",
    ))
  }

  await setOpenCodeProxy(context, true)
  return readWarpStatus()
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
  proxyEnabled: boolean
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
      <text fg={theme().text.muted} wrapMode="none">{ru() ? `OpenCode через WARP: ${props.proxyEnabled ? "включено" : "выключено"}` : `OpenCode via WARP: ${props.proxyEnabled ? "on" : "off"}`}</text>
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
  proxyEnabled: boolean
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
      case "install": return ru() ? "Установка WARP…" : "Installing WARP…"
      case "proxy": return ru() ? "Настройка прокси OpenCode…" : "Configuring OpenCode-only proxy…"
      case "disableProxy": return ru() ? "Отключение прокси OpenCode…" : "Disabling OpenCode proxy…"
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
    <box width="100%" backgroundColor={theme().background.base} padding={1} gap={1}>
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

      <box flexDirection="row" gap={1} flexWrap="wrap">
        <ActionButton
          context={props.context}
          id="warp.install"
          label={ru() ? "Установить WARP…" : "Install WARP…"}
          run={() => props.run("install")}
          disabled={pending() || props.status.state !== "unavailable"}
          emphasized
        />
        <ActionButton
          context={props.context}
          id="warp.refresh"
          label={ru() ? "Статус" : "Refresh"}
          run={() => props.run("refresh")}
          disabled={pending()}
        />
        <ActionButton
          context={props.context}
          id="warp.connect"
          label={ru() ? "Подключить" : "Connect"}
          run={() => props.run("connect")}
          disabled={pending() || props.status.state === "connected" || props.status.state === "unavailable"}
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
          id="warp.proxy"
          label={props.proxyEnabled
            ? (ru() ? "Убрать прокси OpenCode" : "Disable OpenCode proxy")
            : (ru() ? "Только OpenCode через WARP…" : "Route only OpenCode through WARP…")}
          run={() => props.run(props.proxyEnabled ? "disableProxy" : "proxy")}
          disabled={pending() || props.status.state === "unavailable"}
          emphasized={!props.proxyEnabled}
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
            ? "В Local Proxy только OpenCode использует WARP; остальные приложения идут напрямую. Сброс регистрации — только для личного WARP, не корпоративного Zero Trust."
            : "With Local Proxy, only OpenCode uses WARP; other applications connect directly. Reset registration is for personal WARP only, not organization-managed Zero Trust."}
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
    const [status, updateStatus] = context.storage.memory<WarpStatus>("status", {
      initial: { state: "checking", details: "Checking Cloudflare WARP…" },
    })
    const [busy, updateBusy] = context.storage.memory<SharedBusy>("busy", { initial: { action: null } })
    const [proxy, updateProxy] = context.storage.memory<{ enabled: boolean }>("proxy", { initial: { enabled: false } })

    const refreshProxy = async () => {
      const enabled = await readOpenCodeProxyEnabled(context)
      updateProxy((draft) => { draft.enabled = enabled })
    }

    const refresh = async () => {
      if (busy.action !== null) return
      setSharedStatus(updateStatus, await readWarpStatus())
      await refreshProxy()
    }

    const perform = async (action: WarpAction) => {
      if (busy.action !== null) return
      setSharedBusy(updateBusy, action)
      try {
        let next: WarpStatus
        let actionMessage: string | undefined
        if (action === "install") {
          const installed = await installWarp(context)
          next = await readWarpStatus()
          actionMessage = installed
            ? text(context, "Installer finished. Check WARP status and enable Local Proxy before routing OpenCode through it.", "Установщик завершился. Проверь статус WARP и включи Local Proxy перед маршрутизацией OpenCode.")
            : text(context, "Opened installation guidance. WARP is not confirmed installed yet.", "Открыта инструкция по установке. Установка WARP пока не подтверждена.")
        } else if (action === "proxy") {
          next = await setupLocalProxy(context)
          updateProxy((draft) => { draft.enabled = true })
          actionMessage = text(context, "Only OpenCode is configured to use WARP. Other apps are unchanged.", "Только OpenCode настроен на WARP. Настройки остальных приложений не изменены.")
        } else if (action === "disableProxy") {
          await setOpenCodeProxy(context, false)
          updateProxy((draft) => { draft.enabled = false })
          next = await readWarpStatus()
          actionMessage = text(context, "OpenCode proxy disabled; its previous proxy environment is restored.", "Прокси OpenCode отключён; прежние настройки прокси восстановлены.")
        } else {
          next = await performWarpAction(action)
        }
        setSharedStatus(updateStatus, next)
        if (action !== "refresh") {
          context.ui.toast.show({
            title: text(context, "WARP action finished", "Операция WARP завершена"),
            message: actionMessage ?? (statusLabel(context, next.state) + ": " + next.details.slice(0, 240)),
            variant: action === "install" || action === "proxy" || action === "disableProxy"
              ? "success"
              : next.state === "connected" ? "success" : "info",
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

    const close = () => context.ui.dialog.clear()
    const open = () => {
      context.ui.dialog.show(() => (
        <WarpPage
          context={context}
          status={status}
          busy={busy}
          proxyEnabled={proxy.enabled}
          run={(action) => void perform(action)}
          onClose={close}
        />
      ))
      context.ui.dialog.set({ size: "medium", centered: true })
    }

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
              slash: { name: "warp", arguments: true },
              palette: true,
              run: open,
            },
            {
              id: "opencode.warp.update",
              title: text(context, "Refresh WARP registration", "Обновить регистрацию WARP"),
              description: text(context, "Reset and recreate the personal WARP registration, then reconnect", "Сбросить и создать заново регистрацию личного WARP, затем подключиться"),
              group: "System",
              slash: { name: "update", arguments: true },
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
      render: () => <WarpSidebar context={context} status={status} busy={busy} proxyEnabled={proxy.enabled} open={open} refresh={() => void perform("refresh")} />,
    })

    void refresh()
    void refreshProxy()
    const timer = setInterval(() => void refresh(), STATUS_REFRESH_MS)

    return () => clearInterval(timer)
  },
})
