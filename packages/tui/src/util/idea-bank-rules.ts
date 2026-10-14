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
  {
    id: "local-privacy",
    title: "Keep a useful workflow private and local",
    category: "Privacy",
    kind: "Local-first tool",
    description: "A workflow that should not send sensitive material to a cloud service may benefit from a local-first implementation.",
    pattern:
      /(?:\b(?:keep.{0,30}(?:local|private)|without uploading|on[- ]device|local[- ]first|don't want.{0,40}(?:cloud|upload))\b|не хочу загружать|локальн.{0,20}(?:решение|инструмент)|без облака|без отправки данных)/iu,
  },
  {
    id: "localization",
    title: "Make software work across languages",
    category: "Localization",
    kind: "Translation or language tool",
    description: "Repeated language barriers may point to better translation, localization, or multilingual interfaces.",
    pattern:
      /(?:\b(?:translate|translation|locali[sz]ation|language barrier|not available in my language)\b|перевод|перевести|локализаци|нет на моём языке|языковой барьер)/iu,
  },
  {
    id: "accessibility",
    title: "Make a workflow easier to use for more people",
    category: "Accessibility",
    kind: "Accessibility tool",
    description: "A recurring accessibility barrier may indicate an opportunity for a more inclusive interface or assistive tool.",
    pattern:
      /(?:\b(?:accessibility|accessible|screen reader|keyboard[- ]only|hard to see|hard to hear|assistive)\b|доступност|экранн(?:ый|ого) диктор|только клавиатур|плохо вижу|плохо слышу|ассистив)/iu,
  },
  {
    id: "monitoring",
    title: "Turn a recurring problem into a useful monitor",
    category: "Monitoring and analytics",
    kind: "Dashboard or alerting tool",
    description: "A problem that is noticed repeatedly may be easier to solve by detecting it earlier and explaining the trend.",
    pattern:
      /(?:\b(?:keep checking|have to monitor|watch this manually|no visibility|need an alert|hard to track|trend)\b|приходится проверять|нужно следить|нет видимости|нужн.{0,20}(?:алерт|уведомлен)|сложно отслеживать|динамик)/iu,
  },
  {
    id: "learning",
    title: "Turn a difficult topic into an interactive learning tool",
    category: "Education",
    kind: "Learning tool",
    description: "A topic that repeatedly feels difficult may benefit from an interactive explanation, practice tool, or simulator.",
    pattern:
      /(?:\b(?:hard to learn|don't understand|need to practice|interactive tutorial|practice tool|simulator)\b|сложно понять|не понимаю|нужно практиковаться|интерактивн.{0,20}(?:обуч|урок)|тренажёр|симулятор)/iu,
  },
  {
    id: "data-work",
    title: "Simplify repeated data preparation or reporting",
    category: "Data and reporting",
    kind: "Data utility",
    description: "Repeated cleaning, formatting, or reporting work may be a good target for a focused data tool.",
    pattern:
      /(?:\b(?:cleaning data|formatting data|prepare reports|reporting takes|merge spreadsheets|csv|data entry)\b|обработк.{0,20}данн|подготовк.{0,20}отч[её]т|сводить таблиц|ввод данных|таблиц.{0,20}вручную)/iu,
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
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
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

export const GLOBAL_SHARE_SUCCESS_COOLDOWN_MS = 24 * 60 * 60 * 1000
export const GLOBAL_SHARE_RETRY_COOLDOWN_MS = 5 * 60 * 1000

export function shouldAttemptGlobalShare(now: number, lastSharedAt: number, lastAttemptAt: number): boolean {
  if (![now, lastSharedAt, lastAttemptAt].every(Number.isFinite)) return false
  return (
    now - lastSharedAt >= GLOBAL_SHARE_SUCCESS_COOLDOWN_MS &&
    now - lastAttemptAt >= GLOBAL_SHARE_RETRY_COOLDOWN_MS
  )
}
