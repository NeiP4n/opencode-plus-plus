import { expect, test } from "bun:test"
import { App } from "@opencode/core/app"

test("preserves the explicit latest channel in the user agent", () => {
  expect(App.useragent(App.make({ name: "cli", version: "2.0.24", channel: "latest" }))).toBe(
    "opencode/latest/2.0.24/cli",
  )
})

test("uses a version-only user agent for local and branch builds", () => {
  expect(App.useragent(App.make({ name: "cli", version: "2.0.24+abc123", channel: "lan-rooms" }))).toBe(
    "opencode/2.0.24+abc123",
  )
  expect(App.useragent(App.make({ name: "cli", version: "2.0.24+abc123", channel: "local" }))).toBe(
    "opencode/2.0.24+abc123",
  )
})
