import { execFile, spawn } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import * as Warp from "@opencode/core/warp"
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { hoverBackground } from "../../ui/hover"
import { warpStatusError, type WarpConnectionState, type WarpStatus } from "./warp-status"

type WarpAction = "refresh" | "connect" | "disconnect" | "reconnect" | "reset" | "install" | "proxy" | "disableProxy" | "changeIp"
type SharedBusy = { action: WarpAction | null }

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

const readWarpStatus = Warp.status

function describe(context: Plugin.Context, cause: unknown) {
  if (cause instanceof Warp.WarpError) {
    switch (cause.code) {
      case "cli-missing":
        return text(context, "Cloudflare WARP CLI was not found. Install WARP first.", "Cloudflare WARP CLI не найден. Сначала установи WARP.")
      case "daemon-down":
        return text(context, "The WARP background service is not running. Press \"Route only OpenCode through WARP\" to start it (Windows may ask for confirmation).", "Фоновая служба WARP не запущена. Нажми «Только OpenCode через WARP…», чтобы запустить её (Windows может попросить подтверждение).")
      case "not-proxy-mode":
        return text(context, "WARP is not in Local Proxy mode, so it would affect the whole device. Use \"Route only OpenCode through WARP\" first.", "WARP не в режиме Local Proxy и затронул бы всё устройство. Сначала нажми «Только OpenCode через WARP».")
      case "device-in-use":
        return text(context, "WARP is connected for the whole device. OpenCode will not switch it to Local Proxy because other applications would lose their tunnel. Disconnect WARP and retry.", "WARP подключён для всех программ. OpenCode не будет переключать его в Local Proxy, иначе остальные программы потеряют туннель. Отключи WARP и повтори.")
      case "socks-only":
        return text(context, "This WARP version's local proxy speaks SOCKS5 only; OpenCode needs HTTP. Update Cloudflare WARP.", "Локальный прокси этой версии WARP работает только по SOCKS5, а OpenCode нужен HTTP. Обнови Cloudflare WARP.")
      case "managed-registration":
        return text(context, "This WARP client is managed by an organization (Zero Trust); its registration cannot be reset here.", "Этот WARP управляется организацией (Zero Trust); регистрацию отсюда сбросить нельзя.")
      default:
        return cause.message
    }
  }
  return messageOf(cause)
}

async function performWarpAction(action: WarpAction, context: Plugin.Context): Promise<WarpStatus> {
  if (action === "refresh") return readWarpStatus()
  if (action === "connect") return Warp.connect()
  if (action === "disconnect") return Warp.disconnect()
  if (action === "reconnect") return Warp.reconnect()
  return Warp.resetRegistration()
}

function setSharedStatus(set: (mutation: (draft: WarpStatus) => void) => void, value: WarpStatus) {
  set((draft) => {
    draft.state = value.state
    draft.details = value.details
  })
}

