import { createSocket } from "node:dgram"
import { networkInterfaces } from "node:os"
import { OpenCode } from "./promise/index.js"
import { PORT, QUERY, REPLY_PORT, decodeReply } from "@opencode/protocol/room-discovery"

export type FoundRoom = {
  readonly id: string
  // Absent for a closed room: the host lists it without its name, because this list
  // is readable without a credential. Such a room still needs its join code.
  readonly name?: string
  readonly host: string
  readonly url: string
  // Joined without a code.
  readonly open: boolean
}

export type FoundMesh = {
  readonly clusterID: string
  readonly status: "forming" | "active"
  readonly name: string
  // Mesh enrollment is accepted only by the owner, so expose its address to the LAN scan.
  readonly ownerURL: string
  readonly memberCount: number
}

// An opencode server that answered, with ordinary Host rooms and optional Mesh membership.
export type FoundServer = {
  readonly url: string
  readonly host: string
  // This computer's own server, which answers the scan like any other.
  readonly own: boolean
  readonly rooms: readonly FoundRoom[]
  readonly mesh?: FoundMesh
}

// UDP ports a firewall must open for discovery: hosts listen on the first, guests on the second.
export const DISCOVERY_PORTS = [PORT, REPLY_PORT] as const

const LISTEN_MS = 1200
const LIST_TIMEOUT_MS = 2000

// Rooms shared by other computers on the local network. Broadcasts reach the
// same Wi-Fi or LAN only; rooms over a VPN such as Radmin are joined by address.
export async function scanRooms(): Promise<FoundServer[]> {
  const servers = await findServers()
  const found = await Promise.all(servers.map((server) => readServer(server.url, server.own).catch(() => undefined)))
  return found.filter((server) => server !== undefined)
}

// One host and the rooms it shares, for an address typed by hand when broadcasts do not get through.
export async function readServer(url: string, own = false): Promise<FoundServer> {
  const list = await OpenCode.make({ baseUrl: url }).room.public({ signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
  return {
    url,
    host: list.host,
    own,
    rooms: list.rooms.map((room) => ({ id: room.id, name: room.name, host: list.host, url, open: room.open })),
    mesh: list.mesh?.ownerURL ? list.mesh : undefined,
  }
}

function findServers() {
  const own = new Set(addresses().map((item) => item.address))
  return new Promise<{ url: string; own: boolean }[]>((resolve) => {
    // URL to whether it is this computer's server.
    const found = new Map<string, boolean>()
    const socket = createSocket({ type: "udp4", reuseAddr: true })
    const finish = () => {
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.close()
      resolve([...found].map(([url, own]) => ({ url, own })))
    }
    const timer = setTimeout(finish, LISTEN_MS)
    socket.on("message", (message, peer) => {
      const reply = decodeReply(message.toString())
      if (!reply) return
      // This computer answers once per adapter; one loopback entry stands for all of them.
      if (own.has(peer.address)) return found.set(`http://127.0.0.1:${reply.port}`, true)
      found.set(`http://${peer.address}:${reply.port}`, false)
    })
    // A socket error ends the scan early with whatever answered so far.
    socket.once("error", finish)
    socket.bind(REPLY_PORT, () => {
      socket.setBroadcast(true)
      // Every subnet separately: Windows sends 255.255.255.255 out of one adapter only,
      // often a VPN or virtual switch rather than the LAN.
      for (const target of new Set(["255.255.255.255", ...addresses().map((item) => item.broadcast)]))
        socket.send(QUERY, PORT, target, () => {})
    })
  })
}

// IPv4 addresses of this machine with the broadcast address of their subnet.
function addresses() {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => {
      const address = item.address.split(".").map(Number)
      const mask = item.netmask.split(".").map(Number)
      return {
        address: item.address,
        broadcast: address.map((part, index) => (part | (~mask[index] & 255)) & 255).join("."),
      }
    })
}
