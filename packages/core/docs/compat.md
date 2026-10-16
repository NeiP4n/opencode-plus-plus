# core/compat — other agent tools' folders: detection, choice, trust and the tool table

## What's In This Folder

- `ecosystem.ts` — the registry of ecosystems OpenCode can read: `agents`, `claude`, `codex`, `gemini`, `cursor`. Each has a folder name, home folders and marker files (`CLAUDE.md`, `GEMINI.md`, `.cursorrules`, ...).
- `store.ts` — the user's per-project choices and trust, kept outside every repository in `<state>/compatibility.json`.
- `detect.ts` — reports every ecosystem found for a location, whether it is on, who decided, and what of it exists.
- `tools.ts` — maps foreign tool names and permission rules (`Bash(npm run *)`, `Read(./src/**)`, `mcp__srv__tool`) onto OpenCode tools, actions and resources.
- `claude/` — the Claude Code adapter: CLAUDE.md memory with `@` imports, commands, subagents, MCP servers, settings (permissions, default mode, model) and command hooks. Plugins, output styles, `env` and `prompt`/`agent` hooks are not read yet; they show up as skipped.
- `claude/hooks/` — Claude hooks: `config.ts` flattens the settings `hooks` section, `run.ts` runs one command, `tools.ts` speaks Claude's tool names and input fields, `plugin.ts` wires them to OpenCode's hook points and events.
- Other ecosystems have no adapter yet; only their `skills` folders merge.

## Key Files

- `packages/core/src/compat/ecosystem.ts` — `all`, `ids`, `record`, `settings` (merges `compatibility` across config documents), `order`, `enabled`.
- `packages/core/src/compat/store.ts` — `read`, `project`, `choose`, `trust`, `trusted`.
- `packages/core/src/compat/detect.ts` — `detect`, `projectRoot`, `present`.
- `packages/core/src/compat/tools.ts` — `resolve`, `parseRule`.
- `packages/core/src/compat/claude/index.ts` — `ClaudeAdapter.load` builds one home and one project config document, the memory files, `loaded` counts and `skipped` reasons; `watchTargets` lists the paths to watch.
- `packages/core/src/compat/claude/settings.ts`, `packages/core/src/compat/claude/commands.ts`, `packages/core/src/compat/claude/agents.ts`, `packages/core/src/compat/claude/mcp.ts`, `packages/core/src/compat/claude/model.ts` — one synchronous converter per Claude source.
- `packages/core/src/compat/claude/instructions.ts` — the memory loader; the only effectful converter, since imports are read from disk.
- `packages/schema/src/config/compatibility.ts` — the config field `compatibility` and the `Report`/`Change` shapes of the HTTP routes.

## Important Details

- A project may carry several ecosystems at once. Discovery finds every one; all of them are on unless someone turned one off, so they merge by default.
- Who decides whether an ecosystem is on, highest first: the per-project choice in the store, then `compatibility.ecosystems` in config (merged key by key across documents), then the default `true`.
- Merge priority on a shared name is `compatibility.order`, then the remaining ecosystems in registry order; `.agents` leads by default, which keeps the old `.agents`-over-`.claude` precedence. Within one ecosystem the nearest project folder wins over farther ones and over home.
- Store keys are resolved project roots (`location.project.directory`). `detect.projectRoot` repeats the rule of `Project.resolve` — the nearest checkout holding `.git` or `.hg`, else the directory — for callers without a location.
- Trust is recorded per ecosystem and project. Passive content (instructions, skills, commands, agents) needs none; project folders need it to run code or loosen permissions (hooks, stdio MCP servers, `allow` rules, environment). Home folders are always trusted, and `deny`/`ask` rules never need trust because they only tighten.
- `Config.compatibility()` reads the store on every call instead of caching it: the compatibility plugin reacts to the raw change feed and may run before the debounced config reload.
- Codex's home folder honours `CODEX_HOME`.
- Adapter output is ordinary config: `Config.load` decodes the Claude documents like files and places them `global opencode → ~/.claude → explicit → project .claude → opencode.json → .opencode → content`. OpenCode wins at each level; rules follow last-match-wins, and the settings converter emits `allow`, then `ask`, then `deny`.
- What a Claude project may do without trust: instructions (imports only inside the project), commands with `` !`cmd` `` replaced by a notice, subagents, `deny`/`ask` rules. With trust it also gets shell interpolation, `.mcp.json` servers, `allow` rules, `additionalDirectories` and `defaultMode: acceptEdits`. `bypassPermissions` is never carried over.
- Model aliases (`sonnet`, `opus`, `haiku`, `fable`) resolve to the newest plain id in the bundled models.dev snapshot, so they move when the snapshot is refreshed; `inherit` leaves the model unset.
- A CLAUDE.md that only imports AGENTS.md files the instruction plugin already loads adds nothing, so projects carrying both are not instructed twice.
- `Config.changeEcosystem` reloads config before answering: choices and trust change the adapter documents, not just the folder list.
- Hook events map onto OpenCode as follows: PreToolUse → tool `execute.before` (deny or exit 2 fails with `Tool.Error`, `updatedInput` rewrites the input, `allow`/`ask` is applied in `permission.evaluate` for that call id and never lifts a deny); PostToolUse → `execute.after` (feedback is appended to the tool result); UserPromptSubmit → session `prompt` (block fails with `PromptInput.Rejected`, context is appended to the prompt in a `<user-prompt-submit-hook>` block); Stop/SubagentStop → `session.execution.succeeded` (block sends the reason as a synthetic message that resumes the session, at most eight times until the user prompts again); SessionStart → `session.created` and `session.compaction.ended` (context as a synthetic message that does not resume); SessionEnd → `session.deleted`; PreCompact → `session.compaction.started`; Notification → `permission.asked`.
- Hooks run through bash — Git Bash on Windows — in the project root with `CLAUDE_PROJECT_DIR` set and the event JSON on stdin, 60 seconds by default. Matching hooks run in parallel and identical commands once. `disableAllHooks` at any level turns them all off.
- `transcript_path` points to a minimal Claude-shaped JSONL (user text, assistant text, tool calls by Claude name) rewritten under `<state>/claude-transcripts/` before each run and removed with its session; hooks that read other transcript fields will not find them.

