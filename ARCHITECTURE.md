# The OpenCode Core — Repository Map

Repository: `github.com/sst/opencode`, license MIT, release **v2.0.22**
(`git describe` → `v2.0.22`, HEAD `527f0b931d`). Every package is described in its own
file `packages/<package>/PACKAGE.md` — start from that file if you already know which
package you need.

There are 35 directories in `packages/`, 30 of them with a `package.json` (`console`,
`stats`, `containers`, `identity`, `effect-drizzle-sqlite` have no manifest of their
own). Line and file counts are over `src/`, without tests.

## Layer Map

Layers with a link to each package's document (order is from foundation to surface):

| Layer | Packages and their documents |
| --- | --- |
| L0 — leaves | [schema](packages/schema/PACKAGE.md), [util](packages/util/PACKAGE.md), [codemode](packages/codemode/PACKAGE.md), [theme](packages/theme/PACKAGE.md), [ui](packages/ui/PACKAGE.md), [http-recorder](packages/http-recorder/PACKAGE.md), [httpapi-codegen](packages/httpapi-codegen/PACKAGE.md), [web](packages/web/PACKAGE.md), [script](packages/script/PACKAGE.md), [function](packages/function/PACKAGE.md), [posts](packages/posts/PACKAGE.md) |
| L1 | [protocol](packages/protocol/PACKAGE.md), [ai](packages/ai/PACKAGE.md), [latex](packages/latex/PACKAGE.md), [merman](packages/merman/PACKAGE.md) |
| L2 | [client](packages/client/PACKAGE.md), [plugin-browser](packages/plugin-browser/PACKAGE.md) |
| L3 | [plugin](packages/plugin/PACKAGE.md) |
| L4 — core | [core](packages/core/PACKAGE.md), [simulation](packages/simulation/PACKAGE.md) |
| L5 — transport | [server](packages/server/PACKAGE.md), [session-ui](packages/session-ui/PACKAGE.md) |
| L6 — surfaces | [cli](packages/cli/PACKAGE.md), [tui](packages/tui/PACKAGE.md), [sdk](packages/sdk/PACKAGE.md), [app](packages/app/PACKAGE.md), [gui-extensions](packages/gui-extensions/PACKAGE.md), [enterprise](packages/enterprise/PACKAGE.md), [desktop](packages/desktop/PACKAGE.md), [storybook](packages/storybook/PACKAGE.md) |

## How Everything Runs

One short path worth remembering:

```
opencode (packages/cli/src/index.ts)
  └─ command (serve, run, tui, pair, service, …)
      └─ server (packages/server/src/routes.ts) — HTTP + SSE
          └─ core (packages/core/src) — sessions, tools, providers
              └─ database (packages/core/src/database) and config (packages/core/src/config.ts)
```

The client (TUI, app, SDK) talks to this server through the endpoints declared in
`packages/protocol/src/api.ts`. Data types live separately, in `packages/schema/src`.

Three places in the code where this can be re-read:

- `packages/cli/src/index.ts` — the command registry; each command is loaded lazily
  via a dynamic import, in the `Handlers` table.
- `packages/server/src/routes.ts:176` — `HttpApiBuilder.layer(Api, …)` mounts the API;
  below it goes `Layer.provide` with the authorization, error layers and ~35 core layers.
- `packages/core/src/instance.ts:114` — `export const graph = LayerNode.group(nodes)`:
  the core layer graph. This is the assembly point of dependencies, not an "instance
  object". There are three such graphs in the core: the other two assemble plugin
  requirements — `packages/core/src/plugin/host.ts:574` and
  `packages/core/src/plugin/internal.ts:160`.

## Dependency Layers

Layers are counted from the `dependencies` field in `packages/*/package.json` (only
`@opencode/*` packages). A package in a row cannot depend on a package higher up the list.

