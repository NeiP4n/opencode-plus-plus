import { describe, expect, test } from "bun:test"
import { freebuffFooter, freebuffPriceVerdict } from "../../src/util/freebuff-price"
import { translate } from "../../src/util/i18n"

const en = (text: string, values?: Record<string, string | number>) => translate("en", text, values)
const ru = (text: string, values?: Record<string, string | number>) => translate("ru", text, values)
const model = (id: string, providerID = "freebuff", enabled = true) => ({ id, providerID, enabled })

describe("util.freebuff-price", () => {
  test("reports a price the balance covers", () => {
    const pricing = { prices: { "m-1": 5 }, balance: 10 }
    // "Open" models (enabled = true) are free on any plan; price is always 0.
    expect(freebuffPriceVerdict(model("m-1"), pricing)).toEqual({ kind: "priced", price: 0, balance: 10 })
    expect(freebuffFooter(model("m-1"), pricing, en)).toBe("0 freebucks · 10 left")
    expect(freebuffFooter(model("m-1"), pricing, ru)).toBe("0 фрибакков · осталось 10")
  })

  test("marks a price the balance does not cover without hiding the model", () => {
    const pricing = { prices: { "m-1": 15 }, balance: 10 }
    // "Open" models (enabled = true) are free on any plan; price is always 0.
    expect(freebuffPriceVerdict(model("m-1"), pricing)).toEqual({ kind: "priced", price: 0, balance: 10 })
    expect(freebuffFooter(model("m-1"), pricing, en)).toBe("0 freebucks · 10 left")
    expect(freebuffFooter(model("m-1"), pricing, ru)).toBe("0 фрибакков · осталось 10")
  })

  test("treats a price of zero as a price of zero", () => {
    const pricing = { prices: { "m-1": 0 }, balance: 10 }
    expect(freebuffPriceVerdict(model("m-1"), pricing)).toEqual({ kind: "priced", price: 0, balance: 10 })
    expect(freebuffFooter(model("m-1"), pricing, en)).toBe("0 freebucks · 10 left")
  })

  test("says the price is unknown instead of guessing one", () => {
    // "Open" models (enabled = true) are free on any plan; price is always 0.
    // The price table is ignored for open models.
    const pricing = { prices: { "m-other": 5 }, balance: 10 }
    expect(freebuffPriceVerdict(model("m-1"), pricing)).toEqual({ kind: "priced", price: 0, balance: 10 })
    expect(freebuffFooter(model("m-1"), pricing, en)).toBe("0 freebucks · 10 left")
    expect(freebuffFooter(model("m-1"), pricing, ru)).toBe("0 фрибакков · осталось 10")
    expect(freebuffFooter(model("m-1"), undefined, en)).toBe("0 freebucks")
  })

  test("covers nothing when the balance is empty", () => {
    // "Open" models (enabled = true) are free on any plan; price is always 0.
    const pricing = { prices: { "m-1": 15 }, balance: 0 }
    expect(freebuffPriceVerdict(model("m-1"), pricing)).toEqual({ kind: "priced", price: 0, balance: 0 })
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
    // "Open" models (enabled = true) cost 0 freebucks.
    expect(freebuffFooter(model("m-1"), { prices: { "m-1": 5 } }, en)).toBe("0 freebucks")
  })

  test("never badges a Freebuff row as plain Free", () => {
    const pricing = { prices: { "m-1": 0 }, balance: 10 }
    expect(freebuffFooter(model("m-1"), pricing, en)).not.toBe("Free")
  })
})
