import { TextAttributes } from "@opentui/core"
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type {
  OrchestraAccess,
  OrchestraProject,
  RoomBan,
  RoomInfo,
  RoomMemberView,
  SessionInfo,
} from "@opencode/client/promise"
import { Orchestra } from "@opencode/schema/orchestra"
import { Mode } from "@opencode/schema/mode"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { roomListChanged, roomListRevision, sameRoom, useJoinedRooms, type JoinedRoom } from "../util/room"
import { DialogConnect, DialogHost, DialogMesh, nextMemberRole, ROLE_LABEL } from "./dialog-rooms"
import { roomClient, tellHostLeft, unlinkRoom } from "../util/room-guest"
import { DialogGroups } from "./dialog-groups"
import { openProjectDialog } from "./dialog-project"
import { useProjects } from "../context/projects"
import { DialogPrompt } from "../ui/dialog-prompt"
import { DialogConfirm } from "../ui/dialog-confirm"
import { ClearSessionsAction } from "./clear-sessions"
import { useNotes, type NotesTab } from "../context/notes"
import { NotesPanel } from "./notes-panel"
import { Row } from "./panel-row"
import { RoomDodRows } from "./room-dod"
import { HoverAction } from "./hover-action"
import { DialogMode } from "./dialog-mode"
import { useNow } from "./note-canvas"
import { useT } from "../util/i18n"
import { tint } from "../theme/color"

// The left panel: the operator's own projects, each a name and a directory,
// with its main session (the orchestrator) and the sessions opened in that
// directory under it, grouped by category. "#" sets a session's category; the
// chip after it is the access the orchestrator has to it, and clicking it steps
// through the levels. Below the projects, Multiplayer lists the sessions this
// computer hosts as rooms and the rooms it joined on other hosts. The Host dialog
// includes a Mesh mode. The Notes tab swaps the tree for notes.

const ACCESS_ORDER: readonly OrchestraAccess[] = ["hidden", "read", "write", "full"]

