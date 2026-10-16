import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { change } from "./shared"

export default Runtime.handler(
  Commands.commands.compat.commands.untrust,
  Effect.fn("cli.compat.untrust")(function* (input) {
    yield* change(input, { trusted: false }, `${input.ecosystem} is no longer trusted`)
  }),
)
