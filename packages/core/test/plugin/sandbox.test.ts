import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { SandboxPlugin } from "@opencode/core/plugin/sandbox"
import { tmpdir } from "../fixture/tmpdir"

describe("sandbox shell environment", () => {
  test("drops what the live server passes down and points opencode at the sandbox roots", () => {
    const env = SandboxPlugin.environment(
      {
        PATH: "/usr/bin",
        OPENCODE_SERVER_PASSWORD: "secret",
        OPENCODE_DB: "/live/opencode.db",
        OPENCODE_TERMINAL: "1",
        XDG_STATE_HOME: "/home/user/.local/state",
      },
      "/sandbox",
    )
    expect(env).toEqual({
      PATH: "/usr/bin",
      OPENCODE_TERMINAL: "1",
      XDG_DATA_HOME: path.join("/sandbox", "data"),
      XDG_CONFIG_HOME: path.join("/sandbox", "config"),
      XDG_STATE_HOME: path.join("/sandbox", "state"),
      XDG_CACHE_HOME: path.join("/sandbox", "cache"),
    })
  })
})

describe.skipIf(!Bun.which("bwrap"))("strict sandbox", () => {
  test("hides the home directory and keeps writes outside the sandbox off the real filesystem", async () => {
    await using tmp = await tmpdir("opencode-sandbox-strict-")
    const home = path.join(tmp.path, "home")
    const source = path.join(tmp.path, "source")
    const sandbox = path.join(tmp.path, "sandbox")
    await mkdir(path.join(source, ".git"), { recursive: true })
    await mkdir(path.join(sandbox, "repo"), { recursive: true })
    await Bun.write(path.join(home, "credentials"), "secret")

    const command = SandboxPlugin.confine(
      {
        command: `cat "$HOME/credentials" || echo hidden; echo kept > made; echo lost > ${path.join(source, "escaped")}`,
        cwd: path.join(sandbox, "repo"),
        shell: "sh",
        timeout: 0,
        env: {},
      },
      { source, home: sandbox, isolation: "strict" },
      home,
    )
    const result = Bun.spawnSync(["sh", "-c", command], { env: { ...process.env, HOME: home } })

    expect(result.stdout.toString()).toContain("hidden")
    expect(result.stdout.toString()).not.toContain("secret")
    expect(await Bun.file(path.join(sandbox, "repo", "made")).text()).toBe("kept\n")
    expect(await Bun.file(path.join(source, "escaped")).exists()).toBe(false)
  })
})
