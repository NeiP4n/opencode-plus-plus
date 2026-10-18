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
  expect(RoomRules.outbound).toContain("playtest")
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
  expect(RoomRules.protectedFile(undefined, "/home/alice/.ssh/id_ed25519")).toContain(".ssh")
  expect(RoomRules.protectedFile(undefined, "/home/alice/.config/opencode/auth.json")).toContain("opencode")
  expect(RoomRules.protectedFile(undefined, "/work/app/.env.local")).toBe(".env*")
})

test("built-in credential globs protect root-level and nested credential files", () => {
  expect(RoomRules.protectedFile(undefined, ".ssh/id_ed25519")).toBe("**/.ssh/**")
  expect(RoomRules.protectedFile(undefined, "/home/user/.ssh/id_ed25519")).toBe("**/.ssh/**")
  expect(RoomRules.protectedFile(undefined, "auth.json")).toBe("**/auth.json")
  expect(RoomRules.protectedFile(undefined, "/project/.config/opencode/auth.json")).toBe("**/.config/opencode/**")
  expect(RoomRules.protectedFile(undefined, "src/auth.json")).toBe("**/auth.json")
})

test("protected files are detected when directly referenced in shell commands", () => {
  expect(RoomRules.protectedFileInCommand(rules, "cat .env.local")).toBe(".env*")
  expect(RoomRules.protectedFileInCommand(rules, 'cat ".env.local"')).toBe(".env*")
  expect(RoomRules.protectedFileInCommand(rules, "cat ./secrets/key.pem")).toBe("secrets/*")
  expect(RoomRules.protectedFileInCommand(rules, "cat C:\\work\\app\\.env")).toBe(".env*")
  expect(RoomRules.protectedFileInCommand(rules, "bash -c 'cat .env'")).toBe(".env*")
  expect(RoomRules.protectedFileInCommand(rules, "git status")).toBeUndefined()
  expect(RoomRules.protectedFileInCommand(rules, "cat src/index.ts")).toBeUndefined()
  expect(RoomRules.protectedFileInCommand(undefined, "cat auth.json")).toBe("**/auth.json")
  expect(RoomRules.protectedFileInCommand(undefined, "cat .ssh/id_ed25519")).toBe("**/.ssh/**")
  expect(RoomRules.protectedFileInCommand(undefined, "cat /home/user/.ssh/id_ed25519")).toBe("**/.ssh/**")
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

test("outbound access is denied by default whenever room rules are active", () => {
  expect(RoomRules.merge([{ hidePaths: true }])?.noOutbound).toBe(true)
  expect(RoomRules.merge([{ noOutbound: false }])?.noOutbound).toBe(false)
})

test("outbound policy includes shell and MCP resource access", () => {
  expect(RoomRules.outbound).toContain("shell")
  expect(RoomRules.outbound).toContain("desktop")
  expect(RoomRules.outbound).toContain("playtest")
  expect(RoomRules.outbound).toContain("opencode_list_mcp_resources")
  expect(RoomRules.outbound).toContain("opencode_read_mcp_resource")
})

test("program rules request approval for the executable, including wrapped commands", () => {
  expect(RoomRules.programsRequiringApproval(rules, "git push origin main")).toEqual(["git"])
  expect(RoomRules.programsRequiringApproval(rules, "echo ok; sudo -u root git push origin main")).toEqual(["git"])
  expect(RoomRules.programsRequiringApproval(rules, "curl https://example.test")).toEqual(["curl"])
  expect(RoomRules.programName("env TOKEN=x git status")).toBe("git")
  expect(RoomRules.programsRequiringApproval(rules, "git status")).toEqual([])
})

test("outbound access is denied by default across overlapping rooms", () => {
  expect(RoomRules.merge([{}])?.noOutbound).toBe(true)
  expect(RoomRules.merge([{ noOutbound: false }])?.noOutbound).toBe(false)
  expect(RoomRules.merge([{ noOutbound: false }, {}])?.noOutbound).toBe(true)
})

test("describe states only the rules that are set", () => {
  expect(RoomRules.describe({})).toBeUndefined()
  expect(RoomRules.describe({ noOutbound: true })).toContain("desktop control, playtest app execution")
  expect(RoomRules.describe({ hideExecution: true })).toContain("screenshots to other guests")
  expect(RoomRules.describe({ denyGuestPrompts: true })).toContain("must not submit prompts")
  expect(RoomRules.describe({ denyGuestCommands: true })).toContain("must not invoke slash commands")
})
