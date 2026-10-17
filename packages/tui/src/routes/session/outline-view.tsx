import { createMemo, createSignal, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useT } from "../../util/i18n"
import type { PartRef } from "./grouping/session"
import type { OutlineCategory } from "./outline"

type Line = {
  key: string
  category: string
  title: string
  level: 0 | 1 | 2
  ref: PartRef
  busy: boolean
}

/**
 * The transcript's outline as a thin rail on the right edge of the chat: one dash per
 * request and its steps. Hovering opens the titles; clicking one scrolls the chat there.
 */
export function OutlineRail(props: {
  categories: readonly OutlineCategory[]
  active: { category?: string; entry?: string }
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
    props.categories.flatMap((category): Line[] => [
      { key: category.key, category: category.key, title: category.title, level: 0, ref: category.ref, busy: false },
      ...category.entries.map((entry) => ({
        key: entry.key,
        category: category.key,
        title: entry.title,
        level: entry.level,
        ref: entry.ref,
        busy: entry.busy,
      })),
    ]),
  )
  const isActive = (line: Line) =>
    line.level === 0 ? line.category === props.active.category : line.key === props.active.entry
  // The rail keeps one row per line; when that does not fit, it drops steps, then
  // shows the requests around the current one.
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
  // Each request after the first is set off by a blank row.
  const rows = () => lines().length + Math.max(0, props.categories.length - 1)
  const width = () => Math.max(16, Math.min(props.maxWidth, 48))
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
      onMouseOver={() => setOpen(true)}
      onMouseOut={() => {
        setOpen(false)
        setHovered(undefined)
      }}
    >
      <Show
        when={open()}
        fallback={
          <box flexDirection="column" width={2} alignItems="flex-end">
            <For each={rail()}>
              {(line) => (
                <text fg={color(line)} wrapMode="none">
                  {line.level === 0 ? (isActive(line) ? "━━" : "──") : line.level === 1 ? " ─" : " ·"}
                </text>
              )}
            </For>
          </box>
        }
      >
        <box
          width={width()}
          flexDirection="column"
          backgroundColor={theme.background.raised.base}
          border={["left"]}
          borderColor={theme.border.base}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.text.muted} wrapMode="none">
            {t("Chat outline")}
          </text>
          <scrollbox
            height={Math.min(rows(), Math.max(2, props.height - 1))}
            verticalScrollbarOptions={{ visible: rows() > props.height - 1 }}
            horizontalScrollbarOptions={{ visible: false }}
          >
            <For each={lines()}>
              {(line) => (
                <box
                  flexDirection="row"
                  paddingLeft={line.level * 2}
                  paddingTop={line.level === 0 && line.key !== lines()[0]?.key ? 1 : 0}
                  onMouseOver={() => setHovered(line.key)}
                  onMouseUp={() => {
                    props.onJump(line.ref)
                    setOpen(false)
                    setHovered(undefined)
                  }}
                >
                  <text fg={color(line)} wrapMode="none" truncate>
                    {`${isActive(line) ? "▸ " : ""}${line.title}${line.busy ? " …" : ""}`}
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
