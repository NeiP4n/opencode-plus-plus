# OpenCode++ Room AI Gateway

A small Anthropic Messages API bridge intended to run on the host machine for a trusted LAN-room. It lets Claude Code or another Anthropic-compatible client call an OpenAI-compatible upstream such as OpenCode Zen, while keeping the upstream API key on the host.

## What it does

- Exposes POST /v1/messages and GET /v1/models.
- Converts Anthropic text, image, and tool-use messages to OpenAI Chat Completions requests and converts normal and SSE streaming responses back to Anthropic Messages format.
- Requires a separate bearer token (or x-api-key) for all /v1/* routes.
- Retries a 429 / selected gateway errors against a configured allowlist of fallback models before any response bytes are sent.
- Binds to loopback by default. It never rotates IP addresses or changes OS networking.

## Run it

From the repository root with the OpenCode++ CLI available:

~~~bash
# Linux / macOS: generate a gateway secret and keep it private.
export OPENCODE_GATEWAY_TOKEN="$(openssl rand -hex 32)"
export OPENCODE_GATEWAY_UPSTREAM_KEY="your-opencode-zen-api-key"
export OPENCODE_GATEWAY_MODEL="glm-4.7-free"
# Optional comma-separated model allowlist used only as failover targets.
export OPENCODE_GATEWAY_FALLBACK_MODELS="minimax-m2.1-free,kimi-k2.5-free,qwen-2.5-72b-free,llama-3.3-70b-free"

opencode gateway --model glm-4.7-free \
  --fallback-model minimax-m2.1-free \
  --fallback-model kimi-k2.5-free \
  --fallback-model qwen-2.5-72b-free \
  --fallback-model llama-3.3-70b-free
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
| OPENCODE_GATEWAY_TOKEN | Required secret of at least 32 characters for standalone-token mode; omit it for room-token mode. |
| OPENCODE_GATEWAY_UPSTREAM_URL | OpenAI-compatible Chat Completions URL. |
| OPENCODE_GATEWAY_UPSTREAM_KEY | Required upstream key; never sent to clients. |
| OPENCODE_GATEWAY_MODEL | Primary upstream model, default glm-4.7-free. |
| OPENCODE_GATEWAY_FALLBACK_MODELS | Optional comma-separated fallback model IDs. |
| OPENCODE_GATEWAY_TIMEOUT_MS | Upstream timeout from 1,000 to 600,000 ms. |
| OPENCODE_GATEWAY_ROOM_API_URL | Local OpenCode API base URL for room-token mode, e.g. http://127.0.0.1:4096. |
| OPENCODE_GATEWAY_ROOM_ID | Room ID; required together with ROOM_API_URL and incompatible with OPENCODE_GATEWAY_TOKEN. |


The CLI also accepts `--host`, `--port`, `--upstream`, `--model`, repeatable `--fallback-model`, `--room-api-url`, and `--room-id` options; command-line values override corresponding environment variables. Secret values are intentionally environment-only, so they are not exposed in process arguments.

## Use a LAN-room guest token

To make the gateway follow the actual room roster and roles instead of sharing a separate gateway secret, set the URL of the OpenCode server running this room and its room ID. The room URL should be loopback when the gateway runs on the same device, so the guest token never needs to cross the LAN just for authorization:

~~~bash
unset OPENCODE_GATEWAY_TOKEN
export OPENCODE_GATEWAY_ROOM_API_URL="http://127.0.0.1:4096"
export OPENCODE_GATEWAY_ROOM_ID="room_your_room_id"
export OPENCODE_GATEWAY_UPSTREAM_KEY="your-opencode-zen-api-key"
opencode gateway --host 0.0.0.0 --model glm-4.7-free
~~~

In this mode, configure clients with their own active **guest token for that room** as the Anthropic API key. Requests are validated against the room server on every call: `member`, `helper`, `cohost`, and `trusted` roles can use the gateway; `viewer` is refused. Removing a guest or changing them to viewer blocks subsequent requests. Room-token mode and standalone gateway-token mode are mutually exclusive.

## Use from a LAN device

Start it on the host machine with:

~~~bash
opencode gateway --host 0.0.0.0 --model glm-4.7-free
~~~

Configure a client with:
- Base URL: http://HOST_LAN_IP:8789
- API key: the value of OPENCODE_GATEWAY_TOKEN
- Model: one of the IDs returned by GET /v1/models

For Claude Code on Linux/macOS, set the endpoint and use the standalone gateway token or (in room-token mode) your room guest token as the Anthropic API key:

~~~bash
export ANTHROPIC_BASE_URL="http://HOST_LAN_IP:8789"
export ANTHROPIC_API_KEY="$OPENCODE_GATEWAY_TOKEN"
claude
~~~

In PowerShell:

~~~powershell
$env:ANTHROPIC_BASE_URL = "http://HOST_LAN_IP:8789"
$env:ANTHROPIC_API_KEY = "paste-the-gateway-token-here"
claude
~~~

The same endpoint can be used by an Anthropic-compatible SDK or provider. The upstream provider key remains on the host and is never sent to clients.

**LAN security:** use a firewall to limit port 8789 to your private network and do not expose this plain-HTTP listener to the public internet. For traffic across untrusted networks, put it behind a TLS-enabled reverse proxy/VPN. In standalone-token mode, share the gateway token only with trusted devices. Room-token mode validates live room membership and role against the configured room API.

## Retry behavior and limitations

A request starts with the requested model if it is in the configured allowlist, otherwise it uses the primary model. If the upstream rejects it with HTTP 429 or a retryable gateway error, the gateway tries the remaining configured models before returning an error. It never retries after it has begun streaming to the client, to avoid duplicate tool calls or output.

The example free-model IDs are a starting point, not a guarantee that every model is currently enabled for every account; verify them with the upstream provider and configure only supported IDs. Fallback models can have different capabilities, output quality, tool-call behavior, or availability. Configure only models that your upstream account can use. This is model failover, not a way to reset an account's service-side quota. The gateway does not support upstream APIs other than OpenAI-compatible Chat Completions and does not attempt to emulate every Anthropic API feature.

## Test

~~~bash
bun run --cwd packages/cli test
bun run --cwd packages/cli typecheck
~~~
