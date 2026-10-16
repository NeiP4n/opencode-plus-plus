import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { change } from "./shared"

export default Runtime.handler(
  Commands.commands.compat.commands.disable,
  Effect.fn("cli.compat.disable")(function* (input) {
    yield* change(input, { enabled: false }, `${input.ecosystem} is off`)
  }),
)
