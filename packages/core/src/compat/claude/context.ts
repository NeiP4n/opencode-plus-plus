export * as ClaudeContext from "./context.js"

/** Where a Claude source sits and what it may do; every converter takes one. */
export interface Context {
  readonly scope: "global" | "project"
  /** Project sources run code or loosen permissions only when the user trusts Claude for this project. */
  readonly trusted: boolean
  /** The `.claude` folder (or `~/.claude`) the source belongs to. */
  readonly root: string
  /** Project root the per-project choices are keyed by. */
  readonly project: string
  /** Session directory: OpenCode file resources are relative to it. */
  readonly directory: string
  readonly home: string
  readonly env: NodeJS.ProcessEnv
}

/** Something found but not carried over, with the reason, so the user can see it in `opencode compat list`. */
export interface Skipped {
  readonly source: string
  readonly reason: string
}

export const TRUST_HINT = "needs trust: run `opencode compat trust claude` in this project"

/** Home sources are the user's own, so they are always trusted. */
export function allowed(context: Context) {
  return context.scope === "global" || context.trusted
}
