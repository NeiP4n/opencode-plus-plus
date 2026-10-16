import { createMemo, createSignal, Show } from "solid-js"
import type { ConfigCompatibilityFound, ConfigCompatibilityReport } from "@opencode/client"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import { DialogSelect } from "../ui/dialog-select"
import { DialogConfirm } from "../ui/dialog-confirm"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useT } from "../util/i18n"

const MASTER = "__all__"

type Change = { enabled?: boolean | null; trusted?: boolean }

/** Where the dialog reads and writes; stories pass a local fixture instead of the server. */
export interface CompatApi {
  readonly get: () => Promise<ConfigCompatibilityReport>
  readonly update: (ecosystem: ConfigCompatibilityFound["id"], change: Change) => Promise<ConfigCompatibilityReport>
  /** Writes the master switch to the global config and returns the report once it applies. */
  readonly setAll: (enabled: boolean) => Promise<ConfigCompatibilityReport>
}

/**
 * Other agent tools' folders (.claude, .codex, .gemini, ...) found for this location: turn each on or off
 * for the project, trust it to run hooks and MCP servers, or switch all of them off everywhere.
 */
export function DialogCompat(props: { report?: ConfigCompatibilityReport; api?: CompatApi } = {}) {
  const client = useClient()
  const data = useData()
  const location = useLocation()
  const dialog = useDialog()
  const toast = useToast()
  const t = useT()
  const theme = useTheme().surface("dialog")
  const directory = () => (location.ref ?? data.location.default()).directory
  const [report, setReport] = createSignal(props.report)
  const [busy, setBusy] = createSignal(false)
  const [focused, setFocused] = createSignal<string>(MASTER)
  const [detail, setDetail] = createSignal<ConfigCompatibilityFound>()

  const api: CompatApi = props.api ?? {
    get: () => client.api.config.compatibility.get({ location: { directory: directory() } }),
    update: (ecosystem, change) =>
      client.api.config.compatibility.update({ location: { directory: directory() }, ecosystem, ...change }),
    // The master switch lives in the global config; the server reloads it shortly after the write.
    setAll: (enabled) =>
      client.api.config
        .update({ compatibilityEnabled: enabled ? null : false })
        .then(() => new Promise((resolve) => setTimeout(resolve, 300)))
        .then(() => client.api.config.compatibility.get({ location: { directory: directory() } })),
  }
  if (!props.report) void api.get().then(setReport).catch(toast.error)

  const run = (call: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(true)
    void call()
      .catch(toast.error)
      .finally(() => setBusy(false))
  }
  const change = (ecosystem: ConfigCompatibilityFound["id"], patch: Change) =>
    run(() => api.update(ecosystem, patch).then(setReport))
  const toggleAll = () => run(() => api.setAll(report()?.enabled === false).then(setReport))

  const ecosystems = createMemo(() => {
    const list = report()?.ecosystems ?? []
    return [...list.filter(present), ...list.filter((item) => !present(item))]
  })

  const options = createMemo(() => {
    const current = report()
    if (!current) return []
    return [
      {
        value: MASTER,
        title: t("All other agent tools"),
        description: t("Read .claude, .codex, .gemini and other folders"),
        category: t("Everywhere"),
        footer: current.enabled ? t("on") : t("off"),
        footerColor: current.enabled ? theme.text.formfield.selected : theme.text.muted,
      },
      ...ecosystems().map((item) => ({
        value: item.id,
        title: item.label,
        description: summary(item, t),
        category: present(item) ? t("Found for this project") : t("Not found"),
        footer: [
          item.enabled ? t("on") : t("off"),
          item.decidedBy === "project" ? t("(this project)") : undefined,
          item.trusted ? t("trusted") : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        footerColor: item.enabled ? theme.text.formfield.selected : theme.text.muted,
      })),
    ]
  })

  const focusedItem = createMemo(() => ecosystems().find((item) => item.id === focused()))

  const trust = (item: ConfigCompatibilityFound) => {
    if (item.trusted) return change(item.id, { trusted: false })
    const current = report()
    dialog.replace(() => (
      <DialogConfirm
        title={t("Trust {name} in this project?", { name: item.label })}
        message={t(
          "Its project settings may run commands on this computer: hooks, MCP servers, shell output in commands, and allow rules. Only trust repositories you know.",
        )}
        label={{ confirm: t("Trust"), cancel: t("Cancel") }}
        // The confirm dialog clears the stack after its callback, so reopen on the next tick.
        onConfirm={() =>
          queueMicrotask(() => {
            dialog.replace(() => <DialogCompat report={current} api={props.api} />)
            void api
              .update(item.id, { trusted: true })
              .then((next) => dialog.replace(() => <DialogCompat report={next} api={props.api} />))
              .catch(toast.error)
          })
        }
        onCancel={() => queueMicrotask(() => dialog.replace(() => <DialogCompat report={current} api={props.api} />))}
      />
    ))
  }

  return (
    <box>
      <Show
        when={detail()}
        fallback={
          <DialogSelect
            title={t("Other agent tools")}
            options={options()}
            preserveSelection
            locked={busy()}
            emptyView={<text fg={theme.text.muted}>{t("Looking for other agent tools…")}</text>}
            onMove={(option) => setFocused(option.value as string)}
            onSelect={(option) => {
              const item = ecosystems().find((entry) => entry.id === option.value)
              if (item) setDetail(item)
              if (option.value === MASTER) toggleAll()
            }}
            actions={[
              {
                title: t("on / off"),
                command: "dialog.compat.toggle",
                onTrigger: (option) => {
                  if (option.value === MASTER) return toggleAll()
                  const item = ecosystems().find((entry) => entry.id === option.value)
                  if (item) change(item.id, { enabled: !item.enabled })
                },
              },
              {
                title: focusedItem()?.trusted ? t("untrust") : t("trust"),
                command: "dialog.compat.trust",
                disabled: (option) => option?.value === MASTER,
                onTrigger: (option) => {
                  const item = ecosystems().find((entry) => entry.id === option.value)
                  if (item) trust(item)
                },
              },
              {
                title: t("reset"),
                command: "dialog.compat.reset",
                disabled: (option) => {
                  const item = ecosystems().find((entry) => entry.id === option?.value)
                  return item?.decidedBy !== "project"
                },
                onTrigger: (option) => {
                  const item = ecosystems().find((entry) => entry.id === option.value)
                  if (item) change(item.id, { enabled: null })
                },
              },
            ]}
            footer={
              <Show when={(focusedItem()?.awaitingTrust ?? 0) > 0 && !focusedItem()?.trusted}>
                <text fg={theme.text.feedback.warning.base}>
                  {t("{count} item(s) wait for trust — enter for details", {
                    count: focusedItem()?.awaitingTrust ?? 0,
                  })}
                </text>
              </Show>
            }
          />
        }
      >
        {(item) => (
          <DialogSelect
            title={item().label}
            options={[
              ...item().folders.map((folder) => ({
                value: folder.path,
                title: folder.path,
                category: t("Folders"),
                footer: folder.scope === "global" ? t("home") : t("project"),
              })),
              ...item().markers.map((marker) => ({ value: marker, title: marker, category: t("Files") })),
              ...(item().skipped ?? []).map((skip, index) => ({
                value: `skip-${index}`,
                title: skip.reason,
                description: skip.source,
                category: t("Not loaded"),
              })),
            ]}
            emptyView={<text fg={theme.text.muted}>{t("Nothing of it was found here.")}</text>}
            onCancel={() => setDetail(undefined)}
            onSelect={() => setDetail(undefined)}
          />
        )}
      </Show>
    </box>
  )
}

function present(item: ConfigCompatibilityFound) {
  return item.folders.length > 0 || item.markers.length > 0
}

function summary(item: ConfigCompatibilityFound, t: ReturnType<typeof useT>) {
  if (!present(item)) return t("not found")
  const loaded = item.loaded
  if (!loaded) return t("{count} folder(s)", { count: item.folders.length + item.markers.length })
  const parts = (
    [
      ["instructions", loaded.instructions],
      ["commands", loaded.commands],
      ["agents", loaded.agents],
      ["MCP", loaded.mcp],
      ["rules", loaded.rules],
      ["hooks", loaded.hooks],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${t(kind)}`)
  return parts.length ? parts.join(", ") : t("nothing loaded")
}
