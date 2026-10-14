---
description: Translate changed English documentation and user-facing UI copy into supported locales
model: opencode/gpt-5.6-sol
---

Inspect the working tree, then translate changed English documentation and user-facing UI copy into every locale already supported by this repository. Include staged and unstaged tracked changes (`git diff HEAD`) and relevant new files; do not create arbitrary new locales. Read the existing locale files and `.opencode/glossary/<locale>.md` before translating. Work on different locales in parallel when independent.

Before translating, identify which changed files contain human-facing English text. Do not translate source logic, generated files, dependency/build output, or unrelated text. Preserve existing user edits and review the final diff for missing strings, unintended source changes, and formatting damage.

Requirements:

- Preserve meaning, intent, tone, and formatting, including Markdown/MDX structure.
- Preserve technical artifacts exactly: product/company names, API names, identifiers, code, commands/flags, paths, URLs, versions, error messages, and config keys/values. Do not translate inline code or fenced code blocks.
- Preserve terms marked do-not-translate in the repository's glossaries, and apply locale-specific guidance from `.opencode/glossary/<locale>.md` when available.
- Follow existing terminology, punctuation, capitalization, and file organization for each locale instead of inventing a new convention.
- Translate only changed/new user-facing text; do not retranslate unrelated files or overwrite translations merely to make wording stylistically different.
- When a target locale has no corresponding file or the right destination is unclear, report that gap instead of guessing a path.