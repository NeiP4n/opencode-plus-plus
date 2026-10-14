export type IdeaSignalKind = {
  id: string
  title: string
  category: string
  kind: string
  description: string
}

type SignalRule = IdeaSignalKind & { pattern: RegExp }

// These deliberately emit fixed, generic labels. Source text is inspected transiently and
// never returned, normalized into storage, or included in diagnostics.
const SIGNAL_KINDS: SignalRule[] = [
  {
    id: "manual-work",
    title: "Automate repetitive work",
    category: "Automation",
    kind: "Utility or workflow",
    description: "Repeated manual work may point to an opportunity for a small automation.",
    pattern:
      /(?:\b(?:manually|by hand|every time|over and over|repetitive|tedious|keep having to)\b|вручную|каждый раз приходится|постоянно приходится|повторяющ(?:аяся|иеся|ихся)|одно и то же)/iu,
  },
  {
    id: "missing-tool",
    title: "Fill a missing tool or capability",
    category: "Developer tools",
    kind: "Tool or integration",
    description: "A missing capability may be worth exploring before proposing a solution.",
    pattern:
      /(?:\b(?:wish there were|why is there no|missing feature|need a tool|no good tool|would be useful if)\b|не хватает|почему нет|нет нормальн.{0,24}(?:инструмент|программ|способ)|хотелось бы)/iu,
  },
  {
    id: "workflow-friction",
    title: "Simplify a frustrating workflow",
    category: "Productivity",
    kind: "Workflow improvement",
    description: "Repeated friction may indicate that existing tools or steps could be simplified.",
    pattern:
      /(?:\b(?:doesn't work|does not work|tried.{0,60}but|annoying|frustrating|painful workflow)\b|не работает|неудобн|перепробовал|надоело|бесит|слишком сложно)/iu,
  },
  {
    id: "documentation",
    title: "Make instructions easier to find",
    category: "Education and documentation",
    kind: "Knowledge tool",
    description: "Difficulty finding or understanding documentation may be an opportunity to improve access to knowledge.",
    pattern:
      /(?:\b(?:no documentation|can't find.{0,30}docs|documentation is unclear|docs are confusing)\b|нет документац|не могу найти инструкц|документац.{0,30}(?:непонят|плох))/iu,
  },
  {
    id: "integration",
    title: "Connect tools that do not work well together",
    category: "Integrations",
    kind: "Integration",
    description: "Repeated problems moving information between tools may point to a missing integration.",
    pattern:
      /(?:\b(?:can't sync|doesn't sync|no integration|moving data between|integrate.{0,40}with)\b|не синхронизир|переносить данные между|интеграци)/iu,
  },
]

// This is a conservative safety filter, not a guarantee that arbitrary text is anonymous.
// Classification never returns text, only one of the fixed generic signal records below.
const SENSITIVE = [
  /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/u,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/iu,
  /\b(?:password|passwd|secret|(?:api[_ -]?)?key|(?:access[_ -]?)?token|authorization|bearer)\s*[:=]/iu,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u,
  /https?:\/\/\S+/iu,
  /(?:[A-Z]:\\Users\\|\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/)/iu,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
]

export function looksSensitive(text: string): boolean {
  return SENSITIVE.some((pattern) => pattern.test(text))
}

export function classifyIdeaSignal(text: string): IdeaSignalKind | undefined {
  if (text.length < 18 || text.length > 5000 || looksSensitive(text)) return undefined
  const match = SIGNAL_KINDS.find((item) => item.pattern.test(text))
  if (!match) return undefined
  return {
    id: match.id,
    title: match.title,
    category: match.category,
    kind: match.kind,
    description: match.description,
  }
}
