import type { Plugin } from "@opencode/plugin/tui"
import type { ConfigCompatibilityFound, ConfigCompatibilityReport } from "@opencode/client"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, onMount } from "solid-js"
import { DialogCompat, type CompatApi } from "../../../component/dialog-compat"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const root = "/Users/kit/code/shop"

const ecosystems: readonly ConfigCompatibilityFound[] = [
  {
    id: "agents",
    label: "Agents",
    enabled: true,
    decidedBy: "default",
    trusted: false,
    folders: [],
    markers: [],
  },
  {
    id: "claude",
    label: "Claude Code",
    enabled: true,
    decidedBy: "default",
    trusted: false,
    folders: [
      { path: "/Users/kit/.claude", scope: "global" },
      { path: `${root}/.claude`, scope: "project" },
    ],
    markers: [`${root}/CLAUDE.md`, `${root}/.mcp.json`],
    loaded: { instructions: 1, commands: 4, agents: 2, mcp: 0, rules: 1, hooks: 0 },
    skipped: [
      { source: `${root}/.claude/settings.json`, reason: "PreToolUse hook needs trust" },
      { source: `${root}/.mcp.json`, reason: "MCP server github needs trust" },
      { source: `${root}/.claude/settings.json`, reason: "env has no OpenCode equivalent yet" },
    ],
    awaitingTrust: 2,
  },
  {
    id: "codex",
    label: "Codex",
    enabled: true,
    decidedBy: "default",
    trusted: false,
    folders: [{ path: `${root}/.codex`, scope: "project" }],
    markers: [],
  },
  { id: "gemini", label: "Gemini CLI", enabled: true, decidedBy: "default", trusted: false, folders: [], markers: [] },
  { id: "cursor", label: "Cursor", enabled: true, decidedBy: "default", trusted: false, folders: [], markers: [] },
]

const initial: ConfigCompatibilityReport = {
  root,
  enabled: true,
  order: ["agents", "claude", "codex", "gemini", "cursor"],
  ecosystems: [...ecosystems],
}

function CompatStory(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  const theme = props.context.theme
  const [report, setReport] = createSignal(initial)
  const [message, setMessage] = createSignal("Fixture only: nothing is written to the server")

  // Mirrors the server's rules closely enough to explore every state locally.
  const apply = (next: ConfigCompatibilityReport, note: string) => {
    setReport(next)
    setMessage(note)
    return Promise.resolve(next)
  }
  const api: CompatApi = {
    get: () => Promise.resolve(report()),
    update: (id, change) =>
      apply(
        {
          ...report(),
          ecosystems: report().ecosystems.map((item) => {
            if (item.id !== id) return item
            const enabled = change.enabled === null ? report().enabled : (change.enabled ?? item.enabled)
            const trusted = change.trusted ?? item.trusted
            return {
              ...item,
              enabled,
              trusted,
              decidedBy: change.enabled === undefined ? item.decidedBy : change.enabled === null ? "default" : "project",
              ...(item.loaded && change.trusted !== undefined
                ? {
                    loaded: { ...item.loaded, mcp: trusted ? 1 : 0, hooks: trusted ? 1 : 0 },
                    awaitingTrust: trusted ? 0 : 2,
                  }
                : {}),
            }
          }),
        },
        `${id}: ${JSON.stringify(change)}`,
      ),
    setAll: (enabled) =>
      apply(
        {
          ...report(),
          enabled,
          ecosystems: report().ecosystems.map((item) =>
            item.decidedBy === "project" ? item : { ...item, enabled, decidedBy: enabled ? "default" : "config" },
          ),
        },
        `all tools ${enabled ? "on" : "off"}`,
      ),
  }

  const open = () => props.context.ui.dialog.show(() => <DialogCompat report={report()} api={api} />)
  onMount(open)

  props.context.keymap.layer(() => ({
    commands: [
      { bind: "o", title: "Open the dialog", group: "Storybook", run: open },
      {
        bind: "r",
        title: "Reset the fixture",
        group: "Storybook",
        run: () => {
          setReport(initial)
          setMessage("Fixture reset")
        },
      },
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
    ],
  }))

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background.raised.base}>
      <box flexGrow={1} />
      <StoryFooter
        context={props.context}
        title="Other agent tools"
        details={["Claude Code awaits trust", "Codex found", "fixture"]}
        message={message()}
        controls={[
          { shortcut: "o", label: "open dialog" },
          { shortcut: "r", label: "reset fixture" },
          { shortcut: "esc", label: "storybook" },
        ]}
      />
    </box>
  )
}

export const compatStory: Story = {
  id: "compat",
  title: "Other agent tools",
  render: (context) => <CompatStory context={context} />,
}
