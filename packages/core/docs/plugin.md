# core/plugin — the plugin layer: registry, module loading, built-in plugins, providers, web search and VCS adapters

## What's In This Folder

68 `.ts` files plus text assets: `packages/core/src/plugin/command/`
(`initialize.txt`, `review.txt`), `packages/core/src/plugin/skill/`
(`opencode.md`, `report.md`), `packages/core/src/plugin/system-prompt/`
(six files: `gpt.txt`, `gpt-astra.txt`, `anthropic.txt`, `kimi.txt`,
`meta.txt`, `trinity.txt`).

Subfolders: `provider/` — 33 files of adapters and layers on top of the models.dev
catalog; `websearch/` — 7 files (5 search engines plus a shared MCP client);
`vcs/` — 2 adapters (`git.ts`, `hg.ts`).

A plugin is `{ id, effect }`; the `effect` receives `Plugin.Context` and works
through the editors (`transform`) of the services and the hooks (`hook`).

## Key Files

- `packages/core/src/plugin/internal.ts` — the registry of built-in plugins: the list
  `services`, `requirements` (LayerNode.group), the order `pre`, the order `post`,
  the set `guarded`. `list()` takes the services from the current context and
  wraps each `effect` through `Effect.provide`.
- `packages/core/src/plugin/supervisor.ts` — the assembly of a plugin generation:
  `resolve()` applies the config operations, `activate()` builds the list,
  `Queue.sliding(1)` + a 100 ms debounce collapse a burst of requests,
  `hold()`/`release()` hold `awaitActivation`.
- `packages/core/src/plugin/host.ts` — the assembly of `Plugin.Context` from the services
  (agent, model, provider, command, MCP, skill, tool, vcs, web search,
  worktree, session, storage).
- `packages/core/src/plugin/service.ts` — the `@opencode/Plugin` tag and the `Generation`
  type (`revision`, `source`, `features` on top of the plugin definition).
- `packages/core/src/plugin/hooks.ts` — the hook registry by the domains `aisdk`,
  `session`, `permission`, `shell`, `tool`; the key is a `domain.name` string.
- `packages/core/src/plugin/module.ts` — module loading: npm install or
  local path, `Host.load` or `sources.read`, validation of `Module` by a schema.
- `packages/core/src/plugin/sdk.ts` and `packages/core/src/plugin/instance.ts` —
  two sources of plugins: global for the host (`SdkPlugins`) and a set at the birth
  of an instance (`InstancePlugins`).
- `packages/core/src/plugin/update.ts` — checking and updating the npm packages
  of plugins, a check cache for a day, a `KeyedMutex` per target.
- `packages/core/src/plugin/provider.ts` — the list `ProviderPlugins` (32 entries).
- `packages/core/src/plugin/vcs/git.ts`, `packages/core/src/plugin/vcs/hg.ts` —
  the `Adapter` adapters from `packages/core/src/vcs.ts`.
- `packages/core/src/plugin/websearch/mcp.ts` — the shared JSON-RPC client
  `tools/call`, parsing of the direct JSON and of the `data: ` stream.

## Important Details

- The order in `pre` is semantics and not style: `PatchTool.Plugin` goes before
  `OptimizePlugin.Plugins`, because the hints about tools are rendered
  after the selection of the available editing tools.
- `post` — the config plugins (`config/plugin/*.ts`), they see the result
  of the built-ins.
- `guarded` contains `opencode.provider.opencode` and the policy plugin: `remove`
  operations skip them, otherwise a repository config could switch off
  the policy enforcement or the connection to Console.
- `InstancePlugins` are added last in `pre`: a later activation
  overrides earlier container entries, so an explicit instance choice
  wins over the global settings.
- The activation is two-pass: first `resolve` with `install: false`, then, if
  there are still `pending` ones, a second pass with installation. Locally available
  packages are activated without waiting for the network.
- `awaitActivation` exists because a cold `Location` activates
  plugins asynchronously: without the wait an early request will see an empty registry.
- `revision` determines whether a plugin is "the same": for `SdkPlugins` it is a counter, for
  `InstancePlugins` — the constant string `instance` (the list is immutable after
  the creation).
- Of the hooks only `tool.execute.before` and `session.prompt` can fall through:
  a `Tool.Error` rejects the call, a `PromptInput.Rejected` refuses the prompt before
  it is enqueued (the HTTP route answers `PromptRejectedError`, 422). The other
  domains are declared with `never` on the error channel.
- `tool-input-repair.ts` repairs the input only with unambiguous schema support,
  the depth is limited; the `execute` tool is skipped — the external Code Mode
  is built per snapshot and is not registered.
- `verbosity.ts` sets `textVerbosity: "low"` for the gpt-6 and gpt-5 models with
  known support, recognizing the prefixes `openai/` and `openai.` in
  the gateway and bedrock packages.
