import { EOL } from "os"
import { Effect } from "effect"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.restart,
  Effect.fn("cli.service.restart")(function* () {
    const options = yield* ServiceConfig.options()
    // Restart must never depend on a live HTTP connection to the old process.
    // Service.stop() performs the best-effort PTY handoff with a bounded timeout,
    // then terminates the registered PID and removes its registration.
    yield* Service.stop({ ...options, pty: "handoff" })
    const transport = yield* Service.ensure(options)
    process.stdout.write(transport.url + EOL)
  }),
)
