export * as HubInstructions from "./instructions.js"

import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Instructions } from "../instructions/index.js"
import { available } from "./resolve.js"
import { HubPrompt } from "./prompt.js"
import { HubHost } from "./host.js"
import type { Permission } from "../permission.js"
import { Wildcard } from "../util/wildcard.js"

const key = Instructions.Key.make("core/hub-hints")

export type Options = {
  // Tests inject probes; production probes the live PATH.
  readonly directory?: string
  readonly availability?: readonly string[]
  readonly terminals?: readonly string[]
}

// The block text is the stored value: one string hashes canonically, and the
// read folds "nothing to say" into `removed`, which keeps the key out of the
// rendered prompt entirely — with nothing installed the prompt stays
// byte-identical to what it was before this source existed.
// Only the terminal choice is read from hub.json, so the hints do not depend on it at all:
// installed programs are listed for every session that can run the hub tool.
const readHints = (options: Options): Effect.Effect<string | typeof Instructions.removed> =>
  Effect.sync(() =>
    HubPrompt.renderHubHints({
      availability: options.availability ?? available(),
      terminals: options.terminals ?? terminalBackends(),
    }),
  ).pipe(
    // A failing PATH probe must not block session initialization the way an
    // unavailable source would: degrade to "nothing installed" instead.
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
  /**
   * Builds a fresh instruction source that lists the installed Hub tools. A session whose
   * permissions wholly deny the hub tool (a team role without it) is told nothing.
   */
  readonly load: (permissions?: Permission.Ruleset) => Instructions.List
}

export class Service extends Context.Service<Service, Interface>()("@opencode/HubInstructions") {}

// The instruction source for one session: nothing at all when its permissions wholly deny the hub tool.
export const forPermissions = (permissions?: Permission.Ruleset, options: Options = {}): Instructions.List =>
  permissions !== undefined && hubDenied(permissions) ? make({ ...options, availability: [] }) : make(options)

const layer = Layer.sync(Service, () => Service.of({ load: (permissions) => forPermissions(permissions) }))

// Same test the tool snapshot uses to drop a tool: the last rule for the action denies every resource.
const hubDenied = (permissions: Permission.Ruleset) => {
  const rule = permissions.findLast((item) => Wildcard.match("hub", item.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
