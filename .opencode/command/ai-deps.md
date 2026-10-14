---
description: Audit AI SDK dependencies and report minor or patch upgrades
---

Audit the workspace for AI SDK and provider dependencies. Read the root `package.json`, its shared `catalog`, and every relevant workspace manifest under `packages/**/package.json` and `services/**/package.json`. Include at least `packages/ai`, `packages/core`, `packages/server`, and any package that declares an `ai` or `@ai-sdk/*` dependency.

Find newer stable versions that keep the same major version. Do not recommend major upgrades or change any files other than the report. Deduplicate packages and distinguish actual direct dependencies from versions that are only declared in the shared catalog.

For every candidate, report the package, current version, recommended version, update type (patch or minor), a brief summary of relevant fixes/features, and an official changelog or release reference. Verify versions against a trustworthy registry or upstream release source; mark anything you could not verify instead of guessing. Ignore unrelated dependencies.

Write the results to `ai-sdk-updates.md`. Do not modify `package.json`, workspace manifests, or lockfiles.