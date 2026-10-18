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
  expect(merged).toEqual({ hidePaths: true, noOutbound: true, blockCommands: ["a", "b"], protectedFiles: [] })
  expect(RoomRules.merge([undefined])).toBeUndefined()
})

test("describe states only the rules that are set", () => {
  expect(RoomRules.describe({})).toBeUndefined()
  expect(RoomRules.describe({ noOutbound: true })).toContain("Send nothing out")
})


test("configured commands require approval for the executable, not the exact invocation", () => {
  expect(RoomRules.programsRequiringApproval(rules, "git push origin main")).toEqual(["git"])
  expect(RoomRules.programsRequiringApproval(rules, "ls && git push origin main")).toEqual(["git"])
  expect(RoomRules.programsRequiringApproval(rules, "echo hi | curl https://example.test")).toEqual(["curl"])
  expect(RoomRules.programsRequiringApproval(rules, "git status")).toEqual([])
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
})

test("nested response values are path-redacted", () => {
  expect(RoomRules.redactPaths({ session: { directory: "C:\\Users\\me\\app", text: "in C:/Users/me/app/src" } }, "C:\\Users\\me\\app"))
    .toEqual({ session: { directory: "<project>", text: "in <project>/src" } })
})
