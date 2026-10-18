export function pluginDirective<T>(plugins: readonly T[] | undefined, target: string, enabled: boolean): (T | string)[] {
  const disabled = `-${target}`
  const current = [...(plugins ?? [])]
  if (!enabled) {
    const preserved = current.filter((entry) => entry !== target && entry !== disabled)
    return [...preserved, disabled]
  }

  // Keep object declarations (including their options), and move the final
  // declaration after wildcard rules so it can override a later exclusion.
  const declaration = current.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "package" in entry &&
      (entry as { package?: unknown }).package === target,
  )
  const next = current.filter((entry) => entry !== target && entry !== disabled && entry !== declaration)
  return [...next, declaration ?? target]
}
