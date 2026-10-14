import { TextAttributes, type InputRenderable } from "@opentui/core"
import { createSignal, For, onMount, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { OrchestraProject, OrchestraTemplate } from "@opencode/client/promise"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import type { DialogContext } from "../ui/dialog"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { isRecord } from "../util/record"
import { Button } from "./devtools-registry"
import { builtinName, openTeamEditor } from "./dialog-teams"

// Create a project, or rename it, move it to another directory or forget it.
// Projects are the operator's own: a name and a directory, nothing discovered.
// A new project always starts with an Orchestrator; a selected template also opens
// its role sessions. Teams themselves
// are edited in the team editor, which comes back here with the typed fields.
type Draft = { name: string; directory: string }

export function DialogProject(props: {
  project?: OrchestraProject
  draft?: Draft
  onDone: () => void
  onClose: () => void
  onCreated?: (project: OrchestraProject) => void | Promise<void>
  onEditTeams?: (draft: Draft) => void
}) {
  const client = useClient()
  const location = useLocation()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const t = useT()
  const dimensions = useTerminalDimensions()
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [armed, setArmed] = createSignal(false)
  const fields: { name?: InputRenderable; directory?: InputRenderable } = {}
  // Loaded when the dialog opens, which may be while the client is still connecting:
  // a failure is shown with a retry instead of an empty list that silently means "No team".
  const [templates, setTemplates] = createSignal<readonly OrchestraTemplate[]>()
  const [templatesFailed, setTemplatesFailed] = createSignal(false)
  const loadTemplates = () => {
    setTemplatesFailed(false)
    client.api.orchestra.template.list().then(setTemplates, () => setTemplatesFailed(true))
  }
  // 0 is "No team"; n picks templates()[n - 1].
  const [team, setTeam] = createSignal(0)
  const [teamFocused, setTeamFocused] = createSignal(false)
  const focusTeam = () => {
    if (templatesFailed()) loadTemplates()
    fields.name?.blur()
    fields.directory?.blur()
    setTeamFocused(true)
  }
  const focusField = (field: InputRenderable | undefined) => {
    setTeamFocused(false)
    field?.focus()
  }
  const teamOptions = () => [
    { name: t("No team"), detail: t("only the Orchestrator") },
    ...(templates() ?? []).map((template) => ({
      name: builtinName(t, template) ?? template.id,
      detail:
        template.description ||
        template.members.map((member) => (template.origin === "builtin" ? t(member.title) : member.title)).join(", "),
    })),
  ]
  const teamCount = () => teamOptions().length
  // Keep the picker compact on short terminals and show the selected option in the visible window.
  const visibleTeamCount = () => Math.max(1, Math.min(5, Math.floor((dimensions().height - 16) / 3)))
  const visibleTeamStart = () =>
    Math.max(0, Math.min(team() - Math.floor(visibleTeamCount() / 2), teamCount() - visibleTeamCount()))
  const visibleTeamEnd = () => Math.min(teamCount(), visibleTeamStart() + visibleTeamCount())
  const visibleTeamOptions = () => teamOptions().slice(visibleTeamStart(), visibleTeamEnd())
  const moveTeam = (direction: 1 | -1) => {
    const count = teamCount()
    setTeam((team() + direction + count) % count)
  }

  onMount(() => {
    if (!props.project) loadTemplates()
    setTimeout(() => {
      if (fields.name && !fields.name.isDestroyed) fields.name.focus()
    }, 1)
  })

  const run = async <Result,>(
    action: () => Promise<Result>,
    onSuccess?: (result: Result) => void | Promise<void>,
  ) => {
    setBusy(true)
    setError()
    await action()
      .then(async (result) => {
        // Finish the main-session handoff before closing the dialog. The callback may return
        // a promise, but it must not wait for the project roster or project-list refresh.
        await onSuccess?.(result)
        props.onDone()
      })
      .catch((cause: unknown) =>
        // The server names the field it rejected; its own text is English.
        setError(
          isRecord(cause) && cause.field === "directory"
            ? t("Not an existing directory: {directory}", { directory: fields.directory?.value.trim() ?? "" })
            : errorMessage(cause),
        ),
      )
    setBusy(false)
  }

  const save = () => {
    if (busy()) return
    const name = fields.name?.value.trim() ?? ""
    const directory = fields.directory?.value.trim() ?? ""
    if (!directory) return setError(t("Enter the project's path"))
    const project = props.project
    if (project) {
      void run(() => client.api.orchestra.project.update({ projectID: project.id, name, directory }))
      return
    }
    // The project owns the orchestrator from the moment creation succeeds. Open that
    // main session immediately so the user lands in the project's control surface.
    void run(
      () => client.api.orchestra.project.create({ name, directory, template: templates()?.[team() - 1]?.id }),
      (created) => props.onCreated?.(created),
    )
  }

  const remove = () => {
    const project = props.project
    if (!project || busy()) return
    if (!armed()) return setArmed(true)
    void run(() => client.api.orchestra.project.remove({ projectID: project.id }))
  }

  const editTeams = () =>
    props.onEditTeams?.({ name: fields.name?.value ?? "", directory: fields.directory?.value ?? "" })

  // Tab moves between the fields (and the team list of a new project); enter saves.
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "tab",
        title: "Next field",
        group: "Project",
        run: () => {
          if (fields.name?.focused) return focusField(fields.directory)
          if (fields.directory?.focused && !props.project) return focusTeam()
          focusField(fields.name)
        },
      },
      { bind: "up", title: "Previous team", group: "Project", enabled: teamFocused, run: () => moveTeam(-1) },
      { bind: "down", title: "Next team", group: "Project", enabled: teamFocused, run: () => moveTeam(1) },
      { bind: "return", title: "Create", group: "Project", enabled: teamFocused, run: save },
      {
        bind: "ctrl+e",
        title: "Edit teams",
        group: "Project",
        enabled: () => !props.project && props.onEditTeams !== undefined,
        run: editTeams,
      },
    ],
  }))

  const input = (key: "name" | "directory", placeholder: string, value: string) => (
    <input
      flexGrow={1}
      value={value}
      cursorStyle={config.cursor}
      ref={(element: InputRenderable) => {
        fields[key] = element
      }}
      onSubmit={save}
      placeholder={placeholder}
      placeholderColor={theme.text.muted}
      textColor={theme.text.formfield.base}
      focusedTextColor={theme.text.formfield.focused}
      cursorColor={theme.text.formfield.focused}
      focusedBackgroundColor={theme.background.formfield.focused}
    />
  )

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          {t(props.project ? "Edit project" : "New project")}
        </text>
        <text fg={theme.text.muted} onMouseUp={props.onClose}>
          esc
        </text>
      </box>
      {/* A click on a field or its label takes focus back from the team list. */}
      <box flexDirection="row" gap={1} onMouseDown={() => focusField(fields.name)}>
        <box width={9}>
          <text fg={theme.text.muted}>{t("Name")}</text>
        </box>
        {input("name", t("My project"), props.project?.name ?? props.draft?.name ?? "")}
      </box>
      <box flexDirection="row" gap={1} onMouseDown={() => focusField(fields.directory)}>
        <box width={9}>
          <text fg={theme.text.muted}>{t("Path")}</text>
        </box>
        {input(
          "directory",
          "/path/to/project",
          props.project?.directory ?? props.draft?.directory ?? location.current?.directory ?? process.cwd(),
        )}
      </box>
      <Show when={!props.project}>
        <box flexDirection="row" gap={1}>
          <box width={9} onMouseUp={focusTeam}>
            <text fg={teamFocused() ? theme.text.formfield.focused : theme.text.muted}>{t("Team")}</text>
          </box>
          <box flexGrow={1} minWidth={0}>
            <For each={visibleTeamOptions()}>
              {(option, index) => (
                <TeamOption
                  selected={team() === visibleTeamStart() + index()}
                  focused={teamFocused()}
                  name={option.name}
                  detail={option.detail}
                  onClick={() => {
                    setTeam(visibleTeamStart() + index())
                    focusTeam()
                  }}
                />
              )}
            </For>
            <Show when={!templates() && !templatesFailed()}>
              <box paddingLeft={2}>
                <text fg={theme.text.muted}>{t("Loading teams…")}</text>
              </box>
            </Show>
            <Show when={templatesFailed()}>
              <box flexDirection="row" gap={1} paddingLeft={2}>
                <text fg={theme.text.feedback.error.base}>{t("Could not load teams")}</text>
                <text fg={theme.text.action.primary.base} onMouseUp={loadTemplates}>
                  {t("Retry")}
                </text>
              </box>
            </Show>
            <Show when={props.onEditTeams || teamCount() > visibleTeamOptions().length}>
              <box paddingLeft={2} flexDirection="row" gap={1}>
                <Show when={teamCount() > visibleTeamOptions().length}>
                  <text fg={theme.text.muted}>
                    {visibleTeamStart() + 1}–{visibleTeamEnd()} / {teamCount()} · ↑↓
                  </text>
                </Show>
                <box flexGrow={1} />
                <Show when={props.onEditTeams}>
                  <box onMouseUp={editTeams}>
                    <text fg={theme.text.action.primary.base}>{t("Edit teams and roles…")}</text>
                  </box>
                </Show>
              </box>
            </Show>
          </box>
        </box>
      </Show>
      <Show when={error()}>
        {(message) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {message()}
          </text>
        )}
      </Show>
      <box flexDirection="row" gap={1}>
        <Button variant="primary" disabled={busy()} onClick={save}>
          {t(props.project ? "Save" : "Create")}
        </Button>
        <Show when={props.project}>
          <Button disabled={busy()} onLeave={() => setArmed(false)} onClick={remove}>
            {t(armed() ? "Remove? Sessions stay" : "Remove project")}
          </Button>
        </Show>
        <box flexGrow={1} />
        <text fg={theme.text.muted}>
          {props.project
            ? t("tab next field · enter save")
            : t("tab next field · ↑↓ team · ctrl+e edit teams · enter create")}
        </text>
      </box>
    </box>
  )
}

