import { timingSafeEqual, randomUUID } from "node:crypto"

const MAX_BODY_BYTES = 20 * 1024 * 1024
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

export type GatewayConfig = {
  host: string
  port: number
  token: string
  upstreamURL: string
  upstreamKey: string
  model: string
  fallbackModels: string[]
  timeoutMs: number
}

type JsonObject = Record<string, any>

export function readConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const token = env.OPENCODE_GATEWAY_TOKEN?.trim()
  const upstreamKey = env.OPENCODE_GATEWAY_UPSTREAM_KEY?.trim()
  if (!token) throw new Error("OPENCODE_GATEWAY_TOKEN is required. Generate a long random secret before starting the gateway.")
  if (!upstreamKey) throw new Error("OPENCODE_GATEWAY_UPSTREAM_KEY is required; the upstream credential must stay on this host.")

  const upstreamURL = env.OPENCODE_GATEWAY_UPSTREAM_URL?.trim() ||
    "https://opencode.ai/zen/v1/chat/completions"
  const parsedURL = new URL(upstreamURL)
  if (parsedURL.protocol !== "https:" && parsedURL.protocol !== "http:") {
    throw new Error("OPENCODE_GATEWAY_UPSTREAM_URL must use HTTP or HTTPS.")
  }

  const port = Number(env.OPENCODE_GATEWAY_PORT ?? "8789")
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("OPENCODE_GATEWAY_PORT must be an integer between 1 and 65535.")
  }

  const timeoutMs = Number(env.OPENCODE_GATEWAY_TIMEOUT_MS ?? "120000")
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) {
    throw new Error("OPENCODE_GATEWAY_TIMEOUT_MS must be between 1000 and 600000.")
  }

  const model = env.OPENCODE_GATEWAY_MODEL?.trim() || "space-bunny-free"
  const fallbackModels = [...new Set(
    (env.OPENCODE_GATEWAY_FALLBACK_MODELS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )].filter((value) => value !== model)

  return {
    // Loopback by default. Set 0.0.0.0 only when you intend to serve trusted LAN devices.
    host: env.OPENCODE_GATEWAY_HOST?.trim() || "127.0.0.1",
    port,
    token,
    upstreamURL,
    upstreamKey,
    model,
    fallbackModels,
    timeoutMs,
  }
}

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  })
}

function equalSecret(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function authorized(request: Request, token: string) {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
  const provided = request.headers.get("x-api-key") ?? bearer
  return Boolean(provided && equalSecret(provided, token))
}

function anthropicError(status: number, message: string) {
  const type =
    status === 401 || status === 403
      ? "authentication_error"
      : status === 429
        ? "rate_limit_error"
        : status === 400 || status === 413
          ? "invalid_request_error"
          : status >= 500
            ? "overloaded_error"
            : "api_error"
  return json({ type: "error", error: { type, message } }, status)
}

function textFromBlocks(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value
    .filter((block: any) => block && block.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("")
}

function blockContent(blocks: any[]): string | any[] {
  const output: any[] = []
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue
    if (block.type === "text" && typeof block.text === "string") {
      output.push({ type: "text", text: block.text })
      continue
    }
    if (block.type === "image") {
      const source = block.source ?? {}
      if (source.type === "base64" && source.media_type && source.data) {
        output.push({
          type: "image_url",
          image_url: { url: "data:" + source.media_type + ";base64," + source.data },
        })
      } else if (source.type === "url" && typeof source.url === "string") {
        output.push({ type: "image_url", image_url: { url: source.url } })
      }
    }
  }
  if (output.every((block) => block.type === "text")) return output.map((block) => block.text).join("")
  return output
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? "")
  return content
    .map((part: any) => {
      if (part?.type === "text") return String(part.text ?? "")
      if (part?.type === "image") return "[image result]"
      return JSON.stringify(part)
    })
    .join("\n")
}

