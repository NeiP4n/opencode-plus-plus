import { TextAttributes, type InputRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import type { RoomInfo, RoomJoinCode, RoomMemberView, RoomMeshEntry, RoomMeshSnapshot } from "@opencode/client/promise"
import { hostname } from "node:os"
import { randomUUID } from "node:crypto"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocal } from "../context/local"
import { useProjects } from "../context/projects"
import { Orchestra } from "@opencode/schema/orchestra"
import { Keymap } from "../context/keymap"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { roomListChanged, sameRoom, useDeviceKey, useJoinedRooms, type JoinedRoom } from "../util/room"
import { Button } from "./devtools-registry"
import { HoverAction } from "./hover-action"
import { roomClient, tellHostLeft, unlinkRoom } from "../util/room-guest"
import { DISCOVERY_PORTS, readServer, scanRooms, type FoundMesh, type FoundRoom } from "@opencode/client/room-discovery"


type MultiplayerMode = "host" | "mesh"

function useMeshDirectory() {
  const data = useData()
  const route = useRoute()
  return () => {
    const sessionID = "sessionID" in route.data ? route.data.sessionID : undefined
    const session = sessionID ? data.session.get(sessionID) : undefined
    if (session?.location.directory) return session.location.directory
    if (route.data.type === "home" && route.data.location?.directory) return route.data.location.directory
    return process.cwd()
  }
}

function MultiplayerModeSelector(props: {
  value: MultiplayerMode
  onChange: (value: MultiplayerMode) => void
}) {
  const theme = useTheme().surface("dialog")
  const t = useT()
  return (
    <box flexDirection="row" gap={1}>
      <HoverAction onClick={() => props.onChange("host")} paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
        <text
          fg={props.value === "host" ? theme.text.action.primary.selected : theme.text.action.primary.base}
          attributes={props.value === "host" ? TextAttributes.BOLD | TextAttributes.UNDERLINE : undefined}
        >
          {t("Host")}
        </text>
      </HoverAction>
      <HoverAction onClick={() => props.onChange("mesh")} paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
        <text
          fg={props.value === "mesh" ? theme.text.action.primary.selected : theme.text.action.primary.base}
          attributes={props.value === "mesh" ? TextAttributes.BOLD | TextAttributes.UNDERLINE : undefined}
        >
          {t("Mesh")}
        </text>
      </HoverAction>
    </box>
  )
}

