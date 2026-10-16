import { expect } from "bun:test"
import { Context, Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { LocationActivity } from "@opencode/core/location-activity"
import { LocationServiceMap } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity } from "./lib/tool"

// Drives a real Chromium over CDP, so it runs only on request: OPENCODE_BROWSER_LIVE=1 bun test test/browser-local.test.ts
const live = process.env.OPENCODE_BROWSER_LIVE === "1"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Session.node, LocationServiceMap.node, LocationActivity.node]),
    [Global.node.replace(tempGlobalLayer), offlineModels],
  ),
)

it.live(
  "Code Mode searches and reads the web through the local browser without a desktop",
  () =>
    Effect.gen(function* () {
      if (!live) return
      const dir = yield* tmpdirScoped()
      const ref = Location.Ref.make({ directory: AbsolutePath.make(dir.path) })
      const locations = yield* LocationServiceMap.Service
      const context = yield* locations.contextEffect(ref)
      yield* Plugin.awaitActivation.pipe(Effect.provideContext(context))
      const session = yield* (yield* Session.Service).create({ location: ref })
      const tools = yield* Context.get(context, Tool.Service).snapshot()
      const started = Date.now()
      const result = yield* tools.execute({
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-browser",
          name: "execute",
          input: {
            code: `const found = await tools.browser.search({ query: "example domain iana", engine: "duckduckgo", limit: 3 })
const tab = found.tab.id
await tools.browser.navigate({ tabID: tab, url: "https://example.com" })
const page = await tools.browser.read({ tabID: tab })
const snapshot = await tools.browser.snapshot({ tabID: tab })
await tools.browser.tabs.close({ tabID: tab })
return { results: found.results.length, title: page.title, text: page.text.length, refs: snapshot.content.includes("@e") }`,
          },
        },
      })
      expect(Date.now() - started).toBeLessThan(60_000)
      expect(result.output).toMatchObject({ toolCalls: expect.any(Array) })
      const output = JSON.parse((result.output as { output: string }).output)
      expect(output).toMatchObject({ title: "Example Domain", refs: true })
      expect(output.results).toBeGreaterThan(0)
      expect(output.text).toBeGreaterThan(50)
    }).pipe(Effect.scoped),
  90_000,
)