function TeamOption(props: { selected: boolean; focused: boolean; name: string; detail: string; onClick: () => void }) {
  const theme = useTheme().surface("dialog")
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      flexDirection="column"
      gap={0}
      flexGrow={1}
      minWidth={0}
      backgroundColor={
        props.selected && props.focused
          ? theme.background.formfield.focused
          : hovered()
            ? theme.background.formfield.hovered
            : undefined
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={props.onClick}
    >
      <box flexDirection="row" gap={1} minWidth={0}>
        <text flexShrink={0} fg={props.selected ? theme.text.formfield.focused : theme.text.muted}>
          {props.selected ? "●" : "○"}
        </text>
        <text
          flexShrink={1}
          wrapMode="none"
          truncate
          fg={props.selected ? theme.text.formfield.focused : theme.text.formfield.base}
        >
          {props.name}
        </text>
      </box>
      <box paddingLeft={2} minWidth={0}>
        <text fg={theme.text.muted} wrapMode="word">
          {props.detail}
        </text>
      </box>
    </box>
  )
}

export function openProjectDialog(
  dialog: DialogContext,
  onDone: () => void,
  project?: OrchestraProject,
  draft?: Draft,
  onCreated?: (project: OrchestraProject) => void | Promise<void>,
) {
  dialog.replace(
    () => (
      <DialogProject
        project={project}
        draft={draft}
        onEditTeams={(typed) =>
          openTeamEditor(dialog, { back: () => openProjectDialog(dialog, onDone, undefined, typed, onCreated) })
        }
        onClose={() => dialog.clear()}
        onCreated={onCreated}
        onDone={() => {
          dialog.clear()
          onDone()
        }}
      />
    ),
    undefined,
    { size: "large" },
  )
  dialog.setCentered(true)
}
