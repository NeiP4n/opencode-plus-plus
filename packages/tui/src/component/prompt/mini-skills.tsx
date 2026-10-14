import { MouseEvent, TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { readFile, mkdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { Keymap } from "../../context/keymap"
import { useTuiPaths } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useToast } from "../../ui/toast"
import { useConfig } from "../../config"
import { stringWidth } from "../../util/string-width"

export type MiniSkill = {
  id: string
  label: string
  icon: string
  instruction: string
}

const DEFAULT_MINI_SKILLS: MiniSkill[] = [
  {
    id: "analyze",
    label: "Analyze",
    icon: "◎",
    instruction: "Analyze the request and relevant code carefully. Identify the root cause, constraints, and risks before making changes.",
  },
  {
    id: "plan",
    label: "Plan",
    icon: "≡",
    instruction: "First inspect the repository and create a concise implementation plan with concrete steps and validation. Then carry it out.",
  },
  {
    id: "debug",
    label: "Debug",
    icon: "⌕",
    instruction: "Investigate the root cause before changing code. Reproduce the issue when possible, trace the relevant paths, then fix and verify it.",
  },
  {
    id: "review",
    label: "Review",
    icon: "✓",
    instruction: "Review the relevant changes for correctness, regressions, edge cases, security, and maintainability. Fix any confirmed problems.",
  },
  {
    id: "test",
    label: "Test",
    icon: "T",
    instruction: "Identify the relevant test coverage, run the most targeted tests first, add regression tests where appropriate, and report the actual results.",
  },
  {
    id: "explain",
    label: "Explain",
    icon: "?",
    instruction: "Explain the relevant implementation in clear, practical language. Trace how the pieces interact and distinguish verified facts from assumptions.",
  },
]

type ManagerEntry = { kind: "skill"; skill: MiniSkill } | { kind: "add" }
type SkillAction = "insert" | "edit" | "remove" | "up" | "down"

function normalizeSkills(value: unknown): MiniSkill[] | undefined {
  if (!Array.isArray(value)) return
  const result: MiniSkill[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const candidate = item as Record<string, unknown>
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.label !== "string" ||
      typeof candidate.instruction !== "string"
    ) continue
    const label = candidate.label.trim()
    const instruction = candidate.instruction.trim()
    if (!label || !instruction) continue
    result.push({
      id: candidate.id,
      label: label.slice(0, 48),
      icon: typeof candidate.icon === "string" && candidate.icon.trim() ? candidate.icon.slice(0, 4) : "✦",
      instruction,
    })
  }
  return result
}

