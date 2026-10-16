import { describe, expect, test } from "bun:test"
import { playbookOf, role, roles, templates, toolGroups } from "@opencode/schema/orchestra"
import { Hub } from "@opencode/core/hub/index"
import { TeamPlugin } from "@opencode/core/plugin/team"
import { checksOf, outcomeOf, toolAllowed, toolRules } from "@opencode/core/orchestra"
import { Permission } from "@opencode/core/permission"

describe("role tool limits", () => {
  test("leave only the listed tools, patterns included", () => {
    const rules = toolRules(["read", "context7_*"])
    expect(Permission.evaluate("read", "src/a.ts", rules).effect).toBe("allow")
    expect(Permission.evaluate("read", ".env", rules).effect).toBe("ask")
    expect(Permission.evaluate("shell", "*", rules).effect).toBe("deny")
    expect(Permission.evaluate("context7_query", "*", rules).effect).toBe("allow")
    expect(Permission.evaluate("question", "*", rules).effect).toBe("allow")
    expect(Permission.evaluate("external_directory", "/tmp", rules).effect).toBe("ask")
    expect(toolAllowed(["read", "context7_*"], "context7_docs")).toBe(true)
    expect(toolAllowed(["read"], "edit")).toBe(false)
  })

  test("keep the Code Mode wrapper open so a role's MCP tools stay reachable", () => {
    const rules = toolRules(["read", "context7_*"])
    expect(Permission.evaluate("execute", "*", rules).effect).toBe("allow")
    expect(Permission.evaluate("playwright_navigate", "*", rules).effect).toBe("deny")
  })
})

describe("built-in role toolkits", () => {
  const actions = new Set(toolGroups.flatMap((group) => group.actions))
  const categories = new Set(Hub.all.map((entry) => entry.category))

  test("every role has its own tools, all of them real permission actions", () => {
    for (const item of roles) {
      expect(item.tools?.length ?? 0).toBeGreaterThan(0)
      for (const tool of item.tools ?? []) expect(actions.has(tool)).toBe(true)
      for (const category of item.hub ?? []) expect(categories.has(category as Hub.Category)).toBe(true)
    }
  })

  test("read-only roles cannot edit and every role can read", () => {
    for (const item of roles) {
      expect(item.tools).toContain("read")
      if (item.readOnly) expect(item.tools).not.toContain("edit")
    }
  })

  test("a role is told exactly which tools and Registry limits it has", () => {
    const reviewer = { ...findRole("reviewer")!, agent: role("reviewer"), origin: "builtin" as const }
    const text = TeamPlugin.toolkit(reviewer, ["read", "grep", "hub", "question"])
    expect(text).toContain("Tools you can call: grep, hub, read.")
    expect(text).toContain("categories search, files, text, json, git, build, github")
    expect(text).toContain("read-only")
    expect(TeamPlugin.toolkit(reviewer, ["read"])).not.toContain("Registry")
  })

  test("roles differ by the job: an analyst has no terminal, a frontend developer has the browser", () => {
    expect(findRole("product-analyst")?.tools).not.toContain("shell")
    expect(findRole("frontend-developer")?.tools).toContain("browser")
    expect(findRole("mobile-developer")?.hub).toContain("mobile")
    expect(findRole("security-auditor")?.hub).toContain("security")
  })
})

const findRole = (id: string) => roles.find((item) => item.id === id)

