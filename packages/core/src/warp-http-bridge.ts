import { createConnection, createServer, type Socket } from "node:net"

type ParsedTarget = { host: string; port: number; path: string; requestLine: string }

function parseRequest(header: string): ParsedTarget | { connect: true; host: string; port: number } | undefined {
  const lines = header.split("\r\n")
  const first = lines[0] ?? ""
  const connect = /^CONNECT\s+([^\s]+)\s+HTTP\/1\.[01]$/i.exec(first)
  if (connect) {
    let url: URL
    try { url = new URL("http://" + connect[1]) } catch { return }
    const port = Number(url.port || 443)
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) return
    return { connect: true, host: url.hostname, port }
  }
  const request = /^(\S+)\s+(\S+)\s+(HTTP\/1\.[01])$/i.exec(first)
  if (!request) return
  let url: URL
  try { url = new URL(request[2]) } catch { return }
  if (url.protocol !== "http:" || !url.hostname) return
  const port = Number(url.port || 80)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return
  const path = (url.pathname || "/") + url.search
  return { host: url.hostname, port, path, requestLine: request[1] + " " + path + " " + request[3] }
}

function socksAddress(host: string, port: number) {
  const address = Buffer.from(host)
  const addr = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    ? Buffer.from([1, ...host.split(".").map(Number)])
    : Buffer.concat([Buffer.from([3, address.length]), address])
  return Buffer.concat([Buffer.from([5, 1, 0]), addr, Buffer.from([port >> 8, port & 255])])
}

function tunnel(client: Socket, socksPort: number, host: string, port: number, firstPayload?: Buffer, connectMode = false) {
  const upstream = createConnection({ host: "127.0.0.1", port: socksPort })
  let stage: "greeting" | "connect" | "stream" = "greeting"
  const fail = () => {
    if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
    upstream.destroy()
  }
  upstream.on("error", fail)
  upstream.once("connect", () => upstream.write(Buffer.from([5, 1, 0])))
  upstream.on("data", (data) => {
    if (stage === "greeting") {
      if (data.length < 2 || data[0] !== 5 || data[1] !== 0) return fail()
      stage = "connect"
      upstream.write(socksAddress(host, port))
      return
    }
    if (stage === "connect") {
      if (data.length < 2 || data[1] !== 0) return fail()
      stage = "stream"
      if (connectMode) client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (firstPayload?.length) upstream.write(firstPayload)
      upstream.removeAllListeners("data")
      upstream.pipe(client)
      client.pipe(upstream)
    }
  })
  client.once("error", () => upstream.destroy())
  client.once("close", () => upstream.destroy())
}

/** HTTP CONNECT/absolute-URI proxy bound to loopback and backed by WARP's SOCKS5 endpoint. */
export async function startHttpBridge(socksPort: number, httpPort: number): Promise<void> {
  const server = createServer((client) => {
    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > 32 * 1024) {
        client.end("HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n")
        return
      }
      const end = buffer.indexOf("\r\n\r\n")
      if (end < 0) return
      client.removeListener("data", onData)
      const header = buffer.subarray(0, end).toString("latin1")
      const rest = buffer.subarray(end + 4)
      const target = parseRequest(header)
      if (!target) {
        client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
        return
      }
      if ("connect" in target) {
        tunnel(client, socksPort, target.host, target.port, rest, true)
        return
      }
      const lines = header.split("\r\n")
      lines[0] = target.requestLine
      if (!lines.some((line) => /^host:/i.test(line))) lines.push("Host: " + target.host)
      const payload = Buffer.concat([Buffer.from(lines.join("\r\n") + "\r\n\r\n", "latin1"), rest])
      tunnel(client, socksPort, target.host, target.port, payload)
    }
    client.on("data", onData)
    client.on("error", () => client.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(httpPort, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve()
    })
  })
  server.unref()
}
