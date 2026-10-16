export * as ClaudeModel from "./model.js"

import snapshotText from "../../models-dev/snapshot.txt" with { type: "text" }

const FAMILIES = ["opus", "sonnet", "haiku", "fable"] as const
type Family = (typeof FAMILIES)[number]

let latestCache: Partial<Record<Family, string>> | undefined

/**
 * The newest plain id per family (`claude-sonnet-5-5`, not dated or `-thinking` variants) in the bundled
 * models.dev snapshot, so aliases follow the snapshot instead of a hand-kept table.
 */
export function latest(): Partial<Record<Family, string>> {
  if (latestCache) return latestCache
  const best = new Map<Family, { id: string; version: readonly number[] }>()
  for (const [, id, family, major, minor] of snapshotText.matchAll(
    /"(claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?)"/g,
  )) {
    const version = [Number(major), Number(minor ?? 0)]
    const current = best.get(family as Family)
    if (
      !current ||
      version[0] > current.version[0] ||
      (version[0] === current.version[0] && version[1] > current.version[1])
    )
      best.set(family as Family, { id, version })
  }
  latestCache = Object.fromEntries(Array.from(best, ([family, item]) => [family, item.id]))
  return latestCache
}

export type Resolved =
  | { readonly type: "model"; readonly model: string }
  | { readonly type: "inherit" }
  | { readonly type: "unsupported"; readonly reason: string }

/** Claude's `model` value as an OpenCode `provider/model` selection. */
export function resolve(value: unknown): Resolved {
  if (value === undefined || value === null || value === "" || value === "inherit") return { type: "inherit" }
  if (typeof value !== "string")
    return { type: "unsupported", reason: `model ${JSON.stringify(value)} is not a string` }
  const alias = value.toLowerCase().replace(/\[1m\]$/, "")
  if ((FAMILIES as readonly string[]).includes(alias)) {
    const id = latest()[alias as Family]
    return id
      ? { type: "model", model: `anthropic/${id}` }
      : { type: "unsupported", reason: `no ${alias} model is known` }
  }
  if (alias === "default" || alias === "opusplan") return { type: "inherit" }
  if (/^claude-[a-z0-9.-]+$/.test(alias)) return { type: "model", model: `anthropic/${alias}` }
  if (value.includes("/")) return { type: "model", model: value }
  return { type: "unsupported", reason: `unknown model ${JSON.stringify(value)}` }
}
