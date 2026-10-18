export * as DodTool from "./dod.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Room } from "@opencode/schema/room"
import type { Tool } from "@opencode/schema/tool"
import { ToolFailure } from "@opencode/ai"
import { optional } from "@opencode/schema/schema"
import { Effect, Schema } from "effect"
import { Dod } from "../../dod.js"
import { Location } from "../../location.js"
import { Orchestra } from "../../orchestra.js"
import { Passport } from "../../passport.js"
import { Permission } from "../../permission.js"

export const name = "dod"

// The AI of this project, one holder for every local session: a new chat picks up the
// item the previous one held instead of finding it taken. Room guests hold items under
// their own member IDs, so they never pass for this one.
export const owner: Dod.Owner = { id: "local-ai", name: "AI" }

export const Input = Schema.Struct({
  action: Schema.Literals([
    "show",
    "item",
    "next",
    "take",
    "check",
    "uncheck",
    "block",
    "release",
    "add",
    "verify",
  ]).annotate({
    description: "What to do with the project's Definition of Done board",
  }),
  id: optional(Schema.String.annotate({ description: "Item ID, such as L-004" })),
  // Models send numbers as strings often enough that refusing them would loop.
  step: optional(
    Schema.Union([Schema.Number, Schema.String]).annotate({ description: "Step number from item, counted from 1" }),
  ),
  reason: optional(Schema.String.annotate({ description: "block: what the item is stuck on; omit to unblock" })),
  what: optional(Schema.String.annotate({ description: "add: the outcome the item delivers, one line" })),
  group: optional(Schema.String.annotate({ description: "add: stage or group the item belongs to" })),
  steps: optional(Schema.Array(Schema.String).annotate({ description: "add: checkable steps, in order" })),
  command: optional(
    Schema.String.annotate({ description: "add: shell command whose exit code 0 proves the item done" }),
  ),
  depends_on: optional(Schema.Array(Schema.String).annotate({ description: "add: IDs that must be DONE first" })),
})
export type Input = typeof Input.Type

export const Output = Schema.Struct({ output: Schema.String })

export const description = [
  "Keep the project's Definition of Done (.opencode/dod.yaml) true to the work. You are responsible for it.",
  "",
  "Actions:",
  "  show — every item with its state, checked steps and holder.",
  "  item — one item (id) with its numbered steps and verification command.",
  "  next — take the first item that is free and whose dependencies are done; your own unfinished item comes first.",
  "  take — take item id before working on it.",
  "  check / uncheck — mark step (number from item) of item id as done or not done; check it as soon as it is really done.",
  "  block — mark item id BLOCKED with reason; without reason it goes back to IN_PROGRESS.",
  "  release — give item id back unfinished.",
  "  add — add an item: what, optional id, group, steps, command (verification) and depends_on. Creates the board when the project has none.",
  "  verify — run item id's verification command; exit code 0 with every step checked makes it DONE with recorded evidence, otherwise FAILED.",
  "",
  "Rules: take an item before working on it; add the user's multi-step work to the board if it is not there; an item becomes DONE only through verify, never by editing dod.yaml; report item IDs and states in your answer.",
].join("\n")

