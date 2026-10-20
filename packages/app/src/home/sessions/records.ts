import type { SessionInfo } from "@opencode/client/promise"
import type { LocalProject } from "@/shell/state/layout"
import { displayName } from "@opencode/ui/project-avatar"
import { compareSessionTime } from "@/shell/layout/helpers"
import { pathKey } from "@/workspaces/path-key"
import { getFilename } from "@opencode/util/path"

export type HomeSessionRecord = {
  session: SessionInfo
  project: LocalProject
  projectName: string
}

export function homeSessionLocation(directory: string, branch?: string) {
  return { worktree: getFilename(directory) || directory, branch }
}

export function buildHomeSessionRecords(input: {
  sessions: () => SessionInfo[]
  projectDirectories: () => string[] | undefined
  projects: () => LocalProject[]
  resolveProject?: (session: SessionInfo) => LocalProject | undefined
}) {
  const selected = input.projectDirectories()
  const directories = selected ? new Set(selected.map(pathKey)) : undefined

  const sessions = directories
    ? input.sessions().filter((session) => directories.has(pathKey(session.location.directory)))
    : input.sessions()
  const projects = input.projects()
  const byDirectory = new Map<string, LocalProject>()
  const byID = new Map<string, LocalProject>()

  // Preserve Array.find's first-match behavior while indexing once instead of
  // rescanning every project and sandbox for every session row.
  const indexDirectory = (directory: string, project: LocalProject) => {
    const key = pathKey(directory)
    if (!byDirectory.has(key)) byDirectory.set(key, project)
  }
  for (const project of projects) {
    if (project.id && !byID.has(project.id)) byID.set(project.id, project)
    indexDirectory(project.worktree, project)
    for (const sandbox of project.sandboxes ?? []) indexDirectory(sandbox, project)
  }

  return [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
    .sort(compareSessionTime)
    .map((session) => {
      const project =
        input.resolveProject?.(session) ??
        byDirectory.get(pathKey(session.location.directory)) ??
        byID.get(session.projectID) ?? {
          id: session.projectID,
          worktree: session.location.directory,
          expanded: false,
        }

      return { session, project, projectName: displayName(project) }
    })
}

// Worktree inventories load on demand, so a worktree session may not match any directory yet;
// the session's project ID still identifies its added project.
export function homeProjectForSession<T extends { id?: string; worktree: string; sandboxes?: readonly string[] }>(
  session: SessionInfo,
  projects: readonly T[],
) {
  const directory = pathKey(session.location.directory)

  return (
    projects.find(
      (item) =>
        pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
    ) ?? projects.find((item) => item.id === session.projectID)
  )
}
