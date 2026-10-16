export * as HubInstructions from "./instructions.js"

import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Instructions } from "../instructions/index.js"
import { available } from "./resolve.js"
import { HubState } from "./state.js"
import { HubPrompt } from "./prompt.js"
import { HubHost } from "./host.js"

const key = Instructions.Key.make("core/hub-hints")

export type Options = {
  // Tests inject the state directory and probes; production reads the global
  // hub.json and probes the live PATH.
  readonly directory?: string
  readonly availability?: readonly string[]
  readonly terminals?: readonly string[]
}

// The block text is the stored value: one string hashes canonically, and the
// read folds "nothing to say" into `removed`, which keeps the key out of the
// rendered prompt entirely — with nothing installed the prompt stays
// byte-identical to what it was before this source existed.
const readHints = (options: Options): Effect.Effect<string | typeof Instructions.removed> =>
  Effect.tryPromise({
    try: () => HubState.read(options),
    catch: () => undefined,
  }).pipe(
    Effect.map((state) =>
      HubPrompt.renderHubHints({
        state,
        availability: options.availability ?? available(),
        terminals: options.terminals ?? terminalBackends(),
      }),
    ),
    // An unreadable hub.json must not block session initialization the way an
    // unavailable source would: degrade to "nothing enabled" instead.
    Effect.orElseSucceed(() => ""),
    Effect.map((text) => (text === "" ? Instructions.removed : text)),
  )

export const make = (options: Options = {}): Instructions.List =>
  Instructions.make({
    key,
    codec: Schema.toCodecJson(Schema.String),
    read: readHints(options),
    render: {
      initial: (text) => text,
      changed: (_previous, text) =>
        ["The installed hub tools have changed; this list replaces the previous one:", text].join("\n"),
      removed: () =>
        "No hub tools are installed any more: do not rely on what was listed before.",
    },
  })

// Backends with a working shell on this machine, in this platform's order:
// on Windows bash only counts when Git Bash is installed.
const terminalBackends = (): string[] => HubHost.backends()


export interface Interface {
  /** Builds a fresh instruction source that lists the installed Hub tools. */
  readonly load: () => Instructions.List
}

export class Service extends Context.Service<Service, Interface>()("@opencode/HubInstructions") {}

const layer = Layer.sync(Service, () => Service.of({ load: () => make() }))

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
