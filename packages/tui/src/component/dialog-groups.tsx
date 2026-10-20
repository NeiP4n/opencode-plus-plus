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

  const act = (action: () => Promise<unknown>) =>
    void action().then(() => refetch()).catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))

  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  type GroupToStart = { name: string; supervisor?: string; mode?: "lead" | "council" }

  const createSupervisor = async (group: GroupToStart) => {
    const mode = group.mode ?? "lead"
    // A group that already has a chat opens it. The server keeps one chat per group,
    // so there is nothing left to dedupe on the client.
    if (group.supervisor) {
      route.navigate({ type: "session", sessionID: group.supervisor })
      props.onClose?.()
      return
    }
    setOpening(group.name)
    try {
      // The server owns the group chat: it creates the chat inside the group's own
      // directory, registers the supervisor on the group and sends the bootstrap.
      const chat = await client.api.orchestra.group.chat({ name: group.name, mode })
      // A failed refresh must not hide the chat that was just created.
      await Promise.resolve(refetch?.()).catch(() => {})
      route.navigate({ type: "session", sessionID: chat.sessionID })
      props.onClose?.()
    } catch (error) {
      toast.show({ message: errorMessage(error), variant: "error" })
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
        // A chat that cannot be removed keeps its old mode, so the failure is reported
        // instead of leaving the group in a state the operator did not ask for.
        if (group.supervisor) await client.api.session.remove({ sessionID: group.supervisor })
        await client.api.orchestra.group.save({ name: group.name, projects: group.projects as never, mode, supervisor: undefined })
      } catch (error) {
        toast.show({ message: errorMessage(error), variant: "error" })
      } finally {
        await Promise.resolve(refetch?.()).catch(() => {})
        clearModeOverride(group.name)
      }
    })()
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
                <Button variant="primary" disabled={opening() === group.name} onClick={() => void createSupervisor({ name: group.name, supervisor: group.supervisor, mode: modeOf(group) })}>
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