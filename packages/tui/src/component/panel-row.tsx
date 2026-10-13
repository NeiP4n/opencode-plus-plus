import type { JSX } from "solid-js"
import { useTheme } from "../context/theme"

// One clickable line of the left panel. Hover is shared by the panel so only one
// row lights up at a time, and the selected row marks where the user is.
export function Row(props: {
  id: string
  hover: () => string | undefined
  setHover: (id: string | undefined) => void
  selected?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  const theme = useTheme()
  return (
    <box
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        props.selected
          ? theme.background.action.primary.focused
          : props.hover() === props.id
            ? theme.increase(theme.background.raised.base, 4)
            : undefined
      }
      onMouseOver={() => props.setHover(props.id)}
      onMouseOut={() => props.setHover(undefined)}
      onMouseUp={props.onClick}
    >
      {props.children}
    </box>
  )
}
