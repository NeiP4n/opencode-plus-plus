import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { OpenCode, type ConfigCompatibilityReport, type ConfigCompatibilityUpdateInput } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { ServerConnection } from "../../../services/server-connection"

interface ServerInput {
  readonly server: Option.Option<string>
  readonly standalone: boolean
}

export const client = Effect.fn("cli.compat.client")(function* (input: ServerInput) {
  const { endpoint } = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
})

export const change = Effect.fn("cli.compat.change")(function* (
  input: ServerInput & { readonly ecosystem: ConfigCompatibilityUpdateInput["ecosystem"] },
  patch: { readonly enabled?: boolean | null; readonly trusted?: boolean },
  done: string,
) {
  const api = yield* client(input)
  const report = yield* Effect.tryPromise({
    try: (signal) =>
      api.config.compatibility.update(
        { location: { directory: process.cwd() }, ecosystem: input.ecosystem, ...patch },
        { signal },
      ),
    catch: (cause) => cause,
  })
  process.stdout.write(`${done} for ${report.root}` + EOL + EOL)
  process.stdout.write(table(report))
})

export function table(report: ConfigCompatibilityReport) {
  const rows = report.ecosystems.map((item) => {
    const found = item.folders.length + item.markers.length > 0
    const state = item.enabled ? "on" : "off"
    const where = [
      ...item.folders.map((folder) => `${folder.path}${folder.scope === "global" ? " (global)" : ""}`),
      ...item.markers,
    ]
    return [
      item.id,
      found ? "found" : "-",
      `${state} (${item.decidedBy})`,
      item.trusted ? "trusted" : "-",
      where.join(", ") || "-",
    ]
  })
  const header = ["ECOSYSTEM", "FOUND", "STATE", "TRUST", "WHERE"]
  const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => row[index].length)))
  const line = (row: readonly string[]) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index])))
      .join("  ")
      .trimEnd()
  const order = report.order.length ? report.order.join(" > ") : "none"
  const details = report.ecosystems.flatMap((item) => {
    if (!item.loaded) return []
    const counts = Object.entries(item.loaded)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => `${count} ${kind}`)
    return [
      "",
      `${item.id}: ${counts.length ? counts.join(", ") : "nothing loaded"}`,
      ...(item.skipped ?? []).map((skip) => `  skipped ${skip.source}: ${skip.reason}`),
    ]
  })
  return [line(header), ...rows.map(line), "", `Merge priority: ${order}`, ...details].join(EOL) + EOL
}
