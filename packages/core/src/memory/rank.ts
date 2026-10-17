export * as MemoryRank from "./rank.js"

/**
 * Offline lexical ranking for memory search: BM25 over stemmed terms, plus a phrase bonus,
 * tag matches and a gentle recency decay. No embedding model is involved, so search works
 * the same on every provider, costs nothing and never leaves the machine.
 */

export interface Document {
  readonly text: string
  readonly tags?: ReadonlyArray<string>
  /** Epoch ms of the last write. */
  readonly updated: number
}

const K1 = 1.2
const B = 0.75
/** Score halves roughly every half year without being rewritten. */
const HALF_LIFE = 180 * 24 * 60 * 60 * 1000

export function rank<A extends Document>(query: string, documents: ReadonlyArray<A>, now = Date.now()) {
  const terms = [...new Set(tokens(query))]
  if (terms.length === 0) return []
  const indexed = documents.map((document) => ({
    document,
    terms: tokens([document.text, ...(document.tags ?? [])].join(" ")),
  }))
  const average = indexed.reduce((sum, entry) => sum + entry.terms.length, 0) / Math.max(1, indexed.length)
  const frequency = new Map(
    terms.map((term) => [term, indexed.filter((entry) => entry.terms.includes(term)).length] as const),
  )
  const phrase = normalize(query)
  return indexed
    .map((entry) => {
      const counts = entry.terms.reduce(
        (result, term) => result.set(term, (result.get(term) ?? 0) + 1),
        new Map<string, number>(),
      )
      const lexical = terms.reduce((sum, term) => {
        const count = counts.get(term) ?? 0
        if (count === 0) return sum
        const documents = frequency.get(term) ?? 0
        const idf = Math.log(1 + (indexed.length - documents + 0.5) / (documents + 0.5))
        return sum + (idf * count * (K1 + 1)) / (count + K1 * (1 - B + (B * entry.terms.length) / Math.max(1, average)))
      }, 0)
      if (lexical === 0) return { document: entry.document, score: 0 }
      const matched = terms.filter((term) => counts.has(term)).length / terms.length
      const tagged = (entry.document.tags ?? []).some((tag) => terms.includes(stem(tag.toLowerCase()))) ? 0.5 : 0
      const exact = phrase.length > 3 && normalize(entry.document.text).includes(phrase) ? 1 : 0
      const age = Math.max(0, now - entry.document.updated)
      const fresh = 0.6 + 0.4 * Math.pow(0.5, age / HALF_LIFE)
      return { document: entry.document, score: (lexical * (0.5 + matched) + tagged + exact) * fresh }
    })
    .filter((entry) => entry.score > 0)
    .toSorted((a, b) => b.score - a.score)
}

/** Token overlap of two texts, 0 to 1; used to fold a near-duplicate fact into the one already stored. */
export function similarity(left: string, right: string) {
  const a = new Set(tokens(left))
  const b = new Set(tokens(right))
  if (a.size === 0 || b.size === 0) return 0
  const shared = [...a].filter((term) => b.has(term)).length
  return shared / (a.size + b.size - shared)
}

export function tokens(text: string) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map(stem)
}

/**
 * A crude suffix stripper good enough for Russian and English inflection: "сессии",
 * "сессия", "сессию" and "sessions", "session" meet on the same stem. Precision is
 * recovered by BM25 and the phrase bonus, so over-stemming is cheap.
 */
function stem(word: string) {
  if (/^\d+$/.test(word)) return word
  const russian = /[а-яё]/.test(word)
  const found = (russian ? RU : EN).find((ending) => word.length - ending.length >= 3 && word.endsWith(ending))
  const base = found ? word.slice(0, -found.length) : word
  if (!russian) return base
  // "сессия" -> "сесс" but "сессии" -> "сесси": a vowel left behind by the shorter ending goes too.
  const trimmed = base.replace(/[аеёиоуыэюяйь]+$/, "")
  return trimmed.length >= 3 ? trimmed : base
}

function normalize(text: string) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ")
}

// Longest first, so "ями" wins over "и".
const RU = [
  "иями",
  "ться",
  "ями",
  "ами",
  "ией",
  "ием",
  "иях",
  "ого",
  "его",
  "ому",
  "ему",
  "ыми",
  "ими",
  "тся",
  "ешь",
  "ает",
  "яет",
  "ует",
  "ал",
  "ил",
  "ия",
  "ие",
  "ий",
  "ию",
  "ой",
  "ей",
  "ый",
  "ая",
  "яя",
  "ое",
  "ее",
  "ые",
  "ов",
  "ев",
  "ах",
  "ях",
  "ам",
  "ям",
  "ом",
  "ем",
  "ть",
  "а",
  "я",
  "о",
  "е",
  "ы",
  "и",
  "у",
  "ю",
  "ь",
]
// Longest first, like RU.
const EN = ["ations", "ation", "ments", "ment", "ings", "ing", "ies", "ied", "ers", "er", "ed", "es", "ly", "s"]

const STOP = new Set([
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "be",
  "it",
  "this",
  "that",
  "with",
  "as",
  "at",
  "by",
  "an",
  "и",
  "в",
  "во",
  "на",
  "не",
  "что",
  "как",
  "это",
  "по",
  "из",
  "за",
  "от",
  "до",
  "для",
  "же",
  "ли",
  "бы",
  "но",
  "а",
  "или",
  "то",
  "так",
  "уже",
])