| Layer | Packages | Depends on |
| --- | --- | --- |
| **L0 — leaves** | `schema`, `util`, `codemode`, `theme`, `ui`, `http-recorder`, `httpapi-codegen`, `web`, `script`, `function`, `posts` | — |
| **L1** | `protocol`, `ai`, `latex`, `merman` | `schema`, `plugin` |
| **L2** | `client`, `plugin-browser` | `protocol`, `schema`, `plugin` |
| **L3** | `plugin` | `ai`, `client`, `protocol`, `schema`, `util` |
| **L4 — core** | `core`, `simulation` | `ai`, `codemode`, `plugin`, `schema`, `util`, `core` |
| **L5 — transport** | `server`, `session-ui` | `core`, `protocol`, `schema`, `simulation`, `util`, `client`, `ui` |
| **L6 — surfaces** | `cli`, `tui`, `sdk`, `app`, `gui-extensions`, `enterprise`, `desktop`, `storybook` | everything listed above |

**A caveat that matters when reading this:** the layers come from the manifests, not from
the import graph, so the real coupling is wider. Two examples that show it:

- `packages/tui` is declared at L6 and depends on `core`, but `packages/tui/src/mini/`
  pulls the core directly, bypassing `packages/tui/src/context/client.tsx`.
- `packages/latex` and `packages/merman` sit at L1 but depend on `plugin` (L3) — that is,
  the reference goes down the layers. Check the concrete file, not just the package.

## Packages by Layer

| Package | Lines in src | Files | Document |
| --- | --- | --- | --- |
| `schema` | 5 785 | 102 | `packages/schema/PACKAGE.md` |
| `util` | 4 565 | 44 | `packages/util/PACKAGE.md` |
| `codemode` | 10 764 | 45 | `packages/codemode/PACKAGE.md` |
| `theme` | 1 592 | 10 | `packages/theme/PACKAGE.md` |
| `ui` | 35 114 | 214 | `packages/ui/PACKAGE.md` |
| `http-recorder` | 1 601 | 14 | `packages/http-recorder/PACKAGE.md` |
| `httpapi-codegen` | 1 977 | 1 | `packages/httpapi-codegen/PACKAGE.md` |
| `web` | 2 649 | 18 | `packages/web/PACKAGE.md` |
| `script` | 88 | 1 | `packages/script/PACKAGE.md` |
| `function` | 402 | 2 | `packages/function/PACKAGE.md` |
| `posts` | 14 | 1 | `packages/posts/PACKAGE.md` |
| `protocol` | 4 201 | 36 | `packages/protocol/PACKAGE.md` |
| `ai` | 29 218 | 201 | `packages/ai/PACKAGE.md` |
| `latex` | 2 646 | 14 | `packages/latex/PACKAGE.md` |
| `merman` | 21 359 | 88 | `packages/merman/PACKAGE.md` |
| `client` | 16 722 | 30 | `packages/client/PACKAGE.md` |
| `plugin-browser` | 1 530 | 7 | `packages/plugin-browser/PACKAGE.md` |
| `plugin` | 3 089 | 60 | `packages/plugin/PACKAGE.md` |
| `core` | 65 299 | 431 | `packages/core/PACKAGE.md` |
| `simulation` | 2 182 | 13 | `packages/simulation/PACKAGE.md` |
| `server` | 3 883 | 52 | `packages/server/PACKAGE.md` |
| `session-ui` | 24 443 | 113 | `packages/session-ui/PACKAGE.md` |
| `cli` | 12 297 | 109 | `packages/cli/PACKAGE.md` |
| `tui` | 62 303 | 281 | `packages/tui/PACKAGE.md` |
| `sdk` | 647 | 15 | `packages/sdk/PACKAGE.md` |
| `app` | 121 153 | 516 | `packages/app/PACKAGE.md` |
| `gui-extensions` | 44 877 | 799 | `packages/gui-extensions/PACKAGE.md` |
| `enterprise` | 1 466 | 13 | `packages/enterprise/PACKAGE.md` |
| `desktop` | 9 569 | 142 | `packages/desktop/PACKAGE.md` |
| `storybook` | 0 | 0 | `packages/storybook/PACKAGE.md` |

