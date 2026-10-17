# OpenCode++ Room AI Gateway

A small Anthropic Messages API bridge intended to run on the host machine for a trusted LAN-room. It lets Claude Code or another Anthropic-compatible client call an OpenAI-compatible upstream such as OpenCode Zen, while keeping the upstream API key on the host.

## What it does

- Exposes POST /v1/messages and GET /v1/models.
- Converts Anthropic text, image, and tool-use messages to OpenAI Chat Completions requests and converts normal and SSE streaming responses back to Anthropic Messages format.
- Requires a separate bearer token (or x-api-key) for all /v1/* routes.
- Retries a 429 / selected gateway errors against a configured allowlist of fallback models before any response bytes are sent.
- Binds to loopback by default. It never rotates IP addresses or changes OS networking.

## Run it

From the repository root with Bun installed:

~~~bash
# Linux / macOS: generate a gateway secret and keep it private.
export OPENCODE_GATEWAY_TOKEN="$(openssl rand -hex 32)"
export OPENCODE_GATEWAY_UPSTREAM_KEY="your-opencode-zen-api-key"
export OPENCODE_GATEWAY_MODEL="space-bunny-free"
# Optional comma-separated model allowlist used only as failover targets.
export OPENCODE_GATEWAY_FALLBACK_MODELS="mimo-v2.6-flash-free,ling-3.1-flash-fin-free"

bun run --cwd packages/room-gateway start
~~~

Defaults:
- bind: 127.0.0.1:8789
- upstream: https://opencode.ai/zen/v1/chat/completions
- request timeout: 120 seconds

Configuration:

| Variable | Purpose |
| --- | --- |
| OPENCODE_GATEWAY_HOST | Bind host; defaults to 127.0.0.1. Set 0.0.0.0 only to accept LAN connections. |
| OPENCODE_GATEWAY_PORT | Listen port, default 8789. |
| OPENCODE_GATEWAY_TOKEN | Required secret used by clients to authenticate to the gateway. |
| OPENCODE_GATEWAY_UPSTREAM_URL | OpenAI-compatible Chat Completions URL. |
| OPENCODE_GATEWAY_UPSTREAM_KEY | Required upstream key; never sent to clients. |
| OPENCODE_GATEWAY_MODEL | Primary upstream model, default space-bunny-free. |
| OPENCODE_GATEWAY_FALLBACK_MODELS | Optional comma-separated fallback model IDs. |
| OPENCODE_GATEWAY_TIMEOUT_MS | Upstream timeout from 1,000 to 600,000 ms. |

## Use from a LAN device

Start it on the host machine with:

~~~bash
export OPENCODE_GATEWAY_HOST=0.0.0.0
bun run --cwd packages/room-gateway start
~~~

Configure a client with:
- Base URL: http://HOST_LAN_IP:8789
- API key: the value of OPENCODE_GATEWAY_TOKEN
- Model: one of the IDs returned by GET /v1/models

For Claude Code, set the usual Anthropic base URL and API-key environment variables to those values before launching it. The same endpoint can be used by an Anthropic-compatible SDK or provider.

**LAN security:** use a firewall to limit port 8789 to your private network, distribute the gateway token only to trusted devices, and do not expose this plain-HTTP listener to the public internet. For traffic across untrusted networks, put it behind a TLS-enabled reverse proxy/VPN. The gateway token is separate from an OpenCode room invitation token and does not currently inherit room membership or role revocations; revoke/rotate it independently.

## Retry behavior and limitations

A request starts with the requested model if it is in the configured allowlist, otherwise it uses the primary model. If the upstream rejects it with HTTP 429 or a retryable gateway error, the gateway tries the remaining configured models before returning an error. It never retries after it has begun streaming to the client, to avoid duplicate tool calls or output.

Fallback models can have different capabilities, output quality, tool-call behavior, or availability. Configure only models that your upstream account can use. This is model failover, not a way to reset an account's service-side quota. The gateway does not support upstream APIs other than OpenAI-compatible Chat Completions and does not attempt to emulate every Anthropic API feature.

## Test

~~~bash
bun run --cwd packages/room-gateway test
bun run --cwd packages/room-gateway typecheck
~~~
