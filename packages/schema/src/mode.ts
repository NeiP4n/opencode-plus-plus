export * as Mode from "./mode.js"

import { Schema } from "effect"
import { PositiveInt, optional } from "./schema.js"
import type { SessionMetadata } from "./session-metadata.js"

// A mode is how a session works, not who it is. The role keeps its identity, tools and
// permissions; the mode narrows the work (read-only investigation, implementation, review,
// a one-pass fast path) and tells the model which behaviour is expected. A mode never widens
// permissions: a planner switched to coding still cannot edit files.
export const MetadataKey = "opencode-pp:mode"

export const ID = Schema.String.pipe(Schema.brand("Mode.ID"))
export type ID = typeof ID.Type

export interface Spec extends Schema.Schema.Type<typeof Spec> {}
export const Spec = Schema.Struct({
  id: ID,
  name: Schema.String,
  description: Schema.String,
  guidance: Schema.String,
  /** The mode forbids project edits even when the role itself may edit. */
  readOnly: Schema.Boolean,
  /** A soft ceiling for one run; a worker that hits it reports the blocker instead of looping. */
  steps: PositiveInt.pipe(optional),
}).annotate({ identifier: "Mode.Spec" })

const spec = (input: {
  id: string
  name: string
  description: string
  guidance: string
  readOnly?: boolean
  steps?: number
}): Spec => ({
  id: ID.make(input.id),
  name: input.name,
  description: input.description,
  guidance: input.guidance,
  readOnly: input.readOnly ?? false,
  ...(input.steps === undefined ? {} : { steps: input.steps }),
})

// `auto` is the explicit "no mode": it cancels a role default and restores the role's own rules.
export const builtins: readonly Spec[] = [
  spec({
    id: "auto",
    name: "Auto",
    description: "No mode override: the role works exactly as its own rules describe.",
    guidance: "",
  }),
  spec({
    id: "fast",
    name: "Fast",
    description: "One pass for a small, well-understood task; no plan, no ceremony.",
    guidance: [
      "Work in one pass. Read only what the task needs, make the smallest change that satisfies it, run the single most relevant check, then report and stop.",
      "Do not write a plan document, do not refactor surrounding code, do not add tests beyond the changed behaviour, and do not start a second round of polishing.",
      "If your role is read-only, answer in one pass with the exact change to make and the check to run; do not expand the work.",
      "If the task turns out to be larger or ambiguous, say so in one sentence with the reason and the next concrete step instead of expanding the work silently.",
    ].join("\n"),
    steps: 20,
  }),
  spec({
    id: "coding",
    name: "Coding",
    description: "Implement the change completely and prove it with the project's own checks.",
    guidance: [
      "Implement the assigned scope completely. Read the surrounding code, tests and callers first; follow the project's existing patterns instead of inventing new ones.",
      "If your role is read-only, do not edit: produce the implementation-ready plan with exact files, symbols, snippets and checks at the same depth, so a builder can apply it without re-investigating.",
      "Keep the change minimal and coherent. Add or update tests for the changed behaviour; for a bug, make the test fail before the fix and pass after it.",
      "Run the project's own type check, lint and the relevant tests. Inspect the final diff for accidental changes.",
      "Report files changed, exact commands with their observed results, checks not run and why, and remaining risks.",
    ].join("\n"),
    steps: 100,
  }),
  spec({
    id: "research",
    name: "Research",
    description: "Build an evidence map without changing project files.",
    guidance: [
      "You are investigating, not changing project files. Search the repository first, then authoritative upstream docs or source when the answer depends on a library, API or version.",
      "Trace concrete symbols and call paths, not filenames alone. Compare alternatives only when the decision matters, and state the trade-offs.",
      "Label every statement as verified, inferred or unknown; support facts with paths, symbols or links. Never invent an API, benchmark or result.",
      "Return the evidence map the implementer can act on without repeating the research, plus what you searched but could not establish.",
    ].join("\n"),
    readOnly: true,
    steps: 60,
  }),
  spec({
    id: "planning",
    name: "Planning",
    description: "Produce a decision-ready plan grounded in the real code; do not implement it.",
    guidance: [
      "Produce a decision-ready plan, not code. Read enough of the repository to ground every step in real files and symbols.",
      "Name the files and symbols to change, the sequence, dependencies, acceptance criteria and the exact check for each task. Separate verified facts from assumptions.",
      "Compare at most two or three viable approaches and choose the smallest complete one; say why. Stop planning once the plan is actionable.",
      "Do not expand the plan with optional ideas. Do not edit project files; hand the implementation to a worker.",
    ].join("\n"),
    readOnly: true,
    steps: 40,
  }),
  spec({
    id: "review",
    name: "Review",
    description: "Find behavioural, security and data defects in a change; do not rewrite it.",
    guidance: [
      "Review the change as a skeptical reviewer. Read the diff and the surrounding code, not just the changed lines.",
      "Report only defects that can affect behaviour, security, data or maintainability. For each: file and line, the concrete failure scenario, and the smallest required fix.",
      "Check that tests actually prove the change: deleted tests, loosened assertions, skipped cases and silenced errors are findings, not passes.",
      "Do not rewrite the code. List required fixes, missing tests and anything you could not verify.",
    ].join("\n"),
    readOnly: true,
    steps: 50,
  }),
  spec({
    id: "debug",
    name: "Debug",
    description: "Reproduce the failure and prove the root cause before proposing a fix.",
    guidance: [
      "Find the root cause before proposing a fix. Start from the symptom: expected versus actual behaviour, environment, logs and recent changes.",
      "Build the smallest reproduction you can, then narrow the cause by comparing inputs, states, versions and platforms. Trace the causal chain to a specific condition.",
      "Do not edit project files until the cause is proven. Separate the root cause from secondary symptoms.",
      "Report reproduction steps, evidence (commands, log lines, symbols), the mechanism, a minimal proposed fix with the files it touches, and the regression test to add.",
    ].join("\n"),
    readOnly: true,
    steps: 60,
  }),
  spec({
    id: "design",
    name: "Design",
    description: "Specify the user-facing change; implement only when the task explicitly assigns it.",
    guidance: [
      "Study the existing interface first: navigation, components, design tokens, typography, spacing, icons, copy style and localisation. Reuse existing components before inventing new ones.",
      "Specify layout, content, every state (default, hover/focus, selected, disabled, empty, loading, error, success), narrow-screen behaviour and keyboard/touch interaction.",
      "Cover accessibility: contrast, focus order, labels for screen readers, touch target sizes and long or translated text.",
      "Hand off the components and files to change, tokens to use, exact copy, and how to check the result. Report anything that needs a product decision.",
    ].join("\n"),
    readOnly: true,
    steps: 50,
  }),
  spec({
    id: "ops",
    name: "Ops",
    description: "Keep builds, CI, packaging and release steps reproducible and reversible.",
    guidance: [
      "Read the existing CI workflows, build scripts, Dockerfiles and release docs before editing. Prefer the smallest reversible change and keep secrets out of logs and files.",
      "Cover the platforms the project actually ships: build, package and signing steps, versioning and rollback. Do not deploy, publish, push tags or delete release assets unless explicitly asked.",
      "Keep POSIX shell and PowerShell semantics separate and test paths with spaces when scripts handle files.",
      "Report exact commands, artifacts produced, platform coverage, and anything not executed. Never claim CI passes from a partial local run.",
    ].join("\n"),
    steps: 80,
  }),
]

