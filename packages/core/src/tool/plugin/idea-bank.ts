export * as IdeaBankTool from "./idea-bank.js"

import { Error as ToolError } from "@opencode/schema/tool"
import { Permission } from "../../permission.js"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"

export const name = "idea_bank"

export const description = [
  "Search and use the shared Global Idea Bank, a community catalogue hosted separately from this OpenCode++ installation.",
  "Use action=search to find published ideas, action=get to read one published idea by id, and action=submit to propose a new shared idea.",
  "Use the bank when the user asks for ideas, alternatives, similar projects, or wants to compare an idea with community entries. Search before recommending that an idea is novel.",
  "Never submit just because an idea was mentioned. Submit only when the user directly asks to share or add that idea to the global bank, provide consent=true, and send only a short user-approved title, summary, category, tags and language — never a transcript, secret, personal information, or unrelated chat context.",
  "An explicitly shared idea is published only after server-side privacy checks, duplicate handling, and per-IP quotas. Never submit a chat transcript. If the global bank is not configured, explain that OPENCODE_IDEA_BANK_URL must point to the shared service.",
].join("\n")

export const Input = Schema.Struct({
  action: Schema.Literals(["search", "get", "submit"]),
  query: Schema.optionalKey(Schema.String.annotate({ description: "Terms for searching the shared catalogue; optional for the newest published ideas." })),
  id: Schema.optionalKey(Schema.String.annotate({ description: "Exact published idea id, used with action=get." })),
  category: Schema.optionalKey(Schema.String),
  language: Schema.optionalKey(Schema.String.annotate({ description: "Optional language code such as en or ru." })),
  limit: Schema.optionalKey(Schema.Number),
  title: Schema.optionalKey(Schema.String.annotate({ description: "Short public title for a submission. Do not include private context." })),
  summary: Schema.optionalKey(Schema.String.annotate({ description: "Public summary, edited for sharing; never copy a chat transcript." })),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  consent: Schema.optionalKey(Schema.Boolean.annotate({ description: "Must be true only after the user directly asks to share this idea publicly." })),
})

const Output = Schema.Struct({ output: Schema.String })

const failure = (message: string, error?: unknown) => Effect.fail(new ToolError({ message, error }))

export const Plugin = {
  id: "opencode.tool.idea-bank",
  effect: Effect.fn("IdeaBankTool.Plugin")(function* (ctx: Context) {
    const permission = yield* Permission.Service
    yield* ctx.tool.transform((editor) =>
      editor.add({
        name,
        options: { codemode: false },
        description,
        input: Input,
        output: Output,
        execute: (input, context) =>
          Effect.gen(function* () {
            const configured = process.env.OPENCODE_IDEA_BANK_URL?.trim().replace(/\/+$/, "")
            if (!configured) {
              const output =
                "The global Idea Bank is not connected. Set OPENCODE_IDEA_BANK_URL to the shared public service URL and restart OpenCode++. No idea was sent anywhere."
              return { output: { output }, content: output }
            }

            let base: URL
            try {
              base = new URL(configured)
            } catch (error) {
              return yield* failure("OPENCODE_IDEA_BANK_URL is not a valid URL", error)
            }
            if (
              base.username ||
              base.password ||
              (base.protocol !== "https:" &&
                base.hostname !== "localhost" &&
                base.hostname !== "127.0.0.1" &&
                base.hostname !== "[::1]")
            ) {
              return yield* failure("The global Idea Bank URL must use HTTPS (HTTP is allowed only for localhost development)")
            }

            if (input.action === "submit") {
              if (input.consent !== true)
                return yield* failure("Nothing was shared. First get the user's explicit permission to submit this idea publicly, then call again with consent=true.")
              if (!input.title?.trim() || !input.summary?.trim() || !input.category?.trim())
                return yield* failure("A shared submission needs a title, a public summary, and a category.")
              yield* permission.assert({
                action: name,
                resources: ["submit"],
                save: [],
                metadata: { action: "submit" },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
            }

            let url: URL
            let method: "GET" | "POST" = "GET"
            let body: Record<string, unknown> | undefined
            if (input.action === "search") {
              url = new URL("/v1/ideas", base)
              if (input.query?.trim()) url.searchParams.set("q", input.query.trim().slice(0, 120))
              if (input.category?.trim()) url.searchParams.set("category", input.category.trim().slice(0, 60))
              if (input.language?.trim()) url.searchParams.set("language", input.language.trim().slice(0, 8))
              const limit = input.limit
              if (typeof limit === "number" && Number.isFinite(limit))
                url.searchParams.set("limit", String(Math.max(1, Math.min(50, Math.floor(limit)))))
            } else if (input.action === "get") {
              if (!input.id?.trim()) return yield* failure("Pass the exact idea id with action=get")
              url = new URL("/v1/ideas/" + encodeURIComponent(input.id.trim()), base)
            } else {
              method = "POST"
              url = new URL("/v1/ideas", base)
              body = {
                consent: true,
                title: input.title,
                summary: input.summary,
                category: input.category,
                tags: input.tags ?? [],
                language: input.language ?? "en",
              }
            }

            const response = yield* Effect.tryPromise({
              try: async () => {
                const result = await fetch(url, {
                  method,
                  headers: body ? { "Content-Type": "application/json" } : undefined,
                  body: body ? JSON.stringify(body) : undefined,
                  signal: AbortSignal.timeout(8_000),
                })
                const text = await result.text()
                let data: unknown
                try {
                  data = JSON.parse(text)
                } catch {
                  data = { error: text.slice(0, 500) || "The service returned an empty response." }
                }
                return { ok: result.ok, status: result.status, data }
              },
              catch: (error) =>
                new ToolError({ message: "Could not contact the global Idea Bank. Check its URL and availability.", error }),
            })
            const result = response.data && typeof response.data === "object" && !Array.isArray(response.data)
              ? (response.data as Record<string, unknown>)
              : { result: response.data }
            if (!response.ok) {
              const message = typeof result.error === "string" ? result.error : "Request failed"
              return yield* failure(`Global Idea Bank returned HTTP ${response.status}: ${message}`)
            }
            const output = JSON.stringify(result, null, 2)
            return { output: { output }, content: output }
          }).pipe(
            Effect.mapError((error) =>
              error instanceof ToolError
                ? error
                : new ToolError({
                    message: error instanceof globalThis.Error ? error.message : "Global Idea Bank action failed",
                    error,
                  }),
            ),
          ),
      }),
    )
  }),
}
