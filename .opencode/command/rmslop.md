---
description: Remove clearly unnecessary AI-generated code artifacts from the branch diff
---

Review the diff from `origin/v2` to `HEAD` and remove only clearly unnecessary AI-generated slop introduced by this branch.

First verify that `origin/v2` exists and that the diff can be computed. If it does not exist, stop and report the missing base; do not silently compare against another ref. Inspect the exact diff before editing.

Look for:

- Comments that state the obvious or do not match the surrounding code style.
- Redundant defensive branches, duplicate work, or unnecessary try/catch blocks, but only after verifying the relevant call path and error contract.
- `any` casts or type assertions used to silence a type error instead of fixing the type.
- Inconsistent style or unnecessary emoji.

Do not remove input validation, permission checks, resource cleanup, error handling, or security checks merely because they look defensive. Do not change intended behavior, rewrite unrelated files, or add speculative refactors. After editing, review the new diff and run the narrowest relevant checks.

At the end, report only a 1–3 sentence summary of the changes; if nothing clearly qualifies as slop, leave the tree unchanged.