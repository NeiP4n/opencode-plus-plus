# Services

Independently deployed services supporting OpenCode live here. Runtime packages
and clients live in `packages/`.

| Service                | Purpose                                | Deployment                   |
| ---------------------- | -------------------------------------- | ---------------------------- |
| [`www`](./www)         | Website and V2 documentation           | `deploy-www.yml`, Wrangler   |
| [`updates`](./updates) | Release metadata and update selection  | `publish.yml`, Wrangler      |
| [`files`](./files)     | Public file distribution at `/files/*` | `deploy-files.yml`, Wrangler |
| [`idea-bank`](./idea-bank) | Shared, moderated community idea catalogue | Wrangler + D1 (manual setup) |

These directories are Bun workspaces. Run package commands from each service's
directory. Repository-wide Turbo commands discover them through `services/*`.
