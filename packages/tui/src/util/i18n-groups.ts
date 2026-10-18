import { useT } from "./i18n"

const ru: Record<string, string> = {
  Edit: "Изменить",
  Delete: "Удалить",
  "Delete?": "Удалить?",
}

export function useGroupT() {
  const base = useT()
  return (text: string, values?: Record<string, string | number>) => {
    const translated = base(text, values)
    if (translated !== text) return translated
    // The group dialog has a few generic action labels that are not part of the
    // upstream locale table yet. Keep the fallback local until the shared table
    // is regenerated, while preserving English exactly.
    return ru[text] ?? text
  }
}
