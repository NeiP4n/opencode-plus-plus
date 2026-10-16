import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { change } from "./shared"

export default Runtime.handler(
  Commands.commands.compat.commands.enable,
  Effect.fn("cli.compat.enable")(function* (input) {
    yield* change(input, { enabled: true }, `${input.ecosystem} is on`)
  }),
)
