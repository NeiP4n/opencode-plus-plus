# Backlog

Out-of-scope problems seen while working. One line each; not fixed here.

- 2026-10-20 `bun run check` still fails at `@opencode/core:typecheck`, but only on the test layers below.
- 2026-10-19 `packages/core/src/plugin/internal.ts` (38 errors) and `packages/core/src/plot.ts` (3 errors) are fixed: `Database`
  is part of the plugin requirements, so the plugin arrays typecheck again.
- `packages/core/test/provider-request-compatibility.test.ts`: 5 errors, test tools lack the required `type` field.
- `packages/core/test/{tool-read,tool-search,tool-dod,session-instructions}.test.ts`: `Missing dependencies` layer types do not match.
- `packages/schema/test/room-rules.test.ts`: the fixture typing is fixed, but four assertions still describe older
  globs and merge output (`protectedFile` now reports `**/secrets/**`, `redactPath` redacts a nested session path to
  `<project>`, `.merge` returns one more flag). Someone has to decide whether the implementation or the expectations moved.
