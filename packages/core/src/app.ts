export * as App from "./app.js"

import { Context, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"

export interface Info {
  readonly name: string
  readonly version: string
  readonly channel: string
}

export const Metadata = Context.Reference<Info>("@opencode/App", {
  defaultValue: () => make(),
})

export function make(input: Partial<Info> = {}): Info {
  return {
    name: input.name ?? "opencode",
    version: input.version ?? "unknown",
    channel: input.channel ?? "unknown",
  }
}

export function useragent(app: Info) {
  // OpenCode Zen accepts the compact product/version form for non-release builds. Branch names
  // such as "lan-rooms" are build metadata, not published client channels, and putting them in
  // the channel position makes Zen reject an otherwise compatible request. Keep the explicit
  // channel/artifact format for the official latest channel; non-release versions carry a git
  // build identifier from packages/script so they remain distinguishable without claiming latest.
  if (app.channel === "latest") return `opencode/latest/${app.version}/${app.name}`
  return `opencode/${app.version}`
}

export const layer = (input?: Partial<Info>) => Layer.succeed(Metadata, make(input))

export const configured = (input?: Partial<Info>) =>
  makeGlobalNode({ service: Metadata, layer: layer(input), deps: [] })

export const node = configured()
