import { useOptionalConfig } from "../config"
import { useT } from "./i18n"

// Labels used by the project-group dialog that are not part of the shared
// upstream locale table yet. Keep them here temporarily, but only activate
// them for Russian so the English locale is never accidentally changed.
const ru: Record<string, string> = {
  Edit: "Изменить",
  Delete: "Удалить",
  "Delete?": "Удалить?",
  "Creating...": "Создаётся...",
  "Coordinator": "Координатор",
  "Members": "Участники",
  "Projects": "Проекты",
  "Linked": "Связано",
  "Not linked": "Не связано",
  "To use the council, open Society above and type your task or question in that chat. It will ask every project Orchestrator for a proposal and collect the answers here. Changing the mode alone does not send tasks.": "Чтобы воспользоваться советом, нажми «Общество · Открыть» выше и напиши задачу или вопрос в этом чате. Он запросит предложение у оркестратора каждого проекта и соберёт ответы здесь. Одна только смена режима не отправляет задачи.",
  "President is a chat bound to this group. Ask it for the group status or a recommendation; it will not dispatch tasks to project sessions on its own.": "Президент — это чат, привязанный к группе. Попроси его показать состояние группы или дать рекомендацию; сам он не будет отправлять задачи в сессии проектов.",
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
