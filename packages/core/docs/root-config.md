# core/src — config, access rights, projects and external integrations

## Purpose

The layer of the settings and the permissions: how the config is assembled from the files, the variables and the remote manifests, what
overwrites the global fields, how the secrets are stored and switched, by what rules
an action is allowed or asks the user, how a catalog becomes a project and how the external
integrations (auth, commands, keys) become saved credentials.

## What's In This Folder

Thirteen root files of `src`. The configuration and environment services: `config`, `credential`,
`permission`, `project`, `workspace`, `wellknown`, `integration`. The registries on a replayable
state: `skill`, `reference`, `instruction-discovery`. The small ones: `kv` (key-value over the DB) and two
files of declarations — `markdown.d.ts` (the import of `.md` as a string) and `node-ffi.d.ts` (a local
declaration of `node:ffi`). All services are on Effect: `Context.Service` + `Layer` + a node `makeLocationNode`
(bound to a location) or `makeGlobalNode` (one per process).

## Key Files

- `config.ts` — the service `@opencode/Config`. The order of the records from bottom to top: wellknown → the global
  directory → the explicit file → the direct files → the directories of the project → the content from `OPENCODE_CONFIG_CONTENT`.
  `entries()` gives this list (the documents with `AbsolutePath` and the parsed `Info`, plus the records of the
  directories), `changes()` — a stream of the raw events of the watcher, `compatibility()` — the merge order and the
  existing folders of every ecosystem that is on (`.agents`, `.claude`, `.codex`, `.gemini`, `.cursor`, see
  `packages/core/docs/compat.md`), `ecosystems()` and `changeEcosystem()` — detection and the per-project choice,
  `update(patch)` edits only the `shell` field in the global
  config, keeping the rest of the JSONC. `Config.Event.Updated` goes only on a real change
  of the list or of the compatibility roots.
- `credential.ts` — the service `@opencode/Credential` above `credential/sql.ts`: it stores the `Value` (a key
  or OAuth), the label and the activity flag. The methods `all`, `list`, `get`, `create`, `activate`, `update`,
  `remove`; the order is always `active` → `time_created` → `id`. The event `Updated` goes after the edit,
  `Switched` — when the active record has changed.
- `permission.ts` — the service `@opencode/Permission`. `evaluate` takes the last rule that matched by
  `action` and `resource` (the wildcards through `util/wildcard.ts`), otherwise — `ask`. `configured()` glues
  the rules of the agent and the session, `savedRules()` adds the saved permissions of the project. `ask` asks
  and does not wait, `assert` waits for the answer, `reply` answers, `close` kills the waiters when the layer is finished.
  The errors: `DeclinedError`, `CorrectedError`, `BlockedError`, `NotFoundError`.
- `kv.ts` — the service `@opencode/KV` above `kv/sql.ts`: `get`, `set` (upsert by the key), `remove`, `scan`
  by the prefix with the cursor `after` and the limit `limit`.
- `project.ts` — the service `@opencode/Project`. `resolve` goes up by `.git`/`.hg`: git gives the id from
  the normalized remote, otherwise from the file `opencode` in the common directory, otherwise from the root
  commit; Mercurial takes `opencode` in the storage or the first root changeset from
  `hg log -r "roots(all())" -T {node}`; without a VCS — a hash from the path. `root()` is a separate function without
  the launch of a VCS, it is taken by the checks of the permissions. `persist` writes the project and publishes `Worktree.Event.Resolved`
  with a commit hook of the insertion of the row into `worktree/sql.ts`.
- `workspace.ts` — the service `@opencode/Workspace` above `workspace/sql.ts` and the driver
  `workspace/driver.ts`. `create` takes a logical ID and checks the provider, `provision` creates the
  resource and saves the `binding`, `connect` gives the environment driver with a spawner, `destroy` cancels
  the race and deletes the row. The background cycle once a minute suspends the idle connections (the threshold
  of 20 minutes) and closes their scope.
