# Backlog

Out-of-scope problems seen while working. One line each; not fixed here.

- 2026-10-19 `bun run check` fails at `@opencode/core:typecheck` on pre-existing errors, not on the changed files.
- `packages/core/src/plugin/internal.ts`: 38 errors, plugin array not assignable to `InternalPlugin` (Effect requirements widen to `Scope | Database.Service | ...`).
- `packages/core/src/plot.ts`: 3 errors, `Effect.catchAll` no longer exists and the result is iterated as `never`.
- `packages/core/test/provider-request-compatibility.test.ts`: 5 errors, test tools lack the required `type` field.
- `packages/core/test/{tool-read,tool-search,tool-dod,session-instructions}.test.ts`: `Missing dependencies` layer types do not match.
- `packages/schema/test/room-rules.test.ts`: `screenshot` is required by `RoomRules` but missing in the fixture.
- `packages/tui/src/component/hover-action.tsx`: `BoxProps` rejects the built props object.
- `packages/tui/test/util/session.test.ts`: `error` is not a known `SessionMessageAgentSelected` field.
