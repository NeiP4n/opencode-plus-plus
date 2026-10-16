import { TextAttributes, type InputRenderable, type TextareaRenderable } from "@opentui/core"
import { createMemo, createResource, createSignal, For, onMount, Show, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useTerminalDimensions } from "@opentui/solid"
import type { OrchestraMember, OrchestraRole, OrchestraTemplate } from "@opencode/client/promise"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import type { DialogContext } from "../ui/dialog"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { Button } from "./devtools-registry"
import { Orchestra } from "@opencode/schema/orchestra"
import { Hub } from "@opencode/core/hub/index"

// The team editor: the operator's AI teams and the roles they are made of.
// A role is an agent (instructions, model, whether it may edit files) and a
// team is the list of role sessions a new project opens. Built-in teams and
// roles can be edited and reset; the operator's own can also be deleted.
//
// Keyboard: tab walks the list and every field of the form; in the list
// ↑↓ picks an item and ←→ switches between teams and roles; ctrl+s saves.

type Tab = "teams" | "roles"
const NEW = "\u0000new"
const LIST_WIDTH = 30
// The editor body fills most of the screen but leaves room for the dialog frame on short terminals.
const BODY_HEIGHT = 26
const BODY_MARGIN = 10

export function DialogTeams(props: { onClose: () => void; tab?: Tab }) {
  const client = useClient()
  const theme = useTheme().surface("dialog")
  const t = useT()
  const [roles, rolesResource] = createResource(() => client.api.orchestra.role.list())
  const [teams, teamsResource] = createResource(() => client.api.orchestra.template.list())
  const [tab, setTab] = createSignal<Tab>(props.tab ?? "teams")
  const [cursor, setCursor] = createSignal(1)
  const focus = createFocus()
  const dimensions = useTerminalDimensions()
  const height = () => Math.max(10, Math.min(BODY_HEIGHT, dimensions().height - BODY_MARGIN))

  const items = (): readonly (OrchestraRole | OrchestraTemplate)[] =>
    (tab() === "teams" ? teams() : roles()) ?? []
  const rows = createMemo(() => [NEW, ...items().map((item) => item.id)])
  const current = () => rows()[Math.min(cursor(), rows().length - 1)] ?? NEW
  const move = (direction: 1 | -1) => setCursor((cursor() + direction + rows().length) % rows().length)
  const switchTab = (next: Tab) => {
    setTab(next)
    setCursor(1)
  }
  const pick = (id: string) => {
    setCursor(Math.max(0, rows().indexOf(id)))
    focus.set("list")
  }
  // After a save the list reloads and the cursor follows the saved item, whose id may be new.
  const saved = async (id: string) => {
    await Promise.all([rolesResource.refetch(), teamsResource.refetch()])
    setCursor(Math.max(0, rows().indexOf(id)))
  }
  const removed = async () => {
    await Promise.all([rolesResource.refetch(), teamsResource.refetch()])
    setCursor(Math.min(cursor(), rows().length - 1))
    focus.set("list")
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "tab", title: "Next field", group: "Teams", run: () => focus.move(1) },
      { bind: "shift+tab", title: "Previous field", group: "Teams", run: () => focus.move(-1) },
      { bind: "up", title: "Previous", group: "Teams", enabled: () => focus.is("list"), run: () => move(-1) },
      { bind: "down", title: "Next", group: "Teams", enabled: () => focus.is("list"), run: () => move(1) },
      {
        bind: "left,right",
        title: "Teams or roles",
        group: "Teams",
        enabled: () => focus.is("list"),
        run: () => switchTab(tab() === "teams" ? "roles" : "teams"),
      },
      { bind: "return", title: "Edit", group: "Teams", enabled: () => focus.is("list"), run: () => focus.move(1) },
      {
        bind: "ctrl+n",
        title: "New",
        group: "Teams",
        run: () => {
          setCursor(0)
          focus.move(1)
        },
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          {t("Team editor")}
        </text>
        <TabLabel active={tab() === "teams"} onClick={() => switchTab("teams")}>
          {t("Teams")}
        </TabLabel>
        <TabLabel active={tab() === "roles"} onClick={() => switchTab("roles")}>
          {t("Roles")}
        </TabLabel>
        <box flexGrow={1} />
        <text fg={theme.text.muted} onMouseUp={props.onClose}>
          esc
        </text>
      </box>
      <box flexDirection="row" gap={2} height={height()} flexShrink={0}>
        <box width={LIST_WIDTH} flexShrink={0} onMouseDown={() => focus.set("list")}>
          <scrollbox flexGrow={1} minHeight={0}>
            <For each={rows()}>
              {(id, index) => {
                const item = () => items().find((entry) => entry.id === id)
                return (
                  <ListRow
                    selected={index() === cursor()}
                    focused={focus.is("list")}
                    onClick={() => pick(id)}
                    label={id === NEW ? t(tab() === "teams" ? "+ New team" : "+ New role") : builtinName(t, item()) ?? id}
                    detail={roleCategory(t, item())}
                    badge={item()?.origin === "builtin" ? undefined : item()?.origin}
                  />
                )
              }}
            </For>
          </scrollbox>
        </box>
        <box flexGrow={1} minWidth={0}>
          <Show when={roles() && teams()}>
            <Show when={`${tab()}:${current()}`} keyed>
              {(key) =>
                key.startsWith("roles:") ? (
                  <RoleForm
                    role={roles()?.find((role) => role.id === current())}
                    teams={teams() ?? []}
                    focus={focus}
                    onSaved={saved}
                    onRemoved={removed}
                  />
                ) : (
                  <TeamForm
                    team={teams()?.find((team) => team.id === current())}
                    roles={roles() ?? []}
                    focus={focus}
                    onSaved={saved}
                    onRemoved={removed}
                  />
                )
              }
            </Show>
          </Show>
        </box>
      </box>
      <text fg={theme.text.muted} wrapMode="none" truncate>
        {focus.is("list")
          ? t("↑↓ select · ←→ teams/roles · enter edit · ctrl+n new · esc close")
          : t("tab next field · ctrl+s save · ctrl+d delete · esc close")}
      </text>
    </box>
  )
}