// Mesh is a shared room whose state survives a coordinator leaving. Unlike a LAN
// room, every enrolled device participates in the replicated log and elections.
export function DialogMesh(props: { onClose?: () => void; hideHeader?: boolean }) {
  const client = useClient()
  const theme = useTheme().surface("dialog")
  const dimensions = useTerminalDimensions()
  const t = useT()
  const config = useConfig().data
  const ownDirectory = useMeshDirectory()
  const [server] = createResource(() => client.api.server.info())
  const [snapshot, setSnapshot] = createSignal<RoomMeshSnapshot>()
  const [invite, setInvite] = createSignal("")
  const [entries, setEntries] = createSignal<ReadonlyArray<RoomMeshEntry>>([])
  const [cursor, setCursor] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [kind, setKind] = createSignal<"message" | "task">("message")
  const [leaveArmed, setLeaveArmed] = createSignal(false)
  const fields: {
    url?: InputRenderable
    seedURL?: InputRenderable
    token?: InputRenderable
    name?: InputRenderable
    text?: InputRenderable
  } = {}

  const addresses = () => {
    const urls = server.state === "ready" ? server().urls : []
    const candidates = urls
      .filter((url) => !/^(https?:\/\/)(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url))
      .map((url) => new URL(url).origin)
      .filter((url) => !/^(https?:\/\/)(198\.1[89]\.|169\.254\.)/.test(url))
    const isLAN = (url: string) => /^(https?:\/\/)(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url)
    return [...candidates.filter(isLAN), ...candidates.filter((url) => !isLAN(url))]
  }

  let inviteRequesting = false
  const refresh = async () => {
    const state = await client.api.room.mesh.status()
    setSnapshot(state)
    // The owner secret persists in server storage. Fetch it when reopening an
    // existing room so invitation does not disappear when the dialog is remounted.
    if (state.status !== "unconfigured" && state.ownerNodeID === state.nodeID && !invite() && !inviteRequesting) {
      inviteRequesting = true
      void client.api.room.mesh
        .invite()
        .then((result) => setInvite(result.token))
        .catch(() => {})
        .finally(() => {
          inviteRequesting = false
        })
    }
    if (state.status !== "active") return
    const page = await client.api.room.mesh.feed({ after: cursor() })
    if (page.data.length) {
      setEntries((previous) => {
        const known = new Set(previous.map((entry) => entry.index))
        return [...previous, ...page.data.filter((entry) => !known.has(entry.index))].slice(-80)
      })
    }
    setCursor((previous) => Math.max(previous, page.commitIndex))
  }

  onMount(() => {
    const poll = () => void refresh().catch((reason: unknown) => setError(errorMessage(reason)))
    poll()
    const timer = setInterval(poll, 1200)
    onCleanup(() => clearInterval(timer))
  })

  const run = (action: () => Promise<unknown>, after?: (value: unknown) => void) => {
    setBusy(true)
    setError()
    void action()
      .then((value) => {
        after?.(value)
        return refresh()
      })
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setBusy(false))
  }

  const ownURL = () => fields.url?.value.trim() || addresses()[0] || ""
  const ownName = () => fields.name?.value.trim() || hostname()

  const create = () => {
    const url = ownURL()
    if (!url) return setError(t("Enter this device's reachable address, including its port."))
    run(
      () => client.api.room.mesh.create({ url, name: ownName(), directory: ownDirectory() }),
      (value) => {
        const result = value as { data: RoomMeshSnapshot; token: string }
        setSnapshot(result.data)
        setInvite(result.token)
        setCursor(0)
        setEntries([])
      },
    )
  }

  const join = () => {
    const seedURL = fields.seedURL?.value.trim() ?? ""
    const token = fields.token?.value.trim() ?? ""
    const url = ownURL()
    if (!seedURL || !token || !url)
      return setError(t("Enter the seed address, invitation token and this device's reachable address."))
    run(
      () => client.api.room.mesh.join({ seedURL, token, url, name: ownName(), directory: ownDirectory() }),
      (value) => {
        setSnapshot(value as RoomMeshSnapshot)
        setInvite(token)
        setCursor(0)
        setEntries([])
      },
    )
  }

  const activate = () =>
    run(() => client.api.room.mesh.activate(), (value) => setSnapshot(value as RoomMeshSnapshot))

  const disconnect = () => {
    if (!leaveArmed()) {
      setLeaveArmed(true)
      return
    }
    setLeaveArmed(false)
    run(() => client.api.room.mesh.leave(), (value) => {
      setSnapshot(value as RoomMeshSnapshot)
      setInvite("")
      setEntries([])
      setCursor(0)
      if (fields.seedURL) fields.seedURL.value = ""
      if (fields.token) fields.token.value = ""
    })
  }

  const send = () => {
    const text = fields.text?.value.trim() ?? ""
    if (!text) return setError(t("Write a message or task first."))
    run(
      () =>
        client.api.room.mesh.append({
          id: "evt_" + randomUUID(),
          kind: kind(),
          payload: { text, author: hostname() },
        }),
      () => {
        if (fields.text) fields.text.value = ""
      },
    )
  }

  const describe = (entry: RoomMeshEntry) => {
    const payload = entry.payload
    if (payload && typeof payload === "object" && !Array.isArray(payload) && "text" in payload && typeof payload.text === "string")
      return payload.text
    return JSON.stringify(payload)
  }

  const field = (
    key: "url" | "seedURL" | "token" | "name" | "text",
    label: string,
    placeholder: string,
    width = 42,
  ) => (
    <Labeled label={label}>
      <input
        width={width}
        cursorStyle={config.cursor}
        ref={(element: InputRenderable) => {
          fields[key] = element
        }}
        onMouseDown={() => fields[key]?.focus()}
        placeholder={placeholder}
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.focused}
        cursorColor={theme.text.formfield.focused}
        backgroundColor={theme.background.formfield.base}
        focusedBackgroundColor={theme.background.formfield.focused}
        onSubmit={() => key === "text" ? send() : undefined}
      />
    </Labeled>
  )

  // A Mesh response can be absent briefly while an async create/join/status
  // request is settling. Normalize the snapshot once so the UI never dereferences
  // an incomplete member list during Solid's reactive render.
  const current = () => {
    const value = snapshot()
    if (!value || value.status === "unconfigured") return undefined
    return {
      ...value,
      members: Array.isArray(value.members) ? value.members : [],
      quorum: typeof value.quorum === "number" ? value.quorum : 0,
      commitIndex: typeof value.commitIndex === "number" ? value.commitIndex : 0,
    }
  }
  const showing = () => current() !== undefined

  return (
    <box paddingLeft={props.hideHeader ? 0 : 2} paddingRight={props.hideHeader ? 0 : 2} paddingBottom={props.hideHeader ? 0 : 1} gap={1}>
      <Show when={!props.hideHeader}>
        <Header title={t("Mesh room")} onClose={props.onClose} />
      </Show>
      <scrollbox
        maxHeight={Math.max(props.hideHeader ? 6 : 8, dimensions().height - (props.hideHeader ? 10 : 8))}
        contentOptions={{ minHeight: 0, gap: 1 }}
        scrollbarOptions={{ visible: false }}
      >
        <text fg={theme.text.muted} wrapMode="word">
          {t("All devices are equal peers. The coordinator is elected automatically; shared writes need a majority.")}
        </text>
        <Show when={addresses().length > 0}>
          <text fg={theme.text.muted} wrapMode="word">
            {t("Addresses advertised by this server: {addresses}", { addresses: addresses().join(", ") })}
          </text>
        </Show>
        <Show when={server.error}>
          <text fg={theme.text.feedback.warning.base} wrapMode="word">
            {t("Could not discover this device's addresses. Enter a reachable LAN or VPN address manually.")}
          </text>
        </Show>

        <Show when={!showing()}>
          <Section title={t("Create the Mesh on this device")} />
          {field("url", t("This device's address"), t("e.g. http://192.168.1.12:4096"))}
          {field("name", t("Device name"), t("Default: {name}", { name: hostname() }), 32)}
          <box flexDirection="row">
            <Button variant="primary" disabled={busy()} onClick={create}>
              {t("Create Mesh")}
            </Button>
          </box>

          <Section title={t("Join a Mesh created on another device")} />
          {field("seedURL", t("Seed device address"), t("e.g. http://192.168.1.12:4096"))}
          {field("token", t("Invitation token"), t("Paste the token shown by the creator"), 54)}
          <box flexDirection="row">
            <Button disabled={busy()} onClick={join}>
              {t("Join Mesh")}
            </Button>
          </box>
        </Show>

        <Show when={current()} keyed>
          {(state) => (
            <>
              <Section title={t("Mesh status")} />
              <text fg={theme.text.base} wrapMode="word">
                {t("Room: {id}", { id: state.clusterID ?? "—" })}
              </text>
              <text fg={state.writable ? theme.text.feedback.success.base : theme.text.feedback.warning.base} wrapMode="word">
                {state.writable
                  ? t("Quorum healthy — shared writes are available")
                  : state.leader
                    ? t("Coordinator elected, but quorum is missing — read-only")
                    : state.leaderID
                      ? t("Connected to coordinator: {leader}", { leader: state.leaderID })
                      : t("Replica mode — waiting for a healthy coordinator")}
              </text>
              <text fg={theme.text.muted} wrapMode="word">
                {t("Coordinator: {leader}", { leader: state.leaderID ?? t("electing") })} · {t("Commit: {index}", { index: state.commitIndex })} · {t("Quorum requires {count} of {total} devices", { count: state.quorum, total: state.members.length })}
              </text>
              <box flexDirection="row" gap={1}>
                <Button disabled={busy()} variant={leaveArmed() ? "primary" : undefined} onClick={disconnect}>
                  {leaveArmed() ? t("Click again to leave Mesh") : t("Leave Mesh")}
                </Button>
              </box>
              <Show when={!state.voter}>
                <text fg={theme.text.feedback.warning.base} wrapMode="word">
                  {t("This device is connected as a worker. It receives the shared room log and can send shared messages through the coordinator, but it does not vote or increase the quorum. Remote AI dispatch from this panel is not available yet.")}
                </text>
              </Show>
              <text fg={theme.text.muted} wrapMode="word">
                {t("Leaving clears this device's Mesh state. Other devices keep their current membership, so leaving an active worker does not change the voter quorum.")}
              </text>
              <Section title={t("Devices")} />
              <For each={state.members}>
                {(member) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={member.id === state.leaderID ? theme.text.feedback.success.base : theme.text.base}>
                      {member.id === state.leaderID ? "●" : "○"}
                    </text>
                    <text fg={theme.text.base} wrapMode="none" truncate>
                      {member.name}
                    </text>
                    <box flexGrow={1} />
                    <text fg={theme.text.muted} wrapMode="none" truncate>
                      {new URL(member.url).host}
                    </text>
                    <text fg={theme.text.muted} wrapMode="none" truncate>
                      {state.voters.includes(member.id) ? t("Voter") : t("Worker")}
                    </text>
                  </box>
                )}
              </For>

              <Show when={state.status === "forming" && state.nodeID === state.ownerNodeID}>
                <Section title={t("Invite devices before activation")} />
                <Show when={invite()}>
                  <text fg={theme.text.muted} wrapMode="word">
                    {t("Invitation token — share only with your own devices:")}
                  </text>
                  <text fg={theme.text.base} wrapMode="word">{invite()}</text>
                </Show>
                <Show when={state.members.length < 2}>
                  <text fg={theme.text.feedback.warning.base} wrapMode="word">
                    {t("Connect at least one other device first. Devices invited after activation can join as non-voting workers.")}
                  </text>
                </Show>
                <Button variant="primary" disabled={busy() || state.members.length < 2} onClick={activate}>
                  {t("Activate Mesh")}
                </Button>
              </Show>

              <Show when={state.status === "active"}>
                <Show when={state.nodeID === state.ownerNodeID}>
                  <Section title={t("Invite another device")} />
                  <text fg={theme.text.muted} wrapMode="word">
                    {t("Share this token only with trusted devices. New devices join as non-voting workers, so the current quorum stays unchanged.")}
                  </text>
                  <Show when={invite()}>
                    <text fg={theme.text.base} wrapMode="word">{invite()}</text>
                  </Show>
                </Show>
                <Section title={t("Shared messages and tasks")} />
                <For each={entries()}>
                  {(entry) => (
                    <box gap={0}>
                      <text fg={theme.text.muted} wrapMode="word">
                        {entry.index + ". " + entry.kind + " · " + entry.originID}
                      </text>
                      <text fg={theme.text.base} wrapMode="word">
                        {describe(entry)}
                      </text>
                    </box>
                  )}
                </For>
                <box flexDirection="row" gap={1}>
                  <Button disabled={busy()} onClick={() => setKind(kind() === "message" ? "task" : "message")}>
                    {kind() === "message" ? t("Type: message") : t("Type: task")}
                  </Button>
                </box>
                {field("text", t("Message or task"), t("Enter a shared message; tasks can be dispatched to peers later"), 58)}
                <box flexDirection="row" gap={1}>
                  <Button variant="primary" disabled={busy() || !state.leaderID} onClick={send}>
                    {t("Send")}
                  </Button>
                  <Button disabled={busy()} onClick={() => run(() => refresh())}>
                    {t("Refresh")}
                  </Button>
                </box>
              </Show>
            </>
          )}
        </Show>

        <Show when={error()}>
          {(message) => <text fg={theme.text.feedback.error.base} wrapMode="word">{message()}</text>}
        </Show>
      </scrollbox>
    </box>
  )
}