export const Plugin = {
  id: "opencode.tool.dod",
  effect: Effect.fn("DodTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    const orchestra = yield* Orchestra.Service
    const permission = yield* Permission.Service
    // The same root Dod.instructions reads, so the tool edits the board the prompt shows.
    const directory = location.project.directory

    const run = Effect.fn("DodTool.run")(function* (input: Input, context: Tool.Context) {
      const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
      if (writes(input.action))
        yield* permission.assert({
          action: name,
          resources: [Dod.FILE],
          save: [Dod.FILE],
          sessionID: context.sessionID,
          agent: context.agent,
          source,
        })

      // A project has one DoD owner: its main Orchestrator session. Worker sessions are
      // project-owned by Orchestra and must execute existing items instead of growing the
      // board independently. This is enforced here, rather than only in the prompt, so a
      // model cannot bypass the rule by deciding to call `dod add` anyway.
      if (input.action === "add") {
        const owners = yield* orchestra.owners()
        if (owners[context.sessionID] !== undefined)
          return yield* new ToolFailure({
            message:
              "DoD creation is owned by the project Orchestrator. This team session may use existing DoD items, but cannot add new ones. Report missing work to the Orchestrator instead.",
          })
      }

      switch (input.action) {
        case "show":
          return board(yield* Dod.read(directory))
        case "item":
          return yield* describe(yield* need(input.id, "id"))
        case "next": {
          const taken = yield* Dod.next({ directory, owner })
          return [`You hold ${taken.id} now.`, yield* describe(taken.id)].join("\n\n")
        }
        case "take": {
          const id = yield* need(input.id, "id")
          yield* Dod.take({ directory, id, owner })
          return [`You hold ${id} now.`, yield* describe(id)].join("\n\n")
        }
        case "check":
        case "uncheck": {
          const id = yield* need(input.id, "id")
          const step = Number(yield* need(input.step, "step"))
          yield* Dod.check({ directory, id, step, checked: input.action === "check", owner })
          return yield* describe(id)
        }
        case "block": {
          const id = yield* need(input.id, "id")
          yield* Dod.block({ directory, id, owner, reason: input.reason })
          return yield* describe(id)
        }
        case "release": {
          const id = yield* need(input.id, "id")
          yield* Dod.release({ directory, id, owner })
          return `${id} is free again.`
        }
        case "add": {
          const added = yield* Dod.add({
            directory,
            what: yield* need(input.what, "what"),
            id: input.id,
            group: input.group,
            steps: input.steps,
            verify: input.command,
            dependsOn: input.depends_on,
          })
          return [`Added ${added.id}. Take it before you start on it.`, yield* describe(added.id)].join("\n\n")
        }
        case "verify": {
          const id = yield* need(input.id, "id")
          const command = yield* Dod.command({ directory, id, owner })
          // The check is a shell command from a file anyone can edit, so the shell policy decides.
          yield* permission.assert({
            action: "shell",
            resources: [command],
            save: [command],
            sessionID: context.sessionID,
            agent: context.agent,
            source,
          })
          const result = yield* Effect.tryPromise({
            try: (signal) => Passport.run(command, directory, signal),
            catch: (error) => new ToolFailure({ message: `Could not run the check: ${String(error)}` }),
          })
          const dod = yield* Dod.accept({
            directory,
            id,
            command,
            exitCode: result.exitCode,
            summary: summary(result.output, result.exitCode),
            by: owner.name,
          })
          const state = dod.items.find((item) => item.id === id)?.state ?? "unknown"
          return [
            `${id} check \`${command}\` exited ${result.exitCode}; ${id} is ${state} now.`,
            result.output.trim().split("\n").slice(-30).join("\n"),
          ].join("\n\n")
        }
      }
    })

    const describe = Effect.fn("DodTool.describe")(function* (id: string) {
      const { item, steps } = yield* Dod.detail(directory, id)
      return [
        `${item.id} [${item.state}] ${item.what}`,
        `Stage: ${item.stage} · steps ${item.done}/${item.total}${item.owner ? ` · held by ${item.owner}` : " · free"}`,
        ...(item.waits?.length ? [`Waits for: ${item.waits.join(", ")}`] : []),
        ...steps.map((step, index) => `  ${index + 1}. ${step}`),
        item.verify ? `Verification: ${item.verify}` : "Verification: none; the user accepts this item by hand.",
      ].join("\n")
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            run(input, context).pipe(
              Effect.map((output) => ({ output: { output }, content: output })),
              // A refusal from the board is something the model can act on, so it is output, not a crash.
              Effect.mapError(failed),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}

function writes(action: Input["action"]) {
  return action !== "show" && action !== "item" && action !== "verify"
}

function board(dod: Room.Dod) {
  if (dod.status === "disabled") return `This project has no DoD (${Dod.FILE}) yet. Start one with add.`
  if (dod.items.length === 0) return "The DoD has no items. An empty board does not mean the project is done."
  const done = dod.items.filter((item) => item.state === "DONE" || item.state === "OUT_OF_SCOPE").length
  return [
    `DoD: ${done}/${dod.items.length} done.`,
    ...dod.items.map(
      (item) =>
        `- ${item.id} [${item.state}] ${item.what} (${item.done}/${item.total})` +
        (item.owner ? ` · ${item.owner}` : "") +
        (item.waits?.length ? ` · waits for ${item.waits.join(", ")}` : ""),
    ),
  ].join("\n")
}

// The last lines of a check's output, short enough for one line of the DoD.
function summary(output: string, exitCode: number) {
  const tail = output.trim().split("\n").slice(-3).join(" / ").slice(0, 300)
  return tail || `exit code ${exitCode}, no output`
}

const need = <A>(value: A | undefined, field: string) =>
  value === undefined || value === ""
    ? Effect.fail(new ToolFailure({ message: `This action needs ${field}` }))
    : Effect.succeed(value)

function failed(error: unknown) {
  if (error instanceof ToolFailure) return error
  const message = error instanceof Error ? error.message : String(error)
  return new ToolFailure({ message: `DoD action failed: ${message}`, error })
}
