import type { Plugin } from "@opencode/plugin/tui"

// Builtins are visible to configuration by id, but their implementations need not all be
// imported at startup. A builtin excluded by configuration stays out of the runtime heap.
type Loader = () => Promise<{ default: Plugin.Definition }>

function lazy(id: string, load: Loader): Plugin.Definition {
  let definition: Promise<Plugin.Definition> | undefined
  return {
    id,
    setup(context) {
      if (!definition) {
        definition = load()
          .then((module) => {
            if (module.default.id !== id)
              throw new Error(`Builtin plugin id mismatch: expected ${id}, got ${module.default.id}`)
            return module.default
          })
          .catch((error) => {
            definition = undefined
            throw error
          })
      }
      return definition.then((plugin) => plugin.setup(context))
    },
  }
}

export const builtins = [
  lazy("opencode.home.footer", () => import("../feature-plugins/home/footer")),
  lazy("opencode.btw", () => import("../feature-plugins/prompt/btw")),
  lazy("opencode.prompt.footer", () => import("../feature-plugins/prompt/footer")),
  lazy("opencode.mascot", () => import("../feature-plugins/prompt/mascot")),
  lazy("opencode.sidebar.context", () => import("../feature-plugins/sidebar/context")),
  lazy("opencode.sidebar.mcp", () => import("../feature-plugins/sidebar/mcp")),
  lazy("opencode.sidebar.footer", () => import("../feature-plugins/sidebar/footer")),
  lazy("opencode.notifications", () => import("../feature-plugins/system/notifications")),
  lazy("opencode.plugins", () => import("../feature-plugins/system/plugins")),
  lazy("opencode.warp", () => import("../feature-plugins/system/warp")),
  lazy("opencode.stats", () => import("../feature-plugins/system/stats")),
  lazy("opencode.merman", () => import("@opencode/merman/plugin")),
  lazy("opencode.latex", () => import("@opencode/latex/plugin")),
  // The storybook is a development tool; keep its route and palette commands out of
  // normal launches and register it only for OPENCODE_STORY runs.
  ...(process.env.OPENCODE_STORY ? [lazy("opencode.storybook", () => import("../feature-plugins/system/storybook"))] : []),
  lazy("opencode.diffs", () => import("../feature-plugins/system/diff-viewer")),
]
