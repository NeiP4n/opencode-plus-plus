import { createMemo } from "solid-js"
import { Mode } from "@opencode/schema/mode"
import { useLocal } from "../context/local"
import { useDialog, type DialogContext } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"

// The picker works in two places: the composer (the chat being written) and a session row
// in the roster (a worker the operator wants to retune). A new chat keeps the choice as a
// draft until its session exists.
export function DialogMode(props: { sessionID?: string }) {
  const local = useLocal()
  const dialog = useDialog()

  const current = () => (props.sessionID ? local.mode.currentFor(props.sessionID) : local.mode.current())
  const options = createMemo(() =>
    Mode.builtins.map((mode) => ({
      value: String(mode.id),
      title: mode.name,
      description: [
        mode.description,
        mode.readOnly ? "read-only" : "",
        mode.steps === undefined ? "" : `${mode.steps} steps`,
      ]
        .filter(Boolean)
        .join(" · "),
      onSelect: () => {
        dialog.clear()
        if (props.sessionID) local.mode.setFor(props.sessionID, String(mode.id))
        else local.mode.set(String(mode.id))
      },
    })),
  )

  return <DialogSelect<string> title="Work mode" current={current()} options={options()} flat />
}

DialogMode.show = (dialog: DialogContext, sessionID?: string) =>
  dialog.replace(() => <DialogMode sessionID={sessionID} />)
