# Global Idea Bank

This is the shared service for community ideas. It runs separately from each OpenCode++ installation so users on different machines can search the same published catalogue. It stores ideas in Cloudflare D1, not chat transcripts.

## Safety rules

- Public search returns only ideas with status `published`.
- New ideas require explicit `consent: true`. After validation, sensitive-content checks, deduplication, and a per-IP daily quota, they become searchable immediately. Repeated matching submissions increment the existing idea's signal count.
- The database stores the submitted title, summary, category, tags, language, timestamps, a daily-rotating salted IP hash used for rate limiting, and a duplicate-detection hash. It does not store the source chat or raw IP address.
- The quota is five contribution attempts per IP per UTC day. Its salted pseudonymous hash rotates daily; the counter increments atomically and duplicate submissions count too. This is a UTC-day quota, not a rolling 24-hour window.
- Credentials, emails, URLs, IP addresses, and common home-directory paths are rejected. This filter helps catch accidental disclosure but is not a guarantee that arbitrary text is anonymous.
- The built-in AI tool can search, get a single idea, and submit an idea. It must not submit unless the user explicitly asks to share it. A separate TUI toggle enables automatic contribution of fixed, predefined idea categories inferred by local rules; it is off by default and never sends the source message or transcript. Global sharing can be paused at any time.
- A seed catalogue is included so new deployments are useful immediately.

## Deploy your shared instance

You need a Cloudflare account with Workers and D1 enabled. The same Worker URL will be used by all installations that should share the bank.

From the repository root:

```sh
cd services/idea-bank
bun run db:create
```

Copy the D1 `database_id` printed by Wrangler. There are two deployment options.

**Recommended — GitHub Actions:** in repository Settings → Secrets and variables → Actions, add these secrets:

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token allowed to manage Workers and D1.
- `CLOUDFLARE_ACCOUNT_ID` — the 32-character account ID shown in the Cloudflare dashboard.
- `IDEA_BANK_DATABASE_ID` — the D1 UUID from `bun run db:create`.
- `IDEA_BANK_ADMIN_TOKEN` — a long random token for admin-only review endpoints.
- `RATE_LIMIT_SALT` — an independent long random value used to hash IPs for the daily quota.

Then open Actions → **deploy-idea-bank** → **Run workflow**. The workflow substitutes the D1 ID only inside its temporary checkout, applies migrations, sets Worker secrets, and deploys the service. Secret values are not committed to Git.

**Manual deployment:** replace the all-zero `database_id` in `wrangler.jsonc`, export `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in your shell, then run:

```sh
bun run db:migrate:remote
bunx wrangler secret put IDEA_BANK_ADMIN_TOKEN
bunx wrangler secret put RATE_LIMIT_SALT
bun run deploy
```

Never commit the secrets. For local development, run `bun run db:migrate:local` and `bun run dev`.

Wrangler prints a public `workers.dev` URL after deployment, for example `https://opencode-idea-bank.<your-account>.workers.dev`. Set it on each OpenCode++ installation that should share the bank:

```sh
OPENCODE_IDEA_BANK_URL=https://opencode-idea-bank.<your-account>.workers.dev
```

Restart OpenCode++ after changing the environment variable. If it is not set, the built-in tool explains how to configure it instead of silently contacting some other server.

## API

- `GET /v1/health` — service health.
- `GET /v1/ideas?q=translation&limit=20` — search published ideas using Unicode-normalized terms, including Cyrillic; also supports `category`, `language`, and `offset`.
- `GET /v1/ideas/:id` — retrieve one published idea.
- `POST /v1/ideas` — share an idea with `consent: true`; returns `201` and status `published`. Duplicate content returns the existing id and increments `signalCount`.
- `GET /v1/admin/submissions` — list pending entries; requires `Authorization: Bearer <IDEA_BANK_ADMIN_TOKEN>`.
- `POST /v1/admin/submissions/:id/review` with `{"status":"published"}` or `{"status":"rejected"}` — moderate an entry.

The admin queue is retained for pending entries from future workflows or older deployments; ordinary submissions become public after the automatic checks above. An authenticated admin may reject a published item if needed. There is intentionally no unauthenticated moderation endpoint.
