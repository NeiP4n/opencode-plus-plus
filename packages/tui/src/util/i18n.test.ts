import { describe, expect, test } from "bun:test"
import { translate } from "./i18n"

describe("TUI i18n", () => {
  test("keeps English UI text unchanged", () => {
    expect(translate("en", "Mesh status")).toBe("Mesh status")
    expect(translate("en", "Create Mesh")).toBe("Create Mesh")
    expect(translate("en", "Orchestrator council")).toBe("Orchestrator council")
  })

  test("translates LAN Rooms and Mesh UI to Russian", () => {
    expect(translate("ru", "Mesh status")).toBe("Состояние Mesh")
    expect(translate("ru", "Create Mesh")).toBe("Создать Mesh")
    expect(translate("ru", "Join Mesh")).toBe("Войти в Mesh")
    expect(translate("ru", "Leave Mesh")).toBe("Выйти из Mesh")
    expect(translate("ru", "Quorum healthy — shared writes are available")).toBe(
      "Кворум в норме — общие записи доступны",
    )
  })

  test("translates federation and project-group UI", () => {
    expect(translate("ru", "Single coordinator")).toBe("Один координатор")
    expect(translate("ru", "Orchestrator council")).toBe("Совет оркестраторов")
    expect(translate("ru", "Project groups")).toBe("Группы проектов")
    expect(translate("ru", "Start council")).toBe("Запустить совет")
  })

  test("preserves interpolation placeholders", () => {
    expect(translate("ru", "Servers found: {count}", { count: 3 })).toBe("Найдено серверов: 3")
    expect(translate("ru", "Quorum requires {count} of {total} devices", { count: 2, total: 3 })).toBe(
      "Для кворума нужно 2 из 3 устройств",
    )
    expect(translate("ru", "Coordinator: {leader}", { leader: "node-1" })).toBe("Координатор: node-1")
  })

  test("falls back safely for untranslated strings", () => {
    const source = "A newly added English label"
    expect(translate("ru", source)).toBe(source)
    expect(translate(undefined, source)).toBe(source)
  })
})
