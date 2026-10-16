import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { change } from "./shared"

export default Runtime.handler(
  Commands.commands.compat.commands.reset,
  Effect.fn("cli.compat.reset")(function* (input) {
    yield* change(input, { enabled: null }, `${input.ecosystem} follows config again`)
  }),
)
