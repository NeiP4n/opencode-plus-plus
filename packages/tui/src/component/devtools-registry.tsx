import { TextAttributes, type InputRenderable } from "@opentui/core"
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { Hub } from "@opencode/core/hub/index"
import { HubState } from "@opencode/core/hub/state"
import { McpCatalog } from "@opencode/core/mcp/catalog"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { useT } from "../util/i18n"
import { hubRegistryStatus, type RegistryOptions, type RegistryTool } from "../util/hub-registry"

// Interactive catalog control for the Universal Tool Hub, opened from the
// devtools bar as a centered dialog. Every row is one binary the catalog
// depends on, and the operator installs or removes it. What is installed is
// there for the model; which installed program each team role may use is chosen
// per role in the team editor, not here.
//
// Removal runs a package manager, so it takes two activations of the same
// button ("Remove" arms, "Remove?" executes); moving elsewhere disarms it.
// While an action is pending the controls are disabled, the outcome goes
// through a toast, and a failure pins the exact command to rerun by hand to
// the note line.

const PAGE_SIZE = 12
const TOOL_COLUMN = 16

export type RegistryPanelOptions = RegistryOptions & {
  // `hub.json` directory; tests point this at a temp dir instead of the Global
  // state directory so a click never edits the operator's real selection.
  directory?: string
  // Package-manager actions; tests replace them so no command ever runs.
  install?: (tool: string) => Promise<Hub.ActionResult>
  remove?: (tool: string) => Promise<Hub.ActionResult>
  update?: () => Promise<Hub.ActionResult>
}

