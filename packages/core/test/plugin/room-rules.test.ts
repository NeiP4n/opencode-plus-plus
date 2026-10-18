import { describe, expect, test } from "bun:test"
import { blocksOutboundTool } from "@opencode/core/plugin/room-rules"

describe("blocksOutboundTool", () => {
  test("blocks direct outbound tool names and OpenCode aliases", () => {
    expect(blocksOutboundTool("shell")).toBe(true)
    expect(blocksOutboundTool("opencode_shell")).toBe(true)
    expect(blocksOutboundTool("webfetch")).toBe(true)
    expect(blocksOutboundTool("desktop")).toBe(true)
    expect(blocksOutboundTool("desktop_screenshot")).toBe(true)
  })

  test("blocks outbound actions carried by multi-action tools", () => {
    expect(blocksOutboundTool("peers", "run")).toBe(true)
    expect(blocksOutboundTool("federation", "send")).toBe(true)
    expect(blocksOutboundTool("other-tool", "opencode_list_mcp_resources")).toBe(true)
  })

  test("blocks namespaced MCP tools with server-defined names", () => {
    expect(blocksOutboundTool("custom_server_upload", undefined, true)).toBe(true)
  })

  test("does not block unrelated local tools", () => {
    expect(blocksOutboundTool("read")).toBe(false)
    expect(blocksOutboundTool("grep")).toBe(false)
    expect(blocksOutboundTool("sessions", "list")).toBe(true)
    expect(blocksOutboundTool("other-tool", "list")).toBe(true)
  })
})
