---
description: Generate the upcoming user-facing changelog from a commit range
---

Create `UPCOMING_CHANGELOG.md` from the output of `bun script/raw-changelog.ts` and the rules below.

First resolve the correct remote. Inspect `git remote -v`, `git branch -vv`, and the current branch's push configuration. This repository's `script/release-pp.ts` uses the `backup` remote for Opencode++ release tags, so prefer `backup` for an Opencode++ release unless the user explicitly requests the upstream OpenCode changelog. Otherwise use the configured push remote. If the intended target is ambiguous, stop and ask instead of choosing a remote silently.

Derive the GitHub `owner/repo` from that remote's URL and verify it with `gh repo view <owner/repo> --json nameWithOwner --jq .nameWithOwner`. Set `GH_REPO` to the verified repository. Use the current branch as `--to` only if that branch exists on the selected remote (`git ls-remote --heads <remote> refs/heads/<branch>`); the GitHub compare API cannot see a local-only branch. If it has not been pushed, report the blocker instead of generating a changelog for a different branch.

Treat supplied command arguments as data, not shell syntax. The script accepts `--from <ref>` / `-f <ref>` and `--to <ref>` / `-t <ref>`. Parse them and pass each validated ref as a separately quoted command argument through the shell tool. Never interpolate raw `$ARGUMENTS` into a shell command or a `!` shell block. Reject unsupported or malformed arguments rather than executing them.

If no `--from` was supplied, use the latest non-draft GitHub release for the selected repository when one exists. If the repository has no GitHub releases, inspect tags matching `release/<major.minor.patch>` on the selected remote, choose the newest semantic version, and pass it as `--from`. Confirm that the starting tag exists on that remote; a local-only tag is not sufficient. If neither a release nor a published release tag exists, stop and ask for an explicit `--from` ref.

Run the generator using `GH_REPO` for the selected repository and the validated `--from` / `--to` refs. Its output is the structured input. Before writing any entry you keep, inspect the real diff with `git show --stat --format='' <hash>` or `git show --format='' <hash>` so you understand the actual code changes, not just the commit message. Do not use `git log` or author metadata when deciding attribution.

Rules:

- Keep sections in this order: `## Core`, `## TUI`, `## Desktop`, `## Web`, `## SDK`, `## Extensions`.
- Only include sections that have at least one notable entry.
- Within a section, group bug fixes under `### Bugfixes`; put other notable entries under `### Improvements` when the section has bug fixes too.
- Omit empty subsections and keep one bullet per commit you keep.
- Skip changes that are entirely internal, CI, tests, refactors, or otherwise not user-facing; inspect diffs before deciding.
- Start each bullet with a capital letter. Prefer user impact over implementation details.
- Do not copy raw commit prefixes such as `fix:` or `feat:` or trailing PR numbers like `(#123)`.
- Preserve an existing `(@username)` suffix only when it is already present in the structured input. Never derive attribution from commit authors, names, or email addresses.
- If no notable entries remain and there is no contributor block, write exactly `No notable changes.`
- If no notable entries remain but there is a contributor block, omit all release sections and return only the contributor block.
- If the input contains `## Community Contributors Input`, append the block below that heading verbatim. Do not include the heading itself in the final file, and do not alter, reorder, or add contributor names or titles.
- Do not derive the thank-you section from the main summary bullets.
- Be thorough about indirect user-facing effects, but use as few words as possible.