import type { JsonValue } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, onCleanup } from "solid-js"
import { useT } from "../../util/i18n"
import { Locale } from "../../util/locale"
import { stringWidth } from "../../util/string-width"
import { dialogWidth } from "../../ui/dialog"

// Mirrors the core contract in `@opencode/core/plugin/provider/freebuff-rpc`.
const RPC_ID = "opencode.freebuff"

/**
 * The price table needs more room than a medium dialog gives: the catalog
 * name, the price, the warning marker and the gateway model id have to sit on
 * one line each. A large dialog fills an 80 column terminal (78 columns wide)
 * and keeps 86 columns in a 120 column terminal, so the table still fits
 * everywhere a terminal is usable.
 */
const STATUS_DIALOG_SIZE = "large" as const

/** Pads to a display width, so columns of any script stay aligned. */
function padTo(text: string, width: number) {
  const missing = width - stringWidth(text)
  return missing > 0 ? text + " ".repeat(missing) : text
}

interface FreebuffModelPrice {
  /** Catalog row key. */
  readonly key: string
  /** Marketing name from the catalog. */
  readonly name: string
  /** Freebucks a session on this model costs; absent when the price is unknown. */
  readonly price?: number
  /** Gateway model id the price belongs to. */
  readonly modelID?: string
  /** `open` rows run on the current plan, `locked` rows need a paid plan. */
  readonly access?: string
}

interface FreebuffStatus {
  readonly loggedIn: boolean
  readonly balance?: number
  readonly spent?: number
  readonly limit?: number
  /** Milliseconds until the daily freebucks reset. */
  readonly resetIn?: number
  /** Milliseconds until the active session expires. */
  readonly sessionEndsIn?: number
  readonly tier?: string
  /** Price per catalog row, so the dialog can show what a session costs. */
  readonly prices?: ReadonlyArray<FreebuffModelPrice>
}

interface FreebuffAccount {
  readonly id: string
  readonly label: string
  readonly active: boolean
}

// The transport wraps every result in `{ output }`; returning the bare output keeps
// the dialogs from reading `undefined` off a successful call.
async function call<Output>(context: Plugin.Context, method: string, input: JsonValue): Promise<Output> {
  const result = await context.client.rpc.call({ rpcID: RPC_ID, method, input })
  return result.output as Output
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1_000))
  const minutes = Math.floor(total / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const seconds = total % 60
  if (days >= 1) return `${days}d ${hours % 24}h`
  if (hours >= 1) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
  if (minutes >= 1) return `${minutes}m ${String(seconds).padStart(2, "0")}s`
  return `${seconds}s`
}

/** Shown while the browser login is pending; polls until the new account appears. */
function AddAccountDialog(props: {
  context: Plugin.Context
  url: string
  before: number
  onDone: () => void
  onCancel: () => void
}) {
  props.context.keymap.layer(() => ({
    commands: [{ bind: "escape", title: "cancel", run: props.onCancel }],
  }))
  const timer = setInterval(() => {
    void call<{ accounts?: FreebuffAccount[] }>(props.context, "accounts", {})
      .then((result) => {
        const accounts = result?.accounts
        if (accounts && accounts.length > props.before) {
          clearInterval(timer)
          props.context.ui.toast.show({ message: "Freebuff: account connected", variant: "success" })
          props.onDone()
        }
      })
      .catch(() => undefined)
  }, 2_000)
  onCleanup(() => clearInterval(timer))
  const theme = props.context.theme
  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg={theme.text.base}>Sign in to Freebuff in your browser:</text>
      <text fg={theme.text.feedback.info.base}>{props.url}</text>
      <text fg={theme.text.muted}>Waiting for authorization… press Esc to cancel.</text>
    </box>
  )
}

/**
 * Status is plain text, so it cannot go through the select dialog: that component hides
 * options it cannot activate and would render its "No items available" fallback instead.
 */
