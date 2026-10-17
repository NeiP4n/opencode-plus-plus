export * as ConfigProxy from "./proxy.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

/** Proxy settings applied only inside the OpenCode process. */
export const Info = Schema.Struct({
  http: Schema.String.pipe(optional),
  https: Schema.String.pipe(optional),
  no_proxy: Schema.Array(Schema.String).pipe(optional),
}).annotate({ identifier: "Config.Proxy" })

export type Info = typeof Info.Type
