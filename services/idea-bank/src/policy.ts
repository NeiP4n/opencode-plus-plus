export function clean(value: unknown, max: number) {
  if (typeof value !== "string") return ""
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max)
    .trim()
}

const sensitivePatterns = [
  /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/u,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/iu,
  /\b(?:password|passwd|secret|(?:api[_ -]?)?key|(?:access[_ -]?)?token|authorization|bearer)\s*[:=]/iu,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u,
  /https?:\/\/\S+/iu,
  /(?:[A-Z]:\\Users\\|\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/)/iu,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
]

export function hasSensitiveContent(value: string) {
  return sensitivePatterns.some((pattern) => pattern.test(value))
}

export function validLanguage(value: string) {
  return /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value)
}
