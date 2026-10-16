# core/config — discovery, parsing, normalization and watching of config, plus plugins per section

## What's In This Folder

- Four base files: `discovery.ts` (where to look for configs), `watch.ts` (what to watch), `normalize.ts` (how to bring the old format to the current one), `markdown.ts` (frontmatter parsing), plus `variable.ts` (`{env:}` and `{file:}` substitutions).
- `plugin/` — 21 files. These are not "OpenCode plugins in general", but plugins that read a specific config section and pass it to their own subsystem: agents, commands, providers, skills, MCP, policies, instructions, formatting, snapshots, web search, worktree, shell, tool output, images, references, compaction.
- The root `packages/core/src/config.ts` — the service that ties all of this together: it loads the documents, keeps the list of watched targets and publishes a stream of changes.

## Key Files

- `packages/core/src/config/normalize.ts` — the largest file of the folder: translation of a previous-version config into the current schema with diagnostics.
- `packages/core/src/config/discovery.ts` — `discover(options)` and the name list `opencode.json`, `opencode.jsonc`.
- `packages/core/src/config/watch.ts` — `plan(sources)`: turns the found sources into a watch plan.
- `packages/core/src/config/variable.ts` — `substitute`, a `sanitize`-compatible substitution of files and variables.
- `packages/core/src/config/markdown.ts` — `parse`, `parseOption`, `sanitize` on top of `gray-matter`.
- `packages/core/src/config/plugin/provider.ts` and `packages/core/src/config/plugin/agent.ts` — the largest plugins of the folder.
- `packages/core/src/config/plugin/entry-observer.ts` — a shared helper for plugins that need to react to `config.updated`.
- `packages/core/src/config/plugin/source.ts` — the only file in `plugin/` that is not a `define` plugin, but a `ConfigPluginSource` service.

## Important Details

