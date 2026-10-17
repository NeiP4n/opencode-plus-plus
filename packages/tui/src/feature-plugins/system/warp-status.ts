export type WarpConnectionState = "checking" | "connected" | "disconnected" | "unknown" | "unavailable"

export type WarpStatus = {
  state: WarpConnectionState
  details: string
}

export function parseWarpStatus(output: string): WarpStatus {
  const details = output.trim().slice(0, 2_500)
  const normalized = details.toLowerCase()

  if (!details) return { state: "unknown", details: "WARP returned an empty status." }

  if (/\b(disconnected|not\s+connected|offline)\b/.test(normalized)) {
    return { state: "disconnected", details }
  }

  if (/\bconnected\b/.test(normalized)) {
    return { state: "connected", details }
  }

  return { state: "unknown", details }
}

export function warpCliUnavailable(message: string): WarpStatus {
  return {
    state: "unavailable",
    details: message.trim().slice(0, 2_500) || "Cloudflare WARP CLI was not found.",
  }
}

export function warpStatusError(message: string): WarpStatus {
  return {
    state: "unknown",
    details: message.trim().slice(0, 2_500) || "Could not read WARP status.",
  }
}
