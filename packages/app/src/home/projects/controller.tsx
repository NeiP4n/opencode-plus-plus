import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { useServerActionsController } from "@/servers/registry/controller"
import { useSettingsCommand } from "@/settings/command"
import { useSettingsSurface } from "@/settings/surface"
import { type LocalProject } from "@/shell/state/layout"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { closeHomeProject, errorMessage, homeProjectDirectories } from "@/shell/layout/helpers"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { showToast } from "@/shell/notifications/toast"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Button } from "@opencode/ui/button"
import { pathKey } from "@/workspaces/path-key"
import { createResource, createSignal, For } from "solid-js"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import type { HomeController } from "../model"
import { useGlobal } from "@/runtime/server/runtime"
import { SessionTransfer } from "@opencode/schema/session-transfer"
import { useRevealProject } from "./reveal"

export const HomeServersSchema = Schema.Struct({
  collapsed: Persistence.record(Persistence.fallback(Schema.Boolean, () => false)),
})

export function createHomeProjectsController(home: HomeController) {
  const platform = usePlatform()
  const pickDirectory = useDirectoryPicker()
  const dialog = useDialog()
  const language = useLanguage()
  const openSettings = useSettingsCommand()
  const settings = useSettingsSurface()
  const serverManagement = useServerActionsController()
  const global = useGlobal()
  const revealProject = useRevealProject()
  const [_state, setState, _, ready] = persisted(Persist.global("home.servers"), HomeServersSchema, { collapsed: {} })

  const [state] = createResource(
    () => ready.promise ?? Promise.resolve(),
    (promise) => promise.then(() => _state),
    { initialValue: _state },
  )

  function edit(conn: ServerConnection.Http, onSave?: (saved: ServerConnection.Http) => void) {
    void import("@/servers/connect/dialog").then(({ DialogServer }) => {
      void dialog.show(() => <DialogServer mode="edit" server={conn} onSave={(saved) => onSave?.(saved)} />)
    })
  }

  // An expired pairing session or a changed password signs the app out of an HTTP server; signing in again edits it,
  // and the action that asked for sign-in continues once the dialog saves, as it does for extension servers. It continues
  // with the saved connection: the one it started with still carries the rejected credentials.
  function authenticate(conn: ServerConnection.Any, onConnected?: (conn: ServerConnection.Any) => void) {
    if (conn.type !== "http" || !home.server.health(conn)?.unauthorized)
      return ServerConnection.authenticate(conn, () => onConnected?.(conn))
    edit(conn, onConnected)

    return true
  }

  function directories(project: LocalProject) {
    return [project.worktree, ...(project.sandboxes ?? [])]
  }

  function choose(conn: ServerConnection.Any) {
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const selected = homeProjectDirectories(result)
        if (!selected.length) return

        const contains = (parent: string, child: string) => {
          const a = pathKey(parent).replace(/\/$/, "")
          const b = pathKey(child).replace(/\/$/, "")
          return a === b || b.startsWith(a + "/")
        }
        const candidates = home.project.list().flatMap((project) =>
          directories(project)
            .filter((directory) =>
              selected.some((item) => contains(directory, item) || contains(item, directory)),
            )
            .map((directory) => ({ directory, label: directory })),
        )
        const unique = [...new Map(candidates.map((item) => [pathKey(item.directory), item])).values()]

        if (!unique.length) {
          home.project.add(conn, selected)
          return
        }

        void dialog.show(() => (
          <ProjectPathChoiceDialog
            paths={selected}
            candidates={unique}
            onConfirm={(chosen, createNew) => {
              chosen.forEach((directory) => home.project.select(conn, directory))
              if (createNew) home.project.add(conn, selected)
              dialog.close()
            }}
          />
        ))
      },
    })
  }

  return {
    copy: {
      language,
    },
    selection: {
      value: home.selection.value,
    },
    server: {
      list: home.server.list,
      health: home.server.health,
      projects: home.project.forServer,
      collapsed: (conn: ServerConnection.Any) => state().collapsed[ServerConnection.key(conn)] ?? false,
      toggleCollapsed: (conn: ServerConnection.Any) => {
        const key = ServerConnection.key(conn)
        setState("collapsed", key, !state().collapsed[key])
      },
      canRemove: (conn: ServerConnection.Any) => serverManagement.connection.canRemove(ServerConnection.key(conn)),
      remove: (conn: ServerConnection.Any) => serverManagement.connection.remove(ServerConnection.key(conn)),
      canHide: (conn: ServerConnection.Any) => serverManagement.connection.canHide(ServerConnection.key(conn)),
      hide: (conn: ServerConnection.Any) => serverManagement.connection.setHidden(ServerConnection.key(conn), true),
      edit: (conn: ServerConnection.Http) => edit(conn),
      authenticate: (conn: ServerConnection.Any) => authenticate(conn),
      focus: (conn: ServerConnection.Any) => {
        if (authenticate(conn, (next) => home.selection.focusServer(next))) return
        home.selection.focusServer(conn)
      },
    },
    project: {
      list: home.project.list,
      recentlyClosed: home.project.recentlyClosed,
      homedir: home.project.homedir,
      select: (conn: ServerConnection.Any, directory: string) => {
        if (authenticate(conn, (next) => home.project.select(next, directory))) return
        home.project.select(conn, directory)
      },
      add: home.project.add,
      openNewSession: (conn: ServerConnection.Any, directory: string) => {
        if (authenticate(conn, (next) => home.project.openProjectNewSession(next, directory))) return
        home.project.openProjectNewSession(conn, directory)
      },
      canImportSession: !!platform.openAttachmentPickerDialog,
      importSession: (conn: ServerConnection.Any, project: LocalProject) => {
        if (!platform.openAttachmentPickerDialog) return
        void platform
          .openAttachmentPickerDialog(
            {
              title: language.t("command.session.import"),
              accept: ["application/json"],
              extensions: ["json"],
            },
            async (file) => {
              const data = await Schema.decodeUnknownPromise(Schema.fromJsonString(SessionTransfer.Data))(
                await file.text(),
              )

              const api = home.server.context(conn).sdk.api.session

              // SAFETY: the payload is SessionTransfer.Data's own encoding, which the import endpoint decodes and validates.
              const imported = await api.import({
                ...Schema.encodeSync(SessionTransfer.Data)(data),
                location: { directory: project.worktree },
              } as Parameters<typeof api.import>[0])

              home.project.openProjectSession(conn, project.worktree, imported)
            },
          )
          .catch((cause: unknown) => {
            showToast({
              title: language.t("common.requestFailed"),
              description: errorMessage(cause, language.t("common.requestFailed")),
            })
          })
      },
      edit: (conn: ServerConnection.Any, project: LocalProject) => {
        settings.openProject({
          server: ServerConnection.key(conn),
          project: project.worktree,
        })
      },
      unseenCount: (conn: ServerConnection.Any, project: LocalProject) => {
        const notification = global.ensureServerCtx(conn).notification

        return directories(project).reduce((total, directory) => total + notification.project.unseenCount(directory), 0)
      },
      clearNotifications: (conn: ServerConnection.Any, project: LocalProject) => {
        const notification = global.ensureServerCtx(conn).notification
        directories(project)
          .filter((directory) => notification.project.unseenCount(directory) > 0)
          .forEach((directory) => notification.project.markViewed(directory))
      },
      choose: (conn: ServerConnection.Any) => {
        if (authenticate(conn, (next) => choose(next))) return

        if (home.server.health(conn)?.healthy === false) return
        choose(conn)
      },
      close: (conn: ServerConnection.Any, directory: string) => {
        const next = closeHomeProject(
          home.selection.value(),
          ServerConnection.key(conn),
          home.server.context(conn).projects,
          directory,
        )

        if (next) home.selection.set(next)
      },
      move: (conn: ServerConnection.Any, worktree: string, index: number) => {
        home.server.context(conn).projects.move(worktree, index)
      },
      canReveal: revealProject.available,
      reveal: revealProject.reveal,
    },
    utility: {
      settings: openSettings,
      help: () => platform.openExternal("https://opencode.ai/desktop-feedback"),
    },
  }
}

