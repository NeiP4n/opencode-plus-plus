import { errorMessage } from "./error"

// Right after the server starts, its model catalog is still loading and every model reads as unavailable.
const WARMUP_ATTEMPTS = 5
const WARMUP_DELAY = 3_000

const unavailable = (cause: unknown) => errorMessage(cause).startsWith("Model unavailable")

/** Runs a one-shot model request, waiting out the catalog warm-up after a server start instead of failing. */
export async function withModelWarmup<T>(request: () => Promise<T>, attempt = 1): Promise<T> {
  return request().catch(async (cause: unknown) => {
    if (!unavailable(cause) || attempt >= WARMUP_ATTEMPTS) throw cause
    await Bun.sleep(WARMUP_DELAY)
    return withModelWarmup(request, attempt + 1)
  })
}

/** A short, translated reason a one-shot model request failed, without the provider's raw payload. */
export function modelErrorText(cause: unknown, t: (text: string, values?: Record<string, string>) => string) {
  const message = errorMessage(cause)
  if (/usage.?limit|quota|rate.?limit|too many requests/i.test(message))
    return t("The chosen model has run out of its usage limit. Pick another model in the prompt and refresh.")
  if (unavailable(cause)) return t("The chosen model is not available yet. Refresh in a few seconds.")
  if (/free tier/i.test(message)) return t("The free model rejected the request. Pick another model and refresh.")
  return t("The model could not answer: {error}", {
    error: message.length > 160 ? `${message.slice(0, 160)}…` : message,
  })
}
