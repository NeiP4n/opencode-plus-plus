import { Effect, Layer } from "effect"
import { Room } from "@opencode/core/room"

// Read, glob and grep consult the rooms a session belongs to before they touch a path.
// A tool test has no rooms, so the stub answers "no rooms, no members" and dies on the
// room-management calls a tool never makes.
const unused = () => Effect.die(new Error("the room stub does not implement room management"))

export function roomLayer(overrides: Partial<Room.Interface> = {}) {
  const base: Room.Interface = {
    list: () => Effect.succeed([]),
    get: unused,
    create: unused,
    update: unused,
    remove: unused,
    members: () => Effect.succeed([]),
    member: () => Effect.succeed(undefined),
    saveMember: unused,
    removeMember: () => Effect.void,
    bans: () => Effect.succeed([]),
    ban: unused,
    unban: () => Effect.void,
  }
  return Layer.succeed(Room.Service, Room.Service.of({ ...base, ...overrides }))
}