function ProjectPathChoiceDialog(props: {
  paths: string[]
  candidates: { directory: string; label: string }[]
  onConfirm: (selected: string[], createNew: boolean) => void
}) {
  const [selected, setSelected] = createSignal<string[]>(props.candidates.map((item) => item.directory))
  const [createNew, setCreateNew] = createSignal(false)

  const toggle = (directory: string) => {
    setSelected((current) =>
      current.includes(directory) ? current.filter((item) => item !== directory) : [...current, directory],
    )
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup title="Projects found at this path" />
      </DialogHeader>
      <div class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto px-1 py-2">
        <p class="text-sm text-text-weak">Choose one or more existing project directories, or add the selected path as a new project.</p>
        <For each={props.candidates}>
          {(item) => (
            <Button
              variant={selected().includes(item.directory) ? "secondary" : "ghost"}
              class="h-auto min-h-9 justify-start whitespace-normal break-all text-left"
              onClick={() => toggle(item.directory)}
            >
              {selected().includes(item.directory) ? "✓ " : ""}{item.label}
            </Button>
          )}
        </For>
        <Button
          variant={createNew() ? "secondary" : "ghost"}
          class="h-auto min-h-9 justify-start whitespace-normal text-left"
          onClick={() => setCreateNew((value) => !value)}
        >
          {createNew() ? "✓ " : ""}Create a new project from selected path{props.paths.length > 1 ? "s" : ""}
        </Button>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => props.onConfirm([], false)}>Cancel</Button>
        <Button onClick={() => props.onConfirm(selected(), createNew())}>Continue</Button>
      </DialogFooter>
    </Dialog>
  )
}

export type HomeProjectsController = ReturnType<typeof createHomeProjectsController>
