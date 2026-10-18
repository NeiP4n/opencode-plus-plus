import { Option, Schema } from "effect"
import { createSignal } from "solid-js"
import { useStorage } from "../context/storage"

// The host server stamps guest prompts with the author from the room token, so
// this metadata is the only record of who wrote a message in a hosted session.
const RoomMetadata = Schema.Struct({
  room: Schema.Struct({
    id: Schema.String,
    guest: Schema.Struct({ id: Schema.String, name: Schema.String }),
    // Set when the guest's AI wrote it rather than the person.
    ai: Schema.Boolean.pipe(Schema.optional),
  }),
})
const decodeRoomMetadata = Schema.decodeUnknownOption(RoomMetadata)

export function roomAuthor(metadata: unknown) {
  return decodeRoomMetadata(metadata).pipe(
    Option.map((value) => value.room),
    Option.getOrUndefined,
  )
}

// Distinct guest names that posted into one room. There is no presence
// tracking, so this counts who took part, not who is connected now.
export function roomGuests(messages: readonly { type: string; metadata?: unknown }[], roomID: string) {
  // Avoid flatMap/map/filter intermediate arrays: this runs against the whole transcript
  // and is commonly called again when the live message list changes. Keep only the Set that
  // the caller actually needs.
  const guests = new Set<string>()
  for (const message of messages) {
    if (message.type !== "user") continue
    const author = roomAuthor(message.metadata)
    if (author?.id === roomID) guests.add(author.guest.name)
  }
  return guests.size
}

// Rooms change only through host actions in this client, so readers of the
// room list refetch on this revision instead of polling the server.
const [revision, setRevision] = createSignal(0)
export const roomListRevision = revision
export function roomListChanged() {
  setRevision((value) => value + 1)
}

// A room this device joined on another host. The token only opens that room.
export type JoinedRoom = {
  url: string
  roomID: string
  name: string
  token: string
  guest: string
}

// Joined rooms live in client storage under one key, so the Connect window, the
// left panel and the room view all read and change the same live list.
export function useJoinedRooms() {
  return useStorage().store<{ joined: JoinedRoom[]; device?: string }>("rooms", { initial: { joined: [] } })
}

// A random key this client keeps across joins, so a host's ban outlasts a new name.
export function useDeviceKey() {
  const [rooms, update] = useJoinedRooms()
  return async () => {
    if (rooms.device) return rooms.device
    const device = crypto.randomUUID()
    await update((draft) => {
      draft.device = device
    })
    return device
  }
}

export function sameRoom(a: Pick<JoinedRoom, "url" | "roomID">, b: Pick<JoinedRoom, "url" | "roomID">) {
  return a.url === b.url && a.roomID === b.roomID
}
