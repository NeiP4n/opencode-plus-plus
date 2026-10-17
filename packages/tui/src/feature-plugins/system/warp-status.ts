import * as Warp from "@opencode/core/warp"

export type WarpConnectionState = Warp.State | "checking"
export type WarpStatus = { state: WarpConnectionState; details: string }

export const parseWarpStatus = Warp.parseStatus
export const warpCliUnavailable = Warp.unavailableStatus
export const warpStatusError = Warp.errorStatus
