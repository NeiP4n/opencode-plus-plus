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

test("blocked wildcard patterns cannot be hidden inside shell wrappers", () => {
  expect(RoomRules.blockedCommand(rules, 'bash -c "git push origin main"')).toBe("git push*")
  expect(RoomRules.blockedCommand(rules, 'sh -c "echo hi; curl https://example.test"')).toBe("curl")
  expect(RoomRules.blockedCommand(rules, "echo $(git push origin main)")).toBe("git push*")
  expect(RoomRules.blockedCommand(rules, "(git push origin main)")).toBe("git push*")
  expect(RoomRules.blockedCommand(rules, "sudo git push origin main")).toBe("git push*")
  expect(RoomRules.blockedCommand(rules, "env GIT_TRACE=1 git push origin main")).toBe("git push*")
  expect(RoomRules.blockedCommand(rules, "g\\it push origin main")).toBe("git push*")
  expect(RoomRules.blockedCommand(rules, "git \\\n push origin main")).toBe("git push*")
})

test("room command policy covers shell and Registry hub actions", () => {
  expect(RoomRules.commandActions).toEqual(["shell", "hub"])
  expect(RoomRules.outbound).toContain("hub")
  expect(RoomRules.outbound).toContain("desktop")
  expect(RoomRules.blockedCommandForAction(rules, "shell", ["git status"])).toBeUndefined()
  expect(RoomRules.blockedCommandForAction(rules, "hub", ["echo ok", "curl https://example.com"])).toBe("curl")
  expect(RoomRules.blockedCommandForAction(rules, "hub", ["git push origin main"])).toBe("git push*")
  expect(RoomRules.blockedCommandForAction(rules, "read", ["curl https://example.com"])).toBeUndefined()
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
})

test("protected files are detected when directly referenced in shell commands", () => {
  expect(RoomRules.protectedFileInCommand(rules, "cat .env.local")).toBe(".env*")
  expect(RoomRules.protectedFileInCommand(rules, 'cat ".env.local"')).toBe(".env*")
  expect(RoomRules.protectedFileInCommand(rules, "cat ./secrets/key.pem")).toBe("secrets/*")
  expect(RoomRules.protectedFileInCommand(rules, "cat C:\\work\\app\\.env")).toBe(".env*")
  expect(RoomRules.protectedFileInCommand(rules, "bash -c 'cat .env'")).toBe(".env*")
  expect(RoomRules.protectedFileInCommand(rules, "git status")).toBeUndefined()
  expect(RoomRules.protectedFileInCommand(rules, "cat src/index.ts")).toBeUndefined()
})

test("redacting a path covers slash styles and Windows casing", () => {
  expect(RoomRules.redactPath("C:\\Users\\me\\app", "C:\\Users\\me\\app")).toBe("<project>")
  expect(RoomRules.redactPath("opened C:/Users/me/app/src", "C:\\Users\\me\\app")).toBe("opened <project>/src")
  expect(RoomRules.redactPath("opened c:/USERS/ME/APP/src", "C:\\Users\\me\\app")).toBe("opened <project>/src")
})

test("a session in several rooms gets the strictest rules", () => {
  const merged = RoomRules.merge([
    { hidePaths: true, hideExecution: true, denyGuestPrompts: true, blockCommands: ["a"] },
    { noOutbound: true, denyGuestCommands: true, blockCommands: ["a", "b"] },
    undefined,
  ])
  expect(merged).toEqual({
    hidePaths: true,
    hideExecution: true,
    noOutbound: true,
    denyGuestPrompts: true,
    denyGuestCommands: true,
    blockCommands: ["a", "b"],
    protectedFiles: [],
  })
  expect(RoomRules.merge([undefined])).toBeUndefined()
})

test("hard room policy blocks outbound actions, arbitrary MCP tools, commands and protected files", () => {
  const restricted: RoomRules.Rules = {
    noOutbound: true,
    protectedFiles: [".env*"],
  }
  expect(RoomRules.violation(restricted, { action: "webfetch", resources: ["*"] })).toContain("send anything out")
  expect(RoomRules.violation(restricted, {
    action: "github_create_issue",
    resources: ["*"],
    metadata: { transport: "mcp" },
  })).toContain("send anything out")
  expect(RoomRules.violation(restricted, { action: "read", resources: [".env.local"] })).toContain("off limits")
  expect(RoomRules.violation(restricted, { action: "read", resources: ["src/index.ts"] })).toBeUndefined()
  expect(RoomRules.violation({ blockCommands: ["git push*"] }, {
    action: "shell",
    resources: ["git push origin main"],
  })).toContain("forbids commands")
})

test("outbound policy includes shell and MCP resource access", () => {
  expect(RoomRules.outbound).toContain("shell")
  expect(RoomRules.outbound).toContain("desktop")
  expect(RoomRules.outbound).toContain("playtest")
  expect(RoomRules.outbound).toContain("opencode_list_mcp_resources")
  expect(RoomRules.outbound).toContain("opencode_read_mcp_resource")
})

test("describe states only the rules that are set", () => {
  expect(RoomRules.describe({})).toBeUndefined()
  expect(RoomRules.describe({ noOutbound: true })).toContain("Send nothing out")
  expect(RoomRules.describe({ hideExecution: true })).toContain("screenshots to other guests")
  expect(RoomRules.describe({ denyGuestPrompts: true })).toContain("must not submit prompts")
  expect(RoomRules.describe({ denyGuestCommands: true })).toContain("must not invoke slash commands")
})
