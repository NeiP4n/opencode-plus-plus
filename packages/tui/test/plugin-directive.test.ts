import { expect, test } from "bun:test"
import { pluginDirective } from "../src/plugin/directive"

test("plugin directives replace previous exact enablement without duplicating entries", () => {
  expect(pluginDirective(["opencode.home.footer", "-opencode.home.footer", "opencode.*"], "opencode.home.footer", false)).toEqual([
    "opencode.*",
    "-opencode.home.footer",
  ])
  expect(pluginDirective(["-opencode.home.footer"], "opencode.home.footer", true)).toEqual(["opencode.home.footer"])
})

test("plugin directives preserve external package declarations and unrelated settings", () => {
  const packagePlugin = { package: "example-plugin", options: { enabled: true } }
  expect(pluginDirective([packagePlugin, "-other.plugin"], "example.plugin", false)).toEqual([
    packagePlugin,
    "-other.plugin",
    "-example.plugin",
  ])
})
