import { expect, test } from "bun:test"
import { RoomRules } from "../src/room-rules.js"

const rules: RoomRules.Rules = {
  blockCommands: ["rm -rf", "git push*", "curl"],
  protectedFiles: [".env*", "secrets/*"],
}

test("a blocked command matches at the start of the line or of any chained part", () => {
  expect(RoomRules.blockedCommand(rules, "rm -rf /tmp/x")).toBe("rm -rf")
  expect(RoomRules.blockedCommand(rules, "git push origin main")).toBe("git push*")
  expect(RoomRules.blockedCommand(rules, "ls && git push")).toBe("git push*")
  expect(RoomRules.blockedCommand(rules, "echo hi | curl http://x")).toBe("curl")
})

test("a pattern without a wildcard also catches the command inside a wrapper", () => {
  expect(RoomRules.blockedCommand(rules, 'bash -c "rm -rf build"')).toBe("rm -rf")
})

test("harmless commands pass, and no rules block nothing", () => {
  expect(RoomRules.blockedCommand(rules, "git status")).toBeUndefined()
  expect(RoomRules.blockedCommand(rules, "echo push")).toBeUndefined()
  expect(RoomRules.blockedCommand(undefined, "rm -rf /")).toBeUndefined()
})

test("protected files match by name or folder, with either slash", () => {
  expect(RoomRules.protectedFile(rules, "C:\\work\\app\\.env.local")).toBe(".env*")
  expect(RoomRules.protectedFile(rules, "/work/app/secrets/key.pem")).toBe("secrets/*")
  expect(RoomRules.protectedFile(rules, "/work/app/environment.ts")).toBeUndefined()
  expect(RoomRules.protectedFile(rules, "/work/app/src/index.ts")).toBeUndefined()
  expect(RoomRules.protectedFile(undefined, "/home/alice/.ssh/id_ed25519")).toContain(".ssh")
  expect(RoomRules.protectedFile(undefined, "/work/app/.env.local")).toBe(".env*")
  expect(RoomRules.protectedFile(undefined, "/home/alice/.config/opencode/auth.json")).toBe("**/.config/opencode/**")
  expect(RoomRules.protectedFile(undefined, "/home/alice/.ssh")).toBe("**/.ssh")
})

test("redacting a path covers both slash styles", () => {
  expect(RoomRules.redactPath("C:\\Users\\me\\app", "C:\\Users\\me\\app")).toBe("<project>")
  expect(RoomRules.redactPath("opened C:/Users/me/app/src", "C:\\Users\\me\\app")).toBe("opened <project>/src")
})

test("a session in several rooms gets the strictest rules", () => {
  const merged = RoomRules.merge([
    { hidePaths: true, blockCommands: ["a"] },
    { noOutbound: true, blockCommands: ["a", "b"] },
    undefined,
  ])
  expect(merged).toEqual({
    hidePaths: true,
    noOutbound: true,
    hideCommandExecution: false,
    hideScreenshots: false,
    blockCommands: ["a", "b"],
    protectedFiles: [],
  })
  expect(RoomRules.merge([undefined])).toBeUndefined()
})

test("describe always warns that credentials and secret files stay protected", () => {
  expect(RoomRules.describe({})).toContain("Credential and secret files are protected by default")
  expect(RoomRules.describe({ noOutbound: true })).toContain("Do not use network")
})


test("configured commands require approval for the executable, not the exact invocation", () => {
  expect(RoomRules.programsRequiringApproval(rules, "git push origin main")).toEqual(["git"])
  expect(RoomRules.programsRequiringApproval(rules, "ls && git push origin main")).toEqual(["git"])
  expect(RoomRules.programsRequiringApproval(rules, "echo hi | curl https://example.test")).toEqual(["curl"])
  expect(RoomRules.programsRequiringApproval(rules, "git status")).toEqual([])
  expect(RoomRules.programsRequiringApproval(rules, "sudo -u root git push origin main")).toEqual(["git"])
  expect(RoomRules.programsRequiringApproval(rules, "env GIT_SSH_COMMAND=ssh git push origin main")).toEqual(["git"])
  expect(RoomRules.programsRequiringApproval(rules, "bash -c 'git push origin main'")).toEqual(["git"])
  expect(RoomRules.programName("sudo -u root git push origin main")).toBe("git")
})

