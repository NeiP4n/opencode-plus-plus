import { useOptionalConfig } from "../config"
import { useT } from "./i18n"

// Labels used by the project-group dialog that are not part of the shared
// upstream locale table yet. Keep them here temporarily, but only activate
// them for Russian so the English locale is never accidentally changed.
const ru: Record<string, string> = {
  Edit: "Изменить",
  Delete: "Удалить",
  "Delete?": "Удалить?",
  "Group Orchestrator": "Групповой Оркестратор",
  "Orchestrator Council": "Совет Оркестраторов",
  "Start Group Orchestrator": "Запустить Группового Оркестратора",
  "Open Group Orchestrator": "Открыть Группового Оркестратора",
  "Start Orchestrator Council": "Запустить Совет Оркестраторов",
  "Open Orchestrator Council": "Открыть Совет Оркестраторов",
  "Coordinator": "Координатор",
  "Members": "Участники",
  "Projects": "Проекты",
  "Linked": "Связано",
  "Not linked": "Не связано",
}

export function useGroupT() {
  const base = useT()
  const config = useOptionalConfig()
  return (text: string, values?: Record<string, string | number>) => {
    const translated = base(text, values)
    if (translated !== text) return translated
    if (config?.data.language !== "ru") return text
    const value = ru[text]
    if (!value) return text
    return value.replace(/\{(\w+)\}/g, (match, key: string) => {
      if (!values || !(key in values)) return match
      return String(values[key])
    })
  }
}