function setSharedBusy(set: (mutation: (draft: SharedBusy) => void) => void, action: WarpAction | null) {
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
  const needsTerminal = command !== "winget" && command !== "brew"
  if (needsTerminal) context.renderer.suspend()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (needsTerminal) context.renderer.resume()
      if (error) reject(error)
      else resolve()
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { stdio: needsTerminal ? "inherit" : ["ignore", "ignore", "ignore"], windowsHide: !needsTerminal })
    } catch (cause) {
      finish(cause instanceof Error ? cause : new Error(String(cause)))
      return
    }
    child.once("error", (cause) => finish(cause instanceof Error ? cause : new Error(String(cause))))
    child.once("close", (code) => {
      if (code === 0 || (command === "winget" && (code === 43 || code === 0x8a15002b || code === 0x8a150061))) finish()
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
  if (Warp.resolveCli()) {
    context.ui.toast.show({
      title: text(context, "WARP is already installed", "WARP уже установлен"),
      message: text(context, "Use \"Route only OpenCode through WARP\" to set it up.", "Нажми «Только OpenCode через WARP…», чтобы настроить."),
      variant: "info",
    })
    return false
  }
  const termux = Boolean(process.env.PREFIX?.includes("/com.termux/") || process.env.TERMUX_VERSION)
  const installGuide = "https://developers.cloudflare.com/warp-client/get-started/"
  let command: string | undefined
  let args: string[] = []
  let confirmation = text(context, "This will install Cloudflare WARP using the available package manager.", "Это установит Cloudflare WARP через доступный менеджер пакетов.")
  let isAUR = false

  if (termux || process.platform === "android") {
    await context.ui.dialog.alert({
      title: text(context, "WARP on Android / Termux", "WARP на Android / Termux"),
      message: text(context, "Cloudflare's Android VPN app is separate from the Termux CLI. Android does not support WARP Local Proxy mode for routing only OpenCode traffic, so installing the mobile app would not meet the per-app routing requirement.", "Приложение Cloudflare для Android — отдельный VPN-клиент, не CLI для Termux. Режим WARP Local Proxy для маршрутизации только OpenCode на Android не поддерживается, поэтому мобильное приложение не решит задачу изоляции трафика."),
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
    try { release = await readFile("/etc/os-release", "utf8") } catch {}
    if (/ID=(arch|cachyos|manjaro|endeavouros|garuda|artix)/i.test(release) || /ID_LIKE=.*arch/i.test(release)) {
      const helper = (await commandExists("paru")) ? "paru" : (await commandExists("yay")) ? "yay" : undefined
      if (!helper) {
        await context.ui.dialog.alert({
          title: text(context, "Install WARP on Arch", "Установка WARP в Arch"),
          message: text(context, "No AUR helper (paru or yay) was found. Cloudflare does not publish an official Arch package; the commonly used cloudflare-warp-bin package is community-maintained. Install an AUR helper first, then retry.", "Не найден помощник AUR (paru или yay). Cloudflare не публикует официальный пакет для Arch; пакет cloudflare-warp-bin поддерживается сообществом. Сначала установи paru или yay, затем повтори попытку."),
        })
        return false
      }
      command = helper
      args = ["-S", "--needed", "cloudflare-warp-bin"]
      isAUR = true
      confirmation = text(context, "Arch/CachyOS uses the community-maintained AUR package cloudflare-warp-bin, not an official Cloudflare repository. Continue?", "Для Arch/CachyOS будет использован пакет cloudflare-warp-bin из AUR, поддерживаемый сообществом, а не официальный репозиторий Cloudflare. Продолжить?")
    } else if ((await commandExists("apt-get")) && ((await hasPath("/etc/apt/sources.list.d/cloudflare-client.list")) || (await hasPath("/etc/apt/sources.list.d/cloudflare-client.sources")))) {
      command = "sudo"
      args = ["apt-get", "install", "-y", "cloudflare-warp"]
    } else if ((await commandExists("dnf")) && ((await hasPath("/etc/yum.repos.d/cloudflare-warp.repo")) || (await hasPath("/etc/yum.repos.d/cloudflare-client.repo")))) {
      command = "sudo"
      args = ["dnf", "install", "-y", "cloudflare-warp"]
    } else {
      await context.ui.dialog.alert({
        title: text(context, "Install WARP", "Установка WARP"),
        message: text(context, "This Linux distribution does not have the Cloudflare WARP repository configured. Opening the official installation guide: " + installGuide, "В этой Linux-системе не настроен репозиторий Cloudflare WARP. Открываю официальную инструкцию: " + installGuide),
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
  // Installing WARP must never implicitly establish a tunnel. The user enables routing explicitly.
  await Warp.run(["disconnect"]).catch(() => undefined)
  await Warp.hideGui()
  if (isAUR) {
    context.ui.toast.show({
      title: text(context, "WARP installed", "WARP установлен"),
      message: text(context, "WARP is installed but left disconnected. Use \"Route only OpenCode through WARP…\" when you actually want it.", "WARP установлен, но оставлен отключённым. Нажми «Только OpenCode через WARP…», когда действительно захочешь его включить."),
      variant: "success",
    })
  }
  return true
}

async function describeProxyEntries(context: Plugin.Context) {
  try {
    const entries = await context.client.config.get()
    const proxies = entries.flatMap((entry, index) => entry.type === "document" && entry.info.proxy !== undefined ? [`#${index}=${entry.info.proxy === null ? "null" : String(entry.info.proxy.http ?? "-")}`] : [])
    return `documents=${entries.length} proxies=[${proxies.join(", ")}]`
  } catch (cause) {
    return `read failed: ${messageOf(cause).slice(0, 120)}`
  }
}

async function readOpenCodeProxyEnabled(context: Plugin.Context): Promise<boolean | undefined> {
  try {
    const entries = await context.client.config.get()
    const found = entries.findLast((entry) => entry.type === "document" && entry.info.proxy !== undefined)
    if (!found || found.type !== "document") return false
    return Warp.isWarpProxy(found.info.proxy)
  } catch {
    return undefined
  }
}

async function setOpenCodeProxy(context: Plugin.Context, enabled: boolean) {
  await context.client.config.update({ proxy: enabled ? Warp.proxyConfig() : null })
}

async function setupLocalProxy(context: Plugin.Context): Promise<WarpStatus> {
  if (process.platform === "android" || process.env.PREFIX?.includes("/com.termux/")) throw new Error(text(context, "WARP Local Proxy is available on desktop clients only. Android/Termux cannot isolate WARP traffic to OpenCode this way.", "WARP Local Proxy доступен только в настольном клиенте. На Android/Termux нельзя таким способом направить через WARP только трафик OpenCode."))
  let next: WarpStatus
  try {
    next = await Warp.ensureProxy()
  } catch (cause) {
    if (!(cause instanceof Warp.WarpError && cause.code === "device-in-use")) throw cause
    const accepted = await context.ui.dialog.confirm({
      title: text(context, "WARP is routing the whole device", "WARP сейчас работает на всё устройство"),
      message: text(context, "WARP is connected for every application. Switch it to Local Proxy so that only OpenCode uses WARP? Other apps will go back to your normal connection.", "WARP подключён для всех программ. Переключить его в Local Proxy, чтобы WARP использовал только OpenCode? Остальные программы вернутся на обычное соединение."),
      label: { confirm: text(context, "Only OpenCode", "Только OpenCode"), cancel: text(context, "Cancel", "Отмена") },
    })
    if (!accepted) throw cause
    next = await Warp.ensureProxy(Warp.DEFAULT_PORT, { takeOverDevice: true })
  }
  await setOpenCodeProxy(context, true)
  return next
}

function ActionButton(props: { context: Plugin.Context; id: string; label: string; run: () => void; disabled?: boolean; emphasized?: boolean }) {
  const [hovered, setHovered] = createSignal(false)
  const theme = () => props.context.theme
  const base = () => theme().text.action?.primary?.base ?? theme().text.base
  const hover = () => theme().text.action?.primary?.hovered ?? theme().increase(base(), 2)
  return (
    <box id={props.id} paddingLeft={1} paddingRight={1} backgroundColor={hovered() && !props.disabled ? hoverBackground(theme()) : undefined} onMouseOver={() => setHovered(!props.disabled)} onMouseOut={() => setHovered(false)} onMouseUp={(event) => { event.stopPropagation(); if (!props.disabled) props.run() }}>
      <text fg={props.disabled ? theme().text.muted : hovered() ? hover() : props.emphasized ? base() : theme().text.muted} wrapMode="none">{props.label}</text>
    </box>
  )
}

function WarpSidebar(props: { context: Plugin.Context; status: WarpStatus; busy: SharedBusy; proxyEnabled: boolean; exitIp: string; directIp: string; open: () => void; refresh: () => void }) {
  const theme = () => props.context.theme
  const ru = () => language(props.context) === "ru"
  return (
    <box gap={1}>
      <box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
        <text fg={theme().text.base}><b>WARP</b></text>
        <text fg={statusColor(props.context, props.status.state)} wrapMode="none">{statusLabel(props.context, props.status.state)}</text>
      </box>
      <text fg={theme().text.muted} wrapMode="none">{ru() ? `OpenCode через WARP: ${props.proxyEnabled ? "включено" : "выключено"}` : `OpenCode via WARP: ${props.proxyEnabled ? "on" : "off"}`}</text>
      <text fg={theme().text.muted} wrapMode="none">{(ru() ? "Ваш IP: " : "Your IP: ") + (props.directIp || "…")}</text>
      {props.proxyEnabled && <text fg={theme().text.feedback.success.base} wrapMode="none">{"OpenCode: " + (props.exitIp || "…")}</text>}
      <box flexDirection="row" gap={1}>
        <ActionButton context={props.context} id="warp.sidebar.open" label={ru() ? "[ Управление ↗ ]" : "[ Manage ↗ ]"} run={props.open} emphasized />
        <ActionButton context={props.context} id="warp.sidebar.refresh" label={ru() ? "[ Обновить ]" : "[ Refresh ]"} run={props.refresh} disabled={props.busy.action !== null} />
      </box>
    </box>
  )
}

function WarpPage(props: { context: Plugin.Context; status: WarpStatus; busy: SharedBusy; proxyEnabled: boolean; exitIp: string; directIp: string; run: (action: WarpAction) => void; onClose: () => void }) {
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
      case "changeIp": return ru() ? "Смена IP…" : "Changing IP…"
      default: return ""
    }
  }

  props.context.keymap.layer(() => ({ commands: [{ bind: "escape", title: ru() ? "Закрыть WARP" : "Close WARP", group: "WARP", run: props.onClose }] }))

  const reset = async () => {
    const accepted = await props.context.ui.dialog.confirm({
      title: ru() ? "Сбросить регистрацию WARP?" : "Reset WARP registration?",
      message: ru() ? "Будет удалена текущая регистрация WARP и создана новая. Не используйте это для корпоративного WARP / Zero Trust: подключение может потребовать повторной настройки. Сброс не гарантирует снятие лимита у AI-провайдера." : "This deletes the current WARP registration and creates a new one. Do not use it with organization-managed WARP / Zero Trust: setup may need to be repeated. This does not guarantee an AI provider's rate limit will reset.",
      label: { confirm: ru() ? "Сбросить" : "Reset", cancel: ru() ? "Отмена" : "Cancel" },
    })
    if (accepted) props.run("reset")
  }

  return (
    <box width="100%" backgroundColor={theme().background.base} paddingLeft={1} paddingRight={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
        <box flexGrow={1} minWidth={0}>
          <text fg={theme().text.base}><b>Cloudflare WARP</b></text>
          <text fg={theme().text.muted} wrapMode="word">{ru() ? "Через WARP идёт только трафик OpenCode, остальные программы — напрямую." : "Only OpenCode traffic goes through WARP; other apps connect directly."}</text>
        </box>
        <ActionButton context={props.context} id="warp.close" label="[ Esc ]" run={props.onClose} />
      </box>
      <box paddingLeft={1}>
        <box flexDirection="row" alignItems="center" gap={1}>
          <text fg={statusColor(props.context, props.status.state)}>●</text>
          <text fg={theme().text.base}><b>{statusLabel(props.context, props.status.state)}</b></text>
          <text fg={theme().text.muted}>{pending() ? working() : ""}</text>
        </box>
        <text fg={theme().text.muted} wrapMode="word">{props.status.state === "unavailable" ? (ru() ? "Cloudflare WARP не установлен. Нажми «Установить WARP…»." : "Cloudflare WARP is not installed. Press “Install WARP…”.") : props.status.details}</text>
        <text fg={theme().text.muted} wrapMode="none">{(ru() ? "Ваш IP: " : "Your IP: ") + (props.directIp || "…")}</text>
        <text fg={props.exitIp ? theme().text.feedback.success.base : theme().text.muted} wrapMode="none">{(ru() ? "IP OpenCode: " : "OpenCode IP: ") + (props.exitIp || (props.proxyEnabled ? "…" : ru() ? "тот же (WARP выключен)" : "same (WARP off)"))}</text>
      </box>
      <box flexDirection="row" gap={1} flexWrap="wrap">
        {props.status.state === "unavailable" && <ActionButton context={props.context} id="warp.install" label={ru() ? "Установить WARP…" : "Install WARP…"} run={() => props.run("install")} disabled={pending()} emphasized />}
        <ActionButton context={props.context} id="warp.refresh" label={ru() ? "Статус" : "Refresh"} run={() => props.run("refresh")} disabled={pending()} />
        {props.status.state !== "unavailable" && <ActionButton context={props.context} id="warp.connect" label={ru() ? "Подключить" : "Connect"} run={() => props.run("connect")} disabled={pending() || props.status.state === "connected"} />}
        {props.status.state !== "unavailable" && <ActionButton context={props.context} id="warp.disconnect" label={ru() ? "Отключить" : "Disconnect"} run={() => props.run("disconnect")} disabled={pending() || props.status.state !== "connected"} />}
        {props.status.state !== "unavailable" && <ActionButton context={props.context} id="warp.reconnect" label={ru() ? "Переподключить" : "Reconnect"} run={() => props.run("reconnect")} disabled={pending()} />}
        {props.status.state !== "unavailable" && <ActionButton context={props.context} id="warp.proxy" label={props.proxyEnabled ? (ru() ? "Убрать прокси OpenCode" : "Disable OpenCode proxy") : (ru() ? "Только OpenCode через WARP…" : "Route only OpenCode through WARP…")} run={() => props.run(props.proxyEnabled ? "disableProxy" : "proxy")} disabled={pending()} emphasized={!props.proxyEnabled} />}
        {props.status.state !== "unavailable" && <ActionButton context={props.context} id="warp.changeIp" label={ru() ? "Сменить IP" : "Change IP"} run={() => props.run("changeIp")} disabled={pending() || !props.proxyEnabled} emphasized={props.proxyEnabled} />}
        {props.status.state !== "unavailable" && <ActionButton context={props.context} id="warp.reset" label={ru() ? "Сбросить регистрацию…" : "Reset registration…"} run={() => void reset()} disabled={pending()} />}
      </box>
      <box gap={1}><text fg={theme().text.muted} wrapMode="word">{ru() ? "Reconnect, Сменить IP и Сброс работают в режиме Local Proxy. Сброс — только для личного WARP." : "Reconnect, Change IP and Reset work in Local Proxy mode. Reset is for personal WARP only."}</text></box>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.warp",
  setup(context) {
    const [status, updateStatus] = context.storage.memory<WarpStatus>("status", { initial: { state: "checking", details: "Checking Cloudflare WARP…" } })
    const [busy, updateBusy] = context.storage.memory<SharedBusy>("busy", { initial: { action: null } })
    const [proxy, updateProxy] = context.storage.memory<{ enabled: boolean }>("proxy", { initial: { enabled: false } })
    const [exit, updateExit] = context.storage.memory<{ ip: string; direct: string }>("exit", { initial: { ip: "", direct: "" } })

    const describeIp = (seen: Warp.ExitIp | undefined) => seen ? seen.ip + (seen.warp ? " · WARP" : "") + (seen.loc ? " · " + seen.loc : "") : ""
    const refreshExitIp = async () => {
      const [direct, viaWarp] = await Promise.all([Warp.exitIp(), proxy.enabled ? Warp.exitIp(Warp.HTTP_BRIDGE_PORT) : Promise.resolve(undefined)])
      updateExit((draft) => { if (direct) draft.direct = describeIp(direct); if (!proxy.enabled) draft.ip = ""; else if (viaWarp) draft.ip = describeIp(viaWarp) })
    }

    let offReads = 0
    let trustUntil = 0
    let leaving = false
    const leave = () => {
      if (leaving) return
      leaving = true
      Warp.releaseSync({ disconnect: proxy.enabled })
    }
    const onSignal = (code: number) => () => { leave(); process.exit(code) }
    const onHup = onSignal(129)
    const onTerm = onSignal(143)
    process.once("exit", leave)
    process.once("SIGHUP", onHup)
    process.once("SIGTERM", onTerm)

    const refreshProxy = async () => {
      const enabled = await readOpenCodeProxyEnabled(context)
      if (enabled !== proxy.enabled) Warp.log(`opencode proxy flag: stored=${proxy.enabled} read=${String(enabled)} offReads=${offReads} ${await describeProxyEntries(context)}`)
      if (enabled === undefined) return
      if (Date.now() < trustUntil && enabled !== proxy.enabled) return
      offReads = enabled ? 0 : offReads + 1
      if (enabled || offReads >= 2) updateProxy((draft) => { draft.enabled = enabled })
      if (enabled) { leaving = false; Warp.markInUse() }
    }

    const refresh = async () => {
      if (busy.action !== null) return
      const read = await readWarpStatus()
      setSharedStatus(updateStatus, read)
      await refreshProxy()
      // WARP is intentionally NOT auto-reconnected. A user disconnect must stay disconnected.
      await refreshExitIp()
    }

    const perform = async (action: WarpAction) => {
      if (busy.action !== null) return
      setSharedBusy(updateBusy, action)
      if (action === "proxy" || action === "disableProxy") { offReads = 0; trustUntil = Date.now() + 30_000 }
      try {
        let next: WarpStatus
        let actionMessage: string | undefined
        let infoOnly = false
        if (action === "install") {
          const installed = await installWarp(context)
          infoOnly = !installed
          next = await readWarpStatus()
          actionMessage = installed ? text(context, "Installer finished. WARP remains disconnected until you explicitly enable OpenCode-only routing.", "Установщик завершён. WARP остаётся отключённым, пока ты явно не включишь маршрутизацию только OpenCode.") : text(context, "Opened installation guidance. WARP is not confirmed installed yet.", "Открыта инструкция по установке. Установка WARP пока не подтверждена.")
        } else if (action === "proxy") {
          next = await setupLocalProxy(context)
          updateProxy((draft) => { draft.enabled = true })
          actionMessage = text(context, "Only OpenCode is configured to use WARP. Other apps are unchanged.", "Только OpenCode настроен на WARP. Настройки остальных приложений не изменены.")
        } else if (action === "disableProxy") {
          await setOpenCodeProxy(context, false)
          updateProxy((draft) => { draft.enabled = false })
          Warp.releaseSync({ disconnect: false })
          next = await readWarpStatus()
          actionMessage = text(context, "OpenCode proxy disabled; WARP stays disconnected until you explicitly connect it.", "Прокси OpenCode отключён; WARP останется отключённым, пока ты явно не подключишь его.")
        } else {
          next = await performWarpAction(action, context)
        }
        setSharedStatus(updateStatus, next)
        if (action !== "refresh") {
          context.ui.toast.show({ title: text(context, "WARP action finished", "Операция WARP завершена"), message: actionMessage ?? (statusLabel(context, next.state) + ": " + next.details.slice(0, 240)), variant: infoOnly ? "info" : action === "install" || action === "proxy" || action === "disableProxy" ? "success" : next.state === "connected" ? "success" : "info" })
        }
      } catch (cause) {
        const message = describe(context, cause)
        setSharedStatus(updateStatus, action === "install" ? await readWarpStatus() : warpStatusError(message))
        context.ui.toast.show({ title: text(context, "WARP action failed", "Ошибка WARP"), message, variant: "error" })
      } finally {
        setSharedBusy(updateBusy, null)
      }
    }

    const close = () => context.ui.dialog.clear()
    const open = () => {
      context.ui.dialog.show(() => <WarpPage context={context} status={status} busy={busy} proxyEnabled={proxy.enabled} exitIp={exit.ip} directIp={exit.direct} run={(action) => void perform(action)} onClose={close} />)
      context.ui.dialog.set({ size: "medium", centered: true })
    }

    context.ui.slot({ append: "app", render() {
      context.keymap.layer(() => ({ mode: "global", commands: [{ id: "opencode.warp.open", title: text(context, "Cloudflare WARP controls", "Управление Cloudflare WARP"), description: text(context, "View status, connect, reconnect, or reset registration", "Статус, подключение, переподключение и сброс регистрации"), group: "System", slash: { name: "warp", arguments: true }, palette: true, run: open }] }))
      return null
    }})
    context.ui.slot({ append: "sidebar.content", render: () => <WarpSidebar context={context} status={status} busy={busy} proxyEnabled={proxy.enabled} exitIp={exit.ip} directIp={exit.direct} open={open} refresh={() => void perform("refresh")} /> })

    void Warp.hideGui()
    void refresh()
    void refreshProxy()
    const timer = setInterval(() => void refresh(), STATUS_REFRESH_MS)

    return () => {
      clearInterval(timer)
      process.off("exit", leave)
      process.off("SIGHUP", onHup)
      process.off("SIGTERM", onTerm)
    }
  },
})