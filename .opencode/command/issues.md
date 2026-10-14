---
description: Search GitHub issues in the current repository
model: opencode/claude-haiku-4-5
---

Search existing GitHub issues that match this query:

$ARGUMENTS

By default, resolve the current repository from the project directory with `gh repo view --json nameWithOwner --jq .nameWithOwner` and search that repository. Do not hard-code `anomalyco/opencode`: this command is also used in forks.

If the user explicitly starts the query with `--upstream`, remove that flag and search `anomalyco/opencode` instead. If the current repository cannot be resolved, explain the problem and ask before falling back to another repository.

Search open and closed issues. Consider similar titles/descriptions, error messages or symptoms, related components, and feature requests. Quote the query as a single argument when invoking `gh`; never turn untrusted query text into shell syntax.

List matching issues with number, title, a short explanation of why each matches, state, and link. If no good matches are found, say so; do not present loosely related issues as exact matches.