// Host: the rooms this computer shares. A room is one session other devices
// join with a short code; only this computer's AI answers in it.
export function DialogHost(props: { onClose?: () => void }) {
  const dialog = useDialog()
  const client = useClient()
  const data = useData()
  const projects = useProjects()
  const local = useLocal()
  const route = useRoute()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const t = useT()
  const config = useConfig().data
  const hostNameFields: Record<string, InputRenderable> = {}
  const [rooms, { refetch }] = createResource(() => client.api.room.list())
  const [server, { refetch: reread }] = createResource(() => client.api.server.info())
  const [codes, setCodes] = createSignal<Readonly<Record<string, RoomJoinCode & { until: number }>>>({})
  const [armed, setArmed] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [mode, setMode] = createSignal<"host" | "mesh">("host")
  // Drives the join code countdown while the window is open.
  const [now, setNow] = createSignal(Date.now())
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const sessionID = () => (route.data.type === "session" ? route.data.sessionID : undefined)
  // A resource read after a failed fetch throws; the toast already reported the failure.
  const hosted = () => (rooms.error ? undefined : rooms()) ?? []
  const shared = () => hosted().some((room) => room.sessionID === sessionID())
  // Guests need an address they can reach. Loopback only works on this machine, and
  // container bridges (172.16/12), TUN adapters (198.18/15) and link-local addresses are
  // usually not the network other devices are on; they are shown only when nothing else is.
  const listening = () =>
    (server.state === "ready" ? server().urls : [])
      .map((url) => new URL(url).host)
      .filter((host) => !/^(localhost|127\.|\[::1\])/.test(host))
  const virtual = (host: string) => /^(169\.254\.|172\.(1[6-9]|2\d|3[01])\.|198\.1[89]\.)/.test(host)
  const preferred = () => listening().filter((host) => !virtual(host))
  const addresses = () => (preferred().length > 0 ? preferred() : listening())

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setArmed()
    await action()
      .then(() => refetch())
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
    roomListChanged()
    setBusy(false)
  }

  const issue = async (roomID: string) => {
    const issued = await client.api.room.code({ roomID })
    setNow(Date.now())
    setCodes((previous) => ({ ...previous, [roomID]: { ...issued, until: Date.now() + issued.expires_in * 1000 } }))
  }

  // The project the open session belongs to.
  const project = () => {
    const session = sessionID() ? data.session.get(sessionID()!) : undefined
    if (!session) return
    return Orchestra.ownerOf(projects.list(), session.location.directory, projects.owner(session.id))
  }

  // A new room is useless without a code, so hosting hands one out right away. A project
  // room shares every session under the project directory; the open session opens first.
  const share = (whole: boolean) => {
    const id = sessionID()
    if (!id) return
    const target = whole ? project() : undefined
    void run(async () => {
      // Guests prompt the session as it is stored. One that never ran has no model yet and
      // would run on the first model of the host's catalog, not the one picked here.
      const selected = local.model.current()
      if (!data.session.get(id)?.model && selected)
        await client.api.session.switchModel({
          sessionID: id,
          model: { providerID: selected.providerID, id: selected.modelID, variant: local.model.variant.current() },
        })
      const room = await client.api.room.create({
        sessionID: id,
        name: target?.name ?? (data.session.get(id)?.title || undefined),
        hostName: hostname(),
        directory: target?.directory,
      })
      await issue(room.id)
    })
  }

  // One click for `service set hostname 0.0.0.0` and `service restart`; the client reconnects
  // to the replacement service, which then reports its network addresses.
  const openToNetwork = (open: () => Promise<void>) => {
    setBusy(true)
    toast.show({ variant: "info", message: t("Restarting the service for the network…"), duration: 30000 })
    void open()
      .then(() => {
        toast.show({ variant: "success", message: t("The service now listens on the network") })
        void reread()
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
      .finally(() => setBusy(false))
  }

  const close = (room: RoomInfo) => {
    if (armed() !== room.id) return setArmed(room.id)
    void run(() => client.api.room.remove({ roomID: room.id }))
  }

  const saveHostName = (roomID: string) => {
    const name = hostNameFields[roomID]?.value.trim()
    if (!name) {
      toast.show({ message: t("Enter a host nickname."), variant: "error" })
      return
    }
    void run(() => client.api.room.update({ roomID, hostName: name }))
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <Header title={t("Multiplayer")} onClose={props.onClose} />
      <MultiplayerModeSelector value={mode()} onChange={(value) => setMode(value === "mesh" ? "mesh" : "host")} />
      <Show when={mode() === "host"}>
        <Show when={server.error}>
          {(error) => (
            <text fg={theme.text.feedback.error.base} wrapMode="word">
              {t("Could not read this server's addresses: {error}", { error: errorMessage(error()) })}
            </text>
          )}
        </Show>
        <Show
          when={addresses().length > 0}
          fallback={
            <Show when={server.state === "ready"}>
              <Show
                when={client.openToNetwork}
                fallback={
                  <text fg={theme.text.feedback.warning.base} wrapMode="word">
                    {t(
                      "This server only listens on this machine, so other devices cannot connect yet. Run `{command} service set hostname 0.0.0.0` and `{command} service restart`.",
                      { command: process.env.OPENCODE_COMMAND || "opencode" },
                    )}
                  </text>
                }
              >
                {(open) => (
                  <box>
                    <text fg={theme.text.feedback.warning.base} wrapMode="word">
                      {t(
                        "This server only listens on this machine, so other devices cannot connect yet. Opening it to the network restarts the service once; running sessions are interrupted.",
                      )}
                    </text>
                    <box flexDirection="row">
                      <Button variant="primary" disabled={busy()} onClick={() => openToNetwork(open())}>
                        {t("Open to the network")}
                      </Button>
                    </box>
                  </box>
                )}
              </Show>
            </Show>
          }
        >
          <Labeled label={t("Address")}>
            <box>
              <For each={addresses()}>
                {(address) => (
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                    {address}
                  </text>
                )}
              </For>
            </box>
          </Labeled>
          <Show when={preferred().length === 0}>
            <text fg={theme.text.feedback.warning.base} wrapMode="word">
              {t("Only virtual adapters (Docker, WSL, VPN) were found; other devices may not reach these addresses.")}
            </text>
          </Show>
          <FirewallHelp ports={[...new Set(addresses().map((address) => Number(address.split(":").at(-1))))]} />
        </Show>
        <Show
          when={sessionID()}
          fallback={<text fg={theme.text.muted}>{t("Open a session to host it as a room.")}</text>}
        >
          <Show when={!shared()}>
            <box flexDirection="row" gap={1}>
              <Button variant="primary" disabled={busy()} onClick={() => share(false)}>
                {t("Host this session")}
              </Button>
              <Show when={project()}>
                {(item) => (
                  <Button disabled={busy()} onClick={() => share(true)}>
                    {t("Host project {name}", { name: item().name })}
                  </Button>
                )}
              </Show>
            </box>
          </Show>
        </Show>
        <For each={hosted()}>
          {(room) => (
            <box>
              <Labeled label={t("Room")}>
                <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                  {room.name}
                  <span
                    style={{ fg: theme.text.muted }}
                  >{` · ${room.directory ? t("whole project") : t("one session")}`}</span>
                </text>
              </Labeled>
              <Setting
                label={t("Host nickname")}
                help={t("The name other participants use for this host. The AI uses it to distinguish the host from guests.")}
              >
                <input
                  width={24}
                  cursorStyle={config.cursor}
                  ref={(element: InputRenderable) => {
                    hostNameFields[room.id] = element
                    element.value = room.hostName ?? hostname()
                  }}
                  onMouseDown={() => hostNameFields[room.id]?.focus()}
                  placeholder={hostname()}
                  placeholderColor={theme.text.muted}
                  textColor={theme.text.formfield.base}
                  focusedTextColor={theme.text.formfield.focused}
                  cursorColor={theme.text.formfield.focused}
                  backgroundColor={theme.background.formfield.base}
                  focusedBackgroundColor={theme.background.formfield.focused}
                  onSubmit={() => saveHostName(room.id)}
                />
                <Button disabled={busy()} onClick={() => saveHostName(room.id)}>
                  {t("Save")}
                </Button>
              </Setting>
              <Show
                when={!room.open && codes()[room.id]}
                fallback={
                  <Labeled label={t("Join code")}>
                    <text fg={theme.text.muted}>{room.open ? t("not needed") : t("none yet")}</text>
                  </Labeled>
                }
              >
                {(issued) => (
                  <Labeled label={t("Join code")}>
                    <text fg={theme.text.base}>
                      <span style={{ bold: true }}>{issued().code}</span>
                      <Show
                        when={issued().until > now()}
                        fallback={<span style={{ fg: theme.text.feedback.warning.base }}>{"  " + t("expired")}</span>}
                      >
                        <span style={{ fg: theme.text.muted }}>
                          {"  " + t("expires in {time}", { time: countdown(issued().until - now()) })}
                        </span>
                      </Show>
                    </text>
                  </Labeled>
                )}
              </Show>
              <Setting
                label={t("Entry")}
                help={t("Whether guests need the join code or may join straight from the room list.")}
              >
                <Button
                  disabled={busy()}
                  onClick={() => void run(() => client.api.room.update({ roomID: room.id, open: !room.open }))}
                >
                  {room.open ? t("Without a code") : t("With a code")}
                </Button>
              </Setting>
              <Setting label={t("New guests")} help={t(DEFAULT_ROLE_HELP)}>
                <Button
                  disabled={busy()}
                  onClick={() =>
                    void run(() => client.api.room.update({ roomID: room.id, defaultRole: nextRole(joinRole(room)) }))
                  }
                >
                  {t(ROLE_LABEL[joinRole(room)])}
                </Button>
              </Setting>
              <Setting
                label={t("Rules")}
                help={t("What nobody in the room may do or see: project path, commands, files, sending out.")}
              >
                <Button
                  onClick={() => {
                    dialog.replace(
                      () => <DialogRoomRules roomID={room.id} name={room.name} onClose={() => dialog.clear()} />,
                      undefined,
                      { size: "large" },
                    )
                    dialog.setCentered(true)
                  }}
                >
                  {t("Open")}
                </Button>
              </Setting>
              <Setting label={t("People")} help={t("Who joined, their roles; remove or ban a guest.")}>
                <Button
                  onClick={() => {
                    dialog.replace(
                      () => <DialogPeople roomID={room.id} name={room.name} onClose={() => dialog.clear()} />,
                      undefined,
                      { size: "large" },
                    )
                    dialog.setCentered(true)
                  }}
                >
                  {t("Open")}
                </Button>
              </Setting>
              <Setting
                label={t("AI outreach")}
                help={t(
                  "Where this session's AI may post on its own: rooms you linked, or any room it finds, asking you before each send.",
                )}
              >
                <Button
                  disabled={busy()}
                  onClick={() =>
                    void run(() =>
                      client.api.room.update({ roomID: room.id, ai: room.ai === "linked" ? "discovered" : "linked" }),
                    )
                  }
                >
                  {room.ai === "linked" ? t("Linked rooms only") : t("Any room it finds")}
                </Button>
              </Setting>
              <box flexDirection="row" gap={1} paddingTop={1}>
                <Show when={!room.open}>
                  <Button variant="primary" disabled={busy()} onClick={() => void run(() => issue(room.id))}>
                    {codes()[room.id] ? t("New join code") : t("Get join code")}
                  </Button>
                </Show>
                <Button disabled={busy()} onLeave={() => setArmed()} onClick={() => close(room)}>
                  {armed() === room.id ? t("Click again to stop hosting") : t("Stop hosting")}
                </Button>
              </box>
              <Show when={room.open || codes()[room.id]}>
                <text fg={theme.text.muted} wrapMode="word">
                  {room.open
                    ? t("On the other device open Connect and pick this room, or enter the address.")
                    : t("On the other device open Connect, pick this room or enter the address, then the join code.")}
                </text>
              </Show>
            </box>
          )}
        </For>
        <Show when={rooms.error}>
          <text fg={theme.text.feedback.error.base}>{errorMessage(rooms.error)}</text>
        </Show>
      </Show>
      <Show when={mode() === "mesh"}>
        <DialogMesh onClose={props.onClose} hideHeader />
      </Show>
    </box>
  )
}

// Connect: rooms other computers host. The local network is scanned when the
// window opens; any room can also be reached by address, with the join code
// unless its host lets guests in without one.
export function DialogConnect(props: { onClose?: () => void }) {
  const client = useClient()
  const dialog = useDialog()
  const route = useRoute()
  const ownDirectory = useMeshDirectory()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const t = useT()
  const [saved, updateSaved] = useJoinedRooms()
  const deviceKey = useDeviceKey()
  const [found, { refetch: rescan, mutate: setFound }] = createResource(() => scanRooms())
  const [armed, setArmed] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [joinError, setJoinError] = createSignal<string>()
  const [meshJoinError, setMeshJoinError] = createSignal<string>()
  const [localServer] = createResource(() => client.api.server.info())
  const [selectedMesh, setSelectedMesh] = createSignal<(FoundMesh & { seedURL: string; host: string })>()
  const fields: {
    address?: InputRenderable
    code?: InputRenderable
    name?: InputRenderable
    meshToken?: InputRenderable
    meshURL?: InputRenderable
  } = {}

  const discoveredMeshes = createMemo(() => {
    const unique = new Map<string, FoundMesh & { seedURL: string; host: string }>()
    for (const server of found() ?? []) {
      // The local Mesh is already joined on this device; don't offer it as a remote target.
      if (!server.mesh || server.own) continue
      const mesh = {
        ...server.mesh,
        // Use the reachable endpoint that actually advertised this room. The stored
        // ownerURL may be a stale/container-only address on older installations.
        seedURL: server.url,
        host: server.host,
      }
      const existing = unique.get(mesh.clusterID)
      // Prefer a discovery record that points directly at the Mesh owner.
      if (!existing || mesh.isOwner) unique.set(mesh.clusterID, mesh)
    }
    return [...unique.values()]
  })

  const ownMeshAddress = () => {
    const urls = localServer.state === "ready" ? localServer().urls : []
    const candidates = urls
      .map((url) => new URL(url))
      .filter((url) => !/^(localhost|127\.|0\.0\.0\.0|\[::1\])$/.test(url.hostname))
      .filter((url) => !/^(198\.1[89]\.|169\.254\.)/.test(url.hostname))
    const privateLAN = candidates.find((url) =>
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname),
    )
    return (privateLAN ?? candidates[0])?.origin ?? ""
  }

  const chooseMesh = (mesh: FoundMesh & { seedURL: string; host: string }) => {
    const previous = selectedMesh()
    // Never silently reuse a token pasted for a different discovered Mesh.
    if (previous?.clusterID !== mesh.clusterID && fields.meshToken && !fields.meshToken.isDestroyed)
      fields.meshToken.value = ""
    setSelectedMesh(mesh)
    setMeshJoinError()
    setTimeout(() => {
      if (fields.meshURL && !fields.meshURL.isDestroyed && !fields.meshURL.value) fields.meshURL.value = ownMeshAddress()
      if (fields.meshToken && !fields.meshToken.isDestroyed) fields.meshToken.focus()
    }, 1)
  }

  const joinMesh = () => {
    const mesh = selectedMesh()
    // Base64url invite tokens never contain whitespace; remove it in case a terminal
    // paste inserted spaces or line breaks.
    const token = fields.meshToken?.value.replace(/\s+/g, "") ?? ""
    const url = fields.meshURL?.value.trim() || ownMeshAddress()
    if (!mesh) return setMeshJoinError(t("Select a Mesh room from the network list first."))
    if (!token) return setMeshJoinError(t("Paste the invitation token from the Mesh creator."))
    if (!url) return setMeshJoinError(t("Enter this device's reachable address, including its port."))
    setBusy(true)
    setMeshJoinError()
    void client.api.room.mesh
      .join({ seedURL: mesh.seedURL, token, url, name: hostname(), directory: ownDirectory() })
      .then(() => {
        setSelectedMesh(undefined)
        dialog.replace(() => <DialogMesh onClose={() => dialog.clear()} />, undefined, { size: "large" })
        dialog.setCentered(true)
      })
      .catch((error: unknown) => {
        const message = errorMessage(error)
        if (
          message.includes("Mesh credential is invalid") ||
          message.includes("Mesh invitation token does not match this room")
        ) {
          setMeshJoinError(
            t("The invitation token was rejected by {address} for Mesh {id}. Re-copy the current token from that room's owner and retry.", {
              address: mesh.seedURL,
              id: mesh.clusterID,
            }),
          )
          return
        }
        setMeshJoinError(message)
      })
      .finally(() => setBusy(false))
  }

  const enter = (url: string, request: { code?: string; roomID?: string }) => {
    setBusy(true)
    setJoinError()
    void deviceKey()
      .then((device) =>
        roomClient({ url, token: "" }).room.join({ ...request, name: fields.name?.value.trim() || hostname(), device }),
      )
      .then(async (joined) => {
        const room = { url, roomID: joined.room.id }
        await updateSaved((draft) => {
          draft.joined = [
            ...draft.joined.filter((item) => !sameRoom(item, room)),
            { ...room, name: joined.room.name, token: joined.token, guest: joined.guest.name },
          ]
        })
        open(room)
      })
      .catch((error: unknown) => setJoinError(errorMessage(error)))
      .finally(() => setBusy(false))
  }

  // With a code the host decides the room; without one the address must lead to
  // a single open room, and its rooms join the list above when there are several.
  const join = () => {
    const address = fields.address?.value.trim() ?? ""
    const code = fields.code?.value.trim() ?? ""
    if (!address) return setJoinError(t("Enter the host's address"))
    const url = withPort(/^https?:\/\//.test(address) ? address : `http://${address}`)
    if (!url) return setJoinError(t("Add the host's port: 192.168.1.5:PORT"))
    if (code) return enter(url, { code })
    setBusy(true)
    setJoinError()
    void readServer(url)
      .then((server) => {
        const rooms = server.rooms
        setFound((previous) => [...(previous ?? []).filter((item) => item.url !== url), server])
        const unlocked = rooms.filter((room) => room.open)
        if (rooms.length === 0 && server.mesh) {
          chooseMesh({ ...server.mesh, seedURL: server.url, host: server.host })
          return setJoinError(t("Mesh found. Paste its invitation token in the Mesh connection panel below."))
        }
        if (rooms.length === 0) return setJoinError(t("No rooms at this address"))
        if (unlocked.length === 1 && rooms.length === 1) return enter(url, { roomID: unlocked[0].id })
        if (unlocked.length === 0 && rooms.length === 1)
          return setJoinError(t("This room needs the join code its host shows"))
        setJoinError(t("Pick a room above: this host shares several"))
      })
      .catch((error: unknown) => setJoinError(errorMessage(error)))
      .finally(() => setBusy(false))
  }

  // A bare IP takes this computer's server port: hosts usually run the same setup, and
  // without it the URL would silently point at port 80.
  const withPort = (url: string) => {
    const parsed = new URL(url)
    if (parsed.port) return url
    const own = found()?.find((server) => server.own)
    if (!own) return undefined
    parsed.port = new URL(own.url).port
    return parsed.origin
  }

  const order = ["address", "code", "name", "meshToken", "meshURL"] as const
  const cycle = (delta: number) => {
    const index = order.findIndex((key) => fields[key]?.focused)
    fields[order[(index + delta + order.length) % order.length]]?.focus()
  }
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "tab", title: "Next field", group: "Connect", run: () => cycle(1) },
      { bind: "shift+tab", title: "Previous field", group: "Connect", run: () => cycle(-1) },
    ],
  }))
  onMount(() => {
    setTimeout(() => {
      if (fields.address && !fields.address.isDestroyed) fields.address.focus()
    }, 1)
    // Keep the list fresh while the Connect dialog is open; Mesh peers appear without a manual rescan.
    const timer = setInterval(() => {
      if (!found.loading) void rescan()
    }, 5000)
    onCleanup(() => clearInterval(timer))
  })

  // An open room joins at once; any other only lacks the code: fill its address and move to the code field.
  const pick = (room: FoundRoom) => {
    if (room.open) return enter(room.url, { roomID: room.id })
    if (fields.address) fields.address.value = new URL(room.url).host
    setJoinError()
    fields.code?.focus()
  }

  // A joined room opens where a session would and stays in the left panel under Multiplayer.
  const open = (room: Pick<JoinedRoom, "url" | "roomID">) => {
    const current = route.data
    const returnTo =
      current.type === "session" ? current.sessionID : current.type === "room" ? current.returnTo : undefined
    dialog.clear()
    route.navigate({ type: "room", url: room.url, roomID: room.roomID, ...(returnTo ? { returnTo } : {}) })
  }

  const leave = (room: JoinedRoom) => {
    const key = `${room.url}#${room.roomID}`
    if (armed() !== key) return setArmed(key)
    setArmed()
    void tellHostLeft(room)
    void unlinkRoom(client.api, room)
    void updateSaved((draft) => {
      draft.joined = draft.joined.filter((item) => !sameRoom(item, room))
    })
  }

  const field = (
    key: "address" | "code" | "name" | "meshToken" | "meshURL",
    label: string,
    placeholder: string,
  ) => (
    <Labeled label={label}>
      <input
        width={key === "meshToken" ? 54 : 36}
        cursorStyle={config.cursor}
        ref={(element: InputRenderable) => {
          fields[key] = element
        }}
        onMouseDown={() => fields[key]?.focus()}
        onSubmit={() => (key === "meshToken" || key === "meshURL" ? joinMesh() : join())}
        placeholder={placeholder}
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.focused}
        cursorColor={theme.text.formfield.focused}
        backgroundColor={theme.background.formfield.base}
        focusedBackgroundColor={theme.background.formfield.focused}
      />
    </Labeled>
  )

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <Header title={t("Connect")} onClose={props.onClose} />
      <scrollbox
        maxHeight={Math.max(8, dimensions().height - 8)}
        contentOptions={{ minHeight: 0, gap: 1 }}
        scrollbarOptions={{ visible: false }}
      >
        <Section title={t("Join by address")} />
        {field("address", t("Address"), t("IP or IP:port, e.g. 192.168.1.5"))}
        {field("code", t("Join code"), t("e.g. ABCD-EFGH, empty if not needed"))}
        {field("name", t("Your name"), t("{name} (default)", { name: hostname() }))}
        <Show when={joinError()}>
          {(message) => (
            <text fg={theme.text.feedback.error.base} wrapMode="word">
              {message()}
            </text>
          )}
        </Show>
        <box flexDirection="row">
          <Button variant="primary" disabled={busy()} onClick={join}>
            {t("Join")}
          </Button>
        </box>

        <Section title={t("Rooms on this network")} />
        <box flexDirection="row" gap={1}>
          <text fg={theme.text.muted}>
            {found.loading
              ? t("Searching…")
              : found()?.length
                ? t("Servers found: {count}", { count: found()!.length })
                : t("No servers found")}
          </text>
          <Button disabled={found.loading} onClick={() => void rescan()}>
            {t("Search again")}
          </Button>
        </box>
        <For each={found() ?? []}>
          {(server) => (
            <box>
              <text fg={theme.text.muted} wrapMode="none" truncate>
                {`${server.host} · ${new URL(server.url).host}${server.own ? ` · ${t("this computer")}` : ""}`}
              </text>
              <For each={server.rooms}>
                {(room) => (
                  <box flexDirection="row" gap={1} paddingLeft={2}>
                    <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                      {room.name ?? t("Room, needs a code")}
                      <span style={{ fg: theme.text.muted }}>{` · ${t("Host")}`}</span>
                    </text>
                    <box flexGrow={1} />
                    <Button variant="primary" disabled={busy()} onClick={() => pick(room)}>
                      {room.open ? t("Join") : t("Select")}
                    </Button>
                  </box>
                )}
              </For>
              <Show when={server.rooms.length === 0 && !server.mesh}>
                <box paddingLeft={2}>
                  <text fg={theme.text.muted} wrapMode="word">
                    {t("No rooms hosted yet: on that computer open a session and press + Host.")}
                  </text>
                </box>
              </Show>
            </box>
          )}
        </For>

        <Show when={discoveredMeshes().length > 0}>
          <Section title={t("Mesh rooms found")} />
          <For each={discoveredMeshes()}>
            {(mesh) => (
              <box flexDirection="row" gap={1} paddingLeft={2}>
                <box flexGrow={1} minWidth={0}>
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                    {mesh.name}
                    <span style={{ fg: theme.text.action.primary.base }}>{` · ${t("Mesh")}`}</span>
                  </text>
                  <text fg={theme.text.muted} wrapMode="none" truncate>
                    {`${mesh.memberCount} ${t("devices")} · ${mesh.status} · ${mesh.host}`}
                  </text>
                </box>
                <Button variant="primary" disabled={busy()} onClick={() => chooseMesh(mesh)}>
                  {t("Connect")}
                </Button>
              </box>
            )}
          </For>
        </Show>

        <Show when={selectedMesh()}>
          {(mesh) => (
            <box gap={1}>
              <Section title={t("Connect to Mesh: {name}", { name: mesh().name })} />
              <text fg={theme.text.muted} wrapMode="word">
                {t("Found on {host}. Enter the invitation token from the Mesh creator.", { host: mesh().host })}
              </text>
              {field("meshToken", t("Invitation token"), t("Paste the token shown by the creator"))}
              {field("meshURL", t("This device's address"), ownMeshAddress() || t("e.g. http://192.168.1.12:4096"))}
              <Show when={meshJoinError()}>
                {(message) => (
                  <text fg={theme.text.feedback.error.base} wrapMode="word">
                    {message()}
                  </text>
                )}
              </Show>
              <box flexDirection="row" gap={1}>
                <Button variant="primary" disabled={busy()} onClick={joinMesh}>
                  {t("Join Mesh")}
                </Button>
                <Button disabled={busy()} onClick={() => setSelectedMesh(undefined)}>
                  {t("Cancel")}
                </Button>
              </box>
            </box>
          )}
        </Show>

        <Show when={!found.loading && !found()?.length}>
          <text fg={theme.text.muted} wrapMode="word">
            {t(
              "Not found? Both computers must be on one network, and on Windows opencode must be allowed in the firewall.",
            )}
          </text>
        </Show>
        <FirewallHelp ports={[]} />

        <Show when={saved.joined.length > 0}>
          <Section title={t("Joined rooms")} />
        </Show>
        <For each={saved.joined}>
          {(room) => (
            <box flexDirection="row" gap={1}>
              <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                {room.name}
                <span style={{ fg: theme.text.muted }}>{` · ${t("Host")}`}</span>
              </text>
              <text fg={theme.text.muted}>{`${new URL(room.url).host} · ${t("as {name}", { name: room.guest })}`}</text>
              <box flexGrow={1} />
              <Button variant="primary" onClick={() => open(room)}>
                {t("Open")}
              </Button>
              <Button onLeave={() => setArmed()} onClick={() => leave(room)}>
                {armed() === `${room.url}#${room.roomID}` ? t("Click again to leave") : t("Leave")}
              </Button>
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  )
}