function RoleForm(props: {
  role?: OrchestraRole
  teams: readonly OrchestraTemplate[]
  focus: Focus
  onSaved: (id: string) => Promise<void>
  onRemoved: () => Promise<void>
}) {
  const client = useClient()
  const theme = useTheme().surface("dialog")
  const t = useT()
  const groupActions = new Set(Orchestra.toolGroups.flatMap((group) => group.actions))
  const initialTools = props.role?.tools
  const [draft, setDraft] = createStore({
    name: props.role?.name ?? "",
    category: props.role?.category ?? "",
    description: props.role?.description ?? "",
    // "default" runs the Orchestrator's model, "manual" the role's own, "auto" lets the Orchestrator pick per task.
    modelMode: (props.role?.models?.length ? "auto" : props.role?.model ? "manual" : "default") as ModelMode,
    model: props.role?.model ?? "",
    models: (props.role?.models ?? []).join(", "),
    readOnly: props.role?.readOnly ?? false,
    toolsMode: (initialTools ? "custom" : "all") as "all" | "custom",
    // Tool groups are picked as a whole; actions outside every group are kept as free patterns.
    groups: Orchestra.toolGroups
      .filter((group) => (initialTools ?? []).some((tool) => group.actions.includes(tool)))
      .map((group) => group.id),
    extraTools: (initialTools ?? []).filter((tool) => !groupActions.has(tool)).join(", "),
    autoTools: props.role?.autoTools ?? false,
    hubMode: (props.role?.hub ? "custom" : "all") as "all" | "custom",
    hub: [...(props.role?.hub ?? [])],
  })
  const config = useConfig().data
  const rules: { element?: TextareaRenderable } = {}
  const action = createAction()
  props.focus.order(() => [
    "name",
    "category",
    "description",
    "modelMode",
    ...(draft.modelMode === "manual" ? ["model"] : draft.modelMode === "auto" ? ["models"] : []),
    "access",
    "toolsMode",
    ...(draft.toolsMode === "custom" ? ["tools", "extraTools"] : []),
    "autoTools",
    "hubMode",
    ...(draft.hubMode === "custom" ? ["hub"] : []),
    "rules",
  ])

  const list = (text: string) =>
    text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  // The textarea owns the rules text; it is read when saving.
  const spec = () => ({
    name: draft.name,
    category: draft.category,
    description: draft.description,
    readOnly: draft.readOnly,
    rules: rules.element?.plainText ?? props.role?.rules ?? "",
    model: draft.modelMode === "manual" ? draft.model.trim() || undefined : undefined,
    ...(draft.modelMode === "auto" ? { models: list(draft.models) } : {}),
    ...(draft.toolsMode === "custom"
      ? {
          tools: [
            ...Orchestra.toolGroups
              .filter((group) => draft.groups.includes(group.id))
              .flatMap((group) => group.actions),
            ...list(draft.extraTools),
          ],
        }
      : {}),
    ...(draft.autoTools ? { autoTools: true } : {}),
    ...(draft.hubMode === "custom" ? { hub: [...draft.hub] } : {}),
  })
  const save = () =>
    action.run(async () => {
      const role = props.role
        ? await client.api.orchestra.role.update({ roleID: props.role.id, ...spec() })
        : await client.api.orchestra.role.create(spec())
      await props.onSaved(role.id)
    })
  // A copy starts a custom role from this one, so a built-in can be varied without editing it.
  const duplicate = () =>
    action.run(async () => {
      const role = await client.api.orchestra.role.create({
        ...spec(),
        name: t("{name} (copy)", { name: draft.name.trim() || props.role?.name || "" }),
      })
      await props.onSaved(role.id)
    })
  const remove = () => {
    const role = props.role
    if (!role || role.origin === "builtin") return
    // Checked here as well so the reason reads in the operator's language.
    const users = props.teams.filter((team) => team.members.some((member) => member.agent === role.agent))
    if (role.origin === "custom" && users.length > 0)
      return action.fail(
        t("{role} is in {teams}; remove it there first", {
          role: role.name,
          teams: users.map((team) => team.name).join(", "),
        }),
      )
    action.arm(() => client.api.orchestra.role.remove({ roleID: role.id }).then(props.onRemoved))
  }
  const cycleModel = (direction: 1 | -1) =>
    setDraft("modelMode", MODEL_MODES[(MODEL_MODES.indexOf(draft.modelMode) + direction + 3) % 3] ?? "default")
  const toggle = (key: "groups" | "hub", id: string) =>
    setDraft(key, (items) => (items.includes(id) ? items.filter((item) => item !== id) : [...items, id]))
  const toolChips = createChips(() => Orchestra.toolGroups.map((group) => group.id))
  const hubChips = createChips(() => hubCategories())

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "ctrl+s", title: "Save role", group: "Teams", enabled: () => !props.focus.is("list"), run: save },
      { bind: "ctrl+d", title: "Delete role", group: "Teams", enabled: () => !props.focus.is("list"), run: remove },
      {
        bind: "left,right,space,return",
        title: "Switch file access",
        group: "Teams",
        enabled: () => props.focus.is("access"),
        run: () => setDraft("readOnly", !draft.readOnly),
      },
      { bind: "left", title: "Model mode", group: "Teams", enabled: () => props.focus.is("modelMode"), run: () => cycleModel(-1) },
      {
        bind: "right,space,return",
        title: "Model mode",
        group: "Teams",
        enabled: () => props.focus.is("modelMode"),
        run: () => cycleModel(1),
      },
      {
        bind: "left,right,space,return",
        title: "Tools mode",
        group: "Teams",
        enabled: () => props.focus.is("toolsMode"),
        run: () => setDraft("toolsMode", draft.toolsMode === "all" ? "custom" : "all"),
      },
      {
        bind: "left,right,space,return",
        title: "Registry mode",
        group: "Teams",
        enabled: () => props.focus.is("hubMode"),
        run: () => setDraft("hubMode", draft.hubMode === "all" ? "custom" : "all"),
      },
      {
        bind: "space,return",
        title: "Orchestrator may narrow tools",
        group: "Teams",
        enabled: () => props.focus.is("autoTools"),
        run: () => setDraft("autoTools", !draft.autoTools),
      },
      { bind: "left", title: "Previous", group: "Teams", enabled: () => props.focus.is("tools"), run: () => toolChips.move(-1) },
      { bind: "right", title: "Next", group: "Teams", enabled: () => props.focus.is("tools"), run: () => toolChips.move(1) },
      {
        bind: "space,return",
        title: "Toggle tool",
        group: "Teams",
        enabled: () => props.focus.is("tools"),
        run: () => toggle("groups", toolChips.current()),
      },
      { bind: "left", title: "Previous", group: "Teams", enabled: () => props.focus.is("hub"), run: () => hubChips.move(-1) },
      { bind: "right", title: "Next", group: "Teams", enabled: () => props.focus.is("hub"), run: () => hubChips.move(1) },
      {
        bind: "space,return",
        title: "Toggle category",
        group: "Teams",
        enabled: () => props.focus.is("hub"),
        run: () => toggle("hub", hubChips.current()),
      },
    ],
  }))

  return (
    <box gap={0} flexGrow={1}>
      <Field label={t("Name")} focus={props.focus} target="name">
        <TextInput
          focus={props.focus}
          target="name"
          value={draft.name}
          placeholder={t("e.g. Security auditor")}
          onInput={(value) => setDraft("name", value)}
          onSubmit={save}
        />
      </Field>
      <Field label={t("Category")} focus={props.focus} target="category">
        <TextInput
          focus={props.focus}
          target="category"
          value={draft.category}
          placeholder={t("Planning, Build, Quality")}
          onInput={(value) => setDraft("category", value)}
          onSubmit={save}
        />
      </Field>
      <Field label={t("Description")} focus={props.focus} target="description">
        <TextInput
          focus={props.focus}
          target="description"
          value={draft.description}
          placeholder={t("What the Orchestrator sends this role")}
          onInput={(value) => setDraft("description", value)}
          onSubmit={save}
        />
      </Field>
      <Field label={t("Model")} focus={props.focus} target="modelMode">
        <box flexDirection="row" gap={2}>
          <For each={MODEL_MODES}>
            {(mode) => (
              <Choice
                selected={draft.modelMode === mode}
                focused={props.focus.is("modelMode")}
                onClick={() => setDraft("modelMode", mode)}
              >
                {t(MODEL_LABELS[mode])}
              </Choice>
            )}
          </For>
        </box>
      </Field>
      <Show when={draft.modelMode === "manual"}>
        <Field label="" focus={props.focus} target="model">
          <TextInput
            focus={props.focus}
            target="model"
            value={draft.model}
            placeholder={t("provider/model")}
            onInput={(value) => setDraft("model", value)}
            onSubmit={save}
          />
        </Field>
      </Show>
      <Show when={draft.modelMode === "auto"}>
        <Field label="" focus={props.focus} target="models">
          <TextInput
            focus={props.focus}
            target="models"
            value={draft.models}
            placeholder={t("models the Orchestrator picks from: provider/fast, provider/strong")}
            onInput={(value) => setDraft("models", value)}
            onSubmit={save}
          />
        </Field>
      </Show>
      <Field label={t("Files")} focus={props.focus} target="access">
        <box flexDirection="row" gap={2}>
          <Choice
            selected={!draft.readOnly}
            focused={props.focus.is("access")}
            onClick={() => setDraft("readOnly", false)}
          >
            {t("Can edit")}
          </Choice>
          <Choice
            selected={draft.readOnly}
            focused={props.focus.is("access")}
            onClick={() => setDraft("readOnly", true)}
          >
            {t("Read only")}
          </Choice>
        </box>
      </Field>
      <Field label={t("Tools")} focus={props.focus} target="toolsMode">
        <box flexDirection="row" gap={2}>
          <Choice
            selected={draft.toolsMode === "all"}
            focused={props.focus.is("toolsMode")}
            onClick={() => setDraft("toolsMode", "all")}
          >
            {t("All")}
          </Choice>
          <Choice
            selected={draft.toolsMode === "custom"}
            focused={props.focus.is("toolsMode")}
            onClick={() => setDraft("toolsMode", "custom")}
          >
            {t("Selected")}
          </Choice>
          <box flexGrow={1} />
          <box onMouseDown={() => props.focus.set("autoTools")}>
            <Toggle
              on={draft.autoTools}
              focused={props.focus.is("autoTools")}
              onClick={() => setDraft("autoTools", !draft.autoTools)}
            >
              {t("Orchestrator may narrow")}
            </Toggle>
          </box>
        </box>
      </Field>
      <Show when={draft.toolsMode === "custom"}>
        <Field label="" focus={props.focus} target="tools">
          <Chips
            items={Orchestra.toolGroups.map((group) => ({ id: group.id, label: t(group.name) }))}
            selected={draft.groups}
            focused={props.focus.is("tools")}
            cursor={toolChips.index()}
            onToggle={(id) => toggle("groups", id)}
          />
        </Field>
        <Field label="" focus={props.focus} target="extraTools">
          <TextInput
            focus={props.focus}
            target="extraTools"
            value={draft.extraTools}
            placeholder={t("other tools or MCP patterns, e.g. context7_*")}
            onInput={(value) => setDraft("extraTools", value)}
            onSubmit={save}
          />
        </Field>
      </Show>
      <Field label={t("Registry")} focus={props.focus} target="hubMode">
        <box flexDirection="row" gap={2}>
          <Choice
            selected={draft.hubMode === "all"}
            focused={props.focus.is("hubMode")}
            onClick={() => setDraft("hubMode", "all")}
          >
            {t("All categories")}
          </Choice>
          <Choice
            selected={draft.hubMode === "custom"}
            focused={props.focus.is("hubMode")}
            onClick={() => setDraft("hubMode", "custom")}
          >
            {t("Selected")}
          </Choice>
        </box>
      </Field>
      <Show when={draft.hubMode === "custom"}>
        <Field label="" focus={props.focus} target="hub">
          <Chips
            items={hubCategories().map((category) => ({ id: category, label: category }))}
            selected={draft.hub}
            focused={props.focus.is("hub")}
            cursor={hubChips.index()}
            onToggle={(id) => toggle("hub", id)}
          />
        </Field>
      </Show>
      <box
        flexDirection="row"
        gap={1}
        flexGrow={1}
        minHeight={3}
        marginTop={1}
        onMouseDown={() => props.focus.set("rules")}
      >
        <box width={LABEL_WIDTH} flexShrink={0}>
          <text fg={props.focus.is("rules") ? theme.text.formfield.focused : theme.text.muted}>{t("Rules")}</text>
        </box>
        <box flexGrow={1} minWidth={0} gap={0}>
          <textarea
            flexGrow={1}
            wrapMode="word"
            initialValue={props.role?.rules ?? ""}
            placeholder={t("What this role does and how it works. Added after the shared team instructions.")}
            placeholderColor={theme.text.muted}
            textColor={theme.text.formfield.base}
            focusedTextColor={theme.text.formfield.focused}
            cursorColor={theme.text.formfield.focused}
            backgroundColor={theme.background.formfield.base}
            focusedBackgroundColor={theme.background.formfield.focused}
            cursorStyle={config.cursor}
            ref={(element: TextareaRenderable) => {
              rules.element = element
              props.focus.register("rules", element)
            }}
          />
        </box>
      </box>
      <Actions
        action={action}
        isNew={!props.role}
        origin={props.role?.origin}
        onSave={save}
        onRemove={remove}
        onDuplicate={duplicate}
      />
    </box>
  )
}

// Registry categories with at least one entry this OS can run, so a Linux-only category is not offered on Windows.
const hubCategories = () => [...new Set(Hub.all.filter((entry) => Hub.supportsPlatform(entry)).map((entry) => entry.category))].sort()

type ModelMode = "default" | "manual" | "auto"
const MODEL_MODES: readonly ModelMode[] = ["default", "manual", "auto"]
const MODEL_LABELS: Record<ModelMode, string> = {
  default: "Orchestrator's",
  manual: "Fixed",
  auto: "Auto",
}

// The cursor of a row of chips, moved with ←→ while the row has the focus.
function createChips(ids: () => readonly string[]) {
  const [index, setIndex] = createSignal(0)
  return {
    index,
    current: () => ids()[Math.min(index(), ids().length - 1)] ?? "",
    move: (direction: 1 | -1) => setIndex((index() + direction + ids().length) % Math.max(1, ids().length)),
  }
}

function Chips(props: {
  items: readonly { id: string; label: string }[]
  selected: readonly string[]
  focused: boolean
  cursor: number
  onToggle: (id: string) => void
}) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <For each={props.items}>
        {(item, index) => (
          <box
            flexDirection="row"
            gap={1}
            backgroundColor={props.focused && index() === props.cursor ? theme.background.formfield.focused : undefined}
            onMouseUp={() => props.onToggle(item.id)}
          >
            <text fg={props.selected.includes(item.id) ? theme.text.formfield.focused : theme.text.muted}>
              {props.selected.includes(item.id) ? "■" : "□"}
            </text>
            <text fg={props.selected.includes(item.id) ? theme.text.formfield.focused : theme.text.formfield.base}>
              {item.label}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}

function Toggle(props: { on: boolean; focused: boolean; onClick: () => void; children: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <box
      flexDirection="row"
      gap={1}
      backgroundColor={props.focused ? theme.background.formfield.focused : undefined}
      onMouseUp={props.onClick}
    >
      <text fg={props.on ? theme.text.formfield.focused : theme.text.muted}>{props.on ? "■" : "□"}</text>
      <text fg={props.on ? theme.text.formfield.focused : theme.text.formfield.base}>{props.children}</text>
    </box>
  )
}

function TeamForm(props: {
  team?: OrchestraTemplate
  roles: readonly OrchestraRole[]
  focus: Focus
  onSaved: (id: string) => Promise<void>
  onRemoved: () => Promise<void>
}) {
  const client = useClient()
  const theme = useTheme().surface("dialog")
  const t = useT()
  const config = useConfig().data
  // Members carry a local key so their fields keep focus while rows are added, moved or removed.
  let next = 0
  const keyed = (member: OrchestraMember) => ({ ...member, key: `m${next++}` })
  const [draft, setDraft] = createStore({
    name: props.team?.name ?? "",
    description: props.team?.description ?? "",
    members: (props.team?.members ?? []).map(keyed),
  })
  const playbook: { element?: TextareaRenderable } = {}
  // The role picker of one member: a filtered list of every role, opened with enter on its role.
  const [picker, setPicker] = createStore({ open: false, member: "", filter: "", cursor: 0 })
  const action = createAction()
  props.focus.order(() =>
    picker.open
      ? ["picker"]
      : [
          "name",
          "description",
          ...draft.members.flatMap((member) => [`${member.key}.title`, `${member.key}.role`, `${member.key}.category`]),
          "add",
          "playbook",
        ],
  )
  const roleOf = (agent: string) => props.roles.find((role) => role.agent === agent)
  const focusedMember = () => draft.members.findIndex((member) => props.focus.current().startsWith(`${member.key}.`))
  const matches = createMemo(() => matchRoles(t, props.roles, picker.filter))
  const highlighted = () => matches()[Math.min(picker.cursor, matches().length - 1)]

  const add = () => {
    const role = props.roles[0]
    if (!role) return
    const member = keyed({ agent: role.agent, title: "", category: "" })
    setDraft("members", (members) => [...members, member])
    props.focus.set(`${member.key}.title`)
  }
  const cycleRole = (index: number, direction: 1 | -1) => {
    const position = props.roles.findIndex((role) => role.agent === draft.members[index]?.agent)
    const role = props.roles[(position + direction + props.roles.length) % props.roles.length]
    if (role) setDraft("members", index, "agent", role.agent)
  }
  const openPicker = (index: number) => {
    const member = draft.members[index]
    if (!member) return
    const position = props.roles.findIndex((role) => role.agent === member.agent)
    setPicker({ open: true, member: member.key, filter: "", cursor: Math.max(0, position) })
    props.focus.set("picker")
  }
  const closePicker = () => {
    const key = picker.member
    setPicker({ open: false, member: "", filter: "", cursor: 0 })
    props.focus.set(`${key}.role`)
  }
  const choose = (role: OrchestraRole | undefined) => {
    const index = draft.members.findIndex((member) => member.key === picker.member)
    if (role && index >= 0) setDraft("members", index, "agent", role.agent)
    closePicker()
  }
  const shift = (direction: 1 | -1) => {
    const index = focusedMember()
    const target = index + direction
    if (index < 0 || target < 0 || target >= draft.members.length) return
    setDraft(
      "members",
      produce((members) => {
        const [member] = members.splice(index, 1)
        if (member) members.splice(target, 0, member)
      }),
    )
  }
  const drop = (index: number) => {
    setDraft("members", (members) => members.filter((_, position) => position !== index))
    props.focus.set(draft.members[Math.min(index, draft.members.length - 1)]?.key + ".title")
  }

  // The textarea owns the playbook text; it is read when saving.
  const spec = () => {
    const text = (playbook.element?.plainText ?? props.team?.playbook ?? "").trim()
    return {
      name: draft.name,
      description: draft.description,
      members: draft.members.map((member) => ({
        agent: member.agent,
        title: member.title,
        category: member.category,
      })),
      ...(text ? { playbook: text } : {}),
    }
  }
  const save = () =>
    action.run(async () => {
      const team = props.team
        ? await client.api.orchestra.template.update({ templateID: props.team.id, ...spec() })
        : await client.api.orchestra.template.create(spec())
      await props.onSaved(team.id)
    })
  const duplicate = () =>
    action.run(async () => {
      const team = await client.api.orchestra.template.create({
        ...spec(),
        name: t("{name} (copy)", { name: draft.name.trim() || props.team?.name || "" }),
      })
      await props.onSaved(team.id)
    })
  const remove = () => {
    const team = props.team
    if (!team || team.origin === "builtin") return
    action.arm(() => client.api.orchestra.template.remove({ templateID: team.id }).then(props.onRemoved))
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "ctrl+s",
        title: "Save team",
        group: "Teams",
        enabled: () => !props.focus.is("list") && !picker.open,
        run: save,
      },
      {
        bind: "ctrl+d",
        title: "Delete team",
        group: "Teams",
        enabled: () => !props.focus.is("list") && !picker.open,
        run: remove,
      },
      {
        bind: "left",
        title: "Previous role",
        group: "Teams",
        enabled: () => props.focus.current().endsWith(".role"),
        run: () => cycleRole(focusedMember(), -1),
      },
      {
        bind: "right,space",
        title: "Next role",
        group: "Teams",
        enabled: () => props.focus.current().endsWith(".role"),
        run: () => cycleRole(focusedMember(), 1),
      },
      {
        bind: "return",
        title: "Choose role",
        group: "Teams",
        enabled: () => props.focus.current().endsWith(".role"),
        run: () => openPicker(focusedMember()),
      },
      {
        bind: "up",
        title: "Previous role",
        group: "Teams",
        enabled: () => picker.open,
        run: () => setPicker("cursor", Math.max(0, Math.min(picker.cursor, matches().length - 1) - 1)),
      },
      {
        bind: "down",
        title: "Next role",
        group: "Teams",
        enabled: () => picker.open,
        run: () => setPicker("cursor", Math.min(matches().length - 1, picker.cursor + 1)),
      },
      { bind: "return", title: "Pick role", group: "Teams", enabled: () => picker.open, run: () => choose(highlighted()) },
      { bind: "escape", title: "Cancel", group: "Teams", enabled: () => picker.open, run: closePicker },
      {
        bind: "ctrl+up",
        title: "Move member up",
        group: "Teams",
        enabled: () => focusedMember() >= 0,
        run: () => shift(-1),
      },
      {
        bind: "ctrl+down",
        title: "Move member down",
        group: "Teams",
        enabled: () => focusedMember() >= 0,
        run: () => shift(1),
      },
      {
        bind: "ctrl+x",
        title: "Remove member",
        group: "Teams",
        enabled: () => focusedMember() >= 0,
        run: () => drop(focusedMember()),
      },
      { bind: "return,space", title: "Add member", group: "Teams", enabled: () => props.focus.is("add"), run: add },
    ],
  }))

  return (
    <box gap={0} flexGrow={1}>
      <Field label={t("Name")} focus={props.focus} target="name">
        <TextInput
          focus={props.focus}
          target="name"
          value={draft.name}
          placeholder={t("e.g. Mobile app")}
          onInput={(value) => setDraft("name", value)}
          onSubmit={save}
        />
      </Field>
      <Field label={t("Description")} focus={props.focus} target="description">
        <TextInput
          focus={props.focus}
          target="description"
          value={draft.description}
          placeholder={t("What this team is for")}
          onInput={(value) => setDraft("description", value)}
          onSubmit={save}
        />
      </Field>
      <Show
        when={picker.open}
        fallback={
          <box flexDirection="row" gap={1} flexGrow={1} minHeight={3} marginTop={1}>
            <box width={LABEL_WIDTH} flexShrink={0}>
              <text
                fg={focusedMember() >= 0 || props.focus.is("add") ? theme.text.formfield.focused : theme.text.muted}
              >
                {t("Members")}
              </text>
            </box>
            <scrollbox flexGrow={1} minHeight={0}>
              <box flexDirection="row" gap={1}>
                <box width={3} />
                <box width={MEMBER_TITLE}>
                  <text fg={theme.text.muted}>{t("Title")}</text>
                </box>
                <box width={MEMBER_ROLE}>
                  <text fg={theme.text.muted}>{t("Role")}</text>
                </box>
                <box flexGrow={1}>
                  <text fg={theme.text.muted}>{t("Category")}</text>
                </box>
              </box>
              <For each={draft.members}>
                {(member, index) => {
                  const role = () => roleOf(member.agent)
                  return (
                    <box flexDirection="row" gap={1}>
                      <box width={3}>
                        <text fg={focusedMember() === index() ? theme.text.formfield.focused : theme.text.muted}>
                          {`${index() + 1}.`}
                        </text>
                      </box>
                      <box width={MEMBER_TITLE} onMouseDown={() => props.focus.set(`${member.key}.title`)}>
                        <TextInput
                          focus={props.focus}
                          target={`${member.key}.title`}
                          value={member.title}
                          placeholder={builtinName(t, role()) ?? ""}
                          onInput={(value) => setDraft("members", index(), "title", value)}
                          onSubmit={save}
                        />
                      </box>
                      <box
                        width={MEMBER_ROLE}
                        flexDirection="row"
                        backgroundColor={
                          props.focus.is(`${member.key}.role`) ? theme.background.formfield.focused : undefined
                        }
                      >
                        <text
                          fg={theme.text.formfield.base}
                          onMouseUp={() => {
                            props.focus.set(`${member.key}.role`)
                            cycleRole(index(), -1)
                          }}
                        >
                          {"‹ "}
                        </text>
                        <box flexGrow={1} minWidth={0} onMouseUp={() => openPicker(index())}>
                          <text
                            fg={
                              props.focus.is(`${member.key}.role`)
                                ? theme.text.formfield.focused
                                : theme.text.formfield.base
                            }
                            wrapMode="none"
                            truncate
                          >
                            {builtinName(t, role()) ?? member.agent}
                          </text>
                        </box>
                        <text
                          fg={theme.text.formfield.base}
                          onMouseUp={() => {
                            props.focus.set(`${member.key}.role`)
                            cycleRole(index(), 1)
                          }}
                        >
                          {" ›"}
                        </text>
                      </box>
                      <box flexGrow={1} minWidth={0} onMouseDown={() => props.focus.set(`${member.key}.category`)}>
                        <TextInput
                          focus={props.focus}
                          target={`${member.key}.category`}
                          value={member.category}
                          placeholder={roleCategory(t, role()) ?? ""}
                          onInput={(value) => setDraft("members", index(), "category", value)}
                          onSubmit={save}
                        />
                      </box>
                      <text fg={theme.text.muted} onMouseUp={() => drop(index())}>
                        ✕
                      </text>
                    </box>
                  )
                }}
              </For>
              <box
                flexDirection="row"
                paddingLeft={4}
                backgroundColor={props.focus.is("add") ? theme.background.formfield.focused : undefined}
                onMouseUp={add}
              >
                <text fg={theme.text.action.primary.base}>{t("+ Add member")}</text>
              </box>
            </scrollbox>
          </box>
        }
      >
        <box flexDirection="row" gap={1} flexGrow={1} minHeight={3} marginTop={1}>
          <box width={LABEL_WIDTH} flexShrink={0}>
            <text fg={theme.text.formfield.focused}>{t("Role")}</text>
          </box>
          <box flexGrow={1} minWidth={0} gap={0}>
            <TextInput
              focus={props.focus}
              target="picker"
              value=""
              placeholder={t("Type to filter roles")}
              onInput={(value) => setPicker({ filter: value, cursor: 0 })}
              onSubmit={() => choose(highlighted())}
            />
            <scrollbox flexGrow={1} minHeight={0}>
              <For each={matches()}>
                {(role) => (
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={1}
                    backgroundColor={
                      role === highlighted() ? theme.background.formfield.focused : undefined
                    }
                    onMouseUp={() => choose(role)}
                  >
                    <box flexGrow={1} minWidth={0}>
                      <text
                        fg={role === highlighted() ? theme.text.formfield.focused : theme.text.formfield.base}
                        wrapMode="none"
                        truncate
                      >
                        {`${role === highlighted() ? "› " : "  "}${builtinName(t, role)}`}
                      </text>
                    </box>
                    <text fg={theme.text.muted} wrapMode="none">
                      {`${roleCategory(t, role) ?? ""}${role.readOnly ? ` · ${t("read only")}` : ""}`}
                    </text>
                  </box>
                )}
              </For>
              <Show when={matches().length === 0}>
                <text fg={theme.text.muted}>{t("No role matches")}</text>
              </Show>
            </scrollbox>
            <Show when={highlighted()}>
              {(role) => (
                <text fg={theme.text.muted} wrapMode="word">
                  {role().description}
                </text>
              )}
            </Show>
          </box>
        </box>
      </Show>
      <Show when={!picker.open && focusedMember() >= 0}>
        <Show when={roleOf(draft.members[focusedMember()]?.agent ?? "")}>
          {(role) => (
            <text fg={theme.text.muted} wrapMode="word">
              {`${builtinName(t, role())}: ${role().description}`}
            </text>
          )}
        </Show>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {t("enter pick role · ←→ next role · ctrl+↑↓ move · ctrl+x remove · empty title or category uses the role's")}
        </text>
      </Show>
      <Show when={picker.open}>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {t("type to filter · ↑↓ select · enter pick · esc back")}
        </text>
      </Show>
      <Show when={!picker.open}>
        <box
          flexDirection="row"
          gap={1}
          height={PLAYBOOK_HEIGHT}
          flexShrink={0}
          marginTop={1}
          onMouseDown={() => props.focus.set("playbook")}
        >
          <box width={LABEL_WIDTH} flexShrink={0}>
            <text fg={props.focus.is("playbook") ? theme.text.formfield.focused : theme.text.muted}>
              {t("Playbook")}
            </text>
          </box>
          <box flexGrow={1} minWidth={0}>
            <textarea
              flexGrow={1}
              wrapMode="word"
              initialValue={props.team?.playbook ?? ""}
              placeholder={t(
                "How the Orchestrator runs this team: steps, which role does what, what runs in parallel, when it is done.",
              )}
              placeholderColor={theme.text.muted}
              textColor={theme.text.formfield.base}
              focusedTextColor={theme.text.formfield.focused}
              cursorColor={theme.text.formfield.focused}
              backgroundColor={theme.background.formfield.base}
              focusedBackgroundColor={theme.background.formfield.focused}
              cursorStyle={config.cursor}
              ref={(element: TextareaRenderable) => {
                playbook.element = element
                props.focus.register("playbook", element)
              }}
            />
          </box>
        </box>
      </Show>
      <Actions
        action={action}
        isNew={!props.team}
        origin={props.team?.origin}
        onSave={save}
        onRemove={remove}
        onDuplicate={duplicate}
      />
    </box>
  )
}

// Built-in roles and teams ship with English names; unedited ones read in the operator's
// language in lists. Forms keep the stored text, so saving never rewrites it unnoticed.
export function builtinName(
  t: (text: string) => string,
  item: { name: string; origin: OrchestraRole["origin"] } | undefined,
) {
  if (!item) return undefined
  return item.origin === "builtin" ? t(item.name) : item.name
}

// A role's category, shown beside it in the roles list; teams have none.
function roleCategory(t: (text: string) => string, item: OrchestraRole | OrchestraTemplate | undefined) {
  if (!item || !("category" in item)) return undefined
  return item.origin === "builtin" ? t(item.category) : item.category
}

// The roles that match a picker's filter by name, id, category or description, in either language.
function matchRoles(t: (text: string) => string, roles: readonly OrchestraRole[], filter: string) {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  return roles.filter((role) => {
    const text = [role.id, role.name, t(role.name), role.category, t(role.category), role.description]
      .join(" ")
      .toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

const LABEL_WIDTH = 12
const MEMBER_TITLE = 20
const MEMBER_ROLE = 18
const PLAYBOOK_HEIGHT = 5

// Save and delete of one form: a pending request disables both, a failure shows
// under the form, and delete takes a second press to confirm.
function createAction() {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [armed, setArmed] = createSignal(false)
  const run = async (task: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(true)
    setError()
    await task().catch((cause: unknown) => setError(errorMessage(cause)))
    setBusy(false)
    setArmed(false)
  }
  return {
    busy,
    error,
    armed,
    disarm: () => setArmed(false),
    fail: (message: string) => setError(message),
    run,
    arm: (task: () => Promise<unknown>) => {
      if (!armed()) return setArmed(true)
      void run(task)
    },
  }
}

function Actions(props: {
  action: ReturnType<typeof createAction>
  isNew: boolean
  origin?: OrchestraRole["origin"]
  onSave: () => void
  onRemove: () => void
  onDuplicate: () => void
}) {
  const theme = useTheme().surface("dialog")
  const t = useT()
  const removeLabel = () => {
    if (props.origin === "edited") return t(props.action.armed() ? "Reset?" : "Reset to default")
    return t(props.action.armed() ? "Delete?" : "Delete")
  }
  return (
    <box gap={0} marginTop={1}>
      <Show when={props.action.error()}>
        {(message) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {t(message())}
          </text>
        )}
      </Show>
      <box flexDirection="row" gap={1}>
        <Button variant="primary" disabled={props.action.busy()} onClick={props.onSave}>
          {t(props.isNew ? "Create" : "Save")}
        </Button>
        <Show when={!props.isNew}>
          <Button disabled={props.action.busy()} onClick={props.onDuplicate}>
            {t("Duplicate")}
          </Button>
        </Show>
        <Show when={props.origin === "edited" || props.origin === "custom"}>
          <Button disabled={props.action.busy()} onLeave={props.action.disarm} onClick={props.onRemove}>
            {removeLabel()}
          </Button>
        </Show>
        <Show when={props.origin === "builtin"}>
          <text fg={theme.text.muted}>{t("Built-in: saving keeps a copy you can reset")}</text>
        </Show>
      </box>
    </box>
  )
}

type Focus = ReturnType<typeof createFocus>

// One keyboard focus across the list and the form: inputs get the real focus,
// choices (switches, role pickers, the add row) are focused only in this signal.
function createFocus() {
  const [current, setCurrent] = createSignal("list")
  const elements = new Map<string, InputRenderable | TextareaRenderable>()
  const state = { order: (): string[] => [] }
  const set = (key: string) => {
    elements.forEach((element, name) => {
      if (name !== key && !element.isDestroyed && element.focused) element.blur()
    })
    setCurrent(key)
    const element = elements.get(key)
    if (element && !element.isDestroyed) element.focus()
  }
  return {
    current,
    is: (key: string) => current() === key,
    set,
    register: (key: string, element: InputRenderable | TextareaRenderable) => elements.set(key, element),
    order: (keys: () => string[]) => {
      state.order = keys
    },
    move: (direction: 1 | -1) => {
      const keys = ["list", ...state.order()]
      const index = keys.indexOf(current())
      set(keys[(index + direction + keys.length) % keys.length] ?? "list")
    },
  }
}

function Field(props: { label: string; focus: Focus; target: string; children: JSX.Element }) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row" gap={1} onMouseDown={() => props.focus.set(props.target)}>
      <box width={LABEL_WIDTH} flexShrink={0}>
        <text fg={props.focus.is(props.target) ? theme.text.formfield.focused : theme.text.muted}>{props.label}</text>
      </box>
      <box flexGrow={1} minWidth={0}>
        {props.children}
      </box>
    </box>
  )
}

function TextInput(props: {
  focus: Focus
  target: string
  value: string
  placeholder: string
  onInput: (value: string) => void
  onSubmit: () => void
}) {
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  // The initial value only: the input owns its text and reports every change.
  const value = props.value
  const field: { element?: InputRenderable } = {}
  // A field added while it is the focus target (a new member row) takes the keyboard once it exists.
  onMount(() => {
    if (field.element && props.focus.is(props.target) && !field.element.isDestroyed) field.element.focus()
  })
  return (
    <input
      flexGrow={1}
      value={value}
      cursorStyle={config.cursor}
      ref={(element: InputRenderable) => {
        field.element = element
        props.focus.register(props.target, element)
      }}
      onInput={props.onInput}
      onSubmit={props.onSubmit}
      placeholder={props.placeholder}
      placeholderColor={theme.text.muted}
      textColor={theme.text.formfield.base}
      focusedTextColor={theme.text.formfield.focused}
      cursorColor={theme.text.formfield.focused}
      backgroundColor={theme.background.formfield.base}
      focusedBackgroundColor={theme.background.formfield.focused}
    />
  )
}

function Choice(props: { selected: boolean; focused: boolean; onClick: () => void; children: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <box
      flexDirection="row"
      gap={1}
      backgroundColor={props.selected && props.focused ? theme.background.formfield.focused : undefined}
      onMouseUp={props.onClick}
    >
      <text fg={props.selected ? theme.text.formfield.focused : theme.text.muted}>{props.selected ? "●" : "○"}</text>
      <text fg={props.selected ? theme.text.formfield.focused : theme.text.formfield.base}>{props.children}</text>
    </box>
  )
}

function TabLabel(props: { active: boolean; onClick: () => void; children: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <text
      fg={props.active ? theme.text.action.primary.selected : theme.text.muted}
      attributes={props.active ? TextAttributes.UNDERLINE : undefined}
      onMouseUp={props.onClick}
    >
      {props.children}
    </text>
  )
}

function ListRow(props: {
  selected: boolean
  focused: boolean
  label: string
  detail?: string
  badge?: string
  onClick: () => void
}) {
  const theme = useTheme().surface("dialog")
  const t = useT()
  const [hovered, setHovered] = createSignal(false)
  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        props.selected
          ? props.focused
            ? theme.background.formfield.focused
            : theme.background.formfield.hovered
          : hovered()
            ? theme.background.formfield.hovered
            : undefined
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={props.onClick}
    >
      <box flexGrow={1} minWidth={0}>
        <text
          fg={props.selected ? theme.text.formfield.focused : theme.text.formfield.base}
          wrapMode="none"
          truncate
        >
          {props.label}
        </text>
      </box>
      <Show when={props.detail}>
        {(detail) => (
          <text fg={theme.text.muted} wrapMode="none" truncate>
            {detail()}
          </text>
        )}
      </Show>
      <Show when={props.badge}>{(badge) => <text fg={theme.text.muted}>{t(badge())}</text>}</Show>
    </box>
  )
}

// `back` reopens whatever the editor was opened from, such as the new-project dialog.
// Escape calls it before the dialog stack drops the editor, so it runs a tick later
// and only once, however the editor was closed.
export function openTeamEditor(dialog: DialogContext, options: { tab?: Tab; back?: () => void } = {}) {
  const back = options.back
  const state = { left: false }
  const leave = back
    ? () => {
        if (state.left) return
        state.left = true
        queueMicrotask(back)
      }
    : undefined
  dialog.replace(() => <DialogTeams tab={options.tab} onClose={leave ?? (() => dialog.clear())} />, leave, {
    size: "xlarge",
  })
  dialog.setCentered(true)
}