export function toOpenAIRequest(input: JsonObject, model: string): JsonObject {
  const messages: any[] = []
  const system = typeof input.system === "string" ? input.system : textFromBlocks(input.system)
  if (system) messages.push({ role: "system", content: system })

  for (const message of Array.isArray(input.messages) ? input.messages : []) {
    const role = message?.role === "assistant" ? "assistant" : "user"
    const blocks = Array.isArray(message?.content)
      ? message.content
      : [{ type: "text", text: String(message?.content ?? "") }]

    if (role === "assistant") {
      const text = textFromBlocks(blocks)
      const toolCalls = blocks
        .filter((block: any) => block?.type === "tool_use")
        .map((block: any) => ({
          id: String(block.id ?? ("call_" + randomUUID())),
          type: "function",
          function: {
            name: String(block.name ?? "unknown_tool"),
            arguments: JSON.stringify(block.input ?? {}),
          },
        }))
      if (text || toolCalls.length) {
        messages.push({
          role: "assistant",
          content: text || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        })
      }
      continue
    }

    // Tool results must be sent as separate OpenAI tool messages; keep surrounding
    // user text and images in their own messages so their order is preserved.
    let pending: any[] = []
    const flush = () => {
      if (!pending.length) return
      messages.push({ role: "user", content: blockContent(pending) })
      pending = []
    }
    for (const block of blocks) {
      if (block?.type === "tool_result") {
        flush()
        messages.push({
          role: "tool",
          tool_call_id: String(block.tool_use_id ?? ""),
          content: toolResultText(block.content),
        })
      } else {
        pending.push(block)
      }
    }
    flush()
  }

  const output: JsonObject = {
    model,
    messages,
    stream: input.stream === true,
  }
  if (Number.isFinite(input.max_tokens)) output.max_tokens = Math.max(1, Math.floor(input.max_tokens))
  if (Number.isFinite(input.temperature)) output.temperature = input.temperature
  if (Number.isFinite(input.top_p)) output.top_p = input.top_p
  if (Array.isArray(input.stop_sequences) && input.stop_sequences.length) output.stop = input.stop_sequences
  if (input.stream === true) output.stream_options = { include_usage: true }

  if (Array.isArray(input.tools) && input.tools.length) {
    output.tools = input.tools
      .filter((tool: any) => tool && typeof tool.name === "string")
      .map((tool: any) => ({
        type: "function",
        function: {
          name: tool.name,
          ...(typeof tool.description === "string" ? { description: tool.description } : {}),
          parameters: tool.input_schema ?? { type: "object", properties: {} },
        },
      }))
  }

  const choice = input.tool_choice
  if (choice === "auto" || choice?.type === "auto") output.tool_choice = "auto"
  else if (choice === "none") output.tool_choice = "none"
  else if (choice?.type === "any" || choice?.type === "required") output.tool_choice = "required"
  else if (choice?.type === "tool" && typeof choice.name === "string") {
    output.tool_choice = { type: "function", function: { name: choice.name } }
  }

  return output
}

function stopReason(reason: string | null | undefined) {
  if (reason === "tool_calls" || reason === "function_call") return "tool_use"
  if (reason === "length") return "max_tokens"
  if (reason === "content_filter") return "refusal"
  return "end_turn"
}

export function toAnthropicResponse(completion: JsonObject, model: string) {
  const choice = completion.choices?.[0] ?? {}
  const message = choice.message ?? {}
  const content: any[] = []
  if (typeof message.content === "string" && message.content.length) {
    content.push({ type: "text", text: message.content })
  }
  for (const call of message.tool_calls ?? []) {
    let input: unknown = {}
    try {
      input = JSON.parse(call.function?.arguments || "{}")
    } catch {
      input = {}
    }
    content.push({
      type: "tool_use",
      id: String(call.id ?? ("toolu_" + randomUUID())),
      name: String(call.function?.name ?? "unknown_tool"),
      input,
    })
  }
  return {
    id: String(completion.id ?? ("msg_" + randomUUID())),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: Number(completion.usage?.prompt_tokens ?? completion.usage?.input_tokens ?? 0),
      output_tokens: Number(completion.usage?.completion_tokens ?? completion.usage?.output_tokens ?? 0),
    },
  }
}