type RoomRole = RoomMemberView["role"]

export const ROLE_LABEL = { viewer: "Viewer", member: "Member", helper: "Helper", cohost: "Cohost", trusted: "Trusted" } as const
const ROLE_HELP =
  "Viewers only watch, members also write and start sessions, helpers also allow or deny the AI's requests, cohosts also pick the model and agent and run commands, and Trusted members can run remote commands and checks without host confirmation."
const DEFAULT_ROLE_HELP = "This role is given to new guests who join with a code. Trusted access is assigned to individual people in the People list."
const ROLES = ["viewer", "member", "helper", "cohost"] as const
const MEMBER_ROLES: readonly RoomRole[] = [...ROLES, "trusted"]

export function nextRole(role: Exclude<RoomRole, "trusted">) {
  return ROLES[(ROLES.indexOf(role) + 1) % ROLES.length]
}

export function nextMemberRole(role: RoomRole) {
  return MEMBER_ROLES[(MEMBER_ROLES.indexOf(role) + 1) % MEMBER_ROLES.length]
}

// Rooms saved before roles existed: guests who could answer approvals join as helpers.
function joinRole(room: RoomInfo): Exclude<RoomRole, "trusted"> {
  return room.defaultRole ?? (room.guestApprovals ? "helper" : "member")
}

