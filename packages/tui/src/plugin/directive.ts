function targetOf(entry: unknown) {
  if (typeof entry === "string") return entry.startsWith("-") ? entry.slice(1) : entry
  if (typeof entry !== "object" || entry === null || !("package" in entry)) return undefined
  const target = (entry as { package?: unknown }).package
  return typeof target === "string" ? target : undefined
}

export function pluginDirective<T>(plugins: readonly T[] | undefined, target: string, enabled: boolean): (T | string)[] {
  const disabled = `-${target}`
  const current = [...(plugins ?? [])]
  if (!enabled) {
    const preserved = current.filter((entry) => entry !== target && entry !== disabled)
    return [...preserved, disabled]
  }

  // Keep object declarations (including their options), but append an exact
  // positive selector after wildcard rules so it can override a later exclusion.
  const next = current.filter((entry) => entry !== target && entry !== disabled)
  return [...next, target]
}