export function ProjectTree(props: { width: number; collapsed?: boolean; onHide?: () => void; onShow?: () => void }) {
  const t = useT()
  const client = useClient()
  const data = useData()
  const route = useRoute()
  const theme = useTheme()
  const toast = useToast()
  const dialog = useDialog()
  const projectList = useProjects()
  const projects = projectList.list
  const notes = useNotes()
  const [rooms] = createResource(roomListRevision, () => client.api.room.list().catch(() => []))
  const [meshStatus, { refetch: refreshMesh }] = createResource(() =>
    client.api.room.mesh.status().catch(() => undefined),
  )
  onMount(() => {
    const timer = setInterval(() => void refreshMesh(), 2000)
    onCleanup(() => clearInterval(timer))
  })
  // Groups the operator keeps projects in. The dialog changes them, so they are read again as it closes.
  const [groups, { refetch: refreshGroups }] = createResource(() =>
    client.api.orchestra.group.list().catch(() => []),
  )
  onMount(() => {
    const timer = setInterval(() => void refreshGroups(), 3000)
    onCleanup(() => clearInterval(timer))
  })
  const [groupClosed, setGroupClosed] = createStore<Record<string, boolean>>({})
  // Groups first, each with the projects it holds; a project in several groups appears in the first only.
  // Projects in no group follow without a heading.
  const sections = createMemo(() => {
    const seen = new Set<string>()
    const named = (groups.latest ?? []).map((group) => ({
      name: group.name as string | undefined,
      projects: group.projects.flatMap((id) => {
        const project = projects().find((item) => item.id === id)
        if (!project || seen.has(id)) return []
        seen.add(id)
        return [project]
      }),
    }))
    return [...named, { name: undefined as string | undefined, projects: projects().filter((item) => !seen.has(item.id)) }]
  })
  const [joined, updateJoined] = useJoinedRooms()
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [access, setAccess] = createStore<Record<string, OrchestraAccess>>({})
  const [category, setCategory] = createStore<Record<string, string | undefined>>({})
  const [hover, setHoverState] = createSignal<string>()
  // Destructive actions require two clicks. Do not disarm them just because a label reflows
  // under the pointer after the first click; terminals can emit mouse-out during that reflow.
  const [armed, setArmedState] = createSignal<string>()
  let armTimer: ReturnType<typeof setTimeout> | undefined
  const clearArmed = () => {
    if (armTimer !== undefined) clearTimeout(armTimer)
    armTimer = undefined
    setArmedState()
  }
  const arm = (id: string) => {
    if (armTimer !== undefined) clearTimeout(armTimer)
    setArmedState(id)
    armTimer = setTimeout(() => {
      if (armed() === id) setArmedState()
      armTimer = undefined
    }, 4_000)
  }
  const setHover = (id: string | undefined) => {
    // Hover may briefly move between children when a label changes width. Confirmation is
    // cleared by a different destructive action or by timeout, never by pointer bookkeeping.
    setHoverState(id)
  }
  onCleanup(() => {
    if (armTimer !== undefined) clearTimeout(armTimer)
  })
  // Hidden as soon as the delete succeeds; the server's deleted event drops the record later.
  const [removed, setRemoved] = createStore<Record<string, boolean>>({})

  const current = () => (route.data.type === "session" ? data.session.get(route.data.sessionID) : undefined)
  // A narrow panel keeps session titles readable by showing the category and access controls
  // only on the hovered session.
  const narrow = () => props.width < 36
  const shared = createMemo(() => new Set((rooms.latest ?? []).map((room) => room.sessionID)))
  const owner = (session: Pick<SessionInfo, "id" | "location" | "metadata">) =>
    Orchestra.ownerOf(
      projects(),
      session.location.directory,
      projectList.owner(session.id) ?? Orchestra.sessionOwner(session.metadata),
    )

  const sessionProject = () => {
    const session = current()
    return session && projects().find((item) => item.main === session.id || owner(session)?.id === item.id)
  }

  // The project of the open session starts expanded so the tree shows where you are.
  createEffect(() => {
    const project = sessionProject()
    if (project && expanded[project.id] === undefined) void expand(project.id)
  })

  // Opening a session makes its project the one the Notes tab shows.
  createEffect(
    on(
      () => sessionProject()?.id,
      (projectID) => {
        if (projectID && projectID !== notes.project()) notes.setProject(projectID)
      },
    ),
  )

  const expand = async (projectID: string) => {
    setExpanded(projectID, true)
    await client.api.orchestra.project
      .sessions({ projectID })
      .then((result) => {
        result.data.forEach((session) => data.session.remember(session))
        setAccess(result.access)
        setCategory(result.category)
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  }

  const toggle = (projectID: string) => {
    notes.setProject(projectID)
    if (expanded[projectID]) return setExpanded(projectID, false)
    void expand(projectID)
  }

  const openMain = (project: OrchestraProject) =>
    client.api.orchestra.project
      .main({ projectID: project.id })
      .then((session) => {
        data.session.remember(session)
        projectList.mutate((list) => {
          const items = list ?? []
          if (items.some((item) => item.id === project.id))
            return items.map((item) => (item.id === project.id ? { ...item, main: session.id } : item))
          // The create response may beat the projects-list refetch. Keep the freshly created
          // project visible instead of silently dropping it from an initially empty resource.
          return [...items, { ...project, main: session.id }]
        })
        route.navigate({ type: "session", sessionID: session.id })
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))

  const openCreatedProject = async (project: OrchestraProject) => {
    setExpanded(project.id, true)
    // Refresh the roster in the background; opening the project's main session must not
    // depend on a second endpoint responding first.
    void expand(project.id)
    // Return the promise so DialogProject keeps its completion lifecycle in the right order:
    // finish opening the orchestrator, then close the dialog and refresh the project list.
    await openMain(project)
  }

  const edit = (project?: OrchestraProject) =>
    openProjectDialog(dialog, projectList.refetch, project, undefined, project ? undefined : openCreatedProject)

  const cycle = (sessionID: string) => {
    const now = access[sessionID] ?? Orchestra.defaultAccess
    const next = ACCESS_ORDER[(ACCESS_ORDER.indexOf(now) + 1) % ACCESS_ORDER.length]
    setAccess(sessionID, next)
    void client.api.orchestra.access({ sessionID, access: next }).catch((error: unknown) => {
      setAccess(sessionID, now)
      toast.show({ message: errorMessage(error), variant: "error" })
    })
  }

  const categorize = (sessionID: string) =>
    dialog.replace(() => (
      <DialogPrompt
        title={t("Session category")}
        placeholder={t("Planning, Build, Quality… (empty removes it)")}
        value={category[sessionID] ?? ""}
        onCancel={() => dialog.clear()}
        onConfirm={(value) => {
          dialog.clear()
          const previous = category[sessionID]
          setCategory(sessionID, value.trim() || undefined)
          void client.api.orchestra.category({ sessionID, category: value.trim() }).catch((error: unknown) => {
            setCategory(sessionID, previous)
            toast.show({ message: errorMessage(error), variant: "error" })
          })
        }}
      />
    ))

  const remove = (sessionID: string) => {
    if (armed() !== sessionID) return arm(sessionID)
    clearArmed()
    void client.api.session
      .remove({ sessionID })
      .then(() => {
        setRemoved(sessionID, true)
        data.session.evict(sessionID)
        if (route.data.type === "session" && route.data.sessionID === sessionID) route.navigate({ type: "home" })
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  }

  const roomKey = (room: JoinedRoom) => `room:${room.url}#${room.roomID}`
  const openRoom = (room: JoinedRoom, sessionID?: string) =>
    route.navigate({ type: "room", url: room.url, roomID: room.roomID, sessionID })
  const viewing = (room: JoinedRoom) => route.data.type === "room" && sameRoom(route.data, room)

  // Leaving tells the host and forgets the token here; the host keeps the room and its chat.
  const leave = (room: JoinedRoom) => {
    if (armed() !== roomKey(room)) return arm(roomKey(room))
    clearArmed()
    if (viewing(room)) route.navigate({ type: "home" })
    void tellHostLeft(room)
    void unlinkRoom(client.api, room)
    void updateJoined((draft) => {
      draft.joined = draft.joined.filter((item) => !sameRoom(item, room))
    })
  }

  // Closing a room stops sharing its session: the session stays, every guest token stops working.
  const stopHosting = (roomID: string) => {
    if (armed() !== `hosted:${roomID}`) return arm(`hosted:${roomID}`)
    clearArmed()
    void client.api.room
      .remove({ roomID })
      .then(() => roomListChanged())
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  }

  const openRooms = (window: typeof DialogHost | typeof DialogConnect) => {
    dialog.replace(() => window({ onClose: () => dialog.clear() }), undefined, { size: "large" })
    dialog.setCentered(true)
  }
  const openGroups = () => {
    dialog.replace(
      () => (
        <DialogGroups
          onClose={() => {
            dialog.clear()
            void refreshGroups()
          }}
        />
      ),
      undefined,
      { size: "large" },
    )
    dialog.setCentered(true)
  }
  const openMesh = () => {
    dialog.replace(() => <DialogMesh onClose={() => dialog.clear()} />, undefined, { size: "large" })
    dialog.setCentered(true)
  }

  const leaveMesh = () => {
    if (armed() !== "mesh:leave") return arm("mesh:leave")
    clearArmed()
    void client.api.room.mesh
      .leave()
      .then(() => refreshMesh())
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  }

  // The answer settles once: the dialog can be confirmed, cancelled or closed.
  const confirmClear = (options: {
    title: string
    message: string
    label: { confirm: string; cancel: string }
  }) =>
    new Promise<boolean | undefined>((resolve) => {
      let answered = false
      const done = (value: boolean | undefined) => {
        if (answered) return
        answered = true
        resolve(value)
      }
      dialog.replace(
        () => (
          <DialogConfirm
            title={options.title}
            message={options.message}
            label={options.label}
            onConfirm={() => done(true)}
            onCancel={() => done(false)}
          />
        ),
        () => done(undefined),
      )
    })

  const sessionsOf = (project: OrchestraProject) =>
    data.session
      .list()
      .filter(
        (session) =>
          !session.parentID && !removed[session.id] && session.id !== project.main && owner(session)?.id === project.id,
      )

  // Categories in first-seen order; sessions without one come last, under "Other"
  // only when the project uses categories at all.
  const groupsOf = (project: OrchestraProject) => {
    const sessions = sessionsOf(project)
    const names = [...new Set(sessions.flatMap((session) => category[session.id] ?? []))]
    const rest = sessions.filter((session) => !category[session.id])
    return [
      ...names.map((name) => ({ name, sessions: sessions.filter((session) => category[session.id] === name) })),
      ...(rest.length > 0 ? [{ name: names.length > 0 ? t("Other") : "", sessions: rest }] : []),
    ]
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
          border={["right"]}
          borderColor={theme.border.base}
          paddingTop={1}
        >
          <HoverAction id="project-tree.show" onClick={() => props.onShow?.()} paddingLeft={1} paddingRight={1}>
            <text fg={theme.text.action.primary.base}>›</text>
          </HoverAction>
        </box>
      }
    >
      <box width={props.width} height="100%" flexShrink={0} backgroundColor={theme.background.raised.base} paddingTop={1}>
        <box flexDirection="row" paddingLeft={1} paddingRight={1} paddingBottom={1}>
          <Tab tab="projects" label={t("Projects")} hover={hover} setHover={setHover} />
          <text fg={theme.text.muted}>│</text>
          <Tab tab="notes" label={t("Notes")} hover={hover} setHover={setHover} />
          <box flexGrow={1} />
          <Row
            id="new"
            hover={hover}
            setHover={setHover}
            onClick={() => (notes.tab() === "notes" ? notes.setCreating(true) : edit())}
          >
            <text fg={hover() === "new" ? theme.text.action.primary.hovered : theme.text.action.primary.base}>
              {t("+ New")}
            </text>
          </Row>
          <Show when={props.onHide}>
            <HoverAction id="project-tree.hide" onClick={() => props.onHide?.()} paddingLeft={1} paddingRight={1}>
              <text fg={theme.text.action.primary.base}>‹</text>
            </HoverAction>
          </Show>
        </box>
        <Show when={notes.tab() === "notes"}>
          <ProjectNotes />
        </Show>
        <scrollbox
          visible={notes.tab() === "projects"}
          flexGrow={notes.tab() === "projects" ? 1 : 0}
          minHeight={0}
          horizontalScrollbarOptions={{ visible: false }}
        >
          <Section
            title={t("Projects")}
            count={projects().length}
            actions={<SectionAction id="groups:new" label={t("+ Group")} onClick={openGroups} />}
          >
          <For each={sections()}>
            {(section) => (
              <>
                <Show when={section.name}>
                  <Row
                    id={`group:${section.name}`}
                    hover={hover}
                    setHover={setHover}
                    onClick={() => setGroupClosed(section.name!, !groupClosed[section.name!])}
                  >
                    <text flexShrink={0} fg={theme.text.muted}>
                      {groupClosed[section.name!] ? "▸ " : "▾ "}
                    </text>
                    <box flexGrow={1} minWidth={0}>
                      <text fg={theme.text.muted} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                        {section.name}
                        <span style={{ fg: theme.text.muted }}>{` · ${section.projects.length}`}</span>
                      </text>
                    </box>
                    <HoverAction
                      id={`group-edit:${section.name}`}
                      onMouseEnter={() => setHover(`group:${section.name}`)}
                      onMouseLeave={() => setHover(`group:${section.name}`)}
                      onClick={openGroups}
                    >
                      <text fg={theme.text.action.primary.base}>
                        {hover() === `group:${section.name}` ? " ⚙" : "  "}
                      </text>
                    </HoverAction>
                  </Row>
                </Show>
                <Show when={!section.name || !groupClosed[section.name]}>
                  <For each={section.projects}>
                    {(project) => (
                      <box paddingLeft={section.name ? 2 : 0}>
                <Row id={project.id} hover={hover} setHover={setHover} onClick={() => toggle(project.id)}>
                  <text flexShrink={0} fg={theme.text.muted}>
                    {expanded[project.id] ? "▾ " : "▸ "}
                  </text>
                  <box flexGrow={1} minWidth={0}>
                    <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                      {project.name}
                    </text>
                  </box>
                  <HoverAction
                    id={`project-edit:${project.id}`}
                    onMouseEnter={() => setHover(project.id)}
                    onMouseLeave={() => setHover(project.id)}
                    onClick={() => edit(project)}
                  >
                    {/* Only the hovered project shows its settings, so the names are not lined with gears. */}
                    <text fg={theme.text.action.primary.base}>{hover() === project.id ? " ⚙" : "  "}</text>
                  </HoverAction>
                </Row>
                <Show when={expanded[project.id]}>
                  <Row
                    id={`${project.id}:main`}
                    hover={hover}
                    setHover={setHover}
                    selected={project.main !== undefined && project.main === current()?.id}
                    onClick={() => void openMain(project)}
                  >
                    <text flexShrink={0} fg={theme.text.action.primary.base}>
                      {"  ★ "}
                    </text>
                    <text fg={theme.text.base} wrapMode="none" truncate>
                      {t("Orchestrator")}
                    </text>
                  </Row>
                  <For each={groupsOf(project)}>
                    {(group) => (
                      <>
                        <Show when={group.name}>
                          <box paddingLeft={4}>
                            <text fg={theme.text.muted} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                              {group.name}
                            </text>
                          </box>
                        </Show>
                        <For each={group.sessions}>
                          {(session) => (
                            <Row
                              id={session.id}
                              hover={hover}
                              setHover={setHover}
                              selected={session.id === current()?.id}
                              onClick={() => route.navigate({ type: "session", sessionID: session.id })}
                            >
                              <text
                                flexShrink={0}
                                fg={
                                  data.session.status(session.id) === "running"
                                    ? theme.text.feedback.success.base
                                    : theme.text.muted
                                }
                              >
                                {data.session.status(session.id) === "running" ? "  ● " : "  ○ "}
                              </text>
                              <box flexGrow={1} minWidth={0}>
                                <text fg={theme.text.base} wrapMode="none" truncate>
                                  {`${shared().has(session.id) ? "⇄ " : ""}${session.title || t("Untitled")}`}
                                </text>
                              </box>
                              <Show when={!narrow() || hover() === session.id}>
                                <HoverAction
                                  id={`session-mode:${session.id}`}
                                  onMouseEnter={() => setHover(session.id)}
                                  onMouseLeave={() => setHover(session.id)}
                                  onClick={() => DialogMode.show(dialog, session.id)}
                                >
                                  <text fg={theme.text.action.primary.base}>
                                    {` ${Mode.fromMetadata(session.metadata)?.id ?? "auto"} `}
                                  </text>
                                </HoverAction>
                                <HoverAction
                                  id={`session-category:${session.id}`}
                                  onMouseEnter={() => setHover(session.id)}
                                  onMouseLeave={() => setHover(session.id)}
                                  onClick={() => categorize(session.id)}
                                >
                                  <text fg={hover() === session.id ? theme.text.action.primary.base : theme.text.muted}>
                                    {" # "}
                                  </text>
                                </HoverAction>
                                <HoverAction
                                  id={`session-access:${session.id}`}
                                  onMouseEnter={() => setHover(session.id)}
                                  onMouseLeave={() => setHover(session.id)}
                                  onClick={() => cycle(session.id)}
                                >
                                  <text fg={theme.text.formfield.base}>{`[${access[session.id] ?? Orchestra.defaultAccess}]`}</text>
                                </HoverAction>
                              </Show>
                              <HoverAction
                                id={`session-delete:${session.id}`}
                                onMouseEnter={() => setHover(session.id)}
                                onMouseLeave={() => setHover(session.id)}
                                onClick={() => remove(session.id)}
                              >
                                <text fg={armed() === session.id ? theme.text.feedback.error.base : theme.text.muted}>
                                  {armed() === session.id ? ` ${t("delete?")}` : " ×"}
                                </text>
                              </HoverAction>
                            </Row>
                          )}
                        </For>
                      </>
                    )}
                  </For>
                  <Row
                    id={`${project.id}:new`}
                    hover={hover}
                    setHover={setHover}
                    onClick={() =>
                      route.navigate({ type: "home", location: { directory: project.directory }, project: project.id })
                    }
                  >
                    <text fg={theme.text.muted}>{"  " + t("+ New session")}</text>
                  </Row>
                </Show>
                      </box>
                    )}
                  </For>
                </Show>
              </>
            )}
          </For>
          </Section>
          <Section title={t("Multiplayer")} gap>
            <box flexDirection="row" flexWrap="wrap" gap={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
              <SectionButton label={t("+ Host")} onClick={() => openRooms(DialogHost)} />
              <SectionButton label={t("+ Connect")} onClick={() => openRooms(DialogConnect)} />
            </box>
            <Show when={meshStatus() && meshStatus()!.status !== "unconfigured"}>
              <Row
                id="mesh:connected"
                hover={hover}
                setHover={setHover}
                onClick={openMesh}
              >
                <text flexShrink={0} fg={theme.text.action.secondary.base}>
                  {"  ⇄ "}
                </text>
                <box flexGrow={1} minWidth={0}>
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                    {t("Mesh")} · {meshStatus()!.clusterID ?? t("connected")}
                  </text>
                  <text fg={theme.text.muted} wrapMode="none" truncate>
                    {meshStatus()!.status === "active"
                      ? meshStatus()!.leaderID
                        ? t("active · coordinator {id}", { id: meshStatus()!.leaderID ?? "" })
                        : t("active · electing coordinator")
                      : t("waiting for members")}
                  </text>
                </box>
                <HoverAction
                  id="mesh:leave"
                  onMouseEnter={() => setHover("mesh:connected")}
                  onMouseLeave={() => setHover("mesh:connected")}
                  onClick={leaveMesh}
                >
                  <text
                    fg={
                      armed() === "mesh:leave"
                        ? theme.text.action.destructive.focused
                        : theme.text.action.destructive.base
                    }
                  >
                    {armed() === "mesh:leave" ? " leave?" : " ×"}
                  </text>
                </HoverAction>
              </Row>
            </Show>
            <RoomPeople rooms={rooms.latest ?? []} hover={hover} setHover={setHover} />
            <For each={rooms.latest ?? []}>
              {(room) => (
                <>
                  <Row
                    id={`hosted:${room.id}`}
                    hover={hover}
                    setHover={setHover}
                    selected={room.sessionID === current()?.id}
                    onClick={() => route.navigate({ type: "session", sessionID: room.sessionID })}
                  >
                    <text flexShrink={0} fg={theme.text.action.secondary.base}>
                      {"  ⇄ "}
                    </text>
                    <box flexGrow={1} minWidth={0}>
                      <text fg={theme.text.base} wrapMode="none" truncate>
                        {room.name}
                      </text>
                    </box>
                    <HoverAction
                      id={`hosted-close:${room.id}`}
                      onMouseEnter={() => setHover(`hosted:${room.id}`)}
                      onMouseLeave={() => setHover(`hosted:${room.id}`)}
                      onClick={() => stopHosting(room.id)}
                    >
                      <text
                        fg={
                          armed() === `hosted:${room.id}`
                            ? theme.text.action.destructive.focused
                            : theme.text.action.destructive.base
                        }
                      >
                        {armed() === `hosted:${room.id}` ? ` ${t("close?")}` : " ×"}
                      </text>
                    </HoverAction>
                  </Row>
                  <RoomDodRows
                    id={`hosted:${room.id}`}
                    hover={hover}
                    setHover={setHover}
                    load={() => client.api.room.dod.get({ roomID: room.id })}
                    release={(id) => client.api.room.dod.release({ roomID: room.id, id })}
                    feed={(after, wait) => client.api.room.feed({ roomID: room.id, after, wait })}
                  />
                </>
              )}
            </For>
            <For each={joined.joined}>
              {(room) => (
                <>
                  <Row
                    id={roomKey(room)}
                    hover={hover}
                    setHover={setHover}
                    selected={viewing(room) && route.data.type === "room" && !route.data.sessionID}
                    onClick={() => openRoom(room)}
                  >
                    <text flexShrink={0} fg={theme.text.action.secondary.base}>
                      {"  ⇄ "}
                    </text>
                    <box flexGrow={1} minWidth={0}>
                      <text fg={theme.text.base} wrapMode="none" truncate>
                        {room.name}
                        <span style={{ fg: theme.text.muted }}>{` · ${new URL(room.url).host}`}</span>
                      </text>
                    </box>
                    <HoverAction
                      id={`room-leave:${roomKey(room)}`}
                      onMouseEnter={() => setHover(roomKey(room))}
                      onMouseLeave={() => setHover(roomKey(room))}
                      onClick={() => leave(room)}
                    >
                      <text
                        fg={
                          armed() === roomKey(room)
                            ? theme.text.action.destructive.focused
                            : theme.text.action.destructive.base
                        }
                      >
                        {armed() === roomKey(room) ? ` ${t("leave?")}` : " ×"}
                      </text>
                    </HoverAction>
                  </Row>
                  <RoomDodRows
                    id={roomKey(room)}
                    hover={hover}
                    setHover={setHover}
                    load={() => roomClient(room).room.guest.dod.get({ roomID: room.roomID })}
                    take={(id) =>
                      roomClient(room).room.guest.dod.claim(
                        id ? { roomID: room.roomID, id, take: true } : { roomID: room.roomID, next: true, take: true },
                      )
                    }
                    submit={(id) => roomClient(room).room.guest.dod.submit({ roomID: room.roomID, id })}
                    release={(id) => roomClient(room).room.guest.dod.claim({ roomID: room.roomID, id, take: false })}
                    feed={(after, wait) => roomClient(room).room.guest.feed({ roomID: room.roomID, after, wait })}
                  />
                  <RoomSessions
                    room={room}
                    hover={hover}
                    setHover={setHover}
                    current={route.data.type === "room" && sameRoom(route.data, room) ? route.data.sessionID : undefined}
                    onOpen={(sessionID) => openRoom(room, sessionID)}
                  />
                </>
              )}
            </For>
            <Show when={(rooms.latest ?? []).length === 0 && joined.joined.length === 0}>
              <box paddingLeft={1} paddingRight={1}>
                <text fg={theme.text.muted} attributes={TextAttributes.ITALIC} wrapMode="word">
                  {t("No rooms yet. Host a session or connect to someone else's.")}
                </text>
              </box>
            </Show>
          </Section>
        </scrollbox>
        <ClearSessionsAction
          api={client.api.session}
          confirm={confirmClear}
          notify={(options) => toast.show(options)}
          currentSessionID={route.data.type === "session" ? route.data.sessionID : undefined}
          leaveCurrentSession={() => route.navigate({ type: "home" })}
        />
      </box>
    </Show>
  )
}

// A collapsible section of the panel: a shaded heading strip with the section's name and
// its actions, so projects and multiplayer read as separate blocks rather than one list.
function Section(props: {
  title: string
  count?: number
  gap?: boolean
  actions?: JSX.Element
  children: JSX.Element
}) {
  const theme = useTheme()
  const [open, setOpen] = createSignal(true)
  const strip = createMemo(() =>
    tint(theme.background.raised.base, theme.background.raised.high, theme.background.raised.high.a),
  )
  return (
    <box flexShrink={0} paddingTop={props.gap ? 1 : 0}>
      <box
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        marginBottom={open() ? 1 : 0}
        backgroundColor={strip()}
        onMouseUp={() => setOpen(!open())}
      >
        <text flexShrink={0} fg={theme.text.muted}>
          {open() ? "▾ " : "▸ "}
        </text>
        <box flexGrow={1} minWidth={0}>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
            {props.title.toLocaleUpperCase()}
            <Show when={props.count}>
              <span style={{ fg: theme.text.muted }}>{`  ${props.count}`}</span>
            </Show>
          </text>
        </box>
        {props.actions}
      </box>
      <Show when={open()}>{props.children}</Show>
    </box>
  )
}

// A small text action on the right of a section heading.
function SectionAction(props: { id: string; label: string; onClick: () => void }) {
  const theme = useTheme()
  return (
    <HoverAction id={props.id} paddingLeft={1} paddingRight={1} onClick={props.onClick}>
      <text fg={theme.text.action.primary.base}>{props.label}</text>
    </HoverAction>
  )
}

// A filled button for the main actions inside a section.
function SectionButton(props: { label: string; onClick: () => void }) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={hovered() ? theme.background.action.primary.hovered : theme.background.action.primary.base}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={props.onClick}
    >
      <text fg={hovered() ? theme.text.action.primary.hovered : theme.text.action.primary.base}>{props.label}</text>
    </box>
  )
}

function Tab(props: {
  tab: NotesTab
  label: string
  hover: () => string | undefined
  setHover: (id: string | undefined) => void
}) {
  const theme = useTheme()
  const notes = useNotes()
  const id = `tab:${props.tab}`
  const active = () => notes.tab() === props.tab
  return (
    <HoverAction
      id={id}
      paddingLeft={1}
      paddingRight={1}
      onMouseEnter={() => props.setHover(id)}
      onMouseLeave={() => props.setHover(undefined)}
      onClick={() => notes.setTab(props.tab)}
    >
      <text
        fg={
          active()
            ? theme.text.action.primary.selected
            : props.hover() === id
              ? theme.text.action.secondary.hovered
              : theme.text.muted
        }
        attributes={active() ? TextAttributes.BOLD | TextAttributes.UNDERLINE : undefined}
      >
        {props.label}
      </text>
    </HoverAction>
  )
}

// The Notes tab: the notes of the project of the open session, or of the project
// last picked, or of the first one.
function ProjectNotes() {
  const notes = useNotes()
  const route = useRoute()
  const toast = useToast()
  const projects = useProjects().list
  const now = useNow()
  const project = createMemo(() => projects().find((item) => item.id === notes.project()) ?? projects()[0])
  const directory = () => project()?.directory
  const openName = () => (route.data.type === "session" ? notes.bound(route.data.sessionID)?.name : undefined)
  const fail = (error: unknown) => toast.show({ variant: "error", message: errorMessage(error) })

  return (
    <NotesPanel
      project={project()}
      projects={projects()}
      notes={directory() ? notes.list(directory()!) : []}
      loaded={directory() ? notes.loaded(directory()!) : true}
      error={directory() ? notes.error(directory()!) : undefined}
      openName={openName()}
      now={now()}
      creating={notes.creating()}
      onCreating={notes.setCreating}
      onPickProject={notes.setProject}
      onOpen={(note) => {
        const target = directory()
        if (target) void notes.open(target, note).catch(fail)
      }}
      onCreate={(title) => {
        const target = directory()
        if (target) void notes.start(target, title).catch(fail)
      }}
      onRemove={(note) => {
        const target = directory()
        if (!target) return
        void notes.remove(target, note).catch(fail)
      }}
    />
  )
}

// The sessions of a joined project room, under the room in the left panel, with a row to
// start another. A room sharing one session lists nothing here; the room row opens it.
function RoomSessions(props: {
  room: JoinedRoom
  hover: () => string | undefined
  setHover: (id: string | undefined) => void
  current?: string
  onOpen: (sessionID: string) => void
}) {
  const theme = useTheme()
  const toast = useToast()
  const t = useT()
  const remote = roomClient(props.room)
  const roomID = props.room.roomID
  const [sessions, setSessions] = createSignal<readonly SessionInfo[]>([])
  const [category, setCategory] = createSignal<Readonly<Record<string, string>>>({})
  const [project, setProject] = createSignal(false)
  // A gone host or a removed guest just lists nothing; the room view says why.
  const load = () =>
    void Promise.all([remote.room.guest.get({ roomID }), remote.room.guest.session.list({ roomID })])
      .then(([joined, list]) => {
        setProject(joined.room.directory !== undefined)
        setSessions(list.data)
        setCategory(list.category ?? {})
      })
      .catch(() => setSessions([]))
  // Grouped as the host's tree groups them: categories in first-seen order, then "Other".
  const groups = createMemo(() => {
    const names = [...new Set(sessions().flatMap((session) => category()[session.id] ?? []))]
    const rest = sessions().filter((session) => !category()[session.id])
    return [
      ...names.map((name) => ({ name, sessions: sessions().filter((session) => category()[session.id] === name) })),
      ...(rest.length > 0 ? [{ name: names.length > 0 ? t("Other") : "", sessions: rest }] : []),
    ]
  })
  onMount(() => {
    load()
    const timer = setInterval(load, 5000)
    onCleanup(() => clearInterval(timer))
  })
  const start = () =>
    void remote.room.guest.session
      .create({ roomID })
      .then((created) => {
        setSessions((list) => [created, ...list])
        props.onOpen(created.id)
      })
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  const key = (id: string) => `room:${props.room.url}#${roomID}:${id}`
  return (
    <Show when={project()}>
      <For each={groups()}>
        {(group) => (
          <>
            <Show when={group.name}>
              <box paddingLeft={6}>
                <text fg={theme.text.muted} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                  {group.name}
                </text>
              </box>
            </Show>
            <For each={group.sessions}>
              {(session) => (
                <Row
                  id={key(session.id)}
                  hover={props.hover}
                  setHover={props.setHover}
                  selected={props.current === session.id}
                  onClick={() => props.onOpen(session.id)}
                >
                  <text flexShrink={0} fg={theme.text.muted}>
                    {"      ○ "}
                  </text>
                  <box flexGrow={1} minWidth={0}>
                    <text fg={theme.text.base} wrapMode="none" truncate>
                      {session.title || t("Untitled")}
                    </text>
                  </box>
                </Row>
              )}
            </For>
          </>
        )}
      </For>
      <Row id={key("new")} hover={props.hover} setHover={props.setHover} onClick={start}>
        <text fg={theme.text.muted}>{"      " + t("+ New session")}</text>
      </Row>
    </Show>
  )
}

// Who is in the rooms this computer hosts, right under the Multiplayer heading: whether
// each guest is connected, the role a click steps through, and removing or banning
// after a second click. Banned guests follow, each with a way back in.
function RoomPeople(props: {
  rooms: readonly RoomInfo[]
  hover: () => string | undefined
  setHover: (id: string | undefined) => void
}) {
  const client = useClient()
  const theme = useTheme()
  const toast = useToast()
  const t = useT()
  const [open, setOpen] = createSignal(true)
  const [members, setMembers] = createSignal<Record<string, readonly RoomMemberView[]>>({})
  const [bans, setBans] = createSignal<Record<string, readonly RoomBan[]>>({})
  const [armed, setArmed] = createSignal<string>()
  // Guests report in every couple of seconds; reading as often keeps "online" honest.
  const read = () =>
    Promise.all(
      props.rooms.map((room) =>
        Promise.all([
          client.api.room.member.list({ roomID: room.id }).catch(() => []),
          client.api.room.ban.list({ roomID: room.id }).catch(() => []),
        ]).then(([listed, banned]) => ({ id: room.id, listed, banned })),
      ),
    ).then((list) => {
      setMembers(Object.fromEntries(list.map((item) => [item.id, item.listed])))
      setBans(Object.fromEntries(list.map((item) => [item.id, item.banned])))
    })
  createEffect(
    on(
      () => props.rooms,
      () => void read(),
    ),
  )
  onMount(() => {
    const timer = setInterval(() => void read(), 3000)
    onCleanup(() => clearInterval(timer))
  })

  const people = () => props.rooms.flatMap((room) => (members()[room.id] ?? []).map((member) => ({ room, member })))
  const banned = () => props.rooms.flatMap((room) => (bans()[room.id] ?? []).map((ban) => ({ room, ban })))
  const named = (name: string, room: RoomInfo) => (props.rooms.length > 1 ? `${name} · ${room.name}` : name)

  const act = (action: () => Promise<unknown>) =>
    void action()
      .then(read)
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  const confirm = (key: string, action: () => Promise<unknown>) => {
    if (armed() !== key) return setArmed(key)
    setArmed()
    act(action)
  }
  const cycle = (room: RoomInfo, member: RoomMemberView) => {
    const role = nextMemberRole(member.role)
    setMembers((all) => ({
      ...all,
      [room.id]: (all[room.id] ?? []).map((item) => (item.id === member.id ? { ...item, role } : item)),
    }))
    act(() => client.api.room.member.update({ roomID: room.id, guestID: member.id, role }))
  }
  const destructive = (key: string) =>
    armed() === key ? theme.text.action.destructive.focused : theme.text.action.destructive.base

  return (
    <Show when={props.rooms.length > 0}>
      <Row id="people" hover={props.hover} setHover={props.setHover} onClick={() => setOpen(!open())}>
        <text fg={theme.text.muted}>{open() ? "  ▾ " : "  ▸ "}</text>
        <box flexGrow={1} minWidth={0}>
          <text fg={theme.text.base} wrapMode="none" truncate>
            {t("Participants")}
          </text>
        </box>
        <text fg={theme.text.muted}>
          {t("{online}/{total} online", {
            online: people().filter((item) => item.member.online).length,
            total: people().length,
          })}
        </text>
      </Row>
      <Show when={open()}>
        <Show
          when={people().length > 0}
          fallback={
            <box paddingLeft={6} paddingRight={1}>
              <text fg={theme.text.muted}>{t("No guests have joined yet.")}</text>
            </box>
          }
        >
          <For each={people()}>
            {(item) => (
              <box flexDirection="row" paddingLeft={5} paddingRight={1}>
                <text fg={item.member.online ? theme.text.feedback.success.base : theme.text.muted}>
                  {item.member.online ? "● " : "○ "}
                </text>
                <box flexGrow={1} minWidth={0}>
                  <text fg={theme.text.base} wrapMode="none" truncate>
                    {named(item.member.name, item.room)}
                  </text>
                </box>
                <HoverAction
                  id={`member-role:${item.member.id}`}
                  onClick={() => cycle(item.room, item.member)}
                >
                  <text fg={theme.text.formfield.base}>{` [${t(ROLE_LABEL[item.member.role])}]`}</text>
                </HoverAction>
                <HoverAction
                  id={`member-kick:${item.member.id}`}
                  minWidth={6}
                  justifyContent="flex-end"
                  onMouseLeave={() => setArmed()}
                  onClick={() =>
                    confirm(`kick:${item.member.id}`, () =>
                      client.api.room.member.remove({ roomID: item.room.id, guestID: item.member.id }),
                    )
                  }
                >
                  <text fg={destructive(`kick:${item.member.id}`)}>
                    {armed() === `kick:${item.member.id}` ? ` ${t("Kick?")}` : " ×"}
                  </text>
                </HoverAction>
                <HoverAction
                  id={`member-ban:${item.member.id}`}
                  minWidth={5}
                  justifyContent="flex-end"
                  onMouseLeave={() => setArmed()}
                  onClick={() =>
                    confirm(`ban:${item.member.id}`, () =>
                      client.api.room.member.ban({ roomID: item.room.id, guestID: item.member.id }),
                    )
                  }
                >
                  <text fg={destructive(`ban:${item.member.id}`)}>
                    {armed() === `ban:${item.member.id}` ? ` ${t("Ban?")}` : ` ${t("ban")}`}
                  </text>
                </HoverAction>
              </box>
            )}
          </For>
        </Show>
        <For each={banned()}>
          {(item) => (
            <box flexDirection="row" paddingLeft={5} paddingRight={1}>
              <text fg={theme.text.action.destructive.base}>{"⊘ "}</text>
              <box flexGrow={1} minWidth={0}>
                <text fg={theme.text.muted} wrapMode="none" truncate>
                  {named(item.ban.name, item.room)}
                </text>
              </box>
              <HoverAction
                id={`member-unban:${item.ban.id}`}
                onClick={() => act(() => client.api.room.ban.remove({ roomID: item.room.id, banID: item.ban.id }))}
              >
                <text fg={theme.text.action.primary.base}>{` ${t("unban")}`}</text>
              </HoverAction>
            </box>
          )}
        </For>
      </Show>
    </Show>
  )
}
