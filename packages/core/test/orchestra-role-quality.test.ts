import { describe, expect, test } from "bun:test"
import { playbookOf, role, roles, templates } from "@opencode/schema/orchestra"
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
