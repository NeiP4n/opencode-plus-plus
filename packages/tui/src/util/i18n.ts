import { useOptionalConfig } from "../config"
import { translate as baseTranslate } from "./i18n-base"

export type Language = "en" | "ru"

// LAN Rooms and federation were added after the original locale table. Keep these
// additions isolated so the upstream translation table can be replaced independently.
const ruExtra: Record<string, string> = {
  // Mesh
  Mesh: "Mesh",
  "Mesh room": "Комната Mesh",
  "All devices are equal peers. The coordinator is elected automatically; shared writes need a majority.": "Все устройства — равноправные узлы. Координатор выбирается автоматически; для общих записей нужно большинство.",
  "Addresses advertised by this server: {addresses}": "Адреса этого сервера: {addresses}",
  "Could not discover this device's addresses. Enter a reachable LAN or VPN address manually.": "Не удалось определить адреса этого устройства. Введи доступный адрес LAN или VPN вручную.",
  "Create the Mesh on this device": "Создать Mesh на этом устройстве",
  "This device's address": "Адрес этого устройства",
  "e.g. http://192.168.1.12:4096": "напр. http://192.168.1.12:4096",
  "Device name": "Имя устройства",
  "Default: {name}": "По умолчанию: {name}",
  "Create Mesh": "Создать Mesh",
  "Join a Mesh created on another device": "Подключиться к Mesh, созданному на другом устройстве",
  "Seed device address": "Адрес исходного устройства",
  "Invitation token": "Токен приглашения",
  "Paste the token shown by the creator": "Вставь токен, который показал создатель",
  "Join Mesh": "Войти в Mesh",
  "Mesh status": "Состояние Mesh",
  "Room: {id}": "Комната: {id}",
  "Quorum healthy — shared writes are available": "Кворум в норме — общие записи доступны",
  "Coordinator elected, but quorum is missing — read-only": "Координатор выбран, но кворума нет — только чтение",
  "Connected to coordinator: {leader}": "Подключено к координатору: {leader}",
  "Replica mode — waiting for a healthy coordinator": "Режим реплики — ожидание рабочего координатора",
  "Coordinator: {leader}": "Координатор: {leader}",
  electing: "выбирается",
  "Commit: {index}": "Коммит: {index}",
  "Quorum requires {count} of {total} devices": "Для кворума нужно {count} из {total} устройств",
  "Click again to leave Mesh": "Нажми ещё раз, чтобы выйти из Mesh",
  "Leave Mesh": "Выйти из Mesh",
  "This device is connected as a worker. It receives the shared room log and can send shared messages through the coordinator, but it does not vote or increase the quorum. Remote AI dispatch from this panel is not available yet.": "Это устройство подключено как worker. Оно получает общий журнал комнаты и может отправлять сообщения через координатора, но не голосует и не увеличивает кворум. Удалённый запуск ИИ из этой панели пока недоступен.",
  "Leaving clears this device's Mesh state. Other devices keep their current membership, so leaving an active worker does not change the voter quorum.": "Выход очищает состояние Mesh на этом устройстве. Остальные устройства сохраняют членство, поэтому выход активного worker не меняет кворум голосующих.",
  Devices: "Устройства",
  Voter: "Голосующий",
  Worker: "Worker",
  "Invite devices before activation": "Пригласи устройства до активации",
  "Invitation token — share only with your own devices:": "Токен приглашения — передавай только своим устройствам:",
  "Connect at least one other device first. Devices invited after activation can join as non-voting workers.": "Сначала подключи хотя бы одно другое устройство. Устройства, приглашённые после активации, смогут войти как workers без права голоса.",
  "Activate Mesh": "Активировать Mesh",
  "Invite another device": "Пригласить другое устройство",
  "Share this token only with trusted devices. New devices join as non-voting workers, so the current quorum stays unchanged.": "Передавай этот токен только доверенным устройствам. Новые устройства входят как workers без права голоса, поэтому текущий кворум не меняется.",
  "Shared messages and tasks": "Общие сообщения и задачи",
  "Type: message": "Тип: сообщение",
  "Type: task": "Тип: задача",
  "Message or task": "Сообщение или задача",
  "Enter a shared message; tasks can be dispatched to peers later": "Введи общее сообщение; задачи позже можно будет отправлять участникам",
  "Write a message or task first.": "Сначала напиши сообщение или задачу.",
  "Enter this device's reachable address, including its port.": "Введи доступный адрес этого устройства, включая порт.",
  "Enter the seed address, invitation token and this device's reachable address.": "Введи адрес исходного устройства, токен приглашения и доступный адрес этого устройства.",
  Send: "Отправить",
  "Select a Mesh room from the network list first.": "Сначала выбери комнату Mesh из списка сети.",
  "Paste the invitation token from the Mesh creator.": "Вставь токен приглашения от создателя Mesh.",
  "The invitation token was rejected by {address} for Mesh {id}. Re-copy the current token from that room's owner and retry.": "Токен приглашения отклонён адресом {address} для Mesh {id}. Скопируй актуальный токен у владельца комнаты и попробуй снова.",
  "Mesh found. Paste its invitation token in the Mesh connection panel below.": "Найден Mesh. Вставь его токен приглашения в панели подключения к Mesh ниже.",
  "Connect to Mesh: {name}": "Подключиться к Mesh: {name}",
  "Found on {host}. Enter the invitation token from the Mesh creator.": "Найдено на {host}. Введи токен приглашения от создателя Mesh.",
  "Mesh rooms found": "Найдены комнаты Mesh",
  devices: "устройств",

  // Host / Connect
  "Enter a host nickname.": "Введи имя хоста.",
  "Access & roles": "Доступ и роли",
  "Safety rules": "Правила безопасности",
  "Privacy, guest actions, command restrictions and protected files.": "Приватность, действия гостей, ограничения команд и защищённые файлы.",
  "Manage joined people, roles, removals and bans.": "Управление участниками, ролями, удалением и банами.",
  "On the other device open Connect and pick this room, or enter the address.": "На другом устройстве открой «Подключиться» и выбери эту комнату или введи адрес.",
  "On the other device open Connect, pick this room or enter the address, then the join code.": "На другом устройстве открой «Подключиться», выбери эту комнату или введи адрес, затем код.",
  "Only virtual adapters (Docker, WSL, VPN) were found; other devices may not reach these addresses.": "Нашлись только виртуальные адаптеры (Docker, WSL, VPN); другие устройства могут не достучаться по этим адресам.",
  "No rooms hosted yet: on that computer open a session and press + Host.": "Комнат пока нет: на том компьютере открой сессию и нажми «+ Хост».",
  "Rooms on this network": "Комнаты в этой сети",
  "No servers found": "Серверов не найдено",
  "Servers found: {count}": "Найдено серверов: {count}",
  "this computer": "этот компьютер",
  "Room, needs a code": "Комната, нужен код",
  "Pick a room above: this host shares several": "Выбери комнату выше: у этого хоста их несколько",
  "No rooms at this address": "По этому адресу комнат нет",
  "This room needs the join code its host shows": "Для этой комнаты нужен код, который показывает хост",

  // Room rules
  "Room rules": "Правила комнаты",
  "Privacy, network and command/file restrictions also constrain the host's AI. Guest-only restrictions apply to every remote role.": "Ограничения приватности, сети, команд и файлов также действуют на ИИ хоста. Ограничения для гостей применяются ко всем удалённым ролям.",
  "Privacy & visibility": "Приватность и видимость",
  "Guests see <project> instead of the folder on your computer.": "Гости видят <project> вместо папки на твоём компьютере.",
  "Execution details": "Детали выполнения",
  "Other guests cannot see raw tool inputs/outputs, shell commands or screenshots. The host alone handles approvals.": "Другие гости не видят исходные входы/выходы инструментов, shell-команды или скриншоты. Разрешения обрабатывает только хост.",
  "Sending out": "Отправка наружу",
  "The room's AI cannot make web requests, control the desktop, or message other computers and projects.": "ИИ комнаты не может делать веб-запросы, управлять рабочим столом или писать на другие компьютеры и в другие проекты.",
  "Guest permissions": "Разрешения гостей",
  "Guest prompts": "Запросы гостей",
  "Whether guests may send messages to the host's AI. This does not stop the host from chatting.": "Могут ли гости отправлять сообщения ИИ хоста. Это не мешает самому хосту общаться с ИИ.",
  "Guest commands": "Команды гостей",
  "Whether guests may execute commands or submit command checks. This restriction applies to every role.": "Могут ли гости выполнять команды или отправлять проверки команд. Ограничение действует для всех ролей.",
  "Command & file restrictions": "Ограничения команд и файлов",
  "Blocked": "Заблокировано",
  "Allowed": "Разрешено",
  "Forbidden": "Запрещено",
  "Hidden": "Скрыто",
  "Visible": "Видимо",

  // People
  "No guests have joined yet.": "Гости пока не заходили.",
  online: "в сети",
  away: "не в сети",
  Kick: "Выгнать",
  "Kick?": "Выгнать?",
  Ban: "Забанить",
  "Ban?": "Забанить?",
  Banned: "Забанены",
  Unban: "Разбанить",

  // Federation / project groups
  "Single coordinator": "Один координатор",
  "Orchestrator council": "Совет оркестраторов",
  "Every project's main Orchestrator gets the task in parallel; their proposals are brought together in one shared Council session.": "Главный Оркестратор каждого проекта получает задачу параллельно; их предложения собираются в одной общей сессии Совета.",
  "One dedicated Group Orchestrator monitors the projects and coordinates their decisions.": "Отдельный Групповой Оркестратор следит за проектами и координирует их решения.",
  council: "совет",
  "single coordinator": "один координатор",
  "Starting...": "Запускаю…",
  "Open council": "Открыть совет",
  "Open AI": "Открыть ИИ",
  "Start council": "Запустить совет",
  "Start AI": "Запустить ИИ",
  "The group's coordinator project is not available on this device.": "Проект-координатор группы недоступен на этом устройстве.",
  "No groups yet.": "Групп пока нет.",
  "Project groups": "Группы проектов",
  "Linked projects know each other and may ask each other questions. Requests still wait for a person.": "Связанные проекты знают друг о друге и могут задавать друг другу вопросы. Запросы по-прежнему ждут решения человека.",
  "New or edited group": "Новая или изменяемая группа",
  "Group name": "Название группы",
  "Save group": "Сохранить группу",
  "Create projects first.": "Сначала создай проекты.",
  "Enter a group name.": "Введи название группы.",
  "Pick at least one project.": "Выбери хотя бы один проект.",
  "Nothing to link: a group needs two projects.": "Нечего связывать: в группе нужно два проекта.",
  "Linked {count} pair(s).": "Связано пар: {count}.",
  "Link all": "Связать все",

  // Joined-room chat
  "Continue requests sent to {count} sessions": "Запросы на продолжение отправлены в сессии: {count}",
  "{count} sessions could not be continued": "Не удалось продолжить сессии: {count}",
  "↓ Minimize": "↓ Свернуть",
  "Continue all {count} sessions": "Продолжить все сессии: {count}",
  "Continuing {count} sessions…": "Продолжаю сессии: {count}…",
  "Across this room": "Во всей этой комнате",
  Thinking: "Думаю",

  // Project tree
  "+ Mesh": "+ Mesh",
  "No rooms yet. Host, connect, or start a Mesh.": "Комнат пока нет. Открой, подключись или запусти Mesh.",

  // Registry / plugins
  "Previous plugin": "Предыдущий плагин",
  "Next plugin": "Следующий плагин",
  "Enable or disable plugin": "Включить или выключить плагин",
  "Plugin management is unavailable.": "Управление плагинами недоступно.",
  "Manage built-in and external TUI plugins. Built-ins disabled at startup can stay unloaded until enabled.": "Управляй встроенными и внешними плагинами TUI. Отключённые при запуске встроенные плагины остаются незагруженными до включения.",
  "plugin name or built-in / external": "имя плагина или built-in / external",
  "plugins": "плагинов",
  "built-in": "встроенный",
  "external": "внешний",
  active: "активен",
  inactive: "неактивен",
  failed: "ошибка",
  Unavailable: "Недоступен",
  Disable: "Выключить",
  "No plugins match this search.": "Плагины по этому запросу не найдены.",
  "tab next tab · ↑↓ select · enter enable/disable · esc close": "tab следующая вкладка · ↑↓ выбор · enter включить/выключить · esc закрыть",
  "Previous AI tool": "Предыдущий ИИ-инструмент",
  "Next AI tool": "Следующий ИИ-инструмент",
  "Install or remove AI tool": "Установить или удалить ИИ-инструмент",
  "Previous tool": "Предыдущий инструмент",
  "Next tool": "Следующий инструмент",
  "Previous page": "Предыдущая страница",
}

function interpolate(template: string, values?: Record<string, string | number>) {
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))
}

export function translate(language: Language | undefined, text: string, values?: Record<string, string | number>) {
  if (language === "ru" && text in ruExtra) return interpolate(ruExtra[text], values)
  return baseTranslate(language, text, values)
}

export function useT() {
  const config = useOptionalConfig()
  return (text: string, values?: Record<string, string | number>) => translate(config?.data.language, text, values)
}