export function RegistryPanel(props: {
  options?: RegistryPanelOptions
  onClose?: () => void
  // Makes the chosen terminal the shell tool's shell too, where that shell can be permission-checked.
  onShell?: (shell: string) => void
  // AI tools (MCP servers) from the catalog: which are configured, and installing or removing one.
  aiTools?: AiToolsAccess
}) {
  const theme = useTheme().surface("dialog")
  const t = useT()
  const toast = useToast()
  const options = props.options ?? {}
  const install = options.install ?? Hub.HubActions.installTool
  const remove = options.remove ?? Hub.HubActions.removeTool
  // Bumped after anything that can change PATH or the state file, so the
  // memo re-probes instead of trusting a stale readiness count.
  const [revision, setRevision] = createSignal(0)
  const [busy, setBusy] = createSignal<string>()
  const [armed, setArmed] = createSignal<string>()
  const [message, setMessage] = createSignal<string>()
  const [page, setPage] = createSignal(0)
  const [cursor, setCursor] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [terminal, setTerminal] = createSignal<Hub.Backend>()
  const [stale, setStale] = createSignal(false)
  const config = useConfig().data

  // A click that lands before the state file resolves is the operator's newest
  // intent, so the slow read must not overwrite it.
  let terminalInteracted = false
  let terminalSequence = 0
  onMount(async () => {
    const state = await HubState.read({ directory: options.directory })
    if (!terminalInteracted) setTerminal(state.terminal)
    setRevision((value) => value + 1)
  })

  const status = createMemo(() => {
    revision()
    // Only the registry inputs travel on: `directory` and the injected actions
    // belong to this panel, not to the status probe.
    return hubRegistryStatus({
      probe: options.probe,
      terminalProbe: options.terminalProbe,
      platform: options.platform,
      manager: options.manager,
    })
  })
  // Every word of the query must appear in the tool's name or in the id, title,
  // description or category of a catalog entry that needs it, so "yaml" or
  // "docker logs" finds the binary behind the recipe.
  const visible = createMemo(() => {
    const words = query()
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 0)
    if (words.length === 0) return status().tools
    return status().tools.filter((row) => {
      const text = (haystack.get(row.tool) ?? row.tool).toLowerCase()
      return words.every((word) => text.includes(word))
    })
  })
  const pages = createMemo(() => Math.max(1, Math.ceil(visible().length / PAGE_SIZE)))
  const current = createMemo(() => Math.min(page(), pages() - 1))
  const rows = createMemo(() => visible().slice(current() * PAGE_SIZE, current() * PAGE_SIZE + PAGE_SIZE))
  const selected = () => rows()[Math.min(cursor(), rows().length - 1)]
  const missing = createMemo(() => status().tools.filter((row) => !row.installed && row.manageable))
  // Without a choice the hub prefers nu, then pwsh, then bash, whichever is installed.
  const aiTerminal = () => {
    const chosen = terminal()
    if (chosen && status().terminals.some((item) => item.name === chosen && item.present)) return chosen
    return (["nu", "pwsh", "bash"] as const).find((name) =>
      status().terminals.some((item) => item.name === name && item.present),
    )
  }

  const chooseTerminal = (name: Hub.Backend) => {
    terminalInteracted = true
    const intent = ++terminalSequence
    setTerminal(name)
    void HubState.setTerminal(name, { directory: options.directory }).catch(async (error: unknown) => {
      if (terminalSequence === intent) {
        const durable = await HubState.read({ directory: options.directory })
        setTerminal(durable.terminal)
      }
      toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" })
    })
    props.onShell?.(name)
  }

  const runAction = async (
    tool: string,
    verb: "installed" | "removed" | "updated",
    action: (tool: string) => Promise<Hub.ActionResult>,
  ) => {
    setBusy(tool)
    setMessage()
    const result = await action(tool).catch((error: unknown) => ({
      ok: false,
      exit: 1,
      output: error instanceof Error ? error.message : String(error),
      command: "",
    }))
    // A mirror 404 means the databases are stale; only a system update fixes the next install.
    setStale(!result.ok && Hub.HubActions.staleDatabase(result.output))
    // The note pins the command to rerun by hand, while the toast says why it failed.
    const reason = Hub.HubActions.failureReason(result.output)
    setMessage(result.ok ? `${tool} ${verb}` : `${tool}: ${result.command || reason}`)
    toast.show({
      message: result.ok ? `${tool} ${verb}` : `${tool} failed: ${reason}`,
      variant: result.ok ? "success" : "error",
    })
    setBusy()
    setRevision((value) => value + 1)
    return result.ok
  }

  const onInstall = (tool: string) => {
    setArmed()
    if (busy() !== undefined) return
    void runAction(tool, "installed", install)
  }

  const onRemove = (tool: string) => {
    if (busy() !== undefined) return
    // The first activation only arms the destructive action; the second runs it.
    if (armed() !== tool) {
      setArmed(tool)
      return
    }
    setArmed()
    void runAction(tool, "removed", remove)
  }

  // Installs one tool at a time so a failure names the tool that caused it and
  // stops there instead of burying it under the rest of the batch.
  const onInstallMissing = async () => {
    setArmed()
    if (busy() !== undefined) return
    for (const row of missing()) {
      if (!(await runAction(row.tool, "installed", install))) return
    }
  }

  const move = (delta: number) => {
    setArmed()
    setCursor((value) => Math.max(0, Math.min(rows().length - 1, value + delta)))
  }
  const turn = (delta: number) => {
    setArmed()
    setPage((value) => Math.max(0, Math.min(pages() - 1, value + delta)))
    setCursor(0)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "up", title: "Previous tool", group: "Registry", run: () => move(-1) },
      { bind: "down", title: "Next tool", group: "Registry", run: () => move(1) },
      { bind: "left", title: "Previous page", group: "Registry", run: () => turn(-1) },
      { bind: "right", title: "Next page", group: "Registry", run: () => turn(1) },
      {
        bind: "return",
        title: "Install or remove tool",
        group: "Registry",
        run: () => {
          const row = selected()
          if (!row || !row.manageable) return
          if (row.installed) return onRemove(row.tool)
          onInstall(row.tool)
        },
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          {t("Registry")}
        </text>
        <text fg={theme.text.muted} onMouseUp={() => props.onClose?.()}>
          esc
        </text>
      </box>

      <Show when={props.aiTools}>{(ai) => <AiTools tools={ai()} />}</Show>

      <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
        {t("Programs")}
      </text>
      <box flexDirection="row" gap={3}>
        <Stat label={t("Ready")} value={`${status().ready}/${status().total}`} />
        <Stat label={t("Installed")} value={`${status().installed.length}/${status().tools.length}`} />
      </box>

      <box flexDirection="row" gap={1}>
        <text fg={theme.text.muted}>{t("AI terminal")}</text>
        <For each={status().terminals}>
          {(item) => (
            <Switch>
              <Match when={item.present}>
                <Button
                  variant={aiTerminal() === item.name ? "primary" : "secondary"}
                  disabled={busy() !== undefined}
                  onClick={() => chooseTerminal(item.name)}
                >
                  {`${aiTerminal() === item.name ? "●" : "○"} ${item.name}`}
                </Button>
              </Match>
              <Match when={busy() === item.name}>
                <text fg={theme.text.muted}>{`${item.name} …`}</text>
              </Match>
              <Match when={item.installable}>
                <Button disabled={busy() !== undefined} onClick={() => onInstall(item.name)}>
                  {t("Install {name}", { name: item.name })}
                </Button>
              </Match>
              <Match when={true}>
                <text fg={theme.text.muted}>{`${item.name}: ${t(item.manual ?? "no installer here")}`}</text>
              </Match>
            </Switch>
          )}
        </For>
      </box>
      <Show when={aiTerminal() === "nu"}>
        <text fg={theme.text.muted} wrapMode="word">
          {t(
            "The AI's shell commands and hub commands run in nu. Nushell has no grammar the permission check understands, so each nu command is approved as a whole; each command shows the shell that ran it.",
          )}
        </text>
      </Show>

      <text fg={theme.text.muted} wrapMode="word">
        {status()
          .categories.map((entry) => `${entry.name} ${entry.ready}/${entry.total}`)
          .join("  ")}
      </text>

      <box flexDirection="row" gap={1}>
        <text fg={theme.text.muted} flexShrink={0}>
          {t("Search")}
        </text>
        <input
          flexGrow={1}
          flexShrink={1}
          minWidth={0}
          onInput={(value) => {
            setQuery(value)
            setPage(0)
            setCursor(0)
            setArmed()
          }}
          focusedBackgroundColor={theme.background.formfield.focused}
          cursorColor={theme.text.formfield.focused}
          cursorStyle={config.cursor}
          focusedTextColor={theme.text.formfield.focused}
          placeholder={t("tool, category or task: yaml, ports, docker logs")}
          placeholderColor={theme.text.muted}
          ref={(input: InputRenderable) => {
            setTimeout(() => {
              if (!input.isDestroyed) input.focus()
            }, 1)
          }}
        />
        <text fg={theme.text.muted} flexShrink={0}>{`${visible().length}/${status().tools.length}`}</text>
        <Button onClick={() => turn(-1)}>‹</Button>
        <text fg={theme.text.muted} flexShrink={0}>{`${current() + 1}/${pages()}`}</text>
        <Button onClick={() => turn(1)}>›</Button>
      </box>

      <box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button
          variant="primary"
          disabled={busy() !== undefined || missing().length === 0}
          onClick={() => void onInstallMissing()}
        >
          {t("Install missing ({count})", { count: missing().length })}
        </Button>
      </box>
      <text fg={theme.text.muted} wrapMode="word">
        {t("Installed programs are available to every session. Choose which ones each role may use in Teams → role → Registry programs.")}
      </text>

      <box>
        <For each={rows()}>
          {(row, index) => (
            <ToolRow
              tool={row}
              active={index() === cursor()}
              pending={busy() !== undefined}
              working={busy() === row.tool}
              armed={armed() === row.tool}
              onHover={() => setCursor(index())}
              onInstall={() => onInstall(row.tool)}
              onRemove={() => onRemove(row.tool)}
              onDisarm={() => setArmed()}
            />
          )}
        </For>
        <Show when={rows().length === 0}>
          <text fg={theme.text.muted}>
            {query() ? t('Nothing matches "{query}".', { query: query() }) : t("No catalog tools on this platform.")}
          </text>
        </Show>
      </box>

      <Show when={stale()}>
        <text fg={theme.text.feedback.warning.base} wrapMode="word">
          {t("The package databases are outdated, so installs fail. Update the system, then install again.")}
        </text>
        <box flexDirection="row">
          <Button
            variant="primary"
            disabled={busy() !== undefined}
            onClick={() => void runAction("system", "updated", () => (options.update ?? Hub.HubActions.updateSystem)())}
          >
            {t("Update system")}
          </Button>
        </box>
      </Show>
      <Show when={message()}>
        {(text) => (
          <text fg={theme.text.muted} wrapMode="word">
            {text()}
          </text>
        )}
      </Show>
      <text fg={theme.text.muted}>
        {t("↑↓ select · enter install/remove · ←→ page · esc close")}
      </text>
    </box>
  )
}