- `optimize.ts`: the Anthropic hint is appended at the end (`append`),
  the others replace the system prompt; an agent with its own `system` is skipped.
- `plan.ts`: the `plan` agent is read-only, `edit` is forbidden everywhere except
  `~/.opencode/plan`; the reminders about the mode are added by a synthetic
  message with `resume: false` and are checked on every request.
- `warming.ts` skips sessions with `parentID`, and recognizes its own warmup
  request by the match of the prompt text.
- `skill.ts` registers the `opencode` and `report` skills; the content of report
  is supplemented with a snapshot of diagnostics: version, channel, OS, `TERM`, `SHELL` and
  the list of plugins from the config.
- `models-dev.ts` cuts out the obsolete aliases `azure-cognitive-services` and
  `google-vertex-anthropic`, the models with the `deprecated` status and the list
  `BEDROCK_PROFILE_ONLY_IDS` from the amazon-bedrock catalog.
- Git: the command list runs from the directory, the per-file ones — from the worktree root;
  the patches are first collected by a single `git diff` within
  `MAX_TOTAL_PATCH_BYTES`, on exceeding the budget the file gets an empty patch.
- Mercurial: `hg diff --git` does not show untracked (`?`) and deleted
  (`!`) files — their patches are synthesized from the content; a request of committed or
  of an explicit base ends with `DiffError`.
- Local providers (`ollama`, `lmstudio`, `vllm`) are built the same way:
  a detection cache under `Semaphore(1)`, a retry on a schedule, the removal of the
  integration on a non-empty list of models.
- `provider/opencode.ts` receives from Console the providers, web search, MCP and the
  organization policies; in the absence of a key the provider is switched on with
  `apiKey: "public"`, and the paid models are switched off; `withoutCredentials`
  scrubs `apiKey`, `authToken`, `accessToken` out of the arriving settings.

## Connections

- `packages/core/src/plugin.ts` — the public registry: `Interface`, `Generation`,
  `Info`, `State`, `Source`. The types in `service.ts` and `host.ts` come from there.
- `packages/core/src/config/plugin/source.ts` — the `add`/`remove` operations
  that `supervisor` applies.
- `packages/core/src/vcs.ts` and `packages/core/src/vcs/patch.ts` — the `Adapter`,
  `DiffError` contract and the patch budgets for `vcs/`.
- The editors the plugins write into: `packages/core/src/provider.ts`,
  `packages/core/src/model.ts`, `packages/core/src/agent.ts`,
  `packages/core/src/command.ts`, `packages/core/src/skill.ts`,
  `packages/core/src/tool.ts`, `packages/core/src/mcp/index.ts`,
  `packages/core/src/websearch.ts`, `packages/core/src/worktree/strategies.ts`.
- `packages/core/src/session/affinity.ts` — the stable session identifier
  for the headers `session-id` and `X-Interaction-Id`.
- `packages/core/src/modal/models.ts`, `packages/core/src/github-copilot/models.ts`
  — the model snapshots that the corresponding providers lazily load.
- Helper modules: `packages/core/src/effect/keyed-mutex.ts`,
  `packages/core/src/util/iife.ts`, `packages/core/src/util/git-executable.ts`,
  `packages/core/src/tool/http-body.ts`, `packages/core/src/tool/runtime.ts`,
  `packages/core/src/session/system-prompt.ts`.

## Pitfalls

- A duplicate `id` brings down the activation of the registry entirely, together with the built-ins.
  `supervisor` keeps the first occurrence in the load order, and the second
  shows up in `failures` as `Duplicate plugin ID`.
- A package load error does not switch off what was already working: a generation that did not
  load does not replace the previous one — it stays in `packages`/`running`.
- `remove` with the target `"*"` cleans the error list, but entries from `guarded`
  cannot be switched off.
- A credential change rebuilds the catalog: `modal`, `digitalocean`, `openai`,
  `chatgpt`, `azure`, `gitlab`, `github-copilot` are subscribed to
  `Credential.Event.Switched`.
- GitLab requires exactly `http://127.0.0.1:8080/callback` and a public
  (not "Confidential") OAuth application; the built-in client ID exists
  only on `gitlab.com`.
- DigitalOcean holds port 1456, GitLab — 8080, OpenAI — 1455 with a fallback to 1457. If the port is taken the login into the provider will not happen.
- The hooks `identity.ts` and `optimize.ts` mute their errors (`Effect.catch` to
  an empty effect): a failure of the hint must not break the request.
- Local HTTP providers do not remove models on a break — they keep the
  last successful list, so that the availability does not flicker.
- `source-directory.ts` accepts both `.ts`/`.js` files, and directories, and
  symlinks (checking the target through the filesystem), and returns a list
  sorted by path: the order affects the load order.