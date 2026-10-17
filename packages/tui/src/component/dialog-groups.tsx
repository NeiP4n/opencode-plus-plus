import { TextAttributes, type InputRenderable } from "@opentui/core"
import { createResource, createSignal, For, Show } from "solid-js"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useProjects } from "../context/projects"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { Button } from "./devtools-registry"
import { Header } from "./dialog-rooms"

// Groups keep related projects together, such as the web, API and mobile projects of one product.
// Linking a group ties every pair in it: each project then knows the others and may ask them
// questions, while requests and anything beyond that still wait for a person on the receiving side.
export function DialogGroups(props: { onClose?: () => void }) {
  const client = useClient()
  const config = useConfig().data
  const projects = useProjects()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const t = useT()
  let nameField: InputRenderable | undefined
  const [groups, { refetch }] = createResource(() => client.api.orchestra.group.list())
  const [picked, setPicked] = createSignal<readonly string[]>([])
  const [armed, setArmed] = createSignal<string>()
  const listed = () => (groups.error ? undefined : groups.latest) ?? []
  const nameOf = (id: string) => projects.list().find((project) => project.id === id)?.name ?? id

  const act = (action: () => Promise<unknown>) =>
    void action()
      .then(() => refetch())
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))

  const toggle = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  const save = () => {
    const name = nameField?.value.trim()
    if (!name) return toast.show({ message: t("Enter a group name."), variant: "error" })
    if (picked().length === 0) return toast.show({ message: t("Pick at least one project."), variant: "error" })
    act(async () => {
      await client.api.orchestra.group.save({ name, projects: picked() as never })
      if (nameField) nameField.value = ""
      setPicked([])
    })
  }

  const edit = (name: string, members: readonly string[]) => {
    if (nameField) nameField.value = name
    setPicked(members)
  }

  const link = (name: string) =>
    act(async () => {
      const { pairs } = await client.api.orchestra.group.link({ name })
      toast.show({
        message: pairs === 0 ? t("Nothing to link: a group needs two projects.") : t("Linked {count} pair(s).", { count: pairs }),
        variant: "success",
      })
    })

  const remove = (name: string) => {
    if (armed() !== name) return setArmed(name)
    setArmed()
    act(() => client.api.orchestra.group.remove({ name }))
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <Header title={t("Project groups")} onClose={props.onClose} />
      <text fg={theme.text.muted} wrapMode="word">
        {t("Linked projects know each other and may ask each other questions. Requests still wait for a person.")}
      </text>
      <Show when={groups.error}>
        {(error) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {errorMessage(error())}
          </text>
        )}
      </Show>
      <Show when={listed().length > 0} fallback={<text fg={theme.text.muted}>{t("No groups yet.")}</text>}>
        <For each={listed()}>
          {(group) => (
            <box flexDirection="row" gap={1}>
              <box flexGrow={1} minWidth={0}>
                <text fg={theme.text.base} wrapMode="none" truncate>
                  <span style={{ bold: true }}>{group.name}</span>
                  <span style={{ fg: theme.text.muted }}>{` · ${group.projects.map(nameOf).join(", ")}`}</span>
                </text>
              </box>
              <Button onClick={() => edit(group.name, group.projects)}>{t("Edit")}</Button>
              <Button onClick={() => link(group.name)}>{t("Link all")}</Button>
              <Button onLeave={() => setArmed()} onClick={() => remove(group.name)}>
                {armed() === group.name ? t("Delete?") : t("Delete")}
              </Button>
            </box>
          )}
        </For>
      </Show>
      <text fg={theme.text.base} attributes={TextAttributes.UNDERLINE}>
        {t("New or edited group")}
      </text>
      <box flexDirection="row" gap={1}>
        <input
          width={24}
          cursorStyle={config.cursor}
          ref={(element: InputRenderable) => {
            nameField = element
          }}
          onMouseDown={() => nameField?.focus()}
          placeholder={t("Group name")}
          placeholderColor={theme.text.muted}
          textColor={theme.text.formfield.base}
          focusedTextColor={theme.text.formfield.focused}
          cursorColor={theme.text.formfield.focused}
          backgroundColor={theme.background.formfield.base}
          focusedBackgroundColor={theme.background.formfield.focused}
          onSubmit={save}
        />
        <Button variant="primary" onClick={save}>
          {t("Save group")}
        </Button>
      </box>
      <Show when={projects.list().length > 0} fallback={<text fg={theme.text.muted}>{t("Create projects first.")}</text>}>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          <For each={projects.list()}>
            {(project) => (
              <Button variant={picked().includes(project.id) ? "primary" : undefined} onClick={() => toggle(project.id)}>
                {`${picked().includes(project.id) ? "✓" : "○"} ${project.name}`}
              </Button>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
