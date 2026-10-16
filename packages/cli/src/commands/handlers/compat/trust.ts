import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { change } from "./shared"

export default Runtime.handler(
  Commands.commands.compat.commands.trust,
  Effect.fn("cli.compat.trust")(function* (input) {
    yield* change(input, { trusted: true }, `${input.ecosystem} is trusted`)
  }),
)
