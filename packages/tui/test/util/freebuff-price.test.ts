import { describe, expect, test } from "bun:test"
import { freebuffFooter, freebuffPriceVerdict } from "../../src/util/freebuff-price"
import { translate } from "../../src/util/i18n"

const en = (text: string, values?: Record<string, string | number>) => translate("en", text, values)
const ru = (text: string, values?: Record<string, string | number>) => translate("ru", text, values)
const model = (id: string, providerID = "freebuff", enabled = true) => ({ id, providerID, enabled })

describe("util.freebuff-price", () => {
  test("reports a price the balance covers", () => {
    const pricing = { prices: { "m-1": 5 }, balance: 10 }
    // "Open" means no paid plan is needed; the listed freebucks price still applies.
    expect(freebuffPriceVerdict(model("m-1"), pricing)).toEqual({ kind: "priced", price: 5, balance: 10 })
    expect(freebuffFooter(model("m-1"), pricing, en)).toBe("5 freebucks · 10 left")
    expect(freebuffFooter(model("m-1"), pricing, ru)).toBe("5 фрибакков · осталось 10")
  })

  test("marks a price the balance does not cover without hiding the model", () => {
    const pricing = { prices: { "m-1": 15 }, balance: 10 }
    // "Open" means no paid plan is needed; the listed freebucks price still applies.
    expect(freebuffPriceVerdict(model("m-1"), pricing)).toEqual({ kind: "short", price: 15, balance: 10 })
    expect(freebuffFooter(model("m-1"), pricing, en)).toBe("15 freebucks · not enough (10 left)")
    expect(freebuffFooter(model("m-1"), pricing, ru)).toBe("15 фрибакков · не хватит (осталось 10)")
  })

  test("treats a price of zero as a price of zero", () => {
    const pricing = { prices: { "m-1": 0 }, balance: 10 }
    expect(freebuffPriceVerdict(model("m-1"), pricing)).toEqual({ kind: "priced", price: 0, balance: 10 })
    expect(freebuffFooter(model("m-1"), pricing, en)).toBe("0 freebucks · 10 left")
  })

  test("says the price is unknown instead of guessing one", () => {
    // A row the price table does not cover is unknown, not silently free.
    const pricing = { prices: { "m-other": 5 }, balance: 10 }
    expect(freebuffPriceVerdict(model("m-1"), pricing)).toEqual({ kind: "unknown", balance: 10 })
    expect(freebuffFooter(model("m-1"), pricing, en)).toBe("Price unknown · 10 left")
    expect(freebuffFooter(model("m-1"), pricing, ru)).toBe("Цена неизвестна · осталось 10")
    expect(freebuffFooter(model("m-1"), undefined, en)).toBe("Price unknown")
  })

  test("covers nothing when the balance is empty", () => {
    const pricing = { prices: { "m-1": 15 }, balance: 0 }
    expect(freebuffPriceVerdict(model("m-1"), pricing)).toEqual({ kind: "short", price: 15, balance: 0 })
    expect(freebuffPriceVerdict(model("m-2"), { prices: { "m-2": 0 }, balance: 0 })).toEqual({
      kind: "priced",
      price: 0,
      balance: 0,
    })
  })

  test("leaves other providers alone", () => {
    const pricing = { prices: { "m-1": 5 }, balance: 10 }
    expect(freebuffPriceVerdict(model("m-1", "opencode"), pricing)).toEqual({ kind: "not-freebuff" })
    expect(freebuffFooter(model("m-1", "opencode"), pricing, en)).toBeUndefined()
  })

  test("keeps a model the account cannot run marked as locked", () => {
    const pricing = { prices: { "m-1": 100 }, balance: 10 }
    expect(freebuffPriceVerdict(model("m-1", "freebuff", false), pricing)).toEqual({ kind: "locked" })
    expect(freebuffFooter(model("m-1", "freebuff", false), pricing, en)).toBe("Locked")
  })

  test("shows the price alone when the balance is unknown", () => {
    expect(freebuffFooter(model("m-1"), { prices: { "m-1": 5 } }, en)).toBe("5 freebucks")
  })

  test("never badges a Freebuff row as plain Free", () => {
    const pricing = { prices: { "m-1": 0 }, balance: 10 }
    expect(freebuffFooter(model("m-1"), pricing, en)).not.toBe("Free")
  })
})
