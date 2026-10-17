import { TextAttributes, type InputRenderable } from "@opentui/core"
import { createResource, createSignal, For, Show } from "solid-js"
import type { RoomInfo } from "@opencode/client/promise"
import { useConfig } from "../config"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { Button } from "./devtools-registry"
import { Labeled, Section, Setting } from "./settings"

export function DialogRoomRules(props: { roomID: string; onClose?: () => void }) {
  const client = useClient()
  const theme = useTheme().surface("dialog")
  const config = useConfig().data
  const toast = useToast()
  const t = useT()
  const [rooms, { refetch }] = createResource(() => client.api.room.list())
  const [busy, setBusy] = createSignal(false)
  const blockedField: { current?: InputRenderable } = {}
  const instructionField: { current?: InputRenderable } = {}

  const room = () => rooms.latest?.data?.find((item) => item.id === props.roomID) as RoomInfo | undefined
  const rules = () => ({
    protectSecrets: room()?.rules?.protectSecrets ?? true,
    hidePaths: room()?.rules?.hidePaths ?? true,
    blockDangerousCommands: room()?.rules?.blockDangerousCommands ?? true,
    blockedCommands: room()?.rules?.blockedCommands ?? [],
    instructions: room()?.rules?.instructions ?? "",
  })

  const save = async (patch: Partial<ReturnType<typeof rules>>) => {
    const current = rules()
    setBusy(true)
    try {
      await client.api.room.update({ roomID: props.roomID, rules: { ...current, ...patch } })
      await refetch()
      toast.show({ message: t("Multiplayer rules saved"), variant: "success" })
    } catch (error) {
      toast.show({ message: errorMessage(error), variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  const saveFields = () => {
    const blockedCommands = (blockedField.current?.value ?? "")
      .split(/[,;\n]/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50)
    const instructions = (instructionField.current?.value ?? "").trim().slice(0, 4000)
    void save({ blockedCommands, instructions })
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <Section title={t("Multiplayer rules")} />
      <Show when={room()} fallback={<text fg={theme.text.muted}>{t("Room not found")}</text>}>
        <text fg={theme.text.muted} wrapMode="word">
          {t("These rules belong to this room. AI instructions are mandatory context; security-sensitive rules are enforced by the host before remote commands run.")}
        </text>
        <Setting label={t("Protect private data")} help={t("Require the AI not to disclose credentials, tokens, private keys, .env contents or other secrets.")}>
          <Button disabled={busy()} onClick={() => void save({ protectSecrets: !rules().protectSecrets })}>
            {rules().protectSecrets ? t("Enabled") : t("Disabled")}
          </Button>
        </Setting>
        <Setting label={t("Hide host paths")} help={t("Guests see /project instead of the real project path, and ~ instead of the host home directory.")}>
          <Button disabled={busy()} onClick={() => void save({ hidePaths: !rules().hidePaths })}>
            {rules().hidePaths ? t("Enabled") : t("Disabled")}
          </Button>
        </Setting>
        <Setting label={t("Block dangerous commands")} help={t("Reject common privilege-escalation, destructive and system-modifying commands, including for Trusted members.")}>
          <Button disabled={busy()} onClick={() => void save({ blockDangerousCommands: !rules().blockDangerousCommands })}>
            {rules().blockDangerousCommands ? t("Enabled") : t("Disabled")}
          </Button>
        </Setting>
        <Setting label={t("Blocked commands")} help={t("Comma-separated command fragments. A matching remote command is rejected before it reaches the host shell.")}>
          <input
            width={54}
            cursorStyle={config.cursor}
            ref={(element: InputRenderable) => {
              blockedField.current = element
              element.value = rules().blockedCommands.join(", ")
            }}
            onMouseDown={() => blockedField.current?.focus()}
            placeholder={t("e.g. git push --force, curl, wget")}
            placeholderColor={theme.text.muted}
            textColor={theme.text.formfield.base}
            focusedTextColor={theme.text.formfield.focused}
            cursorColor={theme.text.formfield.focused}
            backgroundColor={theme.background.formfield.base}
            focusedBackgroundColor={theme.background.formfield.focused}
            onSubmit={saveFields}
          />
          <Button disabled={busy()} onClick={saveFields}>{t("Save")}</Button>
        </Setting>
        <Setting label={t("Mandatory AI instructions")} help={t("Extra requirements appended to every guest-submitted AI task. They do not replace server-side security checks.")}>
          <input
            width={54}
            cursorStyle={config.cursor}
            ref={(element: InputRenderable) => {
              instructionField.current = element
              element.value = rules().instructions
            }}
            onMouseDown={() => instructionField.current?.focus()}
            placeholder={t("e.g. Never reveal internal notes or credentials")}
            placeholderColor={theme.text.muted}
            textColor={theme.text.formfield.base}
            focusedTextColor={theme.text.formfield.focused}
            cursorColor={theme.text.formfield.focused}
            backgroundColor={theme.background.formfield.base}
            focusedBackgroundColor={theme.background.formfield.focused}
            onSubmit={saveFields}
          />
          <Button disabled={busy()} onClick={saveFields}>{t("Save")}</Button>
        </Setting>
        <text fg={theme.text.muted} wrapMode="word">
          {t("Recommended defaults: all three protections enabled. Trusted changes who may use approved room capabilities; it does not override these rules.")}
        </text>
      </Show>
    </box>
  )
}