## Where To Look

| Task | First file | Package |
| --- | --- | --- |
| how sessions, prompts and tools live | `packages/core/src/session/session.ts` | `core` |
| which tools the agent has and how they are described to the provider | `packages/core/src/tool/runtime.ts` | `core` |
| where models come from and how a provider is chosen | `packages/core/src/provider.ts` | `core` |
| where opencode's data lives (database, cache, state) | `packages/util/src/global.ts` | `util` |
| how config is set and where it is picked up from | `packages/core/src/config.ts` | `core` |
| which HTTP endpoints exist and what they return | `packages/protocol/src/api.ts` | `protocol` |
| authorization, pair, ports, server binding | `packages/server/src/auth.ts` | `server` |
| the event stream (SSE) | `packages/server/src/event-feed.ts` | `server` |
| how the terminal interface is built | `packages/tui/src/routes/session/index.tsx` | `tui` |
| how to connect to someone else's server | `packages/cli/src/services/server-connection.ts` | `cli` |
| how to write a plugin (server side) | `packages/plugin/src/app.ts` | `plugin` |
| how to write a plugin (interface) | `packages/plugin/src/tui/` | `plugin` |
| the data types that travel over the API | `packages/schema/src/` | `schema` |

## Repository Rules (from AGENTS.md)

Before editing any file, read `AGENTS.md` in the root. Briefly, what matters there:

- After changing the public `HttpApi` in `protocol` or `server` you need
  `bun run generate` from `packages/client`; generated client files are not edited by hand.
- Dependency direction: `schema` → `core` and `protocol` → `server`. Client code
  may depend on `schema` and `protocol`, but not on `core` and `server`.
- Changes go into `packages/core`, `cli`, `server`, `protocol`, `schema` and the generated
  client surfaces.
- Changesets are not used in this repository.
- The default branch is `v2`. A local `main` may not exist: diffs are taken against `v2`.
- Tests are not run from the repository root (there is a guard `do-not-run-tests-from-root`),
  but from the package directories.
- Full check: `bun run check` from the root. Narrow check: `bun typecheck` from the package
  directory. `tsc` is never run directly.

## How To Check The Documentation

The validator lives in `.opencode/` and checks that every package from
`.opencode/doc_manifest.txt` has a non-empty `PACKAGE.md` with the six mandatory
sections and no placeholders.

```bash
cd ~/opencode-src
./.opencode/doc_check.py            # shape and completeness across all packages
./.opencode/doc_check.py --links    # plus existence of the mentioned paths
./.opencode/doc_check.py --surface  # manifest against the packages/ directory
./.opencode/doc_check.py --sample   # symbols from the documents against the sources
./.opencode/doc_check.sh util       # negative control: 4 mutations must turn red
```

The validator checks the shape of a document and the existence of paths, but it does
**not** check that what is written matches the meaning of the code. Only reading the
sources and a spot check with `--sample` confirm the factual accuracy of a description.

## Pitfalls

1. **A folder is not always a subsystem.** In `packages/core/src` the subsystems
   `provider`, `event`, `credential`, `permission` are single `.ts` files, and the
   same-named folders exist only for the `sql.ts` with the table schema. Look for the
   file, not the folder.
2. **The real event engine is `packages/core/src/bus.ts`, not the `event/` directory.**
   `event/` holds only `sql.ts`.
3. **Three runtimes in the database:** `packages/core/src/database/sqlite.bun.ts`,
   `sqlite.node.ts` and `sqlite.workerd.ts`. Editing one of them does not mean editing
   the others.
4. **`packages/tui/src/mini/` is not a "mini version" of the interface.** It is a separate
   18 thousand line frontend runtime with its own renderer, started by a separate
   CLI command (`packages/cli/src/commands/handlers/mini.ts`).
5. **`packages/core/src/account/sql.ts` is dead code:** zero imports, and the table in
   `console/core/src/schema/account.sql` exists separately. It is not fixed, only marked.
