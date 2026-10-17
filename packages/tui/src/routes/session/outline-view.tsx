import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Keymap } from "../../context/keymap"
import { useT } from "../../util/i18n"
import type { PartRef } from "./grouping/session"
import type { OutlineCategory } from "./outline"

type Line = {
  key: string
  category: string
  label: string
  level: 0 | 1
  ref: PartRef
}

/**
 * The chat's table of contents as a thin rail on the right edge of the transcript: one dash
 * per topic and section. Hovering opens the titles and marks the one under the pointer;
 * Enter, Space or a click scrolls the chat there.
 */
export function OutlineRail(props: {
  categories: readonly OutlineCategory[]
  active: { category?: string; entry?: string }
  /** Shown beside the header, e.g. while the topics are being renamed. */
  status?: string
  height: number
  maxWidth: number
  right: number
  onJump: (ref: PartRef) => void
}) {
  const theme = useTheme()
  const t = useT()
  const [open, setOpen] = createSignal(false)
  const [hovered, setHovered] = createSignal<string>()
  const lines = createMemo(() =>
    props.categories.flatMap((category, index): Line[] => [
      {
        key: category.key,
        category: category.key,
        label: `${index + 1}. ${category.title}`,
        level: 0,
        ref: category.ref,
      },
      ...category.entries.map((entry) => ({
        key: entry.key,
        category: category.key,
        label: `· ${entry.title}`,
        level: 1 as const,
        ref: entry.ref,
      })),
    ]),
  )
  const isActive = (line: Line) =>
    line.level === 0 ? line.category === props.active.category : line.key === props.active.entry
  // The rail keeps one row per line; when that does not fit, it drops sections, then
  // shows the topics around the current one.
  const rail = createMemo(() => {
    const height = Math.max(1, props.height)
    if (lines().length <= height) return lines()
    const categories = lines().filter((line) => line.level === 0)
    if (categories.length <= height) return categories
    const current = Math.max(
      0,
      categories.findIndex((line) => line.category === props.active.category),
    )
    const start = Math.min(Math.max(0, current - Math.floor(height / 2)), categories.length - height)
    return categories.slice(start, start + height)
  })
  // The list shows as many lines as fit under the header and scrolls the rest.
  const visibleRows = () => Math.max(1, Math.min(lines().length, props.height - 1))
  const width = () => Math.max(16, Math.min(props.maxWidth, 48))
  // Moving between rows sends "out" before the next "over", so closing waits a moment
  // instead of unmounting the list under the pointer.
  let closing: ReturnType<typeof setTimeout> | undefined
  const close = () => {
    clearTimeout(closing)
    closing = undefined
    setOpen(false)
    setHovered(undefined)
  }
  const show = () => {
    clearTimeout(closing)
    closing = undefined
    setOpen(true)
  }
  onCleanup(() => clearTimeout(closing))
  const jump = (line: Line) => {
    props.onJump(line.ref)
    close()
  }
  // Takes Enter and Space from the prompt only while a title is marked.
  Keymap.createLayer(() => ({
    priority: 20,
    enabled: () => open() && hovered() !== undefined,
    commands: [
      {
        bind: "return,space",
        title: "Go to the marked topic",
        group: "Session",
        run: () => {
          const line = lines().find((item) => item.key === hovered())
          if (line) jump(line)
        },
      },
    ],
  }))
  const color = (line: Line) => {
    if (hovered() === line.key) return theme.text.action.primary.hovered
    if (isActive(line)) return theme.text.action.primary.base
    return line.level === 0 ? theme.text.base : theme.text.muted
  }

  return (
    <box
      id="session-outline"
      position="absolute"
      top={0}
      right={props.right}
      zIndex={20}
      flexDirection="column"
      onMouseOver={show}
      onMouseOut={() => {
        clearTimeout(closing)
        closing = setTimeout(close, 250)
      }}
      onMouseDown={show}
    >
      <Show
        when={open()}
        fallback={
          <box flexDirection="column" width={2} alignItems="flex-end">
            <For each={rail()}>
              {(line) => (
                <text fg={color(line)} wrapMode="none">
                  {line.level === 0 ? (isActive(line) ? "━━" : "──") : " ─"}
                </text>
              )}
            </For>
          </box>
        }
      >
        <box
          width={width()}
          height={visibleRows() + 1}
          flexDirection="column"
          backgroundColor={theme.background.raised.base}
          border={["left"]}
          borderColor={theme.border.base}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.text.muted} wrapMode="none" truncate flexShrink={0}>
            {[t("Chat outline"), props.status ?? (hovered() ? t("enter or space to go") : "")]
              .filter(Boolean)
              .join(" · ")}
          </text>
          <scrollbox
            height={visibleRows()}
            flexShrink={0}
            verticalScrollbarOptions={{ visible: lines().length > visibleRows() }}
            horizontalScrollbarOptions={{ visible: false }}
          >
            <For each={lines()}>
              {(line) => (
                <box
                  flexDirection="row"
                  height={1}
                  flexShrink={0}
                  backgroundColor={hovered() === line.key ? theme.background.action.primary.hovered : undefined}
                  onMouseOver={() => setHovered(line.key)}
                  onMouseDown={(event) => {
                    event.stopPropagation()
                    jump(line)
                  }}
                >
                  <text fg={theme.text.action.primary.hovered} wrapMode="none" flexShrink={0}>
                    {hovered() === line.key ? "› " : "  "}
                  </text>
                  <text fg={color(line)} wrapMode="none" truncate paddingLeft={line.level * 3}>
                    {line.label}
                  </text>
                </box>
              )}
            </For>
          </scrollbox>
        </box>
      </Show>
    </box>
  )
}
