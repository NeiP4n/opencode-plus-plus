export * as CommandForgeTool from "./command-forge.js"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { SessionEvent } from "@opencode/schema/session-event"
import type { SessionID } from "@opencode/schema/session-id"
import { Path } from "@opencode/util/global"
import { Effect, Schema, Stream } from "effect"
import { Agent } from "../../agent.js"
import { Bus } from "../../bus.js"
import { Location } from "../../location.js"

export const name = "command_forge"
export const command = "forge-command"

// The kinds of slash command the forge knows, each with a complete example file. Together they
// cover every feature a command file has: arguments, shell context, agent, model and subagent.
export const kinds: readonly { id: string; use: string; example: Draft }[] = [
  {
    id: "prompt",
    use: "A reusable instruction the user types often. The user's text after the command is appended.",
    example: {
      name: "explain",
      description: "explain code simply [file or symbol]",
      template: [
        "Explain $ARGUMENTS to a developer new to this project.",
        "",
        "1. Read the code and what calls it.",
        "2. Say what it does, why it exists and how data flows through it, in plain words.",
        "3. Point out one non-obvious trap.",
        "Keep it under 25 lines.",
      ].join("\n"),
    },
  },
  {
    id: "arguments",
    use: "Positional arguments: $1, $2, ... take single words (quote multi-word values); the last one used takes the rest of the line. $ARGUMENTS is the whole line.",
    example: {
      name: "rename",
      description: "rename a symbol everywhere [old] [new]",
      template: [
        "Rename the symbol `$1` to `$2` across the project.",
        "",
        "- Find every definition, use, import, test and doc mention of `$1` (grep, then read).",
        "- Change them all; keep behavior identical.",
        "- Run the project's type check and tests and report the commands with PASS/FAIL.",
      ].join("\n"),
    },
  },
  {
    id: "context",
    use: "Injects fresh shell output: !`command` runs in the project directory when the command is invoked, and its output replaces it. Use only read-only commands there.",
    example: {
      name: "commit-message",
      description: "write a commit message for the staged changes",
      template: [
        "Write a conventional commit message (type(scope): summary, then a short body) for these staged changes.",
        "",
        "Staged files:",
        "!`git diff --staged --stat`",
        "",
        "Diff:",
        "!`git diff --staged`",
        "",
        "Recent messages, to match their style:",
        "!`git log --oneline -10`",
        "",
        "Print only the message.",
      ].join("\n"),
    },
  },
  {
    id: "subagent",
    use: "subagent: true runs the command in a background child session (here with the read-only explore agent), so long research does not fill the current conversation; its result comes back when it finishes.",
    example: {
      name: "find-usages",
      description: "map where a feature is implemented and used [feature]",
      agent: "explore",
      subagent: true,
      template: [
        "Map how \"$ARGUMENTS\" is implemented in this repository (very thorough).",
        "Report: entry points, core files with one line each, data flow, tests that cover it, and gaps. Absolute paths.",
      ].join("\n"),
    },
  },
  {
    id: "agent",
    use: "agent: switches the session to that agent for this command (plan for thinking without editing, build for doing).",
    example: {
      name: "plan",
      description: "plan a change without editing anything [goal]",
      agent: "plan",
      template: [
        "Goal: $ARGUMENTS",
        "",
        "Do not edit files. Read the relevant code, then give:",
        "1. The smallest complete approach and why.",
        "2. Ordered steps with the files each touches.",
        "3. Risks and how to check each step.",
      ].join("\n"),
    },
  },
  {
    id: "model",
    use: "model: provider/model pins the model for this command, e.g. a fast cheap one for trivial jobs or the strongest one for hard ones. Set it only to a model the operator names: an unknown id makes the command fail.",
    example: {
      name: "typo",
      description: "fix spelling and grammar in a file [file]",
      model: "opencode/gpt-5-nano",
      template: "Fix only spelling and grammar in $1. Do not change meaning, code or formatting. List the fixes.",
    },
  },
  {
    id: "workflow",
    use: "A multi-step procedure with checks and a definition of done; the model loops until the checks pass.",
    example: {
      name: "green",
      description: "make the build and tests pass",
      template: [
        "Make this project's build, type check and tests pass.",
        "",
        "1. Find the project's check commands (package.json scripts, Makefile, CI config).",
        "2. Run them. For each failure: read the exact error, fix the cause (never skip or delete a test), rerun.",
        "3. Stop after three rounds on the same failure and explain what blocks it.",
        "",
        "Done when every check passes. Report each command with PASS/FAIL.",
      ].join("\n"),
    },
  },
  {
    id: "generator",
    use: "Scaffolds new files from arguments, following the project's own conventions by copying the closest existing example.",
    example: {
      name: "component",
      description: "create a component like the existing ones [Name] [what it shows]",
      template: [
        "Create a component named $1 that $2.",
        "",
        "- Find the two most similar existing components and copy their structure, naming, styling and test layout.",
        "- Add the component, its test and its export where siblings are exported.",
        "- Run the type check and the new test.",
      ].join("\n"),
    },
  },
  {
    id: "review",
    use: "A read-only audit with a fixed report format, good for checklists (security, accessibility, release readiness).",
    example: {
      name: "audit-security",
      description: "security review of the uncommitted changes",
      template: [
        "Review these changes for security problems only. Do not edit files.",
        "",
        "!`git diff HEAD`",
        "",
        "Check: injection, auth and access checks, secrets in code, unsafe deserialization, path traversal, SSRF, unsafe defaults.",
        "Report each finding as: severity, file:line, the concrete attack, the fix. Say \"no findings\" if there are none.",
      ].join("\n"),
    },
  },
  {
    id: "registry",
    use: "Uses the Registry (hub tool) recipes for fast, ready-made commands instead of hand-written shell.",
    example: {
      name: "big-files",
      description: "find what takes space in the project",
      template: [
        "Find what takes the most disk space in this project.",
        "Use the hub tool: query it for disk usage and large-file recipes, run the best ones, then summarize the top 10 with sizes and whether each is safe to delete (build output, caches) or not. Delete nothing.",
      ].join("\n"),
    },
  },
]

