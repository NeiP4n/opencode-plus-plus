---
description: Check and correct spelling and grammar in changed Markdown and MDX files
---

Check the staged and unstaged changes to tracked `.md` and `.mdx` files, plus newly created untracked Markdown/MDX files. `git diff HEAD -- '*.md' '*.mdx'` includes both staged and unstaged tracked changes. Open new files listed by `git ls-files --others --exclude-standard -- '*.md' '*.mdx'` and inspect their contents too.

!`git status --short`

!`git diff HEAD -- '*.md' '*.mdx'`

!`git ls-files --others --exclude-standard -- '*.md' '*.mdx'`

Correct clear spelling, grammar, punctuation, and typographical errors in changed Markdown/MDX text only. Preserve meaning, voice, intentional wording, technical identifiers, commands, paths, URLs, code spans, and fenced code blocks. Do not rewrite unrelated paragraphs or discard existing edits. Review the resulting diff and summarize the files corrected.