// The people of one hosted room: who is connected, what each may do, and the guests
// kept out. Clicking a role steps through the roles; removing and banning ask twice.
export function DialogPeople(props: { roomID: string; name: string; onClose?: () => void }) {
  const client = useClient()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const t = useT()
  const [members, { refetch: rereadMembers, mutate: setMembers }] = createResource(() =>
    client.api.room.member.list({ roomID: props.roomID }),
  )
  const [bans, { refetch: rereadBans }] = createResource(() => client.api.room.ban.list({ roomID: props.roomID }))
  const [armed, setArmed] = createSignal<string>()
  // A resource read after a failed fetch throws, so failures show as text and the lists as empty.
  const listed = () => (members.error ? undefined : members.latest) ?? []
  const banned = () => (bans.error ? undefined : bans.latest) ?? []
  // Guests report in every couple of seconds; reading as often keeps "online" honest.
  onMount(() => {
    const timer = setInterval(() => void rereadMembers(), 2000)
    onCleanup(() => clearInterval(timer))
  })

  const act = (action: () => Promise<unknown>) =>
    void action()
      .then(() => Promise.all([rereadMembers(), rereadBans()]))
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))

  const cycle = (member: RoomMemberView) => {
    const role = nextMemberRole(member.role)
    setMembers((list) => list?.map((item) => (item.id === member.id ? { ...item, role } : item)))
    act(() => client.api.room.member.update({ roomID: props.roomID, guestID: member.id, role }))
  }

  // The first click arms the button and the second acts.
  const confirm = (key: string, action: () => Promise<unknown>) => {
    if (armed() !== key) return setArmed(key)
    setArmed()
    act(action)
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <Header title={`${t("People")} · ${props.name}`} onClose={props.onClose} />
      <text fg={theme.text.muted} wrapMode="word">
        {t(ROLE_HELP)}
      </text>
      <Show when={members.error ?? bans.error}>
        {(error) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {errorMessage(error())}
          </text>
        )}
      </Show>
      <Show when={listed().length > 0} fallback={<text fg={theme.text.muted}>{t("No guests have joined yet.")}</text>}>
        <For each={listed()}>
          {(member) => (
            <box flexDirection="row" gap={1}>
              <text fg={member.online ? theme.text.feedback.success.base : theme.text.muted} flexShrink={0}>
                {member.online ? "●" : "○"}
              </text>
              <box flexGrow={1} minWidth={0}>
                <text fg={theme.text.base} wrapMode="none" truncate>
                  {member.name}
                  <span style={{ fg: theme.text.muted }}>
                    {` · ${member.online ? t("online") : t("away")}${member.address ? ` · ${member.address}` : ""}`}
                  </span>
                </text>
              </box>
              <Button onClick={() => cycle(member)}>{t(ROLE_LABEL[member.role])}</Button>
              <Button
                onLeave={() => setArmed()}
                onClick={() =>
                  confirm(`kick:${member.id}`, () =>
                    client.api.room.member.remove({ roomID: props.roomID, guestID: member.id }),
                  )
                }
              >
                {armed() === `kick:${member.id}` ? t("Kick?") : t("Kick")}
              </Button>
              <Button
                variant={armed() === `ban:${member.id}` ? "primary" : undefined}
                onLeave={() => setArmed()}
                onClick={() =>
                  confirm(`ban:${member.id}`, () =>
                    client.api.room.member.ban({ roomID: props.roomID, guestID: member.id }),
                  )
                }
              >
                {armed() === `ban:${member.id}` ? t("Ban?") : t("Ban")}
              </Button>
            </box>
          )}
        </For>
      </Show>
      <Show when={banned().length > 0}>
        <Section title={t("Banned")} />
        <For each={banned()}>
          {(ban) => (
            <box flexDirection="row" gap={1}>
              <box flexGrow={1} minWidth={0}>
                <text fg={theme.text.base} wrapMode="none" truncate>
                  {ban.name}
                  <span style={{ fg: theme.text.muted }}>{ban.address ? ` · ${ban.address}` : ""}</span>
                </text>
              </box>
              <Button onClick={() => act(() => client.api.room.ban.remove({ roomID: props.roomID, banID: ban.id }))}>
                {t("Unban")}
              </Button>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

// Rules the host sets for everyone in a room, the host's AI included. The host's server applies
// them, so a guest's client cannot switch one off. They are about data and commands, not roles.
export function DialogRoomRules(props: { roomID: string; name: string; onClose?: () => void }) {
  const client = useClient()
  const config = useConfig().data
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const t = useT()
  const fields: Record<string, InputRenderable> = {}
  const [rooms, { refetch }] = createResource(() => client.api.room.list())
  const room = () => (rooms.error ? undefined : rooms.latest)?.find((item) => item.id === props.roomID)
  const rules = () => room()?.rules ?? {}
  const noOutbound = () => rules().noOutbound !== false
  const list = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)

  // An update replaces the rules whole, so every save sends the full set.
  const save = (patch: NonNullable<RoomInfo["rules"]>) =>
    void client.api.room
      .update({ roomID: props.roomID, rules: { ...rules(), ...patch } })
      .then(() => refetch())
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))

  const field = (key: "blockCommands" | "protectedFiles", placeholder: string) => (
    <>
      <input
        width={30}
        cursorStyle={config.cursor}
        ref={(element: InputRenderable) => {
          fields[key] = element
          element.value = (rules()[key] ?? []).join(", ")
        }}
        onMouseDown={() => fields[key]?.focus()}
        placeholder={placeholder}
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.focused}
        cursorColor={theme.text.formfield.focused}
        backgroundColor={theme.background.formfield.base}
        focusedBackgroundColor={theme.background.formfield.focused}
        onSubmit={() => save({ [key]: list(fields[key]?.value ?? "") })}
      />
      <Button onClick={() => save({ [key]: list(fields[key]?.value ?? "") })}>{t("Save")}</Button>
    </>
  )

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <Header title={`${t("Room rules")} · ${props.name}`} onClose={props.onClose} />
      <text fg={theme.text.muted} wrapMode="word">
        {t("Rules apply to everyone in the room, including the host's AI. They come before any role.")}
      </text>
      <Show when={rooms.error}>
        {(error) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {errorMessage(error())}
          </text>
        )}
      </Show>
      <Show when={room()}>
        <Setting
          label={t("Project path")}
          help={t("Masks the host's project path in room responses, history, events and tool results. Changes apply while the room is open.")}
        >
          <Button onClick={() => save({ hidePaths: !rules().hidePaths })}>
            {rules().hidePaths ? t("Hidden") : t("Visible")}
          </Button>
        </Setting>
        <Setting
          label={t("Sending out")}
          help={t("Blocks connected-account and unknown tools plus common network commands. Arbitrary code can still open its own sockets; use an OS firewall or sandbox for a hard network boundary.")}
        >
          <Button onClick={() => save({ noOutbound: !noOutbound() })}>
            {noOutbound() ? t("Forbidden") : t("Allowed")}
          </Button>
        </Setting>
        <Setting
          label={t("Commands requiring approval")}
          help={t("Comma-separated command/program patterns. A matching program asks the host before use; Always allow applies only to that room member. * matches any text.")}
        >
          {field("blockCommands", "rm -rf, git push*, curl")}
        </Setting>
        <Setting
          label={t("Off-limits files")}
          help={t("Comma-separated names or folders. .env files, SSH/cloud credentials, private keys, certificates and credential JSON are protected automatically too.")}
        >
          {field("protectedFiles", ".env*, secrets/*")}
        </Setting>
        <Setting
          label={t("Hide command and tool execution")}
          help={t("Other room members do not see command/tool inputs, execution events or tool output. Your local host view is unchanged.")}
        >
          <Button onClick={() => save({ hideCommandExecution: !rules().hideCommandExecution })}>
            {rules().hideCommandExecution ? t("Hidden") : t("Visible")}
          </Button>
        </Setting>
        <Setting
          label={t("Hide screenshots and images")}
          help={t("Removes embedded image attachments and tool-result images from data sent to other room members.")}
        >
          <Button onClick={() => save({ hideScreenshots: !rules().hideScreenshots })}>
            {rules().hideScreenshots ? t("Hidden") : t("Visible")}
          </Button>
        </Setting>

      </Show>
    </box>
  )
}
// Windows Firewall drops room traffic for an app the user never allowed, and the
// prompt that would ask never shows for the background service. The window reads which
// of its rules exist and offers one elevated PowerShell run only when some are missing
// or a block rule for this program is in the way.
function FirewallHelp(props: { ports: readonly number[] }) {
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const t = useT()
  const [busy, setBusy] = createSignal(false)
  const [state, { refetch }] = createResource(
    () => (process.platform === "win32" ? [...props.ports] : undefined),
    (ports) => readFirewall(ports),
  )
  const allow = () => {
    setBusy(true)
    void allowInWindowsFirewall(props.ports)
      .then(() => readFirewall(props.ports))
      .then((after) => {
        void refetch()
        // The elevated run reports nothing back, so what the firewall now holds is the answer.
        if (firewallAllows(after)) return toast.show({ message: t("Windows Firewall rules added"), variant: "success" })
        toast.show({
          message: t("Windows Firewall still lacks the rules; was the administrator prompt declined?"),
          variant: "error",
        })
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
      .finally(() => setBusy(false))
  }
  // A failed read leaves the button: offering it is harmless, hiding it could strand the operator.
  const allowed = () => !state.error && state.state === "ready" && firewallAllows(state())
  return (
    <Show when={process.platform === "win32" && state.state !== "pending" && state.state !== "unresolved"}>
      <Show
        when={!allowed()}
        fallback={<text fg={theme.text.muted}>{t("Windows Firewall lets opencode rooms through.")}</text>}
      >
        <box>
          <text fg={theme.text.muted} wrapMode="word">
            {t(
              "Windows Firewall blocks rooms until opencode is allowed on the local network; Windows asks for administrator rights once.",
            )}
          </text>
          <box flexDirection="row">
            <Button disabled={busy()} onClick={allow}>
              {t("Allow in Windows Firewall")}
            </Button>
          </box>
        </box>
      </Show>
    </Show>
  )
}

const RULE = "opencode rooms"

// One rule per purpose, so allowing from Connect never drops the server port Host allowed.
export function firewallRules(ports: readonly number[]) {
  return [RULE, `${RULE} discovery`, ...ports.map((port) => `${RULE} tcp ${port}`)]
}

// The output of the read script: a "rule:<name>" line per rule present and "block" when a
// block rule for this program exists, which wins over every allow rule.
export function parseFirewall(output: string, ports: readonly number[]) {
  const lines = output.split(/\r?\n/).map((line) => line.trim())
  return {
    missing: firewallRules(ports).filter((name) => !lines.includes(`rule:${name}`)),
    blocked: lines.includes("block"),
  }
}

export function firewallAllows(state: { missing: readonly string[]; blocked: boolean } | undefined) {
  return state !== undefined && state.missing.length === 0 && !state.blocked
}

const program = () => `$program = '${process.execPath.replaceAll("'", "''")}'`
const blockRules =
  "Get-NetFirewallApplicationFilter -Program $program -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Action -eq 'Block' -and $_.Enabled -eq 'True' }"

// Reading rules needs no administrator rights.
async function readFirewall(ports: readonly number[]) {
  const script = [
    program(),
    ...firewallRules(ports).map(
      (name) => `if (Get-NetFirewallRule -DisplayName '${name}' -ErrorAction SilentlyContinue) { 'rule:${name}' }`,
    ),
    `if (${blockRules}) { 'block' }`,
  ].join("; ")
  const child = Bun.spawn(["powershell", "-NoProfile", "-EncodedCommand", encode(script)], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await new Response(child.stdout).text()
  if ((await child.exited) !== 0)
    throw new Error((await new Response(child.stderr).text()).trim() || "PowerShell failed")
  return parseFirewall(output, ports)
}

async function allowInWindowsFirewall(ports: readonly number[]) {
  const rule = `-Direction Inbound -Action Allow -RemoteAddress LocalSubnet -Profile Any`
  const [app, discovery, ...tcp] = firewallRules(ports)
  // Each rule is replaced by its own name only, so rules for other ports stay.
  const replace = (name: string, filter: string) =>
    `Remove-NetFirewallRule -DisplayName '${name}' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '${name}' ${rule} ${filter}`
  const script = [
    program(),
    // A dismissed firewall prompt leaves block rules for the program, and block rules win over allow rules.
    `${blockRules} | Remove-NetFirewallRule`,
    replace(app, "-Program $program"),
    replace(discovery, `-Protocol UDP -LocalPort ${DISCOVERY_PORTS.join(",")}`),
    ...tcp.map((name, index) => replace(name, `-Protocol TCP -LocalPort ${ports[index]}`)),
  ].join("; ")
  const child = Bun.spawn(
    [
      "powershell",
      "-NoProfile",
      "-Command",
      `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encode(script)}'`,
    ],
    { stdout: "ignore", stderr: "pipe" },
  )
  if ((await child.exited) !== 0)
    throw new Error((await new Response(child.stderr).text()).trim() || "PowerShell failed")
}

// PowerShell takes an encoded command as base64 of UTF-16LE, which spares all quoting.
function encode(script: string) {
  return Buffer.from(script, "utf16le").toString("base64")
}

export function Header(props: { title: string; onClose?: () => void }) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      <text fg={theme.text.muted} onMouseUp={() => props.onClose?.()}>
        esc
      </text>
    </box>
  )
}

const LABEL_WIDTH = 14

function Labeled(props: { label: string; children: JSX.Element }) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row">
      <box width={LABEL_WIDTH} flexShrink={0}>
        <text fg={theme.text.muted}>{props.label}</text>
      </box>
      {props.children}
    </box>
  )
}

function Setting(props: { label: string; help: string; children: JSX.Element }) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row">
      <box width={LABEL_WIDTH} flexShrink={0}>
        <text fg={theme.text.muted}>{props.label}</text>
      </box>
      <box flexShrink={1} minWidth={0}>
        <box flexDirection="row">{props.children}</box>
        <text fg={theme.text.muted} wrapMode="word">
          {props.help}
        </text>
      </box>
    </box>
  )
}

function countdown(ms: number) {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function Section(props: { title: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <text fg={theme.text.base} attributes={TextAttributes.UNDERLINE}>
      {props.title}
    </text>
  )
}