export function modelCandidates(requestedModel: unknown, config: Pick<GatewayConfig, "model" | "fallbackModels">) {
  const allowed = [...new Set([config.model, ...config.fallbackModels])]
  const primary = typeof requestedModel === "string" && allowed.includes(requestedModel)
    ? requestedModel
    : config.model
  return [primary, ...allowed.filter((model) => model !== primary)]
}

function anthropicModels(config: GatewayConfig) {
  const data = [...new Set([config.model, ...config.fallbackModels])].map((id) => ({
    type: "model",
    id,
    display_name: id,
    created_at: new Date(0).toISOString(),
  }))
  return { data, has_more: false, first_id: data[0]?.id, last_id: data.at(-1)?.id }
}

function retryable(status: number) {
  return RETRYABLE_STATUS.has(status)
}

async function upstreamRequest(
  body: JsonObject,
  model: string,
  request: Request,
  config: GatewayConfig,
): Promise<Response> {
  return fetch(config.upstreamURL, {
    method: "POST",
    headers: {
      authorization: "Bearer " + config.upstreamKey,
      "content-type": "application/json",
      accept: body.stream ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify(toOpenAIRequest(body, model)),
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(config.timeoutMs)]),
  })
}

function streamAsAnthropic(source: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
  let cancelled = false
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      const emit = (event: string, data: JsonObject) => {
        if (cancelled) return
        try {
          controller.enqueue(encoder.encode("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n"))
        } catch {
          cancelled = true
        }
      }
      const messageID = "msg_" + randomUUID().replaceAll("-", "")
      let textStarted = false
      let textIndex = 0
      let nextIndex = 0
      let finishReason: string | undefined
      let usage = { input_tokens: 0, output_tokens: 0 }
      const tools = new Map<number, { id: string; name: string; arguments: string }>()

      emit("message_start", {
        type: "message_start",
        message: {
          id: messageID,
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage,
        },
      })

      const processData = (line: string) => {
        if (!line.startsWith("data:")) return
        const raw = line.slice(5).trim()
        if (!raw || raw === "[DONE]") return
        let chunk: JsonObject
        try {
          chunk = JSON.parse(raw)
        } catch {
          return
        }
        if (chunk.usage) {
          usage = {
            input_tokens: Number(chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? usage.input_tokens),
            output_tokens: Number(chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? usage.output_tokens),
          }
        }
        const choice = chunk.choices?.[0]
        if (!choice) return
        const delta = choice.delta ?? {}
        if (typeof delta.content === "string" && delta.content) {
          if (!textStarted) {
            textStarted = true
            textIndex = nextIndex++
            emit("content_block_start", {
              type: "content_block_start",
              index: textIndex,
              content_block: { type: "text", text: "" },
            })
          }
          emit("content_block_delta", {
            type: "content_block_delta",
            index: textIndex,
            delta: { type: "text_delta", text: delta.content },
          })
        }
        for (const item of delta.tool_calls ?? []) {
          const index = Number(item.index ?? 0)
          const current = tools.get(index) ?? { id: "", name: "", arguments: "" }
          if (typeof item.id === "string") current.id = item.id
          if (typeof item.function?.name === "string") current.name += item.function.name
          if (typeof item.function?.arguments === "string") current.arguments += item.function.arguments
          tools.set(index, current)
        }
        if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason
      }

      void (async () => {
        const reader = source.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        try {
          while (!cancelled) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let newline = buffer.indexOf("\n")
            while (newline !== -1) {
              const line = buffer.slice(0, newline).replace(/\r$/, "")
              buffer = buffer.slice(newline + 1)
              processData(line)
              newline = buffer.indexOf("\n")
            }
          }
          buffer += decoder.decode()
          if (buffer.trim()) processData(buffer.replace(/\r$/, ""))
          if (textStarted) emit("content_block_stop", { type: "content_block_stop", index: textIndex })

          for (const [, tool] of [...tools.entries()].sort(([a], [b]) => a - b)) {
            const index = nextIndex++
            const argumentsJSON = tool.arguments || "{}"
            emit("content_block_start", {
              type: "content_block_start",
              index,
              content_block: {
                type: "tool_use",
                id: tool.id || ("toolu_" + randomUUID()),
                name: tool.name || "unknown_tool",
                input: {},
              },
            })
            emit("content_block_delta", {
              type: "content_block_delta",
              index,
              delta: { type: "input_json_delta", partial_json: argumentsJSON },
            })
            emit("content_block_stop", { type: "content_block_stop", index })
          }

          emit("message_delta", {
            type: "message_delta",
            delta: { stop_reason: stopReason(finishReason), stop_sequence: null },
            usage: { output_tokens: usage.output_tokens },
          })
          emit("message_stop", { type: "message_stop" })
        } catch {
          emit("error", {
            type: "error",
            error: { type: "api_error", message: "The upstream response stream ended unexpectedly." },
          })
        } finally {
          try {
            reader.releaseLock()
          } catch {}
          if (!cancelled) {
            try {
              controller.close()
            } catch {}
          }
        }
      })()
    },
    cancel(reason) {
      cancelled = true
      void source.cancel(reason).catch(() => {})
    },
  })
}

