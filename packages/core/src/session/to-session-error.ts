import { AIError, RateLimitError, ToolFailure, type FinishReasonDetails } from "@opencode/ai"
import { Tool } from "@opencode/schema/tool"
import { SessionError } from "@opencode/schema/session-error"
import { Permission } from "../permission.js"
import { Integration } from "../integration.js"
import { AgentNotFoundError, StepFailedError } from "./error.js"
import { ModelResolver } from "../model-resolver.js"
import { SessionRunnerModel } from "./runner/model.js"

const tokenSharingMessages = {
  subscription_sharing_user_not_eligible:
    "ChatGPT token sharing isn't available for this account. Connect with an API key or choose another provider.",
  subscription_sharing_usage_limit_exceeded:
    "ChatGPT usage limit reached. Check ChatGPT Settings → Usage for details.",
  subscription_sharing_usage_unavailable: "ChatGPT usage can't be checked right now. Try again later.",
  subscription_sharing_unsupported_capability:
    "This request uses a feature ChatGPT token sharing doesn't support. Remove the unsupported feature and try again.",
  subscription_sharing_route_not_supported:
    "ChatGPT token sharing doesn't support this API route. Check the configured endpoint and HTTP method.",
  subscription_sharing_invalid_user: "This ChatGPT connection is no longer valid. Reconnect to ChatGPT.",
  subscription_sharing_user_unavailable: "This ChatGPT account is temporarily unavailable. Try again later.",
  chatpass_v2_scope_not_authorized:
    "This ChatGPT connection isn't authorized for this request. Reconnect to ChatGPT or choose another connection.",
  chatpass_v2_invalid_authorization_context:
    "This ChatGPT connection isn't authorized for this request. Reconnect to ChatGPT or choose another connection.",
}

/**
 * The Zen console counts free-tier requests per address and answers its own daily cap with HTTP
 * 429 "FreeUsageLimitError". The provider layer cannot know that another address clears that cap,
 * so it files the answer under the account quota, which ends the turn on the first response. A
 * per-address cap is a throttle the session can wait out or route around, so the failure is
 * reclassified before anyone asks whether to send it again.
 */
export function asRateLimit(cause: AIError): AIError {
  if (cause.reason._tag !== "QuotaExceeded") return cause
  const details = [cause.reason.message, cause.reason.body].filter(Boolean).join("\n")
  if (!/freeusagelimiterror/i.test(details)) return cause
  return new AIError({
    reason: new RateLimitError({
      message: cause.reason.message,
      body: cause.reason.body,
      http: cause.reason.http,
      cause: cause.reason.cause,
    }),
  })
}

export function toSessionError(cause: unknown): SessionError.Error {
  if (cause instanceof AIError) {
    const reason = asRateLimit(cause).reason
    switch (reason._tag) {
      case "RateLimit":
        return providerError("provider.rate-limit", reason)
      case "Authentication":
        return providerError("provider.auth", reason)
      case "QuotaExceeded":
        return providerError("provider.quota", reason)
      case "ContentPolicy":
        return providerError("provider.content-filter", reason)
      case "Transport":
        return providerError("provider.transport", reason)
      case "ProviderInternal":
        return providerError("provider.internal", reason)
      case "InvalidProviderOutput":
        return providerError("provider.invalid-output", reason)
      case "InvalidRequest":
        return providerError("provider.invalid-request", reason)
      case "UnsupportedOperation":
        return providerError("provider.unsupported-operation", reason)
      case "NoRoute":
        return providerError("provider.no-route", reason)
      case "UnknownProvider":
        return providerError("provider.unknown", reason)
      case "Timeout":
        return providerError("provider.timeout", reason)
      default: {
        const exhaustive: never = reason
        return exhaustive
      }
    }
  }
  if (cause instanceof Permission.BlockedError) return { type: "permission.rejected", message: cause.message }
  if (cause instanceof Permission.CorrectedError) return { type: "permission.rejected", message: cause.feedback }
  if (cause instanceof ToolFailure || cause instanceof Tool.Error) {
    if (cause.error === undefined) return { type: "tool.execution", message: cause.message }
    const unwrapped = toSessionError(cause.error)
    return unwrapped.message === "" ? { ...unwrapped, type: "tool.execution", message: cause.message } : unwrapped
  }
  if (cause instanceof StepFailedError) return cause.error
  if (cause instanceof ModelResolver.UnsupportedCompactionError)
    return { type: "provider.unsupported-operation", message: cause.message }
  if (cause instanceof AgentNotFoundError) return { type: "unknown", message: cause.message }
  if (
    cause instanceof SessionRunnerModel.ModelNotSelectedError ||
    cause instanceof SessionRunnerModel.ModelUnavailableError ||
    cause instanceof ModelResolver.VariantUnavailableError ||
    cause instanceof ModelResolver.UnsupportedPackageError ||
    cause instanceof ModelResolver.ModelConfigurationError ||
    cause instanceof ModelResolver.ModelInitializationError ||
    cause instanceof ModelResolver.UnresolvedProviderVariablesError
  )
    return { type: "provider.no-route", message: cause.message }
  if (cause instanceof Integration.AuthorizationError) return { type: "provider.auth", message: cause.message }
  return { type: "unknown", message: cause instanceof Error ? cause.message : String(cause) }
}

export function contentFilterError(summary: string, reason: FinishReasonDetails): SessionError.Error {
  return {
    type: "provider.content-filter",
    message: [reason.category === undefined ? summary : `${summary} (${reason.category})`, reason.explanation]
      .filter(Boolean)
      .join(": "),
  }
}

const OPENCODE_FREE_TIER_ERROR = "OpenCode's free tier can only be used from within OpenCode"
// The Zen console names its own per-address limiter in the error it answers with.
const FREE_TIER_LIMIT_ERROR = "freeusagelimiterror"

function providerError(type: string, reason: AIError["reason"]): SessionError.Error {
  const status = reason.http?.status
  const raw = [reason.message, reason.body].filter(Boolean).join("\n")
  const tokenSharing = Object.entries(tokenSharingMessages).find(([code]) => reason.body?.includes(code))?.[1]
  const message = raw.includes(OPENCODE_FREE_TIER_ERROR)
    ? "Zen rejected this request. The provider refused the selected model/access. Retrying the identical request will not change that decision. Check the provider connection or select another currently available model."
    : raw.toLowerCase().includes(FREE_TIER_LIMIT_ERROR)
      ? "Zen's free tier counts requests per IP address, and this address has used its daily allowance. Another address (Auto IP) has an allowance of its own, and the daily reset frees this one."
      : (tokenSharing ?? reason.message)
  return {
    type,
    message,
    ...(status === undefined ? {} : { status }),
    ...(reason.body === undefined ? {} : { response: { body: reason.body } }),
  }
}