type Draft = {
  name: string
  description: string
  template: string
  agent?: string
  model?: string
  subagent?: boolean
}

const description = [
  "Design and save slash commands (custom /commands) of any kind. Only a session running the /forge-command command has this tool.",
  "Actions: kinds shows every kind of command with a complete example file (prompt, arguments, context with !`shell`, subagent, agent, model, workflow, generator, review, registry);",
  "list shows the commands and agents that exist; preview renders a draft with sample args and checks it without saving;",
  "save writes the command file (scope project: .opencode/command in this project, global: every project). A name that exists is refused unless overwrite is true and the file is one this forge can write.",
].join("\n")

export const Input = Schema.Struct({
  action: Schema.Literals(["kinds", "list", "preview", "save"]),
  name: Schema.optionalKey(Schema.String).annotate({
    description: "Command name: lowercase words joined by -, optionally in a group like git/commit",
  }),
  description: Schema.optionalKey(Schema.String).annotate({
    description: "One line shown in the command list; end with the arguments it takes, e.g. [file] [new name]",
  }),
  template: Schema.optionalKey(Schema.String).annotate({
    description: "The prompt body: $ARGUMENTS, $1..$9 and !`read-only shell` are filled when the command runs",
  }),
  agent: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String).annotate({ description: "provider/model" }),
  subagent: Schema.optionalKey(Schema.Boolean),
  scope: Schema.optionalKey(Schema.Literals(["project", "global"])),
  overwrite: Schema.optionalKey(Schema.Boolean),
  args: Schema.optionalKey(Schema.String).annotate({ description: "For preview: sample arguments as the user would type them" }),
})

export const Output = Schema.Struct({ output: Schema.String })

