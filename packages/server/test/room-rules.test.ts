import { describe, expect, test } from "bun:test"
import { Room } from "@opencode/core/room"
import { blockedRoomCommand, redactRoomText, roomPolicyPrompt } from "../src/room-rules"

const room = (rules: Partial<Room.Rules> = {}): Room.Info => ({
  id: "room_test" as Room.ID,
  sessionID: "ses_test" as any,
  name: "test",
  ai: "linked",
  guestApprovals: false,
  defaultRole: "member",
  directory: "/home/alice/projects/demo",
  rules: { ...Room.DEFAULT_RULES, ...rules },
  created: 0,
})

describe("multiplayer room rules", () => {
  test("blocks dangerous commands even for trusted members", () => {
    expect(blockedRoomCommand("sudo systemctl restart ssh", room())).toBeDefined()
    expect(blockedRoomCommand("rm -rf /tmp/test", room())).toBeDefined()
  })

  test("blocks explicit command fragments case-insensitively", () => {
    expect(blockedRoomCommand("git push --force origin main", room({ blockedCommands: ["git push --force"] }))).toContain("git push --force")
  })

  test("redacts project and home paths", () => {
    const result = redactRoomText("open /home/alice/projects/demo/src/index.ts and /home/alice/.ssh/id_ed25519", room())
    expect(result).not.toContain("/home/alice/projects/demo")
    expect(result).not.toContain("/home/alice/.ssh")
    expect(result).toContain("/project")
  })

  test("adds mandatory rules to guest prompts", () => {
    const result = roomPolicyPrompt(room({ instructions: "Never reveal internal notes." }), "Fix the bug")
    expect(result).toContain("MULTIPLAYER ROOM RULES")
    expect(result).toContain("Never reveal internal notes.")
    expect(result).toContain("Fix the bug")
  })
})