## Connections

- `packages/core/src/config/discovery.ts` — walks up for every registry folder and returns them in `Sources.ecosystems`.
- `packages/core/src/config.ts` — `compatibility()`, `ecosystems()` and `changeEcosystem()` apply config, store and order.
- `packages/core/src/config/plugin/compatibility.ts` — merges `<root>/skills` of every ecosystem that is on, adds memory files to `InstructionDiscovery`, and watches the store file.
- `packages/core/src/config/plugin/command.ts`, `packages/core/src/config/plugin/agent.ts`, `packages/core/src/config/plugin/mcp.ts` — consume the adapter documents unchanged.
- `packages/core/src/plugin/hooks.ts` and `packages/plugin/src/effect/session.ts` — `SessionFailures` lets the `prompt` hook refuse a prompt; `packages/server/src/handlers/session.ts` maps the refusal to `PromptRejectedError`.
- `packages/server/src/handlers/config.ts` and `packages/protocol/src/groups/config.ts` — `GET`/`POST /api/config/compatibility`.
- `packages/cli/src/commands/handlers/compat/` — `opencode compat list|enable|disable|reset|trust|untrust`.
- `packages/core/src/tool/mcp.ts` — `McpTool.name` and `namespace`, which `tools.ts` uses for `mcp__` names.

## Pitfalls

- Permission actions are not always tool names: `write` and `patch` assert `edit`, file reads assert `read`. A rule built from a tool name instead of `Target.action` silently never matches.
- OpenCode's `*` crosses `/`, so `**` collapses to `*`; `**/x` yields two patterns because `*/x` would miss `x` at the top.
- A repository can write `compatibility` into its own `opencode.json`, but never into the store: only the user can trust a project or override config for it.
- Ecosystems without an adapter yet (`codex`, `gemini`, `cursor`) are detected and can be switched, but nothing of theirs is read except a `skills` folder.
- Never watch `~/.claude` recursively: Claude keeps logs, todos and project transcripts there. `watchTargets` names the few files and subfolders that feed config; `~/.claude.json` is rewritten by Claude Code all the time, so it costs a reload per write (debounced like every config change).
- A store change made by another process (a second server) is not seen by `Config` until its next reload; changes through the HTTP route reload at once.
- Claude command names keep OpenCode's folder convention (`git/commit`), not Claude's flat `/commit` with a namespace label.
- `systemMessage` from a hook is only logged: OpenCode has no user-only notice channel yet, and a synthetic message would reach the model.
- Promise-style plugins cannot refuse a prompt: their hook callbacks become defects on rejection, as with `Tool.Error`. Only Effect plugins get the typed refusal.
- Hooks never run in the user's shell: with Nushell or PowerShell configured, Claude's `a && b` commands fail. `ClaudeHookRun.bash` looks for Git Bash upward from `git` (`ShellSelect.gitbash` only knows the `Git/cmd` layout, not `Git/mingw64/bin`) and skips `System32\bash.exe`, which is WSL; with no bash the hook reports an error.
- A hook callback runs in its caller's context, so `ClaudeHooksPlugin` captures `AppProcess` and `ShellSelect` at activation; a hook that reads services lazily fails with "Service not found".
- Tests that walk up from a temporary directory can reach the real home folders; filter roots to the fixture, and give `Global` a fixture `state` so the real store is never read.
