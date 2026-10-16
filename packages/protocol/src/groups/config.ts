import { Config } from "@opencode/schema/config"
import { ConfigShell } from "@opencode/schema/config/shell"
import { ConfigCompatibility } from "@opencode/schema/config/compatibility"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const ConfigGroup = HttpApiGroup.make("server.config")
  .add(
    HttpApiEndpoint.get("config.get", "/api/config", {
      query: LocationQuery,
      success: Schema.Array(Config.Entry),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "config.get",
          summary: "Get configuration",
          description:
            "Return configuration documents and discovery sources for the requested location, from lowest to highest priority.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("config.shells", "/api/config/shell", {
      success: Schema.Array(ConfigShell.Option),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "config.shells",
        summary: "List available shells",
        description: "Return shells available to terminal and agent execution.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("config.update", "/api/experimental/config", {
      payload: Config.Patch,
      success: HttpApiSchema.NoContent,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.config.update",
        summary: "Update global configuration",
        description: "Patch supported fields in the highest-precedence global configuration document.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("config.compatibility.get", "/api/config/compatibility", {
      query: LocationQuery,
      success: ConfigCompatibility.Report,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "config.compatibility.get",
          summary: "Detect other agent tools",
          description:
            "Report every ecosystem (.claude, .codex, .gemini, ...) found for the requested location, whether it is on, and whether it is trusted.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("config.compatibility.update", "/api/config/compatibility", {
      query: LocationQuery,
      payload: ConfigCompatibility.Change,
      success: ConfigCompatibility.Report,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "config.compatibility.update",
          summary: "Choose or trust an ecosystem for this project",
          description:
            "Store the user's per-project choice outside the repository. The choice outranks config; trust lets project folders run code or loosen permissions.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "config", description: "Location-scoped configuration routes." }))
