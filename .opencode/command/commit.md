---
description: Review the working tree, create a conventional commit, and push the current branch
model: opencode/kimi-k2.5
subagent: true
---

Create a commit for the changes relevant to the current task and push the current branch to its configured upstream.

Before acting:

1. Inspect `git status --short --branch`, the combined tracked diff (`git diff HEAD`), and the names/content of relevant untracked files.
2. If a merge, rebase, cherry-pick, or unresolved conflict is in progress, stop and report it. Do not resolve conflicts.
3. Stage only files related to this task. Do not blindly run `git add -A`; inspect staged and unstaged diffs, and exclude secrets, credentials, build output, and unrelated user changes.
4. If there are no relevant changes, do not create an empty commit.

Use `type(scope): summary` with a type of `feat`, `fix`, `docs`, `chore`, `refactor`, or `test`; the scope is optional. Explain the user-facing reason rather than merely describing the code. Avoid generic messages.

After reviewing the final staged diff, create the commit. Push only the current branch to its configured upstream. If there is no upstream or the push would require guessing a remote/branch, stop and report the exact command needed rather than guessing. Do not force-push.

Finally, verify the commit and push result, then report the commit hash, branch, and final `git status --short --branch`. Never claim success if a command failed.