- `wellknown.ts` — the service `@opencode/WellKnown`: the sources are stored in `kv` under the key
  `wellknown:sources`, the cache of the manifests — in the memory of the process. The manifest is taken from
  `<origin>/.well-known/opencode`: `auth` (the command and the name of the variable), `config`, `remote_config` (the url and the
  headers). The substitution in the url and the headers goes by the template `{env:NAME}`: first the passed
  variables, then `process.env`.
- `integration.ts` — the service `@opencode/Integration`: the registry of the integrations and the methods (`oauth`, `command`,
  `key`, `env`) in the state, the secrets — in `credential.ts`. On top: `connection.*` (active, resolve,
  key, activate, update, remove, status), `oauth.connect/status/complete/cancel`,
  `command.connect/status/cancel`. An authorization attempt lives 10 minutes, the terminal records a minute,
  the scrub once per 30 seconds; the connection statuses — only in the memory of the process. The errors: `CodeRequiredError`,
  `AuthorizationError`, `AttemptNotFoundError`.
- `skill.ts` — the service `@opencode/Skill`, the state in memory without a DB. `available()` filters the skills by
  the rule `skill` with the resource = the id of the skill, `prepare()` assembles the catalog of the skill, `toModelOutput()`
  wraps the content into `<skill_content>` with a list of the files.
- `reference.ts` — the service `@opencode/Reference`: the named sources (`local` with a path or `git` with a
  repository and a branch). `list()` turns a git source into a cache path via `repository.ts`,
  `refresh()` pulls them via `repository-cache.ts` once an hour, independently of the sessions.
- `instruction-discovery.ts` — the service `@opencode/InstructionDiscovery`: the instruction files (the path and
  the content) plus the availability flag. `list()` and `load()` give them as a source with the key
  `core/instructions` for `instructions/index.ts`; the render glues the heading `Instructions from:`
  to each file, on a change it shows a diff or the full text — whichever is shorter.
- `markdown.d.ts` — `declare module "*.md"`: the import of a markdown file gives a string with the content.
- `node-ffi.d.ts` — the declaration of `node:ffi`: `dlopen(path, definitions)` returns `lib.close()` and
  a table of functions by the signatures, plus `getInt32`.

## Important Details

- The global directory is below the explicit and the direct files, the directories of the project are above all, the content from
  `OPENCODE_CONFIG_CONTENT` — at the top; the later records override the earlier ones when merging the fields.
  `Options.global: false` removes only the global directory and every ecosystem's home folder (`~/.claude`, `~/.codex`, ...);
  the wellknown records, the file ones and the content ones load as usual.
- The parsing of a document: `jsonc-parser` with the trailing comma allowed, then `ConfigNormalize.normalize`,
  then `Schema.decodeUnknownOption(Info)` with `errors: "all"` and ignoring the extra properties.
  The wellknown config is built from the last credential of the integration and only if the value is of the type `key`:
  the string is put into the variable from `auth.env`.
- `config.update` finds the existing file from `ConfigDiscovery.names` in the global directory, otherwise
  writes `opencode.jsonc`, and applies the patch with an indent of two spaces.
- The clones share one project id: the `canonical` is replaced only if the previous directory has disappeared.
- A user refusal without a feedback in `assert` deliberately becomes a defect, so that the wrapper
  of the leaves does not turn it into the text of the model's answer; a refusal with a feedback remains a typed
  error and reaches the tool as a failure with a text. The answer `reject` kills the whole pack of the waiting
  requests of the same session, and not only the one that was answered.

## Connections

- `config.ts` → `wellknown.ts` (the manifests, the update event, the periodic refresh),
  `credential.ts` (the last key of the integration and `Switched`), `config/discovery.ts`, `config/watch.ts`,
  `config/variable.ts`, `config/normalize.ts`, `filesystem/watcher.ts`, `location.ts`, `bus.ts`.
- `credential.ts` → `database/database.ts`, `credential/sql.ts`, `bus.ts`; above it works
  `integration.ts` — the creation, the switching, the refresh of the token. `wellknown.ts` → `kv.ts` (the list
  of the sources) and `bus.ts`, and `kv.ts` → `database/database.ts` and `kv/sql.ts`.
