export * as ConfigCompatibilityPlugin from "./compatibility.js"

import { define } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import path from "path"
import { Effect, FiberMap, Option, PubSub, Semaphore, Stream } from "effect"
import { Config } from "../../config.js"
import { Watcher } from "../../filesystem/watcher.js"
import { Skill } from "../../skill.js"
import { SkillFile } from "./skill-file.js"
import { Global } from "@opencode/util/global"
import { CompatStore } from "../../compat/store.js"
import { InstructionDiscovery } from "../../instruction-discovery.js"

export const Plugin = define({
  id: "opencode.config.compatibility",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const watcher = yield* Watcher.Service
    const store = CompatStore.file((yield* Global.Service).state)
    const watches = yield* FiberMap.make<string>()
    const changes = yield* PubSub.sliding<string>(1)
    const lock = Semaphore.makeUnsafe(1)
    const skills: Skill.Info[] = []
    const instructions: InstructionDiscovery.File[] = []
    // Memory files (CLAUDE.md) join the ambient instructions; compositions without discovery skip them.
    const discovery = Option.getOrUndefined(yield* Effect.serviceOption(InstructionDiscovery.Service))

    const watch = Effect.fn("ConfigCompatibilityPlugin.watch")(function* (target: string, type: "file" | "directory") {
      const updates = yield* watcher.subscribe({ path: target, type })
      yield* FiberMap.run(
        watches,
        `${type}:${target}`,
        updates.pipe(Stream.runForEach((update) => PubSub.publish(changes, update.path).pipe(Effect.asVoid))),
        { onlyIfMissing: true, startImmediately: true },
      )
    })

    const refresh = Effect.fn("ConfigCompatibilityPlugin.refresh")(
      function* () {
        yield* FiberMap.clear(watches)
        // Turning an ecosystem on or off for this project rewrites the user's store, not the repository.
        yield* watch(store, "file")
        const compatibility = config.compatibility ? yield* config.compatibility() : undefined
        // Every ecosystem that is on merges. Load the lowest priority first so later loads win on a shared
        // skill name: the ecosystem earliest in the order, and within it the nearest project folder.
        const directories = (compatibility?.order ?? [])
          .toReversed()
          .flatMap((id) => compatibility!.roots[id])
          .map((root) => path.join(root, "skills"))
        const loaded = new Map<Skill.ID, Skill.Info>()
        for (const directory of directories) {
          const resolved = yield* fs.realPath(directory).pipe(Effect.orElseSucceed(() => undefined))
          if (!resolved) continue
          yield* watch(resolved, "directory")
          const files = yield* fs
            .scan("{*.md,**/SKILL.md}", { cwd: resolved, absolute: true, include: "file", symlink: true, dot: true })
            .pipe(Effect.orElseSucceed(() => [] as string[]))
          for (const filepath of files.toSorted()) {
            const content = yield* fs.readFileStringSafe(filepath).pipe(Effect.orElseSucceed(() => undefined))
            if (!content) continue
            const parsed = SkillFile.parse(resolved, filepath, content)
            if (parsed._tag === "Parsed") loaded.set(parsed.skill.id, parsed.skill)
          }
        }
        skills.splice(0, skills.length, ...loaded.values())
        instructions.splice(0, instructions.length, ...(compatibility?.instructions ?? []))
      },
      (effect) => lock.withPermit(effect),
    )

    const reload = refresh().pipe(
      Effect.andThen(ctx.skill.reload()),
      Effect.andThen(discovery ? discovery.reload() : Effect.void),
    )
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* config.changes().pipe(
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Adapter documents and memory files come from the config load, which settles after the raw change.
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh()
    if (discovery)
      yield* discovery.transform((editor) => {
        if (!discovery.project && !discovery.global) return
        for (const file of instructions) editor.add(file)
      })
    yield* ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill)
    })
  }),
})
