export * as Generate from "./generate.js"

import { LLM, LLMClient, AIError } from "@opencode/ai"
import { SessionID } from "@opencode/schema/session-id"
import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { App } from "./app.js"
import { llmClient } from "./effect/app-node-platform.js"
import { ModelResolver } from "./model-resolver.js"
import { Model } from "./model.js"
import { prepare as prepareProviderCompatibility } from "./provider-request-compatibility.js"

export interface TextInput {
  readonly prompt: string
  readonly model?: Model.Ref
}

export class ModelSelectionError extends Schema.TaggedError<ModelSelectionError>()("Generate.ModelSelectionError", {
  message: Schema.String,
}) {}

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("Generate.UnavailableError", {
  message: Schema.String,
  service: Schema.optional(Schema.String),
}) {}

export type Error = ModelSelectionError | UnavailableError

export interface Interface {
  readonly text: (input: TextInput) => Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Generate") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const llm = yield* LLMClient.Service
    const resolver = yield* ModelResolver.Service
    const app = yield* App.Metadata

    const runText = Effect.fn("Generate.text")(function* (input: TextInput) {
      const resolved = yield* resolver.resolve(input.model).pipe(
        Effect.catchTag(
          [
            "SessionRunnerModel.VariantUnavailableError",
            "SessionRunnerModel.UnsupportedPackageError",
            "SessionRunnerModel.ModelConfigurationError",
            "SessionRunnerModel.ModelInitializationError",
            "SessionRunnerModel.UnresolvedProviderVariablesError",
            "SessionRunnerModel.UnsupportedCompactionError",
          ],
          (error) => {
            const mapped: Error = input.model
              ? new ModelSelectionError({ message: error.message })
              : new UnavailableError({ message: error.message, service: error.providerID })
            return Effect.fail(mapped)
          },
        ),
      )
      if (!resolved)
        return yield* new ModelSelectionError({
          message: input.model
            ? `Model unavailable: ${input.model.providerID}/${input.model.id}`
            : "No model specified and no supported model is available",
        })

      const compatibility = prepareProviderCompatibility({
        providerID: resolved.ref.providerID,
        stateless: true,
      })
      const response = yield* llm
        .generate(
          LLM.request({
            model: resolved.model,
            prompt: input.prompt,
            tools: compatibility.tools,
            toolChoice: compatibility.toolChoice,
            // Gateways require session attribution even for a stateless call; no Session is stored. OpenCode Zen's
            // free tier also checks the client identity that Session requests send.
            http: {
              headers: {
                "x-opencode-session": SessionID.create(),
                "x-opencode-session-id": SessionID.create(),
                "User-Agent": App.useragent(app),
                "x-opencode-client": app.name,
              },
            },
          }),
        )
        .pipe(
          Effect.mapError(
            (error: AIError) =>
              new UnavailableError({
                message: error.message,
                service: resolved.ref.providerID,
              }),
          ),
        )
      return response.text
    })

    const text: Interface["text"] = (input) =>
      runText(input).pipe(
        Effect.catchTag(
          "Integration.Authorization",
          () =>
            new UnavailableError({
              message: "Generation credentials are unavailable",
            }),
        ),
      )

    return Service.of({ text })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ModelResolver.node, llmClient, App.node],
})
