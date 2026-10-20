import type { SessionInfo } from "@opencode/client/promise"
import { errorMessage } from "./error"

/**
 * The slice of the session API the cleanup needs. Both the TUI client and the
 * plugin client expose it, so the same code clears sessions from either side.
 */
export interface SessionCleanupApi {
  list: (input: {
    limit?: number
    order?: "asc" | "desc"
    archived?: boolean
    cursor?: string
  }) => Promise<{ data: SessionInfo[]; cursor: { next?: string | null } }>
  remove: (input: { sessionID: string }) => Promise<unknown>
}

const PAGE_SIZE = 200

async function listPage(
  api: SessionCleanupApi,
  archived: boolean,
  cursor?: string,
): Promise<SessionInfo[]> {
  const page = await api.list({ limit: PAGE_SIZE, order: "asc", archived, cursor })
  if (!page.cursor.next) return page.data
  return [...page.data, ...(await listPage(api, archived, page.cursor.next))]
}

/**
 * Every session the server knows about: all projects, all directories, archived
 * ones included. The server answers one page at a time, so the cursor is followed
 * until it runs out.
 */
export async function listEverySession(api: SessionCleanupApi): Promise<SessionInfo[]> {
  const active = await listPage(api, false)
  const archived = await listPage(api, true)
  return [...active, ...archived]
}

/**
 * Deletes one session at a time: a bulk request would hammer the server with
 * hundreds of parallel deletes and bury the first real failure. A session the
 * server refuses to delete (a project's main orchestrator) is reported instead
 * of stopping the run.
 */
export async function removeEverySession(api: SessionCleanupApi, sessions: SessionInfo[]) {
  const failures: string[] = []
  let removed = 0
  for (const session of sessions) {
    try {
      await api.remove({ sessionID: session.id })
      removed++
    } catch (error) {
      failures.push(errorMessage(error))
    }
  }
  return { removed, failures }
}
