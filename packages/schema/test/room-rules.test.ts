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
  expect(RoomRules.protectedFileInCommand(rules, "tool --config=.env.local")).toBe(".env*")
  expect(RoomRules.protectedFileInCommand(rules, "echo secret > .env.local")).toBe(".env*")
  expect(RoomRules.protectedFileInCommand(rules, "tool --key-file=secrets/key.pem")).toBe("secrets/*")
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
test("redacting a nested session path hides likely project roots but not sibling directories", () => {
  expect(RoomRules.redactPath("project /work/repo", "/work/repo/src/session")).toBe("project <project>")
  expect(RoomRules.redactPath("project C:/Users/alice/repo", "C:/Users/alice/repo/src/session")).toBe("project <project>")
  expect(RoomRules.redactPath("unrelated /work/other", "/work/repo/src/session")).toBe("unrelated /work/other")
  expect(RoomRules.redactPath("unrelated /work/repository-other", "/work/repo/src/session")).toBe("unrelated /work/repository-other")
  expect(RoomRules.redactPath("unrelated /work/Repo/src", "/work/repo/src/session")).toBe("unrelated /work/Repo/src")
  expect(RoomRules.redactPath("unrelated c:/USERS/ALICE/REPO/src", "C:/Users/alice/repo/src/session")).toBe("unrelated <project>/src")
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

test("room policy fails closed for unknown tools and MCP transport metadata", () => {
  expect(RoomRules.isLocalOnlyAction("read")).toBe(true)
  expect(RoomRules.isLocalOnlyAction("webfetch")).toBe(false)
  expect(RoomRules.isLocalOnlyAction("custom_upload")).toBe(false)
  const rules: RoomRules.Rules = { noOutbound: true }
  expect(RoomRules.policy(rules, { action: "read", resources: [] })).toBeUndefined()
  expect(RoomRules.policy(rules, { action: "custom_upload", resources: [] })).toMatchObject({
    effect: "deny",
  })
  expect(
    RoomRules.policy(rules, {
      action: "read",
      resources: [],
      metadata: { transport: "mcp" },
    }),
  ).toMatchObject({ effect: "deny" })
  expect(RoomRules.policy({ noOutbound: false }, { action: "custom_upload", resources: [] })).toBeUndefined()
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

test("shell tokenization remains linear for long escaped quoted arguments", () => {
  const quotedAssignment = '"' + "FOO=" + String.fromCharCode(92).repeat(256) + '!"'
  expect(RoomRules.programName("env " + quotedAssignment + " git status")).toBe("git")
})

test("outbound access is denied by default across overlapping rooms", () => {
  expect(RoomRules.merge([{}])?.noOutbound).toBe(true)
  expect(RoomRules.merge([{ noOutbound: false }])?.noOutbound).toBe(false)
  expect(RoomRules.merge([{ noOutbound: false }, {}])?.noOutbound).toBe(true)
})

test("credential and environment dumps stay blocked even when outbound access is allowed", () => {
  expect(RoomRules.commandLeaksCredentials("env")).toBe(true)
  expect(RoomRules.commandLeaksCredentials("printenv")).toBe(true)
  expect(RoomRules.commandLeaksCredentials("echo $OPENAI_API_KEY")).toBe(true)
  expect(RoomRules.commandLeaksCredentials("Get-ChildItem Env:")).toBe(true)
  expect(RoomRules.commandLeaksCredentials('python -c "import os; print(os.environ)"')).toBe(true)
  expect(RoomRules.commandLeaksCredentials('node -e "console.log(process.env)"')).toBe(true)
  expect(RoomRules.commandLeaksCredentials("echo hello")).toBe(false)
})

test("authoritative room policy denies protected data and asks for program use", () => {
  expect(RoomRules.policy({ noOutbound: true }, { action: "webfetch", resources: ["*"] }))
    .toMatchObject({ effect: "deny" })
  expect(RoomRules.policy({ noOutbound: false, protectedFiles: [".env*"] }, {
    action: "shell",
    resources: ["cat .env.local"],
  })).toMatchObject({ effect: "deny" })
  expect(RoomRules.policy({ noOutbound: false, blockCommands: ["git push*"] }, {
    action: "shell",
    resources: ["git push origin main"],
  })).toMatchObject({ effect: "ask", message: "Room rules require host approval to use: git.", save: [] })
})


test("describe states only the rules that are set", () => {
  expect(RoomRules.describe({})).toContain("Credential and secret files")
  expect(RoomRules.describe({ noOutbound: true })).toContain("Outbound access is denied by default")
  expect(RoomRules.describe({ hideExecution: true })).toContain("command execution details")
  expect(RoomRules.describe({ hideScreenshots: true })).toContain("image attachments or screenshots")
  expect(RoomRules.describe({ denyGuestPrompts: true })).toContain("must not submit prompts")
  expect(RoomRules.describe({ denyGuestCommands: true })).toContain("must not invoke slash commands")
})


test("screenshot privacy merges restrictively across all rooms", () => {
  expect(RoomRules.merge([{ hideScreenshots: false }, { hideScreenshots: true }])?.hideScreenshots).toBe(true)
  expect(RoomRules.merge([{}])?.hideScreenshots).toBe(false)
})

test("screenshot privacy removes nested image payloads while retaining text", () => {
  const payload = {
    files: [
      { mime: "image/png", data: "YWJj" },
      { mime: "text/plain", data: "visible notes" },
    ],
    content: [
      { type: "image_payload", url: "https://example.test/capture.png" },
      { type: "text", text: "capture complete" },
    ],
    screenshot: { uri: "/tmp/capture.png" },
    caption: "before data:image/png;base64,YWJj after",
    text: "ordinary text",
  }
  expect(RoomRules.sanitizeScreenshots(payload, true)).toEqual({
    files: [{ mime: "text/plain", data: "visible notes" }],
    content: [{ type: "text", text: "capture complete" }],
    caption: "before [image hidden by room rules] after",
    text: "ordinary text",
  })
  expect(RoomRules.sanitizeScreenshots(payload, false)).toEqual(payload)
})