- `permission.ts` → `agent.ts`, `session/store.ts`, `permission/saved.ts`, `plugin/hooks.ts` (the hook
  `permission` can rewrite the decision); `skill.ts` takes `Permission.evaluate` to filter the skills.
- `project.ts` → `git.ts`, `@opencode/util/process` (the command `hg`), `project/sql.ts`,
  `worktree/sql.ts`, `database/database.ts`, `bus.ts`. `workspace.ts` → `workspace/driver.ts`
  (the creation, connect, suspend, destroy), `environment/driver.ts` (the driver with a spawner),
  `effect/keyed-mutex.ts` (the lock by the workspace), `workspace/sql.ts`.
- `skill.ts`, `reference.ts`, `instruction-discovery.ts`, `integration.ts` build the state through
  `state.ts`: the transform callbacks survive a reload, `notify` publishes the domain event.
  `reference.ts` additionally takes `repository.ts`, `repository-cache.ts` and `global.ts`;
  `instruction-discovery.ts` — `instructions/index.ts` and the `diff` package.

## Pitfalls

- A broken config file does not bring down the load: a warning goes into the log, the document silently drops out —
  the absence of a setting is easy to take for the absence of a file. A reload is debounced and collapses
  a pack of events into one; the reading at the start reopens the sources, so as not to lose the records made
  before the subscription to the watcher. `config.update` edits exclusively `shell`.
- The list of the credentials is ordered with the active record at the top, and not by the creation time, and the last element
  is the oldest inactive record: this order is relied on by the wellknown config and by `credential.list`.
- `permission.evaluate` is won by the last match, and the permissions saved by the user are put
  at the end of the list, therefore stronger than the rules of the agent and the session; if the agent is not found, the stub
  "everything is forbidden" applies. The answer `always` without the `save` field in the request extends the permission for exactly one time.
- `kv.scan` returns the cursor `next` only when the rows turned out to be more than `limit`; the default limit
  is 100, the maximum is 1000, an empty prefix scans the whole table.
- `project.root()` does not launch a VCS — it only looks for `.git`/`.hg` up the filesystem.
  `project.resolve` at a git project trusts the remote: a renaming of the origin gives a new id; in Mercurial
  there is no remote identification at all. `activate` ignores the repeated calls more often than once a minute.
- `workspace.create` is idempotent by the ID: the same provider will give the same ID, another one — a conflict; the `binding`
  is never zeroed, therefore the deletion always reaches the driver. `destroy` cancels the parallel
  `provision` and can finish it with a success already after being put in the queue for deletion — these exchanges
  are enumerated in the comment by the function. The background suspension holds the lock for the whole time
  of `suspendForIdle`; the connections with the active streams are not touched.
- The wellknown sources lie in the common database, the manifests are cached only in the memory of the process: `refresh()`
  without the sources does nothing, and the network errors are returned as an `Error`, and `config.ts` only logs them.
- `integration.connection.resolve` refreshes the OAuth token only if less than five minutes remain before the expiry;
  the connection statuses do not survive a restart of the process. An authorization attempt that already saves the
  credential is neither cancelled nor expired; a repeated completion of an attempt in the auto mode leads to
  an abrupt termination of the service.
- The list of the files of the skill is a selection: the directory is scanned only for a file named `SKILL.md`, the first
  ten names after the sorting are taken. In `reference.ts` a non-remote repository and an invalid branch silently
  fall out of the list.
- The order of the instruction files is the order of the insertion into the map of the state: the global files, then the ones closest
  to the project, and the neighboring contributors alternate by the order of the transform registration, and a rearrangement of
  the registration changes the text of the instructions. "The instructions are unavailable" and "there are no instructions anymore" are different
  outcomes of one list, and both differ from an empty set of files.
- `markdown.d.ts` makes any import of `.md` a string: a wrong import path will give the content of another
  file or a resolution error, and not a typing. `node-ffi.d.ts` is its own minimal declaration,
  and not the official Node types. At the end of `workspace.ts` the commented plans of the further
  work are left (a janitor at the start, the rotation of the snapshots, a shared keyed helper for the attempts) — these are deliberate
  notes, and not unclosed defects.