test("protected files are also detected in shell arguments", () => {
  expect(RoomRules.commandTouchesProtectedFile(rules, "cat .env.local")).toBe(true)
  expect(RoomRules.commandTouchesProtectedFile(rules, "python -c 'open(\".env\").read()'")).toBe(true)
  expect(RoomRules.commandTouchesProtectedFile(rules, "cat src/index.ts")).toBe(false)
})

test("outbound shell commands are detected", () => {
  expect(RoomRules.commandSendsOutbound("git push origin main")).toBe(true)
  expect(RoomRules.commandSendsOutbound("curl https://example.test")).toBe(true)
  expect(RoomRules.commandSendsOutbound("git status")).toBe(false)
  expect(RoomRules.commandSendsOutbound("gh repo view")).toBe(true)
  expect(RoomRules.commandSendsOutbound("kubectl get pods")).toBe(true)
  expect(RoomRules.commandSendsOutbound("python safe_script.py")).toBe(true)
  expect(RoomRules.commandSendsOutbound("bash ./local-check.sh")).toBe(true)
  expect(RoomRules.commandSendsOutbound("npm test")).toBe(true)
  expect(RoomRules.commandSendsOutbound('python -c "import requests; requests.post(url, data=secret)"')).toBe(true)
})

test("nested response values are path-redacted", () => {
  expect(RoomRules.redactPaths({ session: { directory: "C:\\Users\\me\\app", text: "in C:/Users/me/app/src" } }, "C:\\Users\\me\\app"))
    .toEqual({ session: { directory: "<project>", text: "in <project>/src" } })
})

test("hide-command-execution filters tool events and activity feed entries", () => {
  const privateRules = { hideCommandExecution: true }
  expect(RoomRules.hideExecutionEvent(privateRules, { type: "session.shell.started" })).toBe(true)
  expect(RoomRules.hideExecutionEvent(privateRules, { type: "session.tool.success" })).toBe(true)
  expect(RoomRules.hideExecutionEvent(privateRules, { type: "session.text.ended" })).toBe(false)
  expect(RoomRules.hideExecutionFeed(privateRules, { events: [{ kind: "run" }, { kind: "pass" }, { kind: "fail" }, { kind: "join" }] }))
    .toEqual({ events: [{ kind: "join" }] })
  expect(RoomRules.hideExecutionEvent(privateRules, { type: "permission.asked" })).toBe(true)
})

test("screenshot privacy strips image attachments and replaces tool images with text", () => {
  const input = {
    files: [
      { mime: "image/png", source: { type: "inline" }, data: "YWJj" },
      { mime: "text/plain", source: { type: "inline" }, data: "YWJj" },
    ],
    content: [{ type: "file", mime: "image/png", uri: "file:///tmp/cap.png" }, { type: "text", text: "done" }],
  }
  expect(RoomRules.sanitizeScreenshots(input, true)).toEqual({
    files: [{ mime: "text/plain", source: { type: "inline" }, data: "YWJj" }],
    content: [{ type: "text", text: "[image hidden by room rules]" }, { type: "text", text: "done" }],
  })
})

test("strict outbound mode blocks connected account actions as well as web tools", () => {
  expect(RoomRules.outboundAction("webfetch")).toBe(true)
  expect(RoomRules.outboundAction("github__create_issue")).toBe(true)
  expect(RoomRules.outboundAction("gmail_send")).toBe(true)
  expect(RoomRules.outboundAction("git")).toBe(true)
  expect(RoomRules.outboundAction("read")).toBe(false)
  expect(RoomRules.localOnlyAction("read")).toBe(true)
  expect(RoomRules.localOnlyAction("unknown_custom_tool")).toBe(false)
})

test("execution privacy removes tool calls but keeps the assistant's ordinary text", () => {
  expect(RoomRules.sanitizeForGuest({
    content: [{ type: "text", text: "Finished" }, { type: "tool", name: "shell", state: { input: { command: "git status" } } }],
  }, { hideCommandExecution: true }, "/work/app")).toEqual({
    content: [{ type: "text", text: "Finished" }],
  })
})

test("project path redaction also masks an ancestor project root", () => {
  expect(RoomRules.redactPath("project at /work/repo/src/sub", "/work/repo/src/sub")).toBe("project at <project>")
})

test("outbound access is blocked by default in a room and must be explicitly enabled", () => {
  expect(RoomRules.merge([{}])?.noOutbound).toBe(true)
  expect(RoomRules.merge([{ noOutbound: false }])?.noOutbound).toBe(false)
  expect(RoomRules.merge([{ noOutbound: false }, {}])?.noOutbound).toBe(true)
})
