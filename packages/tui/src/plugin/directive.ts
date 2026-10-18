export function pluginDirective<T>(plugins: readonly T[] | undefined, id: string, enabled: boolean): (T | string)[] {
  const disabled = `-${id}`
  return [...(plugins ?? []).filter((entry) => entry !== id && entry !== disabled), enabled ? id : disabled]
}
