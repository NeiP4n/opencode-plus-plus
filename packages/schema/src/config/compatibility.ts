export * as ConfigCompatibility from "./compatibility.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

/** Other agent tools whose project and home folders OpenCode can read. */
export const Ecosystem = Schema.Literals(["agents", "claude", "codex", "gemini", "cursor"]).annotate({
  identifier: "Config.Compatibility.Ecosystem",
})
export type Ecosystem = typeof Ecosystem.Type

/** On/off per ecosystem; an absent key leaves the decision to the next source. */
export const Choices = Schema.Struct({
  agents: Schema.Boolean.pipe(optional),
  claude: Schema.Boolean.pipe(optional),
  codex: Schema.Boolean.pipe(optional),
  gemini: Schema.Boolean.pipe(optional),
  cursor: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Config.Compatibility.Choices" })
export interface Choices extends Schema.Schema.Type<typeof Choices> {}

export const Info = Schema.Struct({
  enabled: Schema.Boolean.pipe(optional).annotate({
    description: "false stops reading every ecosystem unless a project turns one on explicitly",
  }),
  ecosystems: Choices.pipe(optional).annotate({
    description: "Turn reading an ecosystem's folders on or off; every detected ecosystem is on by default",
  }),
  order: Schema.Array(Ecosystem).pipe(optional).annotate({
    description:
      "Merge priority when ecosystems define the same name: earlier entries win, unlisted ecosystems follow in default order",
  }),
}).annotate({ identifier: "Config.Compatibility" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const Folder = Schema.Struct({
  path: Schema.String,
  scope: Schema.Literals(["global", "project"]),
}).annotate({ identifier: "Config.Compatibility.Folder" })
export interface Folder extends Schema.Schema.Type<typeof Folder> {}

export const Loaded = Schema.Struct({
  instructions: Schema.Number,
  commands: Schema.Number,
  agents: Schema.Number,
  mcp: Schema.Number,
  rules: Schema.Number,
  hooks: Schema.Number,
}).annotate({ identifier: "Config.Compatibility.Loaded" })
export interface Loaded extends Schema.Schema.Type<typeof Loaded> {}

export const Skipped = Schema.Struct({
  source: Schema.String,
  reason: Schema.String,
}).annotate({ identifier: "Config.Compatibility.Skipped" })
export interface Skipped extends Schema.Schema.Type<typeof Skipped> {}

/** One ecosystem as seen from a location: whether it is on, who decided, and what of it exists. */
export const Found = Schema.Struct({
  id: Ecosystem,
  label: Schema.String,
  enabled: Schema.Boolean,
  decidedBy: Schema.Literals(["project", "config", "default"]),
  trusted: Schema.Boolean,
  folders: Schema.Array(Folder),
  markers: Schema.Array(Schema.String),
  /** What an adapter carried over; absent for ecosystems without one. */
  loaded: Schema.optionalKey(Loaded),
  /** What was found but not carried over, and why. */
  skipped: Schema.optionalKey(Schema.Array(Skipped)),
  /** How many of the skipped items would load once the user trusts this ecosystem for the project. */
  awaitingTrust: Schema.optionalKey(Schema.Number),
}).annotate({ identifier: "Config.Compatibility.Found" })
export interface Found extends Schema.Schema.Type<typeof Found> {}

export const Report = Schema.Struct({
  /** Project root the per-project choices are stored under. */
  root: Schema.String,
  /** The master switch from config; ecosystems are off by default when it is false. */
  enabled: Schema.Boolean,
  /** Merge priority of the ecosystems that are on, highest first. */
  order: Schema.Array(Ecosystem),
  ecosystems: Schema.Array(Found),
}).annotate({ identifier: "Config.Compatibility.Report" })
export interface Report extends Schema.Schema.Type<typeof Report> {}

/** A per-project change: `enabled: null` clears the choice so config and the default decide again. */
export const Change = Schema.Struct({
  ecosystem: Ecosystem,
  enabled: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  trusted: Schema.optionalKey(Schema.Boolean),
}).annotate({ identifier: "Config.Compatibility.Change" })
export interface Change extends Schema.Schema.Type<typeof Change> {}