async function messages(request: Request, config: GatewayConfig) {
  const declaredSize = Number(request.headers.get("content-length") ?? "0")
  if (declaredSize > MAX_BODY_BYTES) return anthropicError(413, "Request body is too large.")

  let input: JsonObject
  try {
    const text = await request.text()
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return anthropicError(413, "Request body is too large.")
    input = JSON.parse(text)
  } catch {
    return anthropicError(400, "Request body must be valid JSON.")
  }
  if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
    return anthropicError(400, "A non-empty messages array is required.")
  }

  const candidates = modelCandidates(input.model, config)
  let lastStatus = 502
  for (let index = 0; index < candidates.length; index++) {
    const model = candidates[index]
    let upstream: Response
    try {
      upstream = await upstreamRequest(input, model, request, config)
    } catch (error) {
      lastStatus = 502
      console.warn("[room-gateway] upstream connection failed for model " + model + ": " +
        (error instanceof Error ? error.message : "unknown error"))
      if (index < candidates.length - 1) continue
      return anthropicError(502, "Could not reach the upstream model service.")
    }

    if (!upstream.ok) {
      lastStatus = upstream.status
      // Retry only before response bytes are sent. No IP rotation and no retry of client errors.
      if (retryable(upstream.status) && index < candidates.length - 1) {
        console.warn("[room-gateway] upstream returned HTTP " + upstream.status + " for model " + model +
          "; trying configured fallback")
        try {
          await upstream.body?.cancel()
        } catch {}
        continue
      }
      return anthropicError(upstream.status, "Upstream request failed with HTTP " + upstream.status + ".")
    }

    if (input.stream === true) {
      if (!upstream.body) return anthropicError(502, "The upstream service returned an empty stream.")
      return new Response(streamAsAnthropic(upstream.body, model), {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      })
    }

    let completion: JsonObject
    try {
      completion = await upstream.json()
    } catch {
      return anthropicError(502, "The upstream service returned invalid JSON.")
    }
    return json(toAnthropicResponse(completion, model))
  }

  return anthropicError(lastStatus, "All configured upstream models failed.")
}

export async function handleRequest(request: Request, config: GatewayConfig): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === "/health" && request.method === "GET") {
    return json({ status: "ok", service: "opencode-room-gateway" })
  }

  if (!url.pathname.startsWith("/v1/")) return json({ error: "Not found" }, 404)
  if (!authorized(request, config.token)) {
    return anthropicError(401, "A valid gateway token is required.")
  }

  if (url.pathname === "/v1/models" && request.method === "GET") return json(anthropicModels(config))
  if (url.pathname === "/v1/messages" && request.method === "POST") return messages(request, config)
  return anthropicError(404, "Endpoint not found.")
}

if (import.meta.main) {
  let config: GatewayConfig
  try {
    config = readConfig()
  } catch (error) {
    console.error("[room-gateway] " + (error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: (request) => handleRequest(request, config),
  })
  console.log("[room-gateway] listening on http://" + server.hostname + ":" + server.port)
  console.log("[room-gateway] upstream: " + new URL(config.upstreamURL).origin +
    "; model: " + config.model + "; fallbacks: " + config.fallbackModels.length)
}