// Searchable text per tool: its name plus every catalog entry that requires it.
const haystack = Hub.all.reduce((map, entry) => {
  const text = `${entry.id} ${entry.title} ${entry.description} ${entry.category}`
  for (const tool of entry.requires ?? []) map.set(tool, `${map.get(tool) ?? tool} ${text}`)
  return map
}, new Map<string, string>())

export type AiToolsAccess = {
  installed: () => readonly string[]
  set: (id: string, config: McpCatalog.Entry["config"] | null) => Promise<unknown>
}

// Catalog MCP servers the operator installs for the AI. Installing writes the server into the
// global config, which connects it; every session is then told how to use it.
function AiTools(props: { tools: AiToolsAccess }) {
  const theme = useTheme().surface("dialog")
  const t = useT()
  const toast = useToast()
  const [busy, setBusy] = createSignal<string>()
  // Optimistic until the server list catches up with the config change.
  const [local, setLocal] = createSignal<Record<string, boolean>>({})
  const entries = McpCatalog.forPlatform()
  const runtimes = new Map(
    [...new Set(entries.flatMap((entry) => (entry.runtime ? [entry.runtime] : [])))].map((runtime) => [
      runtime,
      Hub.HubHost.has(runtime),
    ]),
  )
  const isInstalled = (id: string) => local()[id] ?? props.tools.installed().includes(id)
  const change = async (entry: McpCatalog.Entry, install: boolean) => {
    if (busy() !== undefined) return
    setBusy(entry.id)
    await props.tools
      .set(entry.id, install ? entry.config : null)
      .then(() => {
        setLocal((current) => ({ ...current, [entry.id]: install }))
        toast.show({ message: `${entry.name}: ${install ? t("installed") : t("removed")}`, variant: "success" })
      })
      .catch((error: unknown) =>
        toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" }),
      )
    setBusy()
  }
  return (
    <box gap={0}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          {t("AI tools")}
        </text>
        <text fg={theme.text.muted}>{`${entries.filter((entry) => isInstalled(entry.id)).length}/${entries.length}`}</text>
      </box>
      <For each={entries}>
        {(entry) => (
          <box flexDirection="row" gap={1}>
            <box width={TOOL_COLUMN + 4} flexShrink={0}>
              <text fg={isInstalled(entry.id) ? theme.text.base : theme.text.muted} wrapMode="none" truncate>
                {entry.name}
              </text>
            </box>
            <box flexGrow={1} flexShrink={1} minWidth={0}>
              <text fg={theme.text.muted} wrapMode="none" truncate>
                {t(entry.description)}
              </text>
            </box>
            <Switch>
              <Match when={busy() === entry.id}>
                <text fg={theme.text.muted}>…</text>
              </Match>
              <Match when={isInstalled(entry.id)}>
                <Button disabled={busy() !== undefined} onClick={() => void change(entry, false)}>
                  {t("Remove")}
                </Button>
              </Match>
              <Match when={entry.runtime && !runtimes.get(entry.runtime)}>
                <text fg={theme.text.feedback.warning.base}>
                  {t("needs {runtime}", { runtime: entry.runtime === "uvx" ? "uv" : "Node.js" })}
                </text>
              </Match>
              <Match when={true}>
                <Button disabled={busy() !== undefined} onClick={() => void change(entry, true)}>
                  {t("Install")}
                </Button>
              </Match>
            </Switch>
          </box>
        )}
      </For>
    </box>
  )
}

