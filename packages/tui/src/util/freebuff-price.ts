// Freebuff prices, as the account's own price table reports them.
//
// The catalog and the price table speak two different names: the catalog lists
// marketing names ("DeepSeek V4.1 Flash 10/17"), the price table is keyed by the
// gateway model id ("deepseek/deepseek-v4-flash"). The core plugin resolves the two
// through the catalog's own digest link, so a price that reaches the TUI already
// belongs to exactly one catalog row. Nothing here guesses a price: a row the price
// table does not cover stays unknown.
export const FREEBUFF_PROVIDER_ID = "freebuff"

export type Translate = (text: string, values?: Record<string, string | number>) => string

export type FreebuffPricing = {
  /** Freebucks a session costs, per catalog row key. */
  readonly prices: Readonly<Record<string, number>>
  /** Freebucks left on the daily balance. */
  readonly balance?: number
}

export type FreebuffModel = {
  readonly providerID: string
  /** Catalog row key; the id the model picker shows. */
  readonly id: string
  /** False when the account cannot run the model at all (paid plan). */
  readonly enabled: boolean
}

export type FreebuffPriceVerdict =
  | { readonly kind: "not-freebuff" }
  | { readonly kind: "locked" }
  | { readonly kind: "unknown"; readonly balance?: number }
  | { readonly kind: "priced"; readonly price: number; readonly balance?: number }
  | {
      readonly kind: "short"
      readonly price: number
      readonly balance: number
    }

/**
 * What a session on this model costs and whether the balance covers it.
 *
 * The model stays listed either way: the balance grows during the day, so a row that
 * is out of reach now may be reachable after the next reset. Marking it is the
 * caller's job; hiding it would hide the price too.
 */
export function freebuffPriceVerdict(model: FreebuffModel, pricing: FreebuffPricing | undefined): FreebuffPriceVerdict {
  if (model.providerID !== FREEBUFF_PROVIDER_ID) return { kind: "not-freebuff" }
  if (!model.enabled) return { kind: "locked" }
  const price = pricing?.prices[model.id]
  const balance = pricing?.balance
  // "Open" means no paid plan is needed, not that the session is free: the
  // price table still charges freebucks for models like GLM or DeepSeek. A row
  // the table omits stays unknown instead of guessing zero.
  if (price === undefined) return balance === undefined ? { kind: "unknown" } : { kind: "unknown", balance }
  // The balance grows during the day, so a model out of reach now may be reachable
  // after the next reset: it stays listed and is marked, never hidden.
  if (balance !== undefined && price > balance) return { kind: "short", price, balance }
  return balance === undefined ? { kind: "priced", price } : { kind: "priced", price, balance }
}

/**
 * The picker footer for a Freebuff row: the price in freebucks, the balance left, and
 * a note when the price is out of reach. An "open" row still pays its listed price;
 * a row the price table omits shows as unknown.
 */
export function freebuffFooter(model: FreebuffModel, pricing: FreebuffPricing | undefined, t: Translate): string | undefined {
  const verdict = freebuffPriceVerdict(model, pricing)
  if (verdict.kind === "not-freebuff") return undefined
  if (verdict.kind === "locked") return "Locked"
  if (verdict.kind === "unknown")
    return verdict.balance === undefined
      ? t("Price unknown")
      : t("Price unknown · {balance} left", { balance: verdict.balance })
  if (verdict.kind === "short")
    return t("{price} freebucks · not enough ({balance} left)", {
      price: verdict.price,
      balance: verdict.balance,
    })
  if (verdict.balance === undefined) return t("{price} freebucks", { price: verdict.price })
  return t("{price} freebucks · {balance} left", { price: verdict.price, balance: verdict.balance })
}