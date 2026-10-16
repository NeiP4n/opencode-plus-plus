export * as BrowserComposite from "./composite.js"

import { Schema } from "effect"
import { optional } from "@opencode/schema/schema"
import { Browser } from "./rpc.js"

// Higher-level tools built from ordinary browser operations: reading a page as text and a web
// search that returns structured results instead of a page to scrape.

export const Engine = Schema.Literals(["google", "duckduckgo", "bing"])
export type Engine = typeof Engine.Type

const short = Schema.String.check(Schema.isMaxLength(2_048))

export const readDescription =
  "Read this tab's main content as plain text: the <main>/<article> region when the page has one, otherwise the body. Long pages come in chunks; continue with the returned offset. Use browser.snapshot instead when you need element refs to act on."

export const ReadInput = Schema.Struct({
  tabID: Browser.TabID,
  frameID: optional(short).annotate({ description: "Frame ID from browser.frames. Omit for the main frame." }),
  offset: optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "Character offset to continue from. Default 0.",
  }),
  maxChars: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50_000 }))).annotate({
    description: "Maximum characters to return, 1–50000. Default 20000.",
  }),
})

export const ReadOutput = Schema.Struct({
  tab: Browser.Tab,
  title: Schema.String,
  url: Schema.String,
  text: Schema.String,
  offset: Schema.Int,
  total: Schema.Int,
  truncated: Schema.Boolean,
})

export const PageText = Schema.Struct({ title: Schema.String, url: Schema.String, text: Schema.String })

export const readScript = `(() => {
  const root = document.querySelector('main, article, [role="main"]') ?? document.body
  const text = (root?.innerText ?? "").replace(/[ \\t]+\\n/g, "\\n").replace(/\\n{3,}/g, "\\n\\n").trim()
  return { title: document.title, url: location.href, text }
})()`

export const searchDescription =
  "Search the web in the browser and return results as {title, url, snippet}. Uses Google by default and falls back to DuckDuckGo when Google shows no results or a captcha. Opens a background tab unless tabID is given; open a result with browser.navigate({tabID, url}) and read it with browser.read."

export const SearchInput = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  engine: optional(Engine).annotate({ description: "google (default), duckduckgo, or bing. Setting it disables the fallback." }),
  tabID: optional(Browser.TabID).annotate({ description: "Reuse this tab instead of opening a background one." }),
  limit: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))).annotate({
    description: "Maximum results, 1–20. Default 10.",
  }),
})

export const Result = Schema.Struct({ title: Schema.String, url: Schema.String, snippet: Schema.String })

export const SearchOutput = Schema.Struct({
  tab: Browser.Tab,
  engine: Engine,
  url: Schema.String,
  results: Schema.Array(Result),
  notice: optional(Schema.String),
})

export const Found = Schema.Struct({ results: Schema.Array(Result), blocked: Schema.Boolean })

export function searchURL(engine: Engine, query: string) {
  const q = encodeURIComponent(query)
  if (engine === "duckduckgo") return `https://html.duckduckgo.com/html/?q=${q}`
  if (engine === "bing") return `https://www.bing.com/search?q=${q}`
  return `https://www.google.com/search?q=${q}`
}

// Each script runs in the results page and returns {results, blocked}. Selectors follow each
// engine's current markup; an unrecognized page yields no results rather than wrong ones.
export function resultsScript(engine: Engine) {
  const collect = {
    google: `Array.from(document.querySelectorAll("a h3")).map((heading) => {
      const link = heading.closest("a")
      const block = link?.closest("[data-hveid], .g, .MjjYud")
      const snippet = block?.querySelector("[data-sncf], .VwiC3b, [style*='-webkit-line-clamp']")?.innerText ?? ""
      return { title: heading.innerText, url: link?.href ?? "", snippet }
    })`,
    duckduckgo: `Array.from(document.querySelectorAll(".result:not(.result--ad)")).map((block) => {
      const link = block.querySelector("a.result__a")
      const raw = link?.getAttribute("href") ?? ""
      const target = raw.includes("uddg=") ? new URL(raw, location.href).searchParams.get("uddg") ?? raw : raw
      return { title: link?.innerText ?? "", url: new URL(target, location.href).href, snippet: block.querySelector(".result__snippet")?.innerText ?? "" }
    })`,
    bing: `Array.from(document.querySelectorAll("li.b_algo")).map((block) => {
      const link = block.querySelector("h2 a")
      // Bing wraps results in /ck/a redirects whose u parameter is "a1" plus the base64url target.
      const wrapped = link ? new URL(link.href).searchParams.get("u") ?? "" : ""
      const decoded = wrapped.startsWith("a1") ? atob(wrapped.slice(2).replace(/-/g, "+").replace(/_/g, "/")) : ""
      return { title: link?.innerText ?? "", url: /^https?:/.test(decoded) ? decoded : (link?.href ?? ""), snippet: block.querySelector(".b_caption p, .b_lineclamp2")?.innerText ?? "" }
    })`,
  }[engine]
  return `(() => {
  const seen = new Set()
  const results = ${collect}
    .map((item) => ({ title: item.title.trim(), url: item.url, snippet: item.snippet.replace(/\\s+/g, " ").trim().slice(0, 400) }))
    .filter((item) => item.title && /^https?:/.test(item.url) && !/^https?:\\/\\/(www\\.)?(google|bing|duckduckgo)\\.[a-z.]+\\/(search|sorry|aclk|y\\.js)/.test(item.url))
    .filter((item) => !seen.has(item.url) && seen.add(item.url))
  const blocked = /\\/sorry\\//.test(location.pathname) || !!document.querySelector("#captcha-form, form[action*='consent'], .anomaly-modal__modal")
  return { results, blocked }
})()`
}