function StatusDialog(props: {
  context: Plugin.Context
  status: FreebuffStatus
  onAccounts: () => void
  onAdd: () => void
  onRefresh: () => void
}) {
  const theme = props.context.theme
  const t = useT()
  const dimensions = useTerminalDimensions()
  const base = Date.now()
  const [now, setNow] = createSignal(base)
  const timer = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(timer))
  props.context.keymap.layer(() => ({
    commands: [
      { bind: "c", title: "Accounts", run: props.onAccounts },
      { bind: "a", title: "Add account", run: props.onAdd },
      { bind: "r", title: "Refresh", run: props.onRefresh },
      { bind: "escape", title: "Close", run: () => props.context.ui.dialog.clear() },
    ],
  }))
  const remaining = (ms: number) => formatCountdown(ms - (now() - base))
  const rows = () => {
    const status = props.status
    if (!status.loggedIn) return [{ label: t("Status"), value: t("not logged in — press a to sign in") }]
    return [
      { label: t("Balance"), value: `${status.balance ?? "?"} ${t("freebucks")}` },
      ...(status.spent !== undefined && status.limit !== undefined
        ? [{ label: t("Today"), value: `${status.spent}/${status.limit}` }]
        : []),
      ...(status.resetIn !== undefined
        ? [{ label: t("Daily reset"), value: `${t("in")} ${remaining(status.resetIn)}` }]
        : []),
      ...(status.sessionEndsIn !== undefined
        ? [{ label: t("Session"), value: `${t("ends in")} ${remaining(status.sessionEndsIn)}` }]
        : []),
      ...(status.tier !== undefined ? [{ label: t("Tier"), value: status.tier }] : []),
    ]
  }
  // The label column is as wide as the widest label plus one space, so the
  // value never touches the label ("Сброс за сутки" is wider than 13 columns).
  const labelWidth = () => rows().reduce((max, row) => Math.max(max, stringWidth(row.label)), 0) + 1
  // The price table is the account's own: what a session on each model costs in
  // freebucks. A row the price table does not cover says so instead of guessing.
  const priceRows = () =>
    (props.status.prices ?? []).map((entry) => ({
      entry,
      short:
        entry.price !== undefined &&
        props.status.balance !== undefined &&
        entry.price > props.status.balance,
    }))
  const priceLabel = (entry: FreebuffModelPrice) =>
    entry.price === undefined ? t("Price unknown") : `${entry.price} ${t("freebucks")}`
  // The width the table may use: the dialog box minus the padding around it.
  const innerWidth = () => Math.min(dialogWidth(STATUS_DIALOG_SIZE), dimensions().width - 2) - 2
  /**
   * Column widths of the price table. Every column is padded to its own width
   * and the row is a single line of text, so the columns cannot overlap and no
   * cell wraps into the row below. The gateway model id gives up room first
   * and disappears when nothing is left for it; the name and the price are the
   * last to be cut.
   */
  const priceLayout = createMemo(() => {
    const entries = priceRows()
    const warnWidth = entries.some((row) => row.short) ? stringWidth(`· ${t("not enough")}`) : 0
    const paidWidth = entries.some((row) => row.entry.access === "locked")
      ? stringWidth(`· ${t("paid plan")}`)
      : 0
    const nameWidth = entries.reduce((max, row) => Math.max(max, stringWidth(row.entry.name)), 0)
    const priceWidth = entries.reduce((max, row) => Math.max(max, stringWidth(priceLabel(row.entry))), 0)
    const modelWidth = entries.reduce((max, row) => Math.max(max, stringWidth(row.entry.modelID ?? "")), 0)
    // One space separates the name from the price, the price from the marker
    // and the marker from the model id.
    const fixed = priceWidth + warnWidth + paidWidth
    const fixedColumns = 1 + (warnWidth > 0 ? 1 : 0) + (paidWidth > 0 ? 1 : 0)
    const nameBudget = Math.max(0, innerWidth() - fixed - fixedColumns - 1)
    const name = Math.min(nameWidth, nameBudget)
    const modelSpace = nameBudget - name
    const model = modelSpace > 0 ? Math.min(modelWidth, modelSpace) : 0
    const last = model > 0 ? "model" : paidWidth > 0 ? "paid" : warnWidth > 0 ? "warn" : "price"
    return { name, price: priceWidth, warn: warnWidth, paid: paidWidth, model, last }
  })
  // The dialog opens a quarter down the terminal (that is the dialog's own
  // padding), so the price list only gets what is left of the screen and the
  // rest of it scrolls. The chrome is everything around the list: the dialog
  // padding, the title, the gaps, the prices title, the footer and the padding
  // around the content, which is nine rows besides the status rows.
  const priceListHeight = createMemo(() => {
    const chrome = Math.floor(dimensions().height / 4) + 9 + rows().length
    return Math.max(1, Math.min(priceRows().length, dimensions().height - chrome))
  })
  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg={theme.text.base}>Freebuff</text>
      <box flexDirection="column">
        {rows().map((row) => (
          <text wrapMode="none" truncate>
            <span style={{ fg: theme.text.muted }}>{padTo(row.label, labelWidth())}</span>
            <span style={{ fg: theme.text.base }}>{row.value}</span>
          </text>
        ))}
      </box>
      <box flexDirection="column">
        <text fg={theme.text.base}>{t("Prices")}</text>
        {priceRows().length > 0 ? (
          <scrollbox height={priceListHeight()} scrollbarOptions={{ visible: false }}>
            <box flexDirection="column">
              {priceRows().map((row) => {
                const layout = priceLayout()
                const gap = (column: "name" | "price" | "warn" | "paid" | "model") =>
                  layout.last === column || layout[column] === 0 ? "" : " "
                return (
                  <text wrapMode="none" truncate>
                    <span style={{ fg: theme.text.base }}>
                      {padTo(Locale.truncateWidth(row.entry.name, layout.name), layout.name)}
                      {gap("name")}
                    </span>
                    <span style={{ fg: theme.text.base }}>
                      {padTo(Locale.truncateWidth(priceLabel(row.entry), layout.price), layout.price)}
                      {gap("price")}
                    </span>
                    <span style={{ fg: theme.text.feedback.warning.base }}>
                      {padTo(row.short ? `· ${t("not enough")}` : "", layout.warn)}
                      {gap("warn")}
                    </span>
                    <span style={{ fg: theme.text.muted }}>
                      {padTo(row.entry.access === "locked" ? `· ${t("paid plan")}` : "", layout.paid)}
                      {gap("paid")}
                    </span>
                    <span style={{ fg: theme.text.muted }}>
                      {Locale.truncateWidth(row.entry.modelID ?? "", layout.model)}
                    </span>
                  </text>
                )
              })}
            </box>
          </scrollbox>
        ) : undefined}
      </box>
      <text fg={theme.text.muted}>{t("c accounts · a add account · r refresh · esc close")}</text>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.freebuff",
  setup(context) {
    const request = <Output,>(method: string, input: JsonValue) => call<Output>(context, method, input)

    // Starts a login for one more account and waits until the settlement lands.
    const addAccount = async () => {
      const before = (await request<{ accounts: FreebuffAccount[] }>("accounts", {}).catch(() => undefined))?.accounts
        .length
      const url = await request<{ url?: string }>("add", {})
        .then((attempt) => attempt?.url)
        .catch(() => undefined)
      if (!url) {
        context.ui.toast.show({ message: "Freebuff: could not start the login", variant: "error" })
        return
      }
      await new Promise<void>((resolve) => {
        const finish = () => {
          context.ui.dialog.clear()
          resolve()
        }
        context.ui.dialog.show(
          () => <AddAccountDialog context={context} url={url} before={before ?? 0} onDone={finish} onCancel={finish} />,
          () => resolve(),
        )
      })
    }

    const openAccounts = async () => {
      const list = await request<{ accounts: FreebuffAccount[] }>("accounts", {}).catch(() => undefined)
      if (!list) {
        context.ui.toast.show({ message: "Freebuff: accounts are unavailable", variant: "error" })
        return
      }
      if (list.accounts.length === 0) {
        context.ui.toast.show({ message: "Freebuff: no accounts connected yet", variant: "info" })
        await addAccount()
        return
      }
      const selected = await context.ui.dialog.select<string>({
        title: "Freebuff accounts",
        placeholder: "Search accounts",
        current: list.accounts.find((account) => account.active)?.id,
        options: list.accounts.map((account) => ({
          title: account.label,
          value: account.id,
          description: account.active ? "active" : undefined,
          footer: account.active ? "active" : "enter to switch",
        })),
        actions: [
          {
            bind: "a",
            title: "Add account",
            selection: "none",
            onTrigger: () => {
              context.ui.dialog.clear()
              void addAccount()
            },
          },
          {
            bind: "r",
            title: "Refresh",
            selection: "none",
            onTrigger: () => {
              context.ui.dialog.clear()
              void openAccounts()
            },
          },
        ],
      })
      if (selected === undefined) return
      const result = await request<{ ok: boolean }>("use", { id: selected }).catch(() => undefined)
      const label = list.accounts.find((account) => account.id === selected)?.label ?? selected
      context.ui.toast.show(
        result?.ok
          ? { message: `Freebuff: switched to ${label}`, variant: "success" }
          : { message: "Freebuff: switch failed", variant: "error" },
      )
    }

    const openStatus = async () => {
      const status = await request<FreebuffStatus>("status", {}).catch(() => undefined)
      if (!status) {
        context.ui.toast.show({ message: "Freebuff: status is unavailable", variant: "error" })
        return
      }
      const close = () => context.ui.dialog.clear()
      // Showing a fresh dialog on refresh re-captures the baseline, so the countdown restarts from the new server value.
      context.ui.dialog.show(() => (
        <StatusDialog
          context={context}
          status={status}
          onAccounts={() => {
            close()
            void openAccounts()
          }}
          onAdd={() => {
            close()
            void addAccount()
          }}
          onRefresh={() => {
            close()
            void openStatus()
          }}
        />
      ))
      // The price table does not fit a medium dialog, so the status dialog
      // opens wider. `show` resets the size, hence the call after it.
      context.ui.dialog.set({ size: STATUS_DIALOG_SIZE })
    }

    // /freebuff-use [email|#] — switch by argument, or open the picker without one.
    const useAccount = async (input?: string) => {
      const query = input?.trim()
      if (!query) return openAccounts()
      const list = await request<{ accounts: FreebuffAccount[] }>("accounts", {}).catch(() => undefined)
      if (!list) {
        context.ui.toast.show({ message: "Freebuff: accounts are unavailable", variant: "error" })
        return
      }
      const index = Number(query)
      const needle = query.toLowerCase()
      const match =
        Number.isInteger(index) && index >= 1 && index <= list.accounts.length
          ? list.accounts[index - 1]
          : list.accounts.find(
              (account) =>
                account.id === query ||
                account.label.toLowerCase() === needle ||
                account.label.toLowerCase().includes(needle),
            )
      if (!match) {
        context.ui.toast.show({ message: `Freebuff: no account matching "${query}"`, variant: "warning" })
        return
      }
      const result = await request<{ ok: boolean }>("use", { id: match.id }).catch(() => undefined)
      context.ui.toast.show(
        result?.ok
          ? { message: `Freebuff: switched to ${match.label}`, variant: "success" }
          : { message: "Freebuff: switch failed", variant: "error" },
      )
    }

    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "freebuff.status",
              title: "Freebuff balance and timers",
              group: "Freebuff",
              slash: { name: "freebuff" },
              palette: true,
              run() {
                void openStatus()
              },
            },
            {
              id: "freebuff.accounts",
              title: "Freebuff accounts",
              group: "Freebuff",
              slash: { name: "freebuff-accounts" },
              palette: true,
              run() {
                void openAccounts()
              },
            },
            {
              id: "freebuff.add",
              title: "Connect another Freebuff account",
              group: "Freebuff",
              slash: { name: "freebuff-add" },
              palette: true,
              run() {
                void addAccount()
              },
            },
            {
              id: "freebuff.use",
              title: "Switch the active Freebuff account",
              group: "Freebuff",
              slash: { name: "freebuff-use", arguments: true },
              palette: true,
              run(input) {
                void useAccount(input)
              },
            },
          ],
        }))
        return null
      },
    })
  },
})