const byID = new Map(builtins.map((item) => [String(item.id), item]))

export function of(id: string | undefined) {
  if (!id) return undefined
  return byID.get(id.trim())
}

export function list() {
  return builtins.map((item) => String(item.id))
}

// The default mode a role's sessions start in when the operator did not set one.
// Planning roles plan first, quality roles review, builders code; a few specialists
// read better as research/debug/ops/design.
export function defaultForRole(role: {
  id: string
  category: string
  readOnly: boolean
  mode?: string
}) {
  const explicit = of(role.mode)
  if (explicit) return explicit
  if (role.id === "researcher") return of("research")
  if (role.id === "designer") return of("design")
  if (role.id === "debugger") return of("debug")
  if (role.id === "devops" || role.id === "reliability-engineer") return of("ops")
  // A default mode must never remove a permission the role already has. Read-only roles get
  // the read-only modes; a tester or performance engineer that may edit test files keeps coding.
  if (role.category === "Planning") return role.readOnly ? of("planning") : of("coding")
  if (role.category === "Quality") return role.readOnly ? of("review") : of("coding")
  return of("coding")
}

// The mode a session currently stores, if any. Unknown ids are ignored: a saved mode that
// disappeared from a newer build must not break the session.
export function fromMetadata(metadata: SessionMetadata | undefined) {
  const stored = metadata?.[MetadataKey]
  return typeof stored === "string" ? of(stored) : undefined
}

export function stepsOf(metadata: SessionMetadata | undefined) {
  return fromMetadata(metadata)?.steps
}

export function guidanceBlock(mode: Spec) {
  if (!mode.guidance) return ""
  return [
    `# Work mode: ${mode.name} (${mode.id})`,
    mode.description,
    mode.guidance,
    ...(mode.readOnly ? ["This mode is read-only: do not edit project files."] : []),
    ...(mode.steps === undefined
      ? []
      : [`Work within about ${mode.steps} steps. If the task cannot finish, report the blocker and the next step instead of looping.`]),
  ].join("\n")
}
