import { Schema } from "effect"
import { Rpc } from "@opencode/schema/rpc"

/**
 * Contract between the core Freebuff plugin and its TUI companion
 * (`opencode.freebuff` in the TUI feature plugins). The TUI calls these
 * methods to render the balance dialog and manage several accounts.
 */
/** One catalog row with the price a session on it costs. */
export const ModelPrice = Schema.Struct({
  /** Catalog row key (`m-...`), the id the model picker shows. */
  key: Schema.String,
  /** Marketing name from the catalog. */
  name: Schema.String,
  /** Freebucks a session on this model costs; absent when the price is unknown. */
  price: Schema.optional(Schema.Number),
  /** Gateway model id the price belongs to; absent when the price is unknown. */
  modelID: Schema.optional(Schema.String),
  /** `open` rows run on the current plan, `locked` rows need a paid plan. */
  access: Schema.optional(Schema.String),
})

export const Status = Schema.Struct({
  loggedIn: Schema.Boolean,
  /** Freebucks on the balance. */
  balance: Schema.optional(Schema.Number),
  /** Freebucks spent today. */
  spent: Schema.optional(Schema.Number),
  /** Daily freebucks limit. */
  limit: Schema.optional(Schema.Number),
  /** Milliseconds until the daily freebucks reset. */
  resetIn: Schema.optional(Schema.Number),
  /** Milliseconds until the active session expires. */
  sessionEndsIn: Schema.optional(Schema.Number),
  tier: Schema.optional(Schema.String),
  /** Price per catalog row, so the picker and the dialog can show what a session costs. */
  prices: Schema.optional(Schema.Array(ModelPrice)),
})

export const Account = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  active: Schema.Boolean,
})

export const FreebuffRpc = Rpc.define({
  id: "opencode.freebuff",
  methods: {
    /** Read-only balance lookup; never touches sessions. */
    status: { input: Schema.Struct({}), output: Status },
    accounts: { input: Schema.Struct({}), output: Schema.Struct({ accounts: Schema.Array(Account) }) },
    /** Switches the active account; `ok` is false when the id is unknown. */
    use: { input: Schema.Struct({ id: Schema.String }), output: Schema.Struct({ ok: Schema.Boolean }) },
    /** Starts a browser login for one more account and returns its URL. */
    add: { input: Schema.Struct({}), output: Schema.Struct({ url: Schema.optional(Schema.String) }) },
  },
  events: {},
})