- `discovery.discover` returns five groups of sources: `global`, `explicit`, `direct`, `project`, `ecosystems`. The folder names in `ecosystems` come from the registry in `packages/core/src/compat/ecosystem.ts` (`.agents`, `.claude`, `.codex`, `.gemini`, `.cursor`); discovery finds all of them, and turning one off happens later, in `Config.compatibility()`.
- The upward search starts from `location.directory` and stops as soon as it reaches the global directory or when `options.project === false`.
- The key protection against double counting: every found path is resolved, and the global roots (`~/.config/opencode` and every ecosystem's home folder) together with the global files themselves are filtered out of the project walk result. Without this, a config from the home directory would be applied twice.
- Not only the path itself is resolved, but also its parent — the comment explains why: a missing child directory must behave the same as if the global root were a symlink.
- File and directory names are walked in reverse order (`names.toReversed()`), so the result reflects priority from a higher level down to a lower one.
- `watch.plan` returns a `Map` whose key is `JSON.stringify` of the watch target. Deduplication goes by key, not by path: one directory can have both a directory watch and an entries watch.
- For every found directory a watch is planned with `ignore` for `node_modules`, `.git` and their nested paths. For files a watch of the parent is planned in `entries` mode with a sorted name list, and only if the file does not lie inside an already watched directory. The reason is to make deletion and recreation of the file noticeable.
- `variable.substitute` first substitutes `{env:NAME}`, then — only if the text contains `{file:` at all — goes to the files. An empty value for a missing environment variable is substituted as an empty string, without an error.
- File substitution skips lines where `//` stands before the token: such a `{file:...}` stays text. This protects against substitution inside commented examples.
- The file content is inserted as the content of a JSON string: `JSON.stringify(...).slice(1, -1)`. Therefore line breaks inside the file get into the config escaped and remain valid JSON.
- The path `~/` is expanded via `os.homedir()`, a relative path is counted from the config directory (or from `dir` for a virtual source), an absolute one is taken as is.
- A missing file gives either an empty string (`missing: "empty"`), or a refusal `InvalidError` with the message `bad file reference: "<token>"`. For a `NotFound` error the text is supplemented with the file path.
- `markdown.sanitize` is needed for compatibility: other agents accept unquoted colons in frontmatter values. A value with a colon is rewritten as a block scalar `|-`. Comment lines, empty lines, indented lines and values `>`, `|`, as well as already quoted values, are left alone.
- `normalize.normalize` returns one of two shapes: `normalized` with `encoded` and `diagnostics`, or `rejected`. A non-object root is the only refusal case at the top level; everything else becomes a diagnostic and is skipped part by part.
- Diagnostics of three kinds: `unsupported` (an obsolete setting that was dropped), `invalid` (a recognized value that did not decode), `conflict` (a native value overrode an obsolete one).
- The lists of obsolete keys are declared by four constants: `unsupportedTopLevel`, `unsupportedExperimental`, `unsupportedProvider`, `unsupportedModel`. This is the exhaustive list of what is recognized and silently dropped with a warning to the log.
- Every obsolete name is carried over to a native one: `snapshot` → `snapshots`, `autoupdate` → `update`, `autoshare` → `share` (boolean `true` becomes the string `auto`), `attachment` → `media`, `reference` → `references`, `command` → `commands`, `agent` and `mode` → `agents`, `provider` → `providers`, `plugin` → `plugins`, `tools` and `permission` → a single `permissions` list, `compaction.reserved` → `compaction.buffer`, `compaction.preserve_recent_tokens` → `compaction.keep.tokens`, `small_model` → `agents.title.model`, `experimental.mcp_timeout` → `mcp.timeout` immediately in `catalog` and `execution`.
- `experimental.enabled_providers` and `disabled_providers` are not carried over, but **expanded into policy rules**: first a `provider.use` denial on `*` is generated, then permissions for the listed providers. A non-empty empty `enabled_providers` list gives only the general denial.
- Rules from obsolete forms are collected in the order "tools, permissions, native rules". The old form `{ "bash": { "*": "ask" } }` and the short string become `action`/`resource`/`effect` triples with the resource `*`.
- Values are passed through the decode and encode loop (`decodeEncoded`, then `canonical`), and the result goes through `plain`, which recursively drops keys with the value `undefined`. This guarantees that `encoded` gets exactly what `Info` will later accept.
- `prefer` and `mergeMaps` form the conflict rule: the native value wins, but the mismatch lands in the diagnostics instead of staying silent. Deep comparison is `isDeepStrictEqual`.
- `setOwn` writes a key via `Object.defineProperty`, and `own` reads via `Object.hasOwn`. This rules out prototype influence on the parsing of user JSON.
- `isPlainRecord` requires the prototype `Object.prototype` or `null`: an object from another context with its own prototype does not get into the config.
- The plugins from `plugin/` come in two styles. The first uses `ConfigEntryObserver.observe(config, ctx.event, reload)` — a short plugin that simply passes values into the editor of its own subsystem: `shell.ts`, `snapshot.ts`, `tool-output.ts`, `formatter.ts`, `image.ts`, `compaction.ts`, `location-watcher.ts`, `worktree.ts`, `reference.ts`, `provider.ts`, `skill-file.ts` as a helper. The second writes the subscription itself: `agent.ts`, `command.ts`, `skill.ts`, `compatibility.ts`, `mcp.ts`, `websearch.ts`, `source.ts`.
- `entry-observer.ts` closes the race between the first read and the subscription: it re-reads `config.entries()` after the subscription is installed. All plugins of this style declare `config.updated` as the only event they react to.
- `agent.ts` and `command.ts` hold a copy of the loaded state in a `loaded` object and re-read it in `transform`. The subscription to file changes is filtered by an `isAgentSource`/`isCommandSource` check, which looks only at the `directory` entry type and at the path being inside the subdirectories `agent`, `agents`, `mode`, `modes` (for commands — `command`, `commands`). The checks extend to the whole subtree without a suffix check: the comment explains that directory-level rename events carry no file paths.
- Both files declare one buffer `PubSub.sliding<void>(1)` and a debounce of 100 ms, and the subscriptions start on separate fibers via `Effect.forkScoped({ startImmediately: true })`. The comments in both files explain: `Stream.debounce` opens upstream one step later, so the subscription must be alive before the deferral starts.
- `agent.ts` carries over obsolete `.md` agents: `{agent,agents}/**/*.md` are considered secondary, `{mode,modes}/*.md` are primary, and primary ones get `mode: "primary"`. A file name without a directory prefix and without `.md` becomes the agent name.
- Parsing of an obsolete agent goes through `ConfigAgentV1.Info` with a subsequent migration; the native form is decoded by `ConfigAgent.Info`. The sign of obsolescence is the presence in the frontmatter of a key that is not in `agentKeys`.
- The "model + variant" pair in the obsolete form is glued into one string with `#`, but only if the model has no `#` and the variant has no `#`. The comment explains: the built-in selection and the structured one are untouched, and a variant without a model stays as is.
- `expandPermissions` expands `~` and `$HOME` **only** for the actions `external_directory`, `read`, `edit`. The comment explains why not for all: `bash` resources are raw command text, and a safe expansion would require shell parsing.
- `command.ts` runs command templates with the placeholders `$1`, `$2` and `$ARGUMENTS`, as well as substitutions of the form `!`scope`shell`, which are run by a real process with `concurrency: 2`. If a template has neither placeholders nor `$ARGUMENTS` but does have input text, the text is appended at the end through a separate check.
- `provider.ts` merges the obsolete and the native provider description and, besides settings, registers integrations: if there is no integration, a `key` method is created with the label «Manually enter API Key», and with `env` present the `env` method is added. This ties the config to the credential storage.
- `provider.ts` fixes the model source at the moment of folding (`structuredClone`), so later edits or the removal of the source do not change an already defined alias.
- `reference.ts` discards aliases with `/`, a space, a comma or a backtick, and recognizes a local path by the beginning with `.`, `/`, `~` or by the presence of a `path` field.
- `skill-file.ts` parses the skill frontmatter and knows three outcomes: `Parsed`, `Skipped` with the reason `markdown` and `Skipped` with the reason `frontmatter` together with the schema problem. The skill identifier is derived from the file name if it sits directly in the root, otherwise from the directory name. A `metadata` key of the form `opencode/autoinvoke` is read as a boolean, with the string `true` and `false` recognized after `trim().toLowerCase()`.
- `skill.ts` and `compatibility.ts` manage watching themselves through a `FiberMap`, drop it entirely before each reload and hold the reload under one semaphore. `skill.ts` can watch a directory that does not exist yet: `firstMissing` climbs up to the first existing parent and watches it as a file.
- `source.ts` distinguishes watching plugin sources from the config change feed. The found plugin directories are covered by the config feed, while local plugins from the explicit setting that live outside the config roots are watched directly. The comment explains the decision not to drop such watches: an obsolete watch costs one deduplicated descriptor and an idle activation, and they all die together with the layer.
- `source.ts` distinguishes the syntax of the obsolete setting: a string with a leading dash means a removal, an empty dash throws an error, an object gives `package` and `options`. The order of operations: first the found directories, then the explicit setting, so the explicit setting can remove an auto-discovered package.
- An absolute path pointing at a file rather than a directory is discarded with the warning `configured plugin path must be a directory`. A `server` entry point outside the verified catalog root is discarded too: this protects against leaving the bounds of the plugin directory.

## Connections

- `packages/core/src/config.ts` — the owner of the folder: loading the documents, `parseInfo`, the watch plan through `ConfigWatch.plan`, the `changes()` stream, `Config.latest(entries, key)` for the last value of a key, `update(patch)` via `jsonc-parser`, `testLayer` for tests and `configured(options)` for the per-location node.
- `packages/schema/src/config.ts` — the `Info` schema, the `Document`, `Directory`, `Entry`, `Patch` types, the `Updated` event. The sub-schemas live in `packages/schema/src/config/` (`agent.ts`, `command.ts`, `provider.ts`, `mcp.ts`, `formatter.ts`, `lsp.ts`, `media.ts`, `compaction.ts`, `policy.ts`, `plugin.ts`, `reference.ts`, `experimental.ts`).
- `packages/core/src/v1/config/` — the old schemas and the `migrate.ts` migrator; `normalize.ts` calls `ConfigMigrateV1.migrate`, `migrateAgent`, `migrateProvider`, `migrateMcp`, `commands`, `providerID` and `normalizeAction`.
- `packages/core/src/config.ts` — the priority order: wellknown, global directory, explicit file, direct project files, project directories, passed content. A comment in the code records that global is below explicit and direct, while project directories are above.
- `packages/core/src/credential.ts` — the `Config` subscription to `Credential.Event.Switched`, so that the config is re-read when the account of an integration changes.
- `packages/core/src/wellknown.ts` — the source of external integration configs, included with the lowest priority.
- `packages/core/src/filesystem/watcher.ts` — the `Watcher.WatchInput` type and `Watcher.Update` used by `watch.ts`.
- `packages/core/src/util/wildcard.ts` — `Wildcard.match` is applied in `policy.ts` to match rules by pattern.
- `packages/core/src/plugin/source-directory.ts` — the search of plugin directories that `source.ts` relies on.
- `packages/core/src/shell/select.ts` — `ShellSelect.args` is used in `command.ts` to run shell substitutions.
- `packages/core/src/session/subagent-job.ts` — subagent commands delegate the launch of the child session to this service.
- `packages/core/src/managed-policy.ts` — the source of organization statements for `policy.ts`.
- `packages/core/docs/v1.md` — the document of the `v1` folder, the source of all obsolete schemas.

## Pitfalls

- `normalize.normalize` can throw: `canonical` uses `Option.getOrThrow`. If the migration produces a value that does not pass the target schema, the failure will be an exception, not a diagnostic.
- Silent loss of settings is the norm for this file. An obsolete key does not interrupt the config load: it gives a `omitted unsupported legacy setting` warning to the log and disappears. The user sees "everything works" and "the setting is not applied" at the same time.
- `canonical` passes a value through schema decoding and encoding. Any field added to the target schema with a transformation will be normalized, even if the user never wrote it.
- `experimental.enabled_providers` is expanded into policy rules, not stored as a list. The order check in `policy.ts` goes through `findLast`, so the real priority is set by the order of processing entries, not by the order in the config.
- `agent.ts` and `command.ts` filter events by the path being inside subdirectories. A file added through a symlink outside the tree gives no event, and the config will not be re-read.
- The 100 ms debounce is shared for all sources: editing five files in a row causes one reload. That is correct for the result and wrong for the event counter in the logs.
- `skill.ts` in the absence of a skills directory subscribes to the first existing parent as a file. When the directory appears, the event does arrive, but the event name will be the parent's, not the skills directory's.
- `skill.ts` and `compatibility.ts` clear all watches via `FiberMap.clear` before each reload. Between the clear and the new subscription an event is lost; only the fact that the end and the beginning go under one semaphore saves it.
- `policy.ts` calls `policies()` anew for every provider list and every permission check: the current organization statements are read each time, not cached.
- `reference.ts` discards aliases with a space and a slash without any diagnostic. A typo in a reference name looks like "reference not found", although nobody looked for it.
- `variable.substitute` substitutes `{env:}` unconditionally and silently: an unknown variable gives an empty string. In a config this can turn into an empty API key and an authorization error far away from the place of the edit.
- File substitution reads the file entirely and inserts it into the config. Substituting a large file into the config will make it unreadable in diagnostics and in error messages.
- `watch.plan` deduplicates watches by `JSON.stringify` of the target, not by path. The same path in different target forms will give two watches.