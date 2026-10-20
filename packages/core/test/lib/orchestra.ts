import { Effect, Layer, Stream } from "effect"
import { Orchestra } from "@opencode/core/orchestra"

// Tool plugins ask the Orchestrator who owns a session before they touch team state.
// A tool test has no team, so the stub reports "nobody owns anything" and dies on the
// project-lifecycle calls a tool never makes, which keeps a wrong call visible.
const unused = Effect.die(new Error("the orchestra stub does not implement project lifecycle"))

export function orchestraLayer(overrides: Partial<Orchestra.Interface> = {}) {
  const base: Orchestra.Interface = {
    projects: () => Effect.succeed([]),
    create: () => unused,
    update: () => unused,
    remove: () => unused,
    main: () => unused,
    sessions: () => Effect.succeed([]),
    owns: () => Effect.succeed(false),
    owners: () => Effect.succeed({}),
    claim: () => Effect.void,
    createMember: () => unused,
    mainOf: () => Effect.succeed(undefined),
    access: () => Effect.succeed("write"),
    accessMany: () => Effect.succeed({}),
    setAccess: () => Effect.void,
    categories: () => Effect.succeed({}),
    setCategory: () => Effect.void,
    dispatch: () => unused,
    pending: () => Effect.succeed(undefined),
    recoverPendingTasks: () => Effect.void,
    roles: () => Effect.succeed([]),
    saveRole: () => unused,
    removeRole: () => Effect.void,
    templates: () => Effect.succeed([]),
    saveTemplate: () => unused,
    removeTemplate: () => Effect.void,
    playbook: () => Effect.succeed(undefined),
    outcomes: () => Effect.succeed({}),
    changes: Stream.empty,
  }
  return Layer.succeed(Orchestra.Service, Orchestra.Service.of({ ...base, ...overrides }))
}