6. **`packages/core/test/` is 96.5 thousand lines out of 162.7 thousand in `core`.** The
   core `src/` is 65 thousand lines; the rest is tests. Do not look for logic in tests.
7. **Documentation boundaries:** new files in this repository will show up in someone
   else's `git status` as untracked. No commits are made.# Enhanced Architecture (Target)

## Clean Architecture Layers (Target)

```mermaid
graph TB
    subgraph "Presentation (L6)"
        CLI[cli]
        TUI[tui]
        Desktop[desktop]
        SDK[sdk]
        App[app]
        Storybook[storybook]
    end
    
    subgraph "Transport/API (L5)"
        Server[server]
        SessionUI[session-ui]
    end
    
    subgraph "Core Business Logic (L4)"
        Core[core]
        Simulation[simulation]
    end
    
    subgraph "Plugin System (L3)"
        Plugin[plugin]
    end
    
    subgraph "Infrastructure Services (L2)"
        Client[client]
        PluginBrowser[plugin-browser]
    end
    
    subgraph "Domain Models & Protocols (L1)"
        Protocol[protocol]
        AI[ai]
        Latex[latex]
        Merman[merman]
    end
    
    subgraph "Foundations (L0)"
        Schema[schema]
        Util[util]
        Codemode[codemode]
        Theme[theme]
        UI[ui]
        HTTPRec[http-recorder]
        HTTPCodegen[httpapi-codegen]
        Web[web]
        Script[script]
        Function[function]
        Posts[posts]
    end
    
    %% Dependencies flow downward (L0 -> up)
    Protocol --> Schema
    AI --> Schema
    Latex --> Schema
    Merman --> Schema
    
    Client --> Protocol
    Client --> Schema
    PluginBrowser --> Protocol
    
    Plugin --> AI
    Plugin --> Client
    Plugin --> Protocol
    Plugin --> Schema
    Plugin --> Util
    
    Core --> Plugin
    Core --> Schema
    Core --> Util
    Core --> AI
    Core --> Codemode
    Simulation --> Core
    
    Server --> Core
    Server --> Protocol
    Server --> Schema
    SessionUI --> Core
    SessionUI --> UI
    
    CLI --> Server
    TUI --> Server
    TUI --> SessionUI
    SDK --> Client
    App --> Server
    Desktop --> Server
    
    classDef l0 fill:#e1f5fe
    classDef l1 fill:#f3e5f5
    classDef l2 fill:#e8f5e8
    classDef l3 fill:#fff3e0
    classDef l4 fill:#fce4ec
    classDef l5 fill:#e0f2f1
    classDef l6 fill:#f5f5f5
    
    class Schema,Util,Codemode,Theme,UI,HTTPRec,HTTPCodegen,Web,Script,Function,Posts l0
    class Protocol,AI,Latex,Merman l1
    class Client,PluginBrowser l2
    class Plugin l3
    class Core,Simulation l4
    class Server,SessionUI l5
    class CLI,TUI,Desktop,SDK,App,Storybook l6
```

## Dependency Constraints (Enforced)
- No upward dependencies: packages at lower layers must not depend on higher layers
- Schema is the only true leaf - everything else builds on it
- Protocol defines contracts; implementations follow them
- Client is the only transport client boundary (TUI should go through client, not core directly)

## Cycle Prevention
- Use dependency-cruiser to detect circular dependencies (`bun run check:cycles`)
- All new dependencies must respect the layer boundaries
- Shared utilities go to `util`, shared types to `schema`

## Clean Boundaries
- **API Boundary**: protocol (types + contracts) ↔ server (implementation)
- **Client Boundary**: client package abstracts server communication
- **Plugin Boundary**: plugin package defines extension points, core hosts them
- **Data Boundary**: schema defines all cross-cutting types

## Module Cohesion Principles
- High cohesion within packages, low coupling between
- Feature code belongs in appropriate layer
- Infrastructure concerns separated from business logic

To apply these improvements, run: `bun run check:cycles` to identify violations.
```