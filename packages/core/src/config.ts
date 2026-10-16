export * as Config from "./config.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import path from "path"
import { isDeepStrictEqual } from "node:util"
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser"
import { Context, Effect, FiberMap, Layer, Option, PubSub, Ref, Schema, Semaphore, Stream } from "effect"
import { Directory, Document, Info, type Patch, type Entry, Event } from "@opencode/schema/config"
import { Credential } from "./credential.js"
import { Bus } from "./bus.js"
import { Watcher } from "./filesystem/watcher.js"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "./location.js"
import { AbsolutePath } from "./schema.js"
import { ConfigVariable } from "./config/variable.js"
import { ConfigNormalize } from "./config/normalize.js"
import { ConfigDiscovery } from "./config/discovery.js"
import { ConfigWatch } from "./config/watch.js"
import { WellKnown } from "./wellknown.js"
import { Ecosystem } from "./compat/ecosystem.js"
import { CompatStore } from "./compat/store.js"
import { CompatDetect } from "./compat/detect.js"
import { ClaudeAdapter } from "./compat/claude/index.js"
import type { ClaudeHookConfig } from "./compat/claude/hooks/config.js"
import { InstructionDiscovery } from "./instruction-discovery.js"
import type { ConfigCompatibility } from "@opencode/schema/config/compatibility"
import { ConfigMCP } from "@opencode/schema/config/mcp"

export function latest<K extends keyof Info>(entries: readonly Entry[], key: K): Info[K] | undefined {
  return entries.findLast((entry): entry is Document => entry.type === "document" && entry.info[key] !== undefined)
    ?.info[key]
}

export interface Interface {
  /** Returns location config documents and discovery sources from lowest to highest priority. */
  readonly entries: () => Effect.Effect<Entry[]>
  /** Other ecosystems' folders consumed by internal compatibility plugins. */
  readonly compatibility?: () => Effect.Effect<Compatibility>
  /** Every ecosystem found for this location, on or off, for the user to choose among. */
  readonly ecosystems?: () => Effect.Effect<ConfigCompatibility.Report>
  /** Stores the user's per-project choice or trust outside the repository and returns the new report. */
  readonly changeEcosystem?: (change: ConfigCompatibility.Change) => Effect.Effect<ConfigCompatibility.Report>
  /**
   * Streams raw filesystem updates under config roots. Config owns root
   * topology and watch reconciliation; domain owners filter this feed for the
   * source files they parse and rebuild their own state.
   */
  readonly changes: () => Stream.Stream<Watcher.Update>
  /** Updates supported global config fields while preserving unrelated JSONC content. */
  readonly update?: (patch: Patch) => Effect.Effect<void, FSUtil.Error>
}

export interface Compatibility {
  /** Merge priority of the ecosystems that are on, highest first. */
  readonly order: readonly Ecosystem.ID[]
  /** Existing folders of each ecosystem, global first and nearest project folder last; empty when it is off. */
  readonly roots: Ecosystem.ByID<readonly AbsolutePath[]>
  /** Memory files of ecosystems that are on (CLAUDE.md with its imports), global first. */
  readonly instructions: readonly InstructionDiscovery.File[]
  /** Claude command hooks allowed to run in this location. */
  readonly hooks: readonly ClaudeHookConfig.Hook[]
}

export const Options = Schema.Struct({
  project: Schema.optional(Schema.Boolean),
  // false skips the global config dir and every ecosystem's home folder (~/.claude, ~/.codex, ...); wellknown,
  // file, and content entries still load.
  global: Schema.optional(Schema.Boolean),
  file: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

export interface TestInterface extends Interface {
  /** Replaces the entries returned by subsequent entries() calls. */
  readonly setEntries: (entries: Entry[]) => Effect.Effect<void>
  /** Emits one filesystem update to every changes() subscriber. */
  readonly emitChange: (update: Watcher.Update) => Effect.Effect<void>
}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/Config/Test") {}

/** In-memory config for tests: static entries with replaceable state and a test-driven change feed. */
export const testLayer = (
  initial: Entry[] = [],
  compatibility: Partial<Compatibility["roots"]> & {
    readonly order?: readonly Ecosystem.ID[]
    readonly hooks?: Compatibility["hooks"]
  } = {},
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const entries = yield* Ref.make(initial)
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const service = Test.of({
        entries: () => Ref.get(entries),
        compatibility: () =>
          Effect.succeed({
            order: compatibility.order ?? Ecosystem.order(),
            roots: Ecosystem.record((id) => compatibility[id] ?? []),
            instructions: [],
            hooks: compatibility.hooks ?? [],
          }),
        changes: () => Stream.fromPubSub(updates),
        setEntries: (next) => Ref.set(entries, next),
        emitChange: (update) => PubSub.publish(updates, update).pipe(Effect.asVoid),
      })
      return Context.empty().pipe(Context.add(Service, service), Context.add(Test, service))
    }),
  )

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const watcher = yield* Watcher.Service
      const bus = yield* Bus.Service
      const credentials = yield* Credential.Service
      const globalService = yield* Global.Service
      const wellknown = yield* WellKnown.Service
      const reloadLock = Semaphore.makeUnsafe(1)
      const updateLock = Semaphore.makeUnsafe(1)
      const decodeOptions = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const
      const decodeInfo = Schema.decodeUnknownOption(Info, decodeOptions)
      const parseInfo = Effect.fn("Config.parseInfo")(function* (text: string, source: string) {
        const errors: ParseError[] = []
        const input: unknown = parse(text, errors, { allowTrailingComma: true })
        if (errors.length) {
          yield* Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: "$",
            kind: "invalid",
            action: "rejected malformed JSON or JSONC document",
          })
          return
        }
        const result = ConfigNormalize.normalize(input)
        yield* Effect.forEach(result.diagnostics, (diagnostic) =>
          Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: diagnostic.path[0] === "$" ? "$" : `$.${diagnostic.path.join(".")}`,
            kind: diagnostic.kind,
            action: diagnostic.message,
          }),
        )
        if (result.type === "rejected") return
        const info = Option.getOrUndefined(decodeInfo(result.encoded))
        if (info) return info
        yield* Effect.logWarning("configuration normalization diagnostic", {
          source,
          path: "$",
          kind: "invalid",
          action: "rejected canonical configuration after final validation",
        })
      })

      const loadFile = Effect.fnUntraced(function* (filepath: string) {
        const text = yield* fs.readFileStringSafe(filepath)
        if (text === undefined) return
        const substituted = yield* ConfigVariable.substitute({ type: "path", path: filepath, text })
        const info = yield* parseInfo(substituted, filepath)
        if (!info) return
        return new Document({ type: "document", path: AbsolutePath.make(filepath), info })
      })

      const loadWellknownEntry = Effect.fnUntraced(function* (entry: WellKnown.Entry) {
        const auth = entry.manifest.auth
        if (!auth) return []
        const credential = (yield* credentials.list(entry.integrationID)).at(-1)
        if (!credential || credential.value.type !== "key") return []
        const variables = { [auth.env]: credential.value.key }
        const configs = yield* wellknown
          .resolve(entry, variables)
          .pipe(
            Effect.catch(() =>
              Effect.logWarning("failed to load wellknown config", { source: entry.origin }).pipe(
                Effect.as([] as const),
              ),
            ),
          )
        return yield* Effect.forEach(configs, (config) =>
          ConfigVariable.substitute({
            type: "virtual",
            source: entry.origin,
            dir: entry.origin,
            text: JSON.stringify(config),
            env: variables,
          }).pipe(
            Effect.flatMap((text) => parseInfo(text, entry.origin)),
            Effect.map((info) => (info ? new Document({ type: "document", info }) : undefined)),
          ),
        ).pipe(Effect.map((documents) => documents.filter((document) => document !== undefined)))
      })

      const loadWellknown = Effect.fn("Config.loadWellknown")(function* () {
        const entries = yield* wellknown
          .entries()
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to discover wellknown config", { error }).pipe(Effect.as([] as const)),
            ),
          )
        return yield* Effect.forEach(entries, loadWellknownEntry).pipe(Effect.map((documents) => documents.flat()))
      })

      const loadDirectory = Effect.fnUntraced(function* (directory: AbsolutePath) {
        return [
          ...(yield* Effect.forEach(ConfigDiscovery.names, (file) => loadFile(path.join(directory, file))).pipe(
            Effect.map((configs) => configs.filter((config): config is Document => config !== undefined)),
          )),
          new Directory({ type: "directory", path: directory }),
        ]
      })

      const load = Effect.fn("Config.load")(function* (sources: ConfigDiscovery.Sources) {
        const direct = yield* Effect.forEach(sources.direct, (filepath) => loadFile(filepath)).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.filter((entry): entry is Document => entry !== undefined)),
        )

        const explicit = sources.explicit
          ? yield* loadFile(sources.explicit).pipe(
              Effect.map((config) => (config ? [config] : [])),
              Effect.orDie,
            )
          : []
        const content =
          options?.content !== undefined
            ? yield* ConfigVariable.substitute({
                type: "virtual",
                source: "OPENCODE_CONFIG_CONTENT",
                dir: location.directory,
                text: options.content,
              }).pipe(
                Effect.flatMap((text) => parseInfo(text, "OPENCODE_CONFIG_CONTENT")),
                Effect.map((info) => (info ? [new Document({ type: "document", info })] : [])),
                Effect.orDie,
              )
            : []

        // Global entries sit below explicit and direct files; project
        // directories rank above them.
        const globalSupplementary = sources.global ? yield* loadDirectory(sources.global).pipe(Effect.orDie) : []
        const projectSupplementary = yield* Effect.forEach(
          sources.project.filter((root) => root.present),
          (root) => loadDirectory(root.path),
        ).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.flat()),
        )
        const own = [...globalSupplementary, ...explicit, ...direct, ...projectSupplementary, ...content]
        const claude = yield* loadClaude(sources, own)
        // Each ecosystem document sits just below OpenCode's config of the same level.
        return {
          entries: [
            ...(yield* loadWellknown().pipe(Effect.orDie)),
            ...globalSupplementary,
            ...(claude?.global ?? []),
            ...explicit,
            ...(claude?.project ?? []),
            ...direct,
            ...projectSupplementary,
            ...content,
          ],
          claude,
        }
      })

      const loadClaude = Effect.fn("Config.loadClaude")(function* (
        sources: ConfigDiscovery.Sources,
        entries: readonly Entry[],
      ) {
        const choices = (yield* projectChoices()).ecosystems
        if (!Ecosystem.enabled("claude", Ecosystem.settings(entries), choices)) return undefined
        const project = location.project.directory
        const includeGlobal = options?.global !== false
        // A project inside the global config folder is global config; with global off it must not load.
        const includeProject =
          options?.project !== false &&
          (includeGlobal || !FSUtil.contains(yield* fs.resolve(globalService.config), yield* fs.resolve(project)))
        // AGENTS.md files the instruction plugin already loads; CLAUDE.md imports of them are not repeated.
        const agents = [
          ...(includeGlobal ? [path.join(globalService.config, "AGENTS.md")] : []),
          ...(includeProject
            ? ClaudeAdapter.levels(project, location.directory).map((level) => path.join(level, "AGENTS.md"))
            : []),
        ]
        const roots = yield* Effect.filter(sources.ecosystems.claude, fs.isDir)
        const result = yield* ClaudeAdapter.load({
          roots,
          global: Ecosystem.get("claude").global(globalService.home, process.env),
          project,
          directory: location.directory,
          home: globalService.home,
          trusted: CompatStore.trusted(yield* projectChoices(), "claude"),
          env: process.env,
          includeGlobal,
          includeProject,
          loadedInstructions: yield* Effect.filter(agents, fs.isFile),
        }).pipe(Effect.provideService(FSUtil.Service, fs))
        const decode = (document: Record<string, unknown> | undefined, source: string | undefined) =>
          document
            ? parseInfo(JSON.stringify(document), source ?? "claude").pipe(
                Effect.map((info) => (info ? [new Document({ type: "document", info })] : [])),
              )
            : Effect.succeed([])
        return {
          global: yield* decode(result.documents.global, result.paths.global),
          project: yield* decode(result.documents.project, result.paths.project),
          result,
          watch: ClaudeAdapter.watchTargets({
            roots,
            project,
            directory: location.directory,
            home: globalService.home,
            includeGlobal,
            includeProject,
          }),
        }
      })

      // The user's per-project ecosystem choices live outside the repository, beside other user state.
      // Compatibility plugins watch that file themselves; config reloads only track repository sources.
      const storeFile = CompatStore.file(globalService.state)
      const projectChoices = () =>
        options?.project === false
          ? Effect.succeed<CompatStore.Project>({})
          : CompatStore.project(storeFile, location.project.directory).pipe(Effect.provideService(FSUtil.Service, fs))
      const detectEcosystems = () =>
        CompatDetect.detect({
          directory: location.directory,
          root: location.project.directory,
          home: globalService.home,
          state: globalService.state,
          settings: Ecosystem.settings(configs),
          adapters: claude ? { claude: claude.result } : {},
        }).pipe(Effect.provideService(FSUtil.Service, fs))
      // Service methods run outside this layer, so a reload they trigger takes the layer's own services.
      const layerContext = yield* Effect.context<FSUtil.Service | Global.Service | Location.Service>()
      const initial = yield* ConfigDiscovery.discover(options)
      let sources = initial
      const first = yield* load(initial)
      let configs = first.entries
      let claude = first.claude
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const reloads = yield* PubSub.sliding<void>(1)
      // Readiness rescans recover writes made before a watch attached.
      const requestReload = PubSub.publish(reloads, undefined).pipe(Effect.asVoid)
      const watched = yield* FiberMap.make<string>()
      const reconcile = Effect.fn("Config.reconcileWatches")(function* (sources: ConfigDiscovery.Sources) {
        const plan = ConfigWatch.plan(sources, {
          files: claude?.watch.files ?? [],
          directories: yield* Effect.filter(claude?.watch.directories ?? [], fs.isDir),
        })
        for (const key of Array.from(watched, ([key]) => key)) {
          if (!plan.has(key)) yield* FiberMap.remove(watched, key)
        }
        for (const [key, target] of plan) {
          yield* watcher
            .subscribe(target, requestReload)
            .pipe(
              Effect.flatMap(
                Stream.runForEach((update) => PubSub.publish(updates, update).pipe(Effect.andThen(requestReload))),
              ),
              FiberMap.run(watched, key, { onlyIfMissing: true, startImmediately: true }),
            )
        }
      })

      const reload = Effect.fn("Config.reload")(
        function* () {
          const discovered = yield* ConfigDiscovery.discover(options)
          const next = yield* load(discovered)
          const compatibilityChanged =
            !isDeepStrictEqual(sources.ecosystems, discovered.ecosystems) ||
            !isDeepStrictEqual(claude?.result, next.claude?.result)
          claude = next.claude
          yield* reconcile(discovered)
          if (isDeepStrictEqual(configs, next.entries) && !compatibilityChanged) return
          sources = discovered
          configs = next.entries
          yield* bus.publish(Event.Updated, {})
        },
        (effect) => reloadLock.withPermit(effect),
      )

      // Subscribe eagerly so synchronous watch readiness isn't dropped.
      const pendingReloads = yield* PubSub.subscribe(reloads)
      yield* Stream.fromSubscription(pendingReloads).pipe(
        Stream.debounce("100 millis"),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.filterEffect((event) =>
          wellknown.entries().pipe(
            Effect.map((entries) => entries.some((entry) => entry.integrationID === event.data.integrationID)),
            Effect.orElseSucceed(() => false),
          ),
        ),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(WellKnown.Event.Updated).pipe(
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown sources", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.sleep("10 minutes").pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (!wellknown.snapshot().length) return Effect.void
            return Effect.gen(function* () {
              const changed = yield* wellknown
                .refresh()
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to refresh wellknown manifests", { error }).pipe(Effect.as(false)),
                  ),
                )
              if (!changed) yield* reload()
            }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to refresh wellknown config", { cause })))
          }),
        ),
        Effect.forever,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* reloadLock.withPermit(reconcile(initial))

      const update = Effect.fn("Config.update")(
        function* (patch: Patch) {
          const directory = initial.global ?? AbsolutePath.make(globalService.config)
          const candidates = ConfigDiscovery.names.map((name) => path.join(directory, name))
          const filepath =
            (yield* Effect.filter(candidates, fs.isFile)).at(-1) ?? path.join(directory, "opencode.jsonc")
          const formatting = { formattingOptions: { tabSize: 2, insertSpaces: true } }
          const original = (yield* fs.readFileStringSafe(filepath)) ?? "{}\n"
          const text =
            "compatibilityEnabled" in patch
              ? applyEdits(
                  original,
                  modify(original, ["compatibility", "enabled"], patch.compatibilityEnabled ?? undefined, formatting),
                )
              : original
          const updated = yield* Effect.try({
            try: () =>
              Object.entries(patch.mcpServers ?? {}).reduce(
                (current, [server, value]) =>
                  applyEdits(
                    current,
                    modify(
                      current,
                      ["mcp", "servers", server],
                      value === null ? undefined : Schema.encodeSync(ConfigMCP.Server)(value),
                      formatting,
                    ),
                  ),
                (["shell", "model"] as const)
                  .filter((key) => key in patch)
                  .reduce(
                    (current, key) => applyEdits(current, modify(current, [key], patch[key] ?? undefined, formatting)),
                    text,
                  ),
              ),
            catch: (cause) => new FSUtil.FileSystemError({ method: "config.update", cause }),
          })
          yield* fs.writeWithDirs(filepath, updated.endsWith("\n") ? updated : `${updated}\n`)
          yield* requestReload
        },
        (effect) => updateLock.withPermit(effect),
      )

      return Service.of({
        entries: Effect.fnUntraced(function* () {
          return configs
        }),
        compatibility: Effect.fnUntraced(function* () {
          // Read the choices fresh: a consumer reacting to the raw change feed can run before the debounced reload.
          const settings = Ecosystem.settings(configs)
          const project = (yield* projectChoices()).ecosystems
          const on = (id: Ecosystem.ID) => Ecosystem.enabled(id, settings, project)
          const roots = yield* Effect.all(
            Ecosystem.record((id) => (on(id) ? Effect.filter(sources.ecosystems[id], fs.isDir) : Effect.succeed([]))),
          )
          return {
            order: Ecosystem.order(settings.order).filter(on),
            roots,
            instructions: on("claude")
              ? (claude?.result.instructions ?? []).map(
                  (file) =>
                    new InstructionDiscovery.File({ path: AbsolutePath.make(file.path), content: file.content }),
                )
              : [],
            hooks: on("claude") ? (claude?.result.hooks ?? []) : [],
          } satisfies Compatibility
        }),
        ecosystems: detectEcosystems,
        changeEcosystem: Effect.fnUntraced(
          function* (change: ConfigCompatibility.Change) {
            const root = location.project.directory
            if (change.enabled !== undefined)
              yield* CompatStore.choose(storeFile, root, change.ecosystem, change.enabled ?? undefined)
            if (change.trusted !== undefined)
              yield* CompatStore.trust(storeFile, root, change.ecosystem, change.trusted)
            // Choices and trust shape the adapter documents, so rebuild them before reporting.
            yield* reload().pipe(Effect.provideContext(layerContext))
            return yield* detectEcosystems()
          },
          Effect.provideService(FSUtil.Service, fs),
          Effect.orDie,
        ),
        changes: () => Stream.fromPubSub(updates),
        update,
      })
    }),
  )

export function configured(options?: Options) {
  return makeLocationNode({
    service: Service,
    layer: layer(options),
    deps: [Watcher.node, Bus.node, FSUtil.node, Global.node, Location.node, Credential.node, WellKnown.node],
  })
}

export const node = configured()