async function persistMiniSkills(filePath: string, skills: MiniSkill[]) {
  const directory = path.dirname(filePath)
  await mkdir(directory, { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify({ version: 1, items: skills }, null, 2) + "\n", "utf8")
  await rename(temporary, filePath)
}

function moveSkill(items: MiniSkill[], id: string, delta: number) {
  const index = items.findIndex((item) => item.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function PromptMiniSkills(props: {
  mode: () => "normal" | "shell"
  visible?: boolean
  onInsert: (instruction: string) => void
}) {
  const paths = useTuiPaths()
  const theme = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const filePath = path.join(paths.state, "mini-skills.json")
  const [skills, setSkills] = createSignal<MiniSkill[]>(DEFAULT_MINI_SKILLS.map((item) => ({ ...item })))
  const [loaded, setLoaded] = createSignal(false)
  let writes: Promise<void> = Promise.resolve()

  async function save(next: MiniSkill[]) {
    const previous = skills()
    setSkills(next)
    const task = writes.catch(() => undefined).then(() => persistMiniSkills(filePath, next))
    writes = task
    try {
      await task
    } catch (error) {
      setSkills(previous)
      toast.error(error)
      throw error
    }
  }

  onMount(() => {
    void (async () => {
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as { items?: unknown }
        const restored = normalizeSkills(parsed?.items)
        if (!restored) throw new Error("Invalid mini-skills settings")
        setSkills(restored)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          try {
            await save(skills())
          } catch {
            // The defaults remain usable for this run even if persistence fails.
          }
        } else {
          toast.show({
            title: "Mini-skills settings",
            message: "Could not read saved mini-skills; using defaults.",
            variant: "warning",
          })
        }
      } finally {
        setLoaded(true)
      }
    })()
  })

  function insert(skill: MiniSkill) {
    props.onInsert(skill.instruction)
    toast.show({ message: `Inserted mini skill: ${skill.label}`, variant: "info", duration: 1800 })
  }

  const visibleSkills = createMemo(() => {
    const max = dimensions().width < 64 ? 3 : dimensions().width < 84 ? 4 : skills().length
    return skills().slice(0, max)
  })

  return (
    <Show when={loaded() && props.visible !== false && props.mode() === "normal"}>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={3}
        paddingBottom={1}
        height={2}
        width="100%"
      >
        <For each={visibleSkills()}>
          {(skill) => (
            <box
              height={1}
              width={stringWidth(`${skill.icon} ${skill.label}`) + 2}
              flexBasis={stringWidth(`${skill.icon} ${skill.label}`) + 2}
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme.background.raised.base}
              onMouseUp={(event: MouseEvent) => {
                if (event.button !== 0) return
                event.stopPropagation()
                if (props.mode() !== "normal") return
                insert(skill)
              }}
            >
              <text fg={theme.text.base} wrapMode="none" truncate>
                {skill.icon} {skill.label}
              </text>
            </box>
          )}
        </For>
        <Show when={skills().length > visibleSkills().length}>
          <box
            height={1}
            width={5}
            flexBasis={5}
            flexShrink={0}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.background.raised.base}
            onMouseUp={(event: MouseEvent) => {
              if (event.button !== 0) return
              event.stopPropagation()
              dialog.replace(() => <MiniSkillsManager skills={skills} save={save} insert={insert} />)
            }}
          >
            <text fg={theme.text.muted} wrapMode="none" truncate>+{skills().length - visibleSkills().length}</text>
          </box>
        </Show>
        <box
          height={1}
          width={10}
          flexBasis={10}
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.background.raised.base}
          onMouseUp={(event: MouseEvent) => {
            if (event.button !== 0) return
            event.stopPropagation()
            dialog.replace(() => <MiniSkillsManager skills={skills} save={save} insert={insert} />)
          }}
        >
          <text fg={theme.text.muted} wrapMode="none" truncate>⚙ Skills</text>
        </box>
      </box>
    </Show>
  )
}

function MiniSkillsManager(props: {
  skills: () => MiniSkill[]
  save: (skills: MiniSkill[]) => Promise<void>
  insert: (skill: MiniSkill) => void
}) {
  const dialog = useDialog()
  const options = createMemo<DialogSelectOption<ManagerEntry>[]>(() => [
    ...props.skills().map((skill) => ({
      title: `${skill.icon} ${skill.label}`,
      description: skill.instruction,
      value: { kind: "skill", skill } as ManagerEntry,
    })),
    {
      title: "+ Add mini skill",
      description: "Create a custom button with its own prompt text",
      value: { kind: "add" },
    },
  ])

  function edit(skill?: MiniSkill) {
    dialog.replace(() => (
      <MiniSkillEditor
        skill={skill}
        onCancel={() => dialog.replace(() => <MiniSkillsManager {...props} />)}
        onSave={async (updated) => {
          const current = props.skills()
          const next = skill
            ? current.map((item) => (item.id === skill.id ? updated : item))
            : [...current, updated]
          try {
            await props.save(next)
            dialog.replace(() => <MiniSkillsManager {...props} />)
          } catch {
            // Keep the editor open so the user can retry.
          }
        }}
      />
    ))
  }

  function actions(skill: MiniSkill) {
    const options: DialogSelectOption<SkillAction>[] = [
      { title: "Insert instruction", description: "Add this text to the current prompt", value: "insert" },
      { title: "Edit", description: "Change the button name or prompt text", value: "edit" },
      { title: "Remove", description: "Delete this button from the mini-skills bar", value: "remove" },
      { title: "Move up", value: "up" },
      { title: "Move down", value: "down" },
    ]
    dialog.replace(() => (
      <DialogSelect
        title={skill.label}
        options={options}
        onSelect={(option) => {
          const items = props.skills()
          if (option.value === "insert") {
            props.insert(skill)
            dialog.clear()
            return
          }
          if (option.value === "edit") {
            edit(skill)
            return
          }
          if (option.value === "remove") {
            void props.save(items.filter((item) => item.id !== skill.id))
              .then(() => dialog.replace(() => <MiniSkillsManager {...props} />))
              .catch(() => {})
            return
          }
          void props.save(moveSkill(items, skill.id, option.value === "up" ? -1 : 1))
            .then(() => dialog.replace(() => <MiniSkillsManager {...props} />))
            .catch(() => {})
        }}
      />
    ))
  }

  return (
    <DialogSelect
      title="Mini skills"
      options={options()}
      onSelect={(option) => {
        if (option.value.kind === "add") {
          edit()
          return
        }
        actions(option.value.skill)
      }}
      onCancel={() => dialog.clear()}
      emptyView={<text>No mini skills yet. Select “+ Add mini skill” to create one.</text>}
    />
  )
}

function MiniSkillEditor(props: {
  skill?: MiniSkill
  onSave: (skill: MiniSkill) => void | Promise<void>
  onCancel: () => void
}) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const config = useConfig().data
  let labelInput: TextareaRenderable
  let instructionInput: TextareaRenderable

  function save() {
    const label = labelInput.plainText.trim()
    const instruction = instructionInput.plainText.trim()
    if (!label || !instruction) {
      toast.show({ message: "Enter both a button name and prompt text.", variant: "warning" })
      return
    }
    void props.onSave({
      id: props.skill?.id ?? `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      label: label.slice(0, 48),
      icon: props.skill?.icon ?? "✦",
      instruction,
    })
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    priority: 2,
    commands: [
      {
        bind: "ctrl+s",
        title: "Save mini skill",
        group: "Mini skills",
        run: save,
      },
      {
        bind: "escape",
        title: "Back to mini skills",
        group: "Mini skills",
        run: props.onCancel,
      },
      {
        bind: "tab",
        title: "Focus prompt text",
        group: "Mini skills",
        run: () => {
          instructionInput?.focus()
        },
      },
      {
        bind: "shift+tab",
        title: "Focus button name",
        group: "Mini skills",
        run: () => {
          labelInput?.focus()
        },
      },
    ],
  }))

  onMount(() => {
    setTimeout(() => {
      if (!labelInput || labelInput.isDestroyed) return
      labelInput.focus()
    }, 1)
    dialog.setSize("large")
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text fg={theme.text.base}>{props.skill ? "Edit mini skill" : "New mini skill"}</text>
      <text fg={theme.text.muted}>Button name</text>
      <textarea
        height={1}
        wrapMode="none"
        initialValue={props.skill?.label ?? ""}
        placeholder="e.g. Analyze API"
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.base}
        cursorColor={theme.text.base}
        cursorStyle={config.cursor}
        ref={(value: TextareaRenderable) => {
          labelInput = value
        }}
      />
      <text fg={theme.text.muted}>Instruction to insert into the prompt</text>
      <textarea
        height={8}
        maxHeight={10}
        initialValue={props.skill?.instruction ?? ""}
        placeholder="Write the full instruction here. New lines are supported."
        placeholderColor={theme.text.muted}
        textColor={theme.text.formfield.base}
        focusedTextColor={theme.text.formfield.base}
        cursorColor={theme.text.base}
        cursorStyle={config.cursor}
        ref={(value: TextareaRenderable) => {
          instructionInput = value
        }}
      />
      <box flexDirection="row" gap={2}>
        <text fg={theme.text.base}>Ctrl+S <span style={{ fg: theme.text.muted }}>save</span></text>
        <text fg={theme.text.muted}>Tab / Shift+Tab switch fields</text>
        <text
          fg={theme.text.muted}
          onMouseUp={(event: MouseEvent) => {
            if (event.button !== 0) return
            event.stopPropagation()
            props.onCancel()
          }}
        >
          Esc cancel
        </text>
      </box>
    </box>
  )
}

