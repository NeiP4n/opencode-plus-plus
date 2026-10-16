import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { client, table } from "./shared"

export default Runtime.handler(
  Commands.commands.compat.commands.list,
  Effect.fn("cli.compat.list")(function* (input) {
    const api = yield* client(input)
    const report = yield* Effect.tryPromise({
      try: (signal) => api.config.compatibility.get({ location: { directory: process.cwd() } }, { signal }),
      catch: (cause) => cause,
    })
    process.stdout.write(input.format === "json" ? JSON.stringify(report, null, 2) + "\n" : table(report))
  }),
)