const NAME = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/
const MODEL = /^[^/#\s]+\/[^#\s]+(#[^#\s]+)?$/
const SHELL = /!`([^`]+)`/g
// Shell context runs without asking each time the command is invoked, so it must only read.
const WRITES =
  /(^|[\s;&|(])(rm|rmdir|del|erase|mv|move|cp|dd|mkfs|format|shutdown|reboot|kill|pkill|taskkill|chmod|chown|sudo|curl|wget|iwr|Invoke-WebRequest|Remove-Item|Set-Content|Out-File|npm\s+(i|install|publish)|git\s+(push|reset|checkout|clean|commit|rebase|merge|stash|tag|branch\s+-D))\b|(?<![0-9&])>(?!\s*(\/dev\/null|\$null|nul\b|&))/i
// Owned by other plugins: the forge never shadows them.
const RESERVED = new Set(["init", "review", "forge-teams", command])

// A forging session designs commands from the operator's request until its run ends.
type Forge = { request: string; started: boolean }

export const Plugin = {
  id: "opencode.tool.command-forge",
  effect: Effect.fn("CommandForgeTool.Plugin")(function* (ctx: Context) {
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    const agents = yield* Agent.Service
    const forging = new Map<SessionID, Forge>()

    const roots = {
      project: path.join(location.project.directory, ".opencode", "command"),
      global: path.join(process.env.OPENCODE_CONFIG_DIR ?? Path.config, "command"),
    }
    const commands = () =>
      ctx.command.list().pipe(
        Effect.map((result) => result.data),
        Effect.orElseSucceed(() => []),
      )

    const list = Effect.fnUntraced(function* () {
      const existing = yield* commands()
      const available = (yield* agents.list()).filter((agent) => !agent.hidden)
      return [
        "Commands:",
        ...existing.map((item) => `- /${item.name}${item.description ? `: ${item.description}` : ""}`),
        "",
        "Agents for agent: (subagent ones fit subagent: true):",
        ...available.map((agent) => `- ${agent.id} (${agent.mode})${agent.description ? `: ${agent.description.slice(0, 120)}` : ""}`),
        "",
        `Project commands are saved in ${roots.project}, global ones in ${roots.global}.`,
      ].join("\n")
    })

    const check = Effect.fnUntraced(function* (draft: Partial<Draft>) {
      const problems: string[] = []
      if (!draft.name || !NAME.test(draft.name))
        problems.push("name must be lowercase words joined by -, optionally group/name (e.g. git/commit)")
      if (!draft.description?.trim()) problems.push("description is required: one line for the command list")
      if (!draft.template?.trim()) problems.push("template is required: the prompt the command sends")
      if (draft.model !== undefined && !MODEL.test(draft.model)) problems.push("model must look like provider/model")
      if (draft.agent !== undefined && !(yield* agents.get(Agent.ID.make(draft.agent))))
        problems.push(`agent ${draft.agent} does not exist; call list for the agents`)
      const writes = writingShell(draft.template ?? "")
      if (writes.length > 0)
        problems.push(
          `!\`...\` runs without asking whenever the command is used, so it must only read. Move these into the instructions for the model to run with its tools: ${writes.join("; ")}`,
        )
      return problems
    })

    const preview = (draft: Draft, args: string) => {
      const words = args.match(/"[^"]*"|'[^']*'|[^\s"']+/g)?.map((word) => word.replace(/^["']|["']$/g, "")) ?? []
      const positions = (draft.template.match(/\$(\d+)/g) ?? []).map((item) => Number(item.slice(1)))
      const last = Math.max(0, ...positions)
      const filled = draft.template
        .replaceAll(/\$(\d+)/g, (_, index) => {
          const position = Number(index)
          if (position > words.length) return ""
          return position === last ? words.slice(position - 1).join(" ") : (words[position - 1] ?? "")
        })
        .replaceAll("$ARGUMENTS", args)
      const appended = positions.length === 0 && !draft.template.includes("$ARGUMENTS") && args.trim()
      const shell = Array.from(draft.template.matchAll(SHELL), (match) => match[1])
      return [
        `/${draft.name} ${args}`.trim(),
        draft.subagent ? `Runs in a background ${draft.agent ?? "subagent"} session.` : draft.agent ? `Switches to the ${draft.agent} agent.` : "",
        draft.model ? `Uses the model ${draft.model}.` : "",
        shell.length > 0 ? `Runs before sending (read-only): ${shell.join("; ")}` : "",
        "--- prompt the model receives ---",
        appended ? `${filled}\n\n${args}` : filled,
      ]
        .filter(Boolean)
        .join("\n")
    }

    const save = Effect.fnUntraced(function* (draft: Draft, scope: "project" | "global", overwrite: boolean) {
      const file = path.join(roots[scope], `${draft.name}.md`)
      const exists = yield* Effect.promise(() => readFile(file, "utf8").then(() => true, () => false))
      const taken = (yield* commands()).some((item) => item.name === draft.name)
      if (RESERVED.has(draft.name)) return yield* new ToolFailure({ message: `/${draft.name} is built in; choose another name.` })
      if ((taken || exists) && !(overwrite && exists))
        return yield* new ToolFailure({
          message: exists
            ? `/${draft.name} already exists at ${file}. Pass overwrite: true to replace it, or choose another name.`
            : `/${draft.name} already exists (from another source); choose another name.`,
        })
      const frontmatter = [
        `description: ${JSON.stringify(draft.description.trim())}`,
        ...(draft.agent ? [`agent: ${JSON.stringify(draft.agent)}`] : []),
        ...(draft.model ? [`model: ${JSON.stringify(draft.model)}`] : []),
        ...(draft.subagent ? ["subagent: true"] : []),
      ]
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(path.dirname(file), { recursive: true })
          await writeFile(file, ["---", ...frontmatter, "---", "", draft.template.trim(), ""].join("\n"))
        },
        catch: (error) => new ToolFailure({ message: `Could not write ${file}: ${String(error)}`, error }),
      })
      return file
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              if (input.action === "kinds")
                return kinds
                  .map((kind) => [`## ${kind.id}`, kind.use, "```md", render(kind.example), "```"].join("\n"))
                  .join("\n\n")
              if (input.action === "list") return yield* list()
              const draft = {
                name: input.name?.trim() ?? "",
                description: input.description ?? "",
                template: input.template ?? "",
                ...(input.agent ? { agent: input.agent } : {}),
                ...(input.model ? { model: input.model } : {}),
                ...(input.subagent ? { subagent: true } : {}),
              }
              const problems = yield* check(draft)
              if (input.action === "preview")
                return [
                  problems.length > 0 ? `Fix before saving:\n- ${problems.join("\n- ")}` : "Ready to save.",
                  "",
                  preview(draft, input.args ?? ""),
                ].join("\n")
              if (problems.length > 0)
                return yield* new ToolFailure({ message: `Not saved. Fix:\n- ${problems.join("\n- ")}` })
              const file = yield* save(draft, input.scope ?? "project", input.overwrite === true)
              return `Saved /${draft.name} to ${file}. It shows up in the command list within a second; run it as /${draft.name}${draft.description.match(/\[[^\]]+\]/g)?.join(" ").replace(/^/, " ") ?? ""}.`
            }).pipe(Effect.map((output) => ({ output: { output }, content: output }))),
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.command.transform((editor) =>
      editor.add({
        name: command,
        description: "AI designs and saves a new slash command of any kind from your description [what it should do]",
        execute: (input) => {
          const request = input.prompt.text.trim()
          forging.set(input.sessionID, { request, started: false })
          return ctx.session
            .prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: prompt(request),
              delivery: input.delivery,
            })
            .pipe(Effect.asVoid)
        },
      }),
    )

    // The tool lasts for the forging run only; the next ordinary request in the session cannot rewrite commands.
    yield* bus
      .subscribe([SessionEvent.Execution.Succeeded, SessionEvent.Execution.Failed, SessionEvent.Execution.Interrupted])
      .pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.type === SessionEvent.Execution.Interrupted.type && event.data.reason === "shutdown") return
            // A run that was already going when /forge-command was typed is not the forging run.
            if (forging.get(event.data.sessionID)?.started) forging.delete(event.data.sessionID)
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )

    const hook = (event: SessionHooks["context"]) =>
      Effect.sync(() => {
        const forge = forging.get(event.sessionID)
        if (forge) forge.started = true
        if (event.tools[name] && !forge) delete event.tools[name]
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}

// The !`...` snippets of a template that could change something: they run without asking.
export function writingShell(template: string) {
  return Array.from(template.matchAll(SHELL), (match) => match[1] ?? "").filter((source) => WRITES.test(source))
}

// The command file exactly as save writes it.
export function render(draft: Draft) {
  return [
    "---",
    `description: ${JSON.stringify(draft.description)}`,
    ...(draft.agent ? [`agent: ${JSON.stringify(draft.agent)}`] : []),
    ...(draft.model ? [`model: ${JSON.stringify(draft.model)}`] : []),
    ...(draft.subagent ? ["subagent: true"] : []),
    "---",
    "",
    draft.template,
  ].join("\n")
}

function prompt(request: string) {
  return [
    "You are the command forge: you design excellent slash commands and save them with the command_forge tool.",
    request
      ? `The operator wants: ${request}`
      : "The operator gave no description: ask in one short question what the command should do, then continue.",
    "",
    "Steps:",
    "1. Call command_forge kinds and command_forge list. Pick the kind (or combination of kinds) that fits: a plain prompt, arguments, shell context, a background subagent, a different agent, a pinned model, a workflow, a generator, a review checklist, Registry recipes.",
    "2. If the request asks for several commands, design each one; otherwise design one. Choose a short, memorable name that is not taken.",
    "3. Write the template as instructions to a capable but literal model: the goal, numbered steps, what to read first, the checks to run, the output format and when it is done. Use $1..$9 for distinct arguments, $ARGUMENTS for free text, !`...` only for read-only context (git diff, git log, ls, cat of a known file).",
    "4. End the description with the arguments in brackets, e.g. \"rename a symbol [old] [new]\".",
    "5. Call command_forge preview with realistic sample args, read the rendered prompt, and fix anything unclear or any reported problem.",
    "6. Call command_forge save (scope project unless the operator asked for every project).",
    "7. Reply with each saved command, how to run it with an example, and one line on what it does.",
    "Answer in the operator's language; keep the command files in English unless the operator asked otherwise.",
  ].join("\n")
}
