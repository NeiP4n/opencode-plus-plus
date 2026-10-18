import { createSignal, type JSX } from "solid-js"
import { useTheme } from "../context/theme"
import { hoverBackground } from "../ui/hover"

type Props = {
  id?: string
  onClick: () => void
  children: JSX.Element
  disabled?: boolean
  flexShrink?: number
  flexGrow?: number
  minWidth?: number
  maxWidth?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  gap?: number
  flexDirection?: "row" | "column"
  justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around"
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

// A clickable action gets a background highlight across its entire hit area, not just
// brighter text. Stop pointer events from reaching parent rows so buttons never trigger
// the row's action as well.
export function HoverAction(props: Props) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)

  return (
    <box
      id={props.id}
      flexShrink={props.flexShrink ?? 0}
      flexGrow={props.flexGrow}
      minWidth={props.minWidth}
      maxWidth={props.maxWidth}
      paddingLeft={props.paddingLeft ?? 0}
      paddingRight={props.paddingRight ?? 0}
      paddingTop={props.paddingTop}
      paddingBottom={props.paddingBottom}
      gap={props.gap}
      flexDirection={props.flexDirection ?? "row"}
      justifyContent={props.justifyContent}
      backgroundColor={hovered() && !props.disabled ? hoverBackground(theme) : undefined}
      onMouseEnter={() => {
        setHovered(true)
        props.onMouseEnter?.()
      }}
      onMouseLeave={() => {
        setHovered(false)
        props.onMouseLeave?.()
      }}
      onMouseDown={(event) => {
        event.stopPropagation()
        if (!props.disabled) props.onClick()
      }}
    >
      {props.children}
    </box>
  )
}