describe("built-in Orchestra role contracts", () => {
  test("every role has a unique ID, a clear mission, and substantive rules", () => {
    expect(new Set(roles.map((item) => item.id)).size).toBe(roles.length)

    for (const item of roles) {
      expect(item.description.trim().length).toBeGreaterThan(20)
      expect(item.rules.trim().length).toBeGreaterThan(80)
      expect(item.rules).toContain("Mission:")
    }
  })

  test("keeps root-cause analysis, acceptance testing, review, and falsification distinct", () => {
    expect(findRole("debugger")?.rules).toContain("root cause")
    expect(findRole("tester")?.rules).toContain("independently")
    expect(findRole("reviewer")?.readOnly).toBe(true)

    const adversary = findRole("counterexample-engineer")
    expect(adversary).toBeDefined()
    if (!adversary) throw new Error("counterexample-engineer must be registered")
    expect(adversary.readOnly).toBe(true)
    expect(adversary.rules).toContain("trying to disprove")
    expect(adversary.rules).toContain("concrete counterexamples")
  })

  test("keeps the core template lean while allowing adversarial review on demand", () => {
    const core = templates.find((item) => item.id === "opencode-core")
    expect(core).toBeDefined()
    if (!core) throw new Error("opencode-core template must be registered")

    const memberAgents = core.members.map((member) => member.agent)
    for (const id of [
      "architect",
      "core-maintainer",
      "integration-engineer",
      "api-contract-engineer",
      "security-auditor",
      "tester",
      "reviewer",
    ]) {
      expect(memberAgents).toContain(role(id))
    }

    // The orchestrator creates this specialist only when task risk justifies the extra session.
    expect(memberAgents).not.toContain(role("counterexample-engineer"))
  })

  test("offers a high-assurance template that explicitly includes counterexample analysis", () => {
    const proofDriven = templates.find((item) => item.id === "proof-driven")
    expect(proofDriven).toBeDefined()
    if (!proofDriven) throw new Error("proof-driven template must be registered")
    const memberAgents = proofDriven.members.map((member) => member.agent)
    expect(memberAgents).toEqual([
      role("architect"),
      role("developer"),
      role("tester"),
      role("counterexample-engineer"),
      role("reviewer"),
    ])
  })

  test("every built-in team template references registered roles", () => {
    for (const template of templates) {
      for (const member of template.members) {
        expect(roles.some((item) => role(item.id) === member.agent)).toBe(true)
      }
    }
  })

  test("every built-in team has a playbook that names only registered roles", () => {
    const ids = new Set(roles.map((item) => item.id))
    for (const template of templates) {
      expect(playbookOf(template)?.length ?? 0).toBeGreaterThan(80)
      // Role ids in a playbook are what the Orchestrator passes to action create.
      const named = playbookOf(template)?.match(/\b[a-z]+(?:-[a-z]+)+\b/g) ?? []
      for (const id of named.filter((word) => word.endsWith("-developer") || word.endsWith("-engineer") || word.endsWith("-auditor") || word.endsWith("-analyst")))
        expect(ids.has(id)).toBe(true)
    }
  })

  test("ships app teams for mobile and desktop development", () => {
    const mobile = templates.find((item) => item.id === "mobile-app")
    expect(mobile?.members.map((member) => member.agent)).toContain(role("mobile-developer"))
    const desktop = templates.find((item) => item.id === "desktop-app")
    expect(desktop?.members.map((member) => member.agent)).toContain(role("desktop-developer"))
  })

  test("general roles do not assume the Opencode++ monorepo", () => {
    const specific = new Set(["core-maintainer", "integration-engineer", "api-contract-engineer"])
    for (const item of roles.filter((item) => !specific.has(item.id))) {
      expect(item.rules).not.toContain("packages/client")
      expect(item.rules).not.toContain("bun run generate")
    }
  })
})

describe("worker report outcome", () => {
  test("reads the status line however the model decorates it", () => {
    expect(outcomeOf("DONE\nRESULT: added the screen")).toBe("complete")
    expect(outcomeOf("**DONE**")).toBe("complete")
    expect(outcomeOf("## ✅ DONE")).toBe("complete")
    expect(outcomeOf("Status: PARTLY DONE")).toBe("partial")
    expect(outcomeOf("NOT DONE — the build fails")).toBe("incomplete")
    expect(outcomeOf("Готово\nRESULT: ...")).toBe("complete")
    expect(outcomeOf("Не выполнено: нет доступа")).toBe("incomplete")
    expect(outcomeOf("Частично готово")).toBe("partial")
    expect(outcomeOf("I looked at the code.\n\nSTATUS: DONE")).toBe("complete")
  })

  test("counts only checks that were actually run", () => {
    const report = [
      "DONE",
      "RESULT: added the screen",
      "CHECKS:",
      "- bun test test/screen.test.ts — PASS (12 pass, 0 fail)",
      "- bun typecheck — ✓",
      "- flutter test — NOT RUN (no Flutter here)",
      "RISKS: none",
      "- this FAIL is outside CHECKS",
    ].join("\n")
    expect(checksOf(report)).toEqual({ executed: 2, failed: 0, notRun: 1 })
    expect(checksOf("DONE\nCHECKS: NOT RUN, no test runner")).toEqual({ executed: 0, failed: 0, notRun: 1 })
    expect(checksOf("DONE\n**CHECKS**\n- npm test: FAIL (2 failed)")).toMatchObject({ executed: 1, failed: 1 })
    expect(checksOf("DONE, everything works")).toEqual({ executed: 0, failed: 0, notRun: 0 })
  })

  test("does not guess a status the report never states", () => {
    expect(outcomeOf("I changed two files and everything is done.")).toBe("unknown")
    expect(outcomeOf("")).toBe("unknown")
    expect(outcomeOf("DONEZO")).toBe("unknown")
  })
})
