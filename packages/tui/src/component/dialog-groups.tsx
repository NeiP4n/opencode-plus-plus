import { TextAttributes, type InputRenderable } from "@opentui/core"
import { createResource, createSignal, For, Show } from "solid-js"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useProjects } from "../context/projects"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { useGroupT } from "../util/i18n-groups"
import { Button } from "./devtools-registry"
import { Header } from "./dialog-rooms"

export function DialogGroups(props: { onClose?: () => void }) {
  const client = useClient()
  const config = useConfig().data
  const projects = useProjects()
  const route = useRoute()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const t = useGroupT()
  let nameField: InputRenderable | undefined
  const [groups, { refetch }] = createResource(() => client.api.orchestra.group.list())
  const [picked, setPicked] = createSignal<readonly string[]>([])
  const [armed, setArmed] = createSignal<string>()
  const [opening, setOpening] = createSignal<string>()
  const [draftMode, setDraftMode] = createSignal<"lead" | "council">("lead")
  const [modeOverride, setModeOverride] = createSignal<Record<string, "lead" | "council">>({})
  const modeOf = (group: { name: string; mode?: "lead" | "council" }) =>
    modeOverride()[group.name] ?? group.mode ?? "lead"
  const clearModeOverride = (name: string) =>
    setModeOverride((current) => {
      const next = { ...current }
      delete next[name]
      return next
    })
  const listed = () => (groups.error ? undefined : groups.latest) ?? []
  const nameOf = (id: string) => projects.list().find((project) => project.id === id)?.name ?? id
  const supervisorOf = (group: { name: string; projects: readonly string[]; supervisor?: string }) => group.supervisor

  const act = (action: () => Promise<unknown>) =>
    void action().then(() => refetch()).catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))

  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  const supervisorSessionID = (name: string, mode: "lead" | "council") => {
    let hash = 2166136261
    for (const char of `${mode}:${name}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    return `ses_group_${(hash >>> 0).toString(36)}`
  }

  type GroupToStart = { name: string; projects: readonly string[]; supervisor?: string; mode?: "lead" | "council" }

  const createSupervisor = async (group: GroupToStart, openAfterCreate = true) => {
    const mode = group.mode ?? "lead"
    const existing = supervisorOf(group)
    if (existing) {
      if (openAfterCreate) {
        route.navigate({ type: "session", sessionID: existing })
        props.onClose?.()
      }
      return
    }
    const leaderID = group.projects[0]
    const leader = projects.list().find((project) => project.id === leaderID)
    if (!leaderID || !leader) {
      toast.show({ message: t("The group's coordinator project is not available on this device."), variant: "error" })
      return
    }
    setOpening(group.name)
    try {
      const response = await client.api.session.list({ directory: leader.directory, parentID: null, limit: 500, order: "asc" })
      const matches = response.data
        .filter((session) => {
          const marker = session.metadata?.["opencode-pp:group-supervisor"]
          if (!marker || typeof marker !== "object" || Array.isArray(marker)) return false
          const value = marker as Record<string, unknown>
          return value.groupName === group.name && value.leader === leaderID && (value.mode === "council" ? "council" : "lead") === mode
        })
        .sort((a, b) => new Date(a.time.created).getTime() - new Date(b.time.created).getTime())

      const sessionID = matches[0]?.id ?? supervisorSessionID(group.name, mode)
      const created = matches[0] ?? await client.api.session.create({
        id: sessionID,
        title: mode === "council" ? "Общество" : "Президент",
        // A Council chat is a shared Orchestrator session; a President chat sits one
        // level above the member Orchestrators and runs its own agent.
        agent: mode === "council" ? "orchestrator" : "president",
        location: { directory: leader.directory },
        metadata: { "opencode-pp:group-supervisor": { groupName: group.name, leader: leaderID, mode } },
        permissions: [
          { action: "edit", resource: "*", effect: "deny" },
          { action: "shell", resource: "*", effect: "deny" },
          { action: "sessions", resource: "*", effect: "deny" },
          { action: "dod", resource: "*", effect: "deny" },
          { action: "federation", resource: "*", effect: "ask" },
        ],
      })

      await client.api.orchestra.group.save({ name: group.name, projects: group.projects, supervisor: created.id, mode })
      for (const duplicate of matches.slice(1)) {
        if (duplicate.id === created.id) continue
        await client.api.session.remove({ sessionID: duplicate.id }).catch(() => {})
      }

      const bootstrap = [
        "This message initializes the group-bound chat; it is not an operator task.",
        mode === "council"
          ? `You are Society, the Orchestrator Council chat for group "${group.name}". Members: ${group.projects.join(", ")}.`
          : `You are President, the group-bound chat for "${group.name}". The coordinator project is "${leader.name}" (${leaderID}); members: ${group.projects.join(", ")}.`,
        mode === "council"
          ? "When the operator later asks a question or gives a task that needs the member projects' perspectives, call federation action=consult_all with a short subject and the full task. Wait for all proposals to arrive in this chat, then compare them and provide one synthesis."
          : "Use federation action=group_status only when the operator asks for the group's status or a coordination recommendation. Summarize the sanitized status here; do not send tickets, messages, or work to any project.",
        "Do not contact or send anything to member projects in response to this initialization message or on your own. Never call federation action=send from this group-bound chat. The Council may use consult_all only after an explicit task or question from the operator.",
        "Do not edit files, run shell commands, change project settings, or approve work on behalf of a member project. Each project keeps its own rules and approvals.",
        "Acknowledge the setup briefly and wait for the operator's next message. Do not call tools for this initialization.",
      ].join("\n")
      await client.api.session.prompt({
        sessionID: created.id,
        text: bootstrap,
        // Setup is context, not a task: store it without waking the model.
        resume: false,
        metadata: { "opencode-pp:group-supervisor-bootstrap": true },
      })
      if (openAfterCreate) {
        route.navigate({ type: "session", sessionID: created.id })
        props.onClose?.()
      }
    } catch (error) {
      if (openAfterCreate) toast.show({ message: errorMessage(error), variant: "error" })
      else throw error
    } finally {
      setOpening(undefined)
    }
  }

  const save = () => {
    const name = nameField?.value.trim()
    if (!name) return toast.show({ message: t("Enter a group name."), variant: "error" })
    if (picked().length === 0) return toast.show({ message: t("Pick at least one project."), variant: "error" })
    const members = [...picked()]
    const mode = draftMode()
    act(async () => {
      await client.api.orchestra.group.save({ name, projects: members as never, mode, supervisor: undefined })
      if (nameField) nameField.value = ""
      setPicked([])
      setDraftMode("lead")
    })
  }

  const edit = (name: string, members: readonly string[], mode: "lead" | "council" = "lead") => {
    if (nameField) nameField.value = name
    setPicked(members)
    setDraftMode(mode)
  }

  const changeMode = (group: { name: string; projects: readonly string[]; supervisor?: string; mode?: "lead" | "council" }, mode: "lead" | "council") => {
    if (modeOf(group) === mode) return
    setModeOverride((current) => ({ ...current, [group.name]: mode }))
    void (async () => {
      try {
        // Changing a mode only changes the group's configuration. It must never
        // create/open a session or send anything to member projects implicitly.
        if (group.supervisor) await client.api.session.remove({ sessionID: group.supervisor }).catch(() => {})
        await client.api.orchestra.group.save({ name: group.name, projects: group.projects as never, mode, supervisor: undefined })
      } catch (error) {
        toast.show({ message: errorMessage(error), variant: "error" })
      } finally {
        await Promise.resolve(refetch?.()).catch(() => {})
        clearModeOverride(group.name)
      }
    })()
  }

  const openSupervisor = (group: GroupToStart) => {
    void createSupervisor(group, true).catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))
  }

  const link = (name: string) => act(async () => {
    const { pairs } = await client.api.orchestra.group.link({ name })
    toast.show({ message: pairs === 0 ? t("Nothing to link: a group needs two projects.") : t("Linked {count} pair(s).", { count: pairs }), variant: "success" })
  })

  const remove = (name: string) => {
    if (armed() !== name) return setArmed(name)
    setArmed()
    act(() => client.api.orchestra.group.remove({ name }))
  }

  const projectNames = (group: { projects: readonly string[] }) => group.projects.map(nameOf)

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <Header title={t("Project groups")} onClose={props.onClose} />
      <Show when={groups.error}>
        {(error) => <text fg={theme.text.feedback.error.base} wrapMode="word">{errorMessage(error())}</text>}
      </Show>
      <Show when={listed().length > 0} fallback={<text fg={theme.text.muted}>{t("No groups yet.")}</text>}>
        <For each={listed()}>
          {(group) => (
            <box flexDirection="column" gap={1} paddingTop={1} paddingBottom={1}>
              <box flexDirection="row" gap={1}>
                <box flexGrow={1} minWidth={0}>
                  <text fg={theme.text.base} wrapMode="none" truncate>
                    <span style={{ bold: true }}>{group.name}</span>
                    <span style={{ fg: theme.text.muted }}>{` · ${group.projects.length} ${group.projects.length === 1 ? "project" : "projects"}`}</span>
                  </text>
                </box>
                <Button onClick={() => edit(group.name, group.projects, group.mode ?? "lead")}>{t("Edit")}</Button>
                <Button onClick={() => link(group.name)}>{t("Link all")}</Button>
                <Button onLeave={() => setArmed()} onClick={() => remove(group.name)}>{armed() === group.name ? t("Delete?") : t("Delete")}</Button>
              </box>

              <box flexDirection="row" gap={1}>
                <text fg={theme.text.muted}>{t("Mode") + ":"}</text>
                <Button
                  variant={modeOf(group) === "lead" ? "primary" : "secondary"}
                  onClick={() => changeMode(group, "lead")}
                >
                  {t("Single coordinator")}
                </Button>
                <Button
                  variant={modeOf(group) === "council" ? "primary" : "secondary"}
                  onClick={() => changeMode(group, "council")}
                >
                  {t("Orchestrator council")}
                </Button>
              </box>

              <box flexDirection="row" gap={1}>
                <text fg={theme.text.muted}>{t("Group chat") + ":"}</text>
                <Button variant="primary" disabled={opening() === group.name} onClick={() => openSupervisor({ name: group.name, projects: group.projects, supervisor: group.supervisor, mode: modeOf(group) })}>
                  {opening() === group.name
                    ? t("Creating...")
                    : group.supervisor
                      ? (modeOf(group) === "council" ? "★ Общество · Открыть" : "★ Президент · Открыть")
                      : (modeOf(group) === "council" ? "+ Создать Общество" : "+ Создать Президента")}
                </Button>
                <Show when={modeOf(group) === "council"}>
                  <text fg={theme.text.muted}>{`${group.projects.length} ${group.projects.length === 1 ? "оркестратор" : "оркестратора"} · ${projectNames(group).join(", ")}`}</text>
                </Show>
              </box>
              <text fg={theme.text.muted} wrapMode="word">
                {modeOf(group) === "council"
                  ? t("Choose Orchestrator council to set the group mode. Then press Create Society: it creates one chat bound to this group. That chat is the only place where the council works; changing the mode does not start or move any project session.")
                  : t("President is a chat bound to this group. Press Create President to create one group chat. It will not dispatch tasks to project sessions on its own.")}
              </text>
            </box>
          )}
        </For>
      </Show>

      <text fg={theme.text.base} attributes={TextAttributes.UNDERLINE}>{t("New or edited group")}</text>
      <box flexDirection="row" gap={1}>
        <input width={24} cursorStyle={config.cursor} ref={(element: InputRenderable) => { nameField = element }} onMouseDown={() => nameField?.focus()} placeholder={t("Group name")} placeholderColor={theme.text.muted} textColor={theme.text.formfield.base} focusedTextColor={theme.text.formfield.focused} cursorColor={theme.text.formfield.focused} backgroundColor={theme.background.formfield.base} onSubmit={save} />
        <Button variant="primary" onClick={save}>{t("Save group")}</Button>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={theme.text.muted}>{t("New group mode") + ":"}</text>
        <Button variant={draftMode() === "lead" ? "primary" : undefined} onClick={() => setDraftMode("lead")}>
          {t("Single coordinator")}
        </Button>
        <Button variant={draftMode() === "council" ? "primary" : undefined} onClick={() => setDraftMode("council")}>
          {t("Orchestrator council")}
        </Button>
      </box>
      <Show when={projects.list().length > 0} fallback={<text fg={theme.text.muted}>{t("Create projects first.")}</text>}>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          <For each={projects.list()}>
            {(project) => <Button variant={picked().includes(project.id) ? "primary" : undefined} onClick={() => toggle(project.id)}>{`${picked().includes(project.id) ? "✓" : "○"} ${project.name}`}</Button>}
          </For>
        </box>
      </Show>
    </box>
  )
}