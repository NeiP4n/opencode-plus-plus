import { Schema } from "effect"
import { createMemo, For, Show, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Skill } from "@opencode/schema/skill"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { ComposerModel } from "./model"

const MiniSkillDefinitionSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  icon: Schema.String,
  instruction: Schema.String,
})

const MiniSkillsSettingsSchema = Schema.Struct({
  items: Schema.Array(MiniSkillDefinitionSchema),
  placement: Schema.Literals(["above", "below"]),
})

type MiniSkillDefinition = typeof MiniSkillDefinitionSchema.Type

const INITIAL_SETTINGS = {
  items: [
    {
      id: "analyze",
      label: "Analyze",
      icon: "🔎",
      instruction:
        "Analyze the request and relevant context. Identify key facts, constraints, assumptions, and uncertainties. Do not modify files unless explicitly asked.",
    },
    {
      id: "plan",
      label: "Plan",
      icon: "🧭",
      instruction:
        "Create an ordered plan for the task. Identify dependencies, risks, affected areas, and verification steps. Do not change files yet.",
    },
    {
      id: "debug",
      label: "Debug",
      icon: "🐛",
      instruction:
        "Investigate the reported problem, trace it to the underlying cause, inspect relevant code and tests, and prefer the smallest safe fix. Avoid unrelated changes.",
    },
    {
      id: "review",
      label: "Review",
      icon: "🧐",
      instruction:
        "Review the relevant implementation for correctness, regressions, edge cases, security, and maintainability. Prioritize concrete findings and explain their impact.",
    },
    {
      id: "test",
      label: "Test",
      icon: "🧪",
      instruction:
        "Identify the behavior that needs verification, add or update the most appropriate tests, and run focused checks. Report the checks performed and their actual results.",
    },
    {
      id: "explain",
      label: "Explain",
      icon: "💡",
      instruction:
        "Explain the relevant code or concept in clear, simple language. Start with the key idea, then describe how it works and important trade-offs.",
    },
  ],
  placement: "above",
} satisfies typeof MiniSkillsSettingsSchema.Type

type MiniSkillUIState = {
  selectedID?: string
  additionalText: string
  manageOpen: boolean
  editorOpen: boolean
  editingID?: string
  draftLabel: string
  draftIcon: string
  draftInstruction: string
}

const INPUT_CLASS =
  "w-full rounded-md border border-border-weak-base bg-background-base px-3 py-2 text-[13px] leading-5 text-text-base placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-border-weak-base"

export function ComposerMiniSkills(props: ParentProps<{ model: ComposerModel }>) {
  const language = useLanguage()
  const data = useData()
  const location = useWorkspaceLocation()
  const availableSkills = createMemo(() => data.location.skill.list({ directory: location().directory }) ?? [])
  const [settings, setSettings, , ready] = persisted<typeof MiniSkillsSettingsSchema>(
    Persist.global("composer.mini-skills.v2"),
    MiniSkillsSettingsSchema,
    INITIAL_SETTINGS,
  )
  const [ui, setUI] = createStore<MiniSkillUIState>({
    additionalText: "",
    manageOpen: false,
    editorOpen: false,
    draftLabel: "",
    draftIcon: "✨",
    draftInstruction: "",
  })

  const selected = createMemo(() => settings.items.find((item) => item.id === ui.selectedID))
  const draftValid = createMemo(() => !!ui.draftLabel.trim() && !!ui.draftInstruction.trim())

  function addAvailableSkill(skill: { id: string; name: string; description?: string }) {
    props.model.addMention({
      type: "skill",
      id: Skill.ID.make(skill.id),
      name: Skill.Name.make(skill.name),
      content: "@" + skill.id,
      start: 0,
      end: 0,
    })
  }

  function useItem(item: MiniSkillDefinition) {
    const content = [item.instruction.trim(), ui.additionalText.trim()].filter(Boolean).join("\n\n")
    if (!content) return
    const separator = props.model.value().trim() ? "\n\n" : ""
    props.model.addText(separator + content + "\n")
    setUI({ selectedID: undefined, additionalText: "" })
  }

  function beginCreate() {
    setUI({
      selectedID: undefined,
      manageOpen: true,
      editorOpen: true,
      editingID: undefined,
      draftLabel: "",
      draftIcon: "✨",
      draftInstruction: "",
    })
  }

  function beginEdit(item: MiniSkillDefinition) {
    setUI({
      selectedID: undefined,
      manageOpen: true,
      editorOpen: true,
      editingID: item.id,
      draftLabel: item.label,
      draftIcon: item.icon,
      draftInstruction: item.instruction,
    })
  }

  function saveItem() {
    const label = ui.draftLabel.trim()
    const instruction = ui.draftInstruction.trim()
    if (!label || !instruction) return

    const editingID = ui.editingID
    const item: MiniSkillDefinition = {
      id: editingID ?? "mini-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9),
      label,
      icon: ui.draftIcon.trim(),
      instruction,
    }

    setSettings({
      ...settings,
      items: editingID
        ? settings.items.map((current) => (current.id === editingID ? item : current))
        : [...settings.items, item],
    })
    setUI({ editorOpen: false, editingID: undefined, draftLabel: "", draftIcon: "✨", draftInstruction: "" })
  }

  function removeItem(id: string) {
    setSettings({ ...settings, items: settings.items.filter((item) => item.id !== id) })
    if (ui.selectedID === id) setUI({ selectedID: undefined, additionalText: "" })
    if (ui.editingID === id) setUI({ editorOpen: false, editingID: undefined })
  }

  function moveItem(id: string, offset: -1 | 1) {
    const from = settings.items.findIndex((item) => item.id === id)
    const to = from + offset
    if (from < 0 || to < 0 || to >= settings.items.length) return

    const items = [...settings.items]
    const current = items[from]
    const adjacent = items[to]
    if (!current || !adjacent) return
    items[from] = adjacent
    items[to] = current
    setSettings({ ...settings, items })
  }

  const MiniSkillBar = () => (
    <div data-component="composer-mini-skills" class="flex min-w-0 flex-col gap-2">
      <div class="flex min-w-0 flex-wrap items-center gap-1">
        <Show when={settings.items.length === 0 && availableSkills().length === 0}>
          <span class="me-1 text-[12px] leading-4 text-text-faint">{language.t("composer.miniSkills.title")}</span>
        </Show>
        <For each={availableSkills()}>
          {(skill) => (
            <Button
              type="button"
              size="small"
              variant="ghost-muted"
              class="max-w-[220px] gap-1.5"
              title={skill.description ?? skill.name}
              aria-label={skill.name}
              onClick={() => addAvailableSkill(skill)}
            >
              <Icon name="post-skill" size="small" />
              <span class="truncate">{skill.name}</span>
            </Button>
          )}
        </For>
        <For each={settings.items}>
          {(item) => (
            <Button
              type="button"
              size="small"
              variant="ghost-muted"
              class="max-w-[220px] gap-1.5"
              classList={{ "border border-border-base": ui.selectedID === item.id }}
              title={item.label}
              onClick={() =>
                setUI({
                  selectedID: ui.selectedID === item.id ? undefined : item.id,
                  additionalText: "",
                })
              }
            >
              <Show when={item.icon}>
                <span aria-hidden="true">{item.icon}</span>
              </Show>
              <span class="truncate">{item.label}</span>
            </Button>
          )}
        </For>
        <Button
          type="button"
          size="small"
          variant="ghost-muted"
          class="gap-1.5"
          onClick={() => setUI("manageOpen", !ui.manageOpen)}
          aria-label={language.t("composer.miniSkills.manage")}
          title={language.t("composer.miniSkills.manage")}
        >
          <Icon name="sliders-horizontal" size="small" />
        </Button>
        <Button type="button" size="small" variant="ghost-muted" class="gap-1.5" onClick={beginCreate}>
          <Icon name="plus" size="small" />
          <span>{language.t("composer.miniSkills.add")}</span>
        </Button>
      </div>

      <Show when={selected()} keyed>
        {(item) => (
          <section class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-background-base p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2 text-[13px] font-medium text-text-base">
                  <Show when={item.icon}>
                    <span aria-hidden="true">{item.icon}</span>
                  </Show>
                  <span>{item.label}</span>
                </div>
                <p class="mt-1 whitespace-pre-wrap text-[12px] leading-4 text-text-weak">{item.instruction}</p>
              </div>
              <Button
                type="button"
                size="small"
                variant="ghost-muted"
                onClick={() => beginEdit(item)}
                aria-label={language.t("composer.miniSkills.edit")}
                title={language.t("composer.miniSkills.edit")}
              >
                <Icon name="pencil" size="small" />
              </Button>
            </div>
            <label class="text-[12px] font-medium leading-4 text-text-weak">
              {language.t("composer.miniSkills.additionalText")}
            </label>
            <textarea
              class={INPUT_CLASS + " min-h-16 resize-y"}
              rows={2}
              value={ui.additionalText}
              placeholder={language.t("composer.miniSkills.additionalText.placeholder")}
              onInput={(event) => setUI("additionalText", event.currentTarget.value)}
            />
            <div class="flex items-center justify-end gap-2">
              <Button
                type="button"
                size="small"
                variant="ghost-muted"
                onClick={() => setUI({ selectedID: undefined, additionalText: "" })}
              >
                {language.t("composer.miniSkills.close")}
              </Button>
              <Button type="button" size="small" onClick={() => useItem(item)}>
                <Icon name="corner-down-left" size="small" />
                {language.t("composer.miniSkills.insert")}
              </Button>
            </div>
          </section>
        )}
      </Show>

      <Show when={ui.manageOpen}>
        <section class="flex flex-col gap-3 rounded-lg border border-border-weak-base bg-background-base p-3">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-[13px] font-medium leading-4 text-text-base">{language.t("composer.miniSkills.manage")}</h3>
            <Button type="button" size="small" variant="ghost-muted" onClick={beginCreate}>
              <Icon name="plus" size="small" />
              {language.t("composer.miniSkills.add")}
            </Button>
          </div>

          <Show when={settings.items.length === 0}>
            <p class="text-[12px] leading-4 text-text-faint">{language.t("composer.miniSkills.empty")}</p>
          </Show>
          <div class="flex flex-col gap-1">
            <For each={settings.items}>
              {(item, index) => (
                <div class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-background-weak">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 text-[13px] leading-4 text-text-base">
                      <Show when={item.icon}>
                        <span aria-hidden="true">{item.icon}</span>
                      </Show>
                      <span class="truncate">{item.label}</span>
                    </div>
                    <p class="mt-1 line-clamp-2 text-[12px] leading-4 text-text-faint">{item.instruction}</p>
                  </div>
                  <div class="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      disabled={index() === 0}
                      aria-label={language.t("composer.miniSkills.moveUp")}
                      title={language.t("composer.miniSkills.moveUp")}
                      onClick={() => moveItem(item.id, -1)}
                    >
                      <Icon name="chevron-up" size="small" />
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      disabled={index() === settings.items.length - 1}
                      aria-label={language.t("composer.miniSkills.moveDown")}
                      title={language.t("composer.miniSkills.moveDown")}
                      onClick={() => moveItem(item.id, 1)}
                    >
                      <Icon name="chevron-down" size="small" />
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      aria-label={language.t("composer.miniSkills.edit")}
                      title={language.t("composer.miniSkills.edit")}
                      onClick={() => beginEdit(item)}
                    >
                      <Icon name="pencil" size="small" />
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      aria-label={language.t("composer.miniSkills.remove")}
                      title={language.t("composer.miniSkills.remove")}
                      onClick={() => removeItem(item.id)}
                    >
                      <Icon name="trash-2" size="small" />
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>

          <div class="flex flex-col gap-1">
            <label for="composer-mini-skills-placement" class="text-[12px] font-medium leading-4 text-text-weak">
              {language.t("composer.miniSkills.position")}
            </label>
            <select
              id="composer-mini-skills-placement"
              class={INPUT_CLASS + " w-fit"}
              value={settings.placement}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  placement: event.currentTarget.value === "below" ? "below" : "above",
                })
              }
            >
              <option value="above">{language.t("composer.miniSkills.position.above")}</option>
              <option value="below">{language.t("composer.miniSkills.position.below")}</option>
            </select>
          </div>

          <Show when={ui.editorOpen}>
            <form
              class="flex flex-col gap-2 border-t border-border-weak-base pt-3"
              onSubmit={(event) => {
                event.preventDefault()
                saveItem()
              }}
            >
              <label class="flex flex-col gap-1 text-[12px] font-medium leading-4 text-text-weak">
                {language.t("composer.miniSkills.label")}
                <input
                  class={INPUT_CLASS}
                  value={ui.draftLabel}
                  maxLength={64}
                  placeholder={language.t("composer.miniSkills.label.placeholder")}
                  onInput={(event) => setUI("draftLabel", event.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-1 text-[12px] font-medium leading-4 text-text-weak">
                {language.t("composer.miniSkills.icon")}
                <input
                  class={INPUT_CLASS + " max-w-32"}
                  value={ui.draftIcon}
                  maxLength={8}
                  placeholder={language.t("composer.miniSkills.icon.placeholder")}
                  onInput={(event) => setUI("draftIcon", event.currentTarget.value)}
                />
              </label>
              <label class="flex flex-col gap-1 text-[12px] font-medium leading-4 text-text-weak">
                {language.t("composer.miniSkills.instruction")}
                <textarea
                  class={INPUT_CLASS + " min-h-24 resize-y"}
                  rows={4}
                  value={ui.draftInstruction}
                  placeholder={language.t("composer.miniSkills.instruction.placeholder")}
                  onInput={(event) => setUI("draftInstruction", event.currentTarget.value)}
                />
              </label>
              <div class="flex justify-end gap-2">
                <Button
                  type="button"
                  size="small"
                  variant="ghost-muted"
                  onClick={() =>
                    setUI({
                      editorOpen: false,
                      editingID: undefined,
                      draftLabel: "",
                      draftIcon: "✨",
                      draftInstruction: "",
                    })
                  }
                >
                  {language.t("composer.miniSkills.cancel")}
                </Button>
                <Button type="submit" size="small" disabled={!draftValid()}>
                  <Icon name="check" size="small" />
                  {language.t("composer.miniSkills.save")}
                </Button>
              </div>
            </form>
          </Show>
        </section>
      </Show>
    </div>
  )

  return (
    <>
      <Show when={ready() && props.model.state.mode === "normal" && settings.placement === "above"}>
        <MiniSkillBar />
      </Show>
      {props.children}
      <Show when={ready() && props.model.state.mode === "normal" && settings.placement === "below"}>
        <MiniSkillBar />
      </Show>
    </>
  )
}
