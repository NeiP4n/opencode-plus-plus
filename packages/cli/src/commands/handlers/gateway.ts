import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { readConfig, runGateway } from "../../gateway"

export default Runtime.handler(
  Commands.commands.gateway,
  Effect.fnUntraced(function* (input) {
    const env: Record<string, string | undefined> = { ...process.env }
    if (input.host) env.OPENCODE_GATEWAY_HOST = input.host
    if (input.port !== undefined) env.OPENCODE_GATEWAY_PORT = String(input.port)

    let config: ReturnType<typeof readConfig>
    try {
      config = readConfig(env)
    } catch (error) {
      return yield* Effect.fail(new Error(error instanceof Error ? error.message : String(error)))
    }

    return yield* Effect.promise(() => runGateway(config))
  }),
)