function Stat(props: { label: string; value: string }) {
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row" gap={1}>
      <text fg={theme.text.muted}>{props.label}</text>
      <text fg={theme.text.base}>{props.value}</text>
    </box>
  )
}

function ToolRow(props: {
  tool: RegistryTool
  active: boolean
  pending: boolean
  working: boolean
  armed: boolean
  onHover: () => void
  onInstall: () => void
  onRemove: () => void
  onDisarm: () => void
}) {
  const t = useT()
  const theme = useTheme().surface("dialog")
  return (
    <box
      flexDirection="row"
      gap={1}
      backgroundColor={props.active ? theme.background.action.primary.focused : undefined}
      onMouseOver={props.onHover}
    >
      <box width={TOOL_COLUMN}>
        <text fg={props.tool.installed ? theme.text.base : theme.text.muted} wrapMode="none" truncate>
          {props.tool.tool}
        </text>
      </box>
      <box width={11}>
        <text fg={theme.text.muted}>{t(props.tool.entries === 1 ? "{count} entry" : "{count} entries", { count: props.tool.entries })}</text>
      </box>
      <text fg={props.tool.installed ? theme.text.feedback.success.base : theme.text.feedback.warning.base}>
        {props.tool.installed ? t("installed") : t("missing")}
      </text>
      <box flexGrow={1} />
      <Show when={props.working}>
        <text fg={theme.text.muted}>…</text>
      </Show>
      <Show when={!props.working && props.tool.installed && props.tool.manageable}>
        <Button disabled={props.pending} onLeave={props.onDisarm} onClick={props.onRemove}>
          {props.armed ? t("Remove?") : t("Remove")}
        </Button>
      </Show>
      <Show when={!props.working && props.tool.installed && !props.tool.manageable}>
        <text fg={theme.text.muted}>{t("installed (manual)")}</text>
      </Show>
      <Show when={!props.working && !props.tool.installed && props.tool.manageable}>
        <Button disabled={props.pending} onClick={props.onInstall}>
          {t("Install")}
        </Button>
      </Show>
      <Show when={!props.working && !props.tool.installed && !props.tool.manageable}>
        <text fg={theme.text.muted}>{t("no installer here")}</text>
      </Show>
    </box>
  )
}

// Primary is a filled chip for the main action of a section. Secondary keeps the
// theme's transparent background, so brackets mark it as clickable.
export function Button(props: {
  children: string
  onClick: () => void
  disabled?: boolean
  onLeave?: () => void
  variant?: "primary" | "secondary"
}) {
  const theme = useTheme().surface("dialog")
  const [hovered, setHovered] = createSignal(false)
  const primary = () => props.variant === "primary"
  const state = () => (props.disabled ? "disabled" : hovered() ? "hovered" : primary() ? "focused" : "base")
  return (
    <box
      flexShrink={0}
      paddingLeft={primary() ? 1 : 0}
      paddingRight={primary() ? 1 : 0}
      backgroundColor={
        props.disabled
          ? undefined
          : primary()
            ? theme.background.action.primary[hovered() ? "hovered" : "focused"]
            : hovered()
              ? theme.background.action.primary.hovered
              : undefined
      }
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => {
        setHovered(false)
        props.onLeave?.()
      }}
      onMouseUp={(event) => {
        event.stopPropagation()
        if (!props.disabled) props.onClick()
      }}
    >
      <text fg={theme.text.action.primary[state()]} wrapMode="none">{primary() ? props.children : `[ ${props.children} ]`}</text>
    </box>
  )
}
