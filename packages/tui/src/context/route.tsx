import { createStore, reconcile } from "solid-js/store"
import type { LocationRef } from "@opencode/client"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../prompt/history"
import { useTuiStartup } from "./runtime"

export type HomeRoute = {
  type: "home"
  prompt?: PromptInfo
  // Location carried over from the previous session or project picker so a new session lands there.
  location?: LocationRef
  // The project whose "+ New session" opened home; the new session stays with it.
  project?: string
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  prompt?: PromptInfo
}

export type PluginRoute = {
  type: "plugin"
  id: string
  name: string
  data?: Record<string, unknown>
}

// A room joined on another host, shown in place of a session.
export type RoomRoute = {
  type: "room"
  url: string
  roomID: string
  // The local session to return to when this room view is minimized.
  returnTo?: string
  // A session of a project room; the room's own session when absent.
  sessionID?: string
}

export type Route = HomeRoute | SessionRoute | PluginRoute | RoomRoute

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: (props: { initialRoute?: Route }) => {
    const startup = useTuiStartup()
    const [store, setStore] = createStore<Route>(
      props.initialRoute ?? initialRoute(startup.initialRoute) ?? { type: "home" },
    )

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        setStore(reconcile(route))
      },
    }
  },
})

function initialRoute(value: unknown): Route | undefined {
  if (!value || typeof value !== "object" || !("type" in value)) return
  if (value.type === "home") return { type: "home" }
  if (value.type === "session" && "sessionID" in value && typeof value.sessionID === "string") {
    return { type: "session", sessionID: value.sessionID }
  }
  if (
    value.type === "plugin" &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string"
  ) {
    const data =
      "data" in value && typeof value.data === "object" && value.data !== null && !Array.isArray(value.data)
        ? (value.data as Record<string, unknown>)
        : undefined
    if (data) return { type: "plugin", id: value.id, name: value.name, data }
    return { type: "plugin", id: value.id, name: value.name }
  }
}

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
