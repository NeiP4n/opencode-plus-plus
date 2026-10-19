import type {
  ServerInfoOutput,
  ServerPairOutput,
  ServerConnectInput,
  ServerConnectOutput,
  LocationGetInput,
  LocationGetOutput,
  LocationReloadOutput,
  AgentListInput,
  AgentListOutput,
  AgentGetInput,
  AgentGetOutput,
  PluginListInput,
  PluginListOutput,
  PluginCheckInput,
  PluginCheckOutput,
  PluginUpdateInput,
  PluginUpdateOutput,
  SessionListInput,
  SessionListOutput,
  SessionStatsInput,
  SessionStatsOutput,
  SessionCreateInput,
  SessionCreateOutput,
  SessionImportInput,
  SessionImportOutput,
  SessionExportInput,
  SessionExportOutput,
  SessionActiveOutput,
  SessionGetInput,
  SessionGetOutput,
  SessionRemoveInput,
  SessionRemoveOutput,
  SessionForkInput,
  SessionForkOutput,
  SessionSwitchAgentInput,
  SessionSwitchAgentOutput,
  SessionSwitchModelInput,
  SessionSwitchModelOutput,
  SessionUpdateInput,
  SessionUpdateOutput,
  SessionMoveInput,
  SessionMoveOutput,
  SessionPromptInput,
  SessionPromptOutput,
  SessionCommandInput,
  SessionCommandOutput,
  SessionSkillInput,
  SessionSkillOutput,
  SessionSyntheticInput,
  SessionSyntheticOutput,
  SessionShellInput,
  SessionShellOutput,
  SessionCompactInput,
  SessionCompactOutput,
  SessionWaitInput,
  SessionWaitOutput,
  SessionRevertStageInput,
  SessionRevertStageOutput,
  SessionRevertClearInput,
  SessionRevertClearOutput,
  SessionRevertCommitInput,
  SessionRevertCommitOutput,
  SessionContextInput,
  SessionContextOutput,
  SessionDiffInput,
  SessionDiffOutput,
  SessionInboxListInput,
  SessionInboxListOutput,
  SessionInboxCancelInput,
  SessionInboxCancelOutput,
  SessionInboxUpdateInput,
  SessionInboxUpdateOutput,
  SessionInstructionsEntryListInput,
  SessionInstructionsEntryListOutput,
  SessionInstructionsEntryPutInput,
  SessionInstructionsEntryPutOutput,
  SessionInstructionsEntryRemoveInput,
  SessionInstructionsEntryRemoveOutput,
  SessionGenerateInput,
  SessionGenerateOutput,
  SessionLogInput,
  SessionLogOutput,
  SessionInterruptInput,
  SessionInterruptOutput,
  SessionBackgroundInput,
  SessionBackgroundOutput,
  SessionMessageGetInput,
  SessionMessageGetOutput,
  SessionFormListInput,
  SessionFormListOutput,
  SessionFormCreateInput,
  SessionFormCreateOutput,
  SessionFormGetInput,
  SessionFormGetOutput,
  SessionFormReplyInput,
  SessionFormReplyOutput,
  SessionFormCancelInput,
  SessionFormCancelOutput,
  SessionEnvironmentInput,
  SessionEnvironmentOutput,
  SessionViewInput,
  SessionViewOutput,
  MessageListInput,
  MessageListOutput,
  ModelListInput,
  ModelListOutput,
  ModelDefaultInput,
  ModelDefaultOutput,
  GenerateTextInput,
  GenerateTextOutput,
  ProviderListInput,
  ProviderListOutput,
  ProviderGetInput,
  ProviderGetOutput,
  IntegrationListInput,
  IntegrationListOutput,
  IntegrationGetInput,
  IntegrationGetOutput,
  IntegrationWellknownAddInput,
  IntegrationWellknownAddOutput,
  IntegrationConnectKeyInput,
  IntegrationConnectKeyOutput,
  IntegrationConnectExternalInput,
  IntegrationConnectExternalOutput,
  IntegrationOauthConnectInput,
  IntegrationOauthConnectOutput,
  IntegrationOauthStatusInput,
  IntegrationOauthStatusOutput,
  IntegrationOauthCompleteInput,
  IntegrationOauthCompleteOutput,
  IntegrationOauthCancelInput,
  IntegrationOauthCancelOutput,
  IntegrationCommandConnectInput,
  IntegrationCommandConnectOutput,
  IntegrationCommandStatusInput,
  IntegrationCommandStatusOutput,
  IntegrationCommandCancelInput,
  IntegrationCommandCancelOutput,
  McpListInput,
  McpListOutput,
  McpAddInput,
  McpAddOutput,
  McpRemoveInput,
  McpRemoveOutput,
  McpConnectInput,
  McpConnectOutput,
  McpDisconnectInput,
  McpDisconnectOutput,
  McpResourceCatalogInput,
  McpResourceCatalogOutput,
  CredentialListOutput,
  CredentialCreateInput,
  CredentialCreateOutput,
  CredentialUpdateInput,
  CredentialUpdateOutput,
  CredentialActivateInput,
  CredentialActivateOutput,
  CredentialRemoveInput,
  CredentialRemoveOutput,
  ProjectListOutput,
  ProjectUpdateInput,
  ProjectUpdateOutput,
  FormListInput,
  FormListOutput,
  PermissionRequestListInput,
  PermissionRequestListOutput,
  PermissionSavedListInput,
  PermissionSavedListOutput,
  PermissionSavedRemoveInput,
  PermissionSavedRemoveOutput,
  PermissionCreateInput,
  PermissionCreateOutput,
  PermissionListInput,
  PermissionListOutput,
  PermissionGetInput,
  PermissionGetOutput,
  PermissionReplyInput,
  PermissionReplyOutput,
  FileReadInput,
  FileReadOutput,
  FileListInput,
  FileListOutput,
  FileFindInput,
  FileFindOutput,
  FileWriteInput,
  FileWriteOutput,
  CommandListInput,
  CommandListOutput,
  SkillListInput,
  SkillListOutput,
  RpcCallInput,
  RpcCallOutput,
  EventSubscribeOutput,
  PtyListInput,
  PtyListOutput,
  PtyCreateInput,
  PtyCreateOutput,
  PtyGetInput,
  PtyGetOutput,
  PtyUpdateInput,
  PtyUpdateOutput,
  PtyRemoveInput,
  PtyRemoveOutput,
  PtyConnectTokenInput,
  PtyConnectTokenOutput,
  ExperimentalPersistentPtyReadInput,
  ExperimentalPersistentPtyReadOutput,
  ExperimentalPersistentPtyListInput,
  ExperimentalPersistentPtyListOutput,
  ExperimentalPersistentPtyCreateInput,
  ExperimentalPersistentPtyCreateOutput,
  ExperimentalPersistentPtyShutdownOutput,
  ExperimentalPersistentPtyHandoffOutput,
  ExperimentalPersistentPtyGetInput,
  ExperimentalPersistentPtyGetOutput,
  ExperimentalPersistentPtyUpdateInput,
  ExperimentalPersistentPtyUpdateOutput,
  ExperimentalPersistentPtySnapshotInput,
  ExperimentalPersistentPtySnapshotOutput,
  ExperimentalPersistentPtyRemoveInput,
  ExperimentalPersistentPtyRemoveOutput,
  ExperimentalPersistentPtyConnectTokenInput,
  ExperimentalPersistentPtyConnectTokenOutput,
  ShellListInput,
  ShellListOutput,
  ShellCreateInput,
  ShellCreateOutput,
  ShellGetInput,
  ShellGetOutput,
  ShellOutputInput,
  ShellOutputOutput,
  ShellRemoveInput,
  ShellRemoveOutput,
  ReferenceListInput,
  ReferenceListOutput,
  WorktreeListInput,
  WorktreeListOutput,
  WorktreeCreateInput,
  WorktreeCreateOutput,
  WorktreeRemoveInput,
  WorktreeRemoveOutput,
  WorktreeRefreshInput,
  WorktreeRefreshOutput,
  VcsInitInput,
  VcsInitOutput,
  VcsGetInput,
  VcsGetOutput,
  VcsBaseInput,
  VcsBaseOutput,
  VcsStatusInput,
  VcsStatusOutput,
  VcsBranchListInput,
  VcsBranchListOutput,
  VcsDiffInput,
  VcsDiffOutput,
  NoteListInput,
  NoteListOutput,
  NoteGetInput,
  NoteGetOutput,
  NoteBoundInput,
  NoteBoundOutput,
  NoteCreateInput,
  NoteCreateOutput,
  NoteEditInput,
  NoteEditOutput,
  NoteUpdateInput,
  NoteUpdateOutput,
  NoteLinkInput,
  NoteLinkOutput,
  NoteRemoveInput,
  NoteRemoveOutput,
  DebugLocationListOutput,
  DebugLocationEvictInput,
  DebugLocationEvictOutput,
  MigrationV1StatusOutput,
  WebsearchProvidersInput,
  WebsearchProvidersOutput,
  WebsearchQueryInput,
  WebsearchQueryOutput,
  ConfigGetInput,
  ConfigGetOutput,
  ConfigShellsOutput,
  ConfigUpdateInput,
  ConfigUpdateOutput,
  ConfigCompatibilityGetInput,
  ConfigCompatibilityGetOutput,
  ConfigCompatibilityUpdateInput,
  ConfigCompatibilityUpdateOutput,
  RoomListOutput,
  RoomCreateInput,
  RoomCreateOutput,
  RoomUpdateInput,
  RoomUpdateOutput,
  RoomRemoveInput,
  RoomRemoveOutput,
  RoomDodGetInput,
  RoomDodGetOutput,
  RoomDodReleaseInput,
  RoomDodReleaseOutput,
  RoomFeedInput,
  RoomFeedOutput,
  RoomCodeInput,
  RoomCodeOutput,
  RoomPublicOutput,
  RoomJoinInput,
  RoomJoinOutput,
  RoomGuestGetInput,
  RoomGuestGetOutput,
  RoomGuestSessionMessagesInput,
  RoomGuestSessionMessagesOutput,
  RoomLinkListOutput,
  RoomLinkSaveInput,
  RoomLinkSaveOutput,
  RoomLinkRemoveInput,
  RoomLinkRemoveOutput,
  RoomGuestPassportInput,
  RoomGuestPassportOutput,
  RoomGuestRunInput,
  RoomGuestRunOutput,
  RoomGuestDodGetInput,
  RoomGuestDodGetOutput,
  RoomGuestDodClaimInput,
  RoomGuestDodClaimOutput,
  RoomGuestDodSubmitInput,
  RoomGuestDodSubmitOutput,
  RoomGuestFeedInput,
  RoomGuestFeedOutput,
  RoomGuestLeaveInput,
  RoomGuestLeaveOutput,
  RoomGuestSessionListInput,
  RoomGuestSessionListOutput,
  RoomGuestSessionCreateInput,
  RoomGuestSessionCreateOutput,
  RoomGuestModelListInput,
  RoomGuestModelListOutput,
  RoomGuestAgentListInput,
  RoomGuestAgentListOutput,
  RoomGuestMcpListInput,
  RoomGuestMcpListOutput,
  RoomGuestCommandListInput,
  RoomGuestCommandListOutput,
  RoomGuestSessionModelInput,
  RoomGuestSessionModelOutput,
  RoomGuestSessionAgentInput,
  RoomGuestSessionAgentOutput,
  RoomGuestSessionCommandInput,
  RoomGuestSessionCommandOutput,
  RoomMemberListInput,
  RoomMemberListOutput,
  RoomMemberUpdateInput,
  RoomMemberUpdateOutput,
  RoomMemberRemoveInput,
  RoomMemberRemoveOutput,
  RoomMemberBanInput,
  RoomMemberBanOutput,
  RoomBanListInput,
  RoomBanListOutput,
  RoomBanRemoveInput,
  RoomBanRemoveOutput,
  RoomGuestLogInput,
  RoomGuestLogOutput,
  RoomGuestMessagesInput,
  RoomGuestMessagesOutput,
  RoomGuestNoteInput,
  RoomGuestNoteOutput,
  RoomGuestPromptInput,
  RoomGuestPromptOutput,
  RoomGuestPermissionListInput,
  RoomGuestPermissionListOutput,
  RoomGuestPermissionReplyInput,
  RoomGuestPermissionReplyOutput,
  RoomMeshStatusOutput,
  RoomMeshInviteOutput,
  RoomMeshCreateInput,
  RoomMeshCreateOutput,
  RoomMeshJoinInput,
  RoomMeshJoinOutput,
  RoomMeshLeaveOutput,
  RoomMeshActivateOutput,
  RoomMeshAppendInput,
  RoomMeshAppendOutput,
  RoomMeshFeedInput,
  RoomMeshFeedOutput,
  RoomMeshRpcInput,
  RoomMeshRpcOutput,
  OrchestraProjectListOutput,
  OrchestraTemplateListOutput,
  OrchestraTemplateCreateInput,
  OrchestraTemplateCreateOutput,
  OrchestraTemplateUpdateInput,
  OrchestraTemplateUpdateOutput,
  OrchestraTemplateRemoveInput,
  OrchestraTemplateRemoveOutput,
  OrchestraRoleListOutput,
  OrchestraRoleCreateInput,
  OrchestraRoleCreateOutput,
  OrchestraRoleUpdateInput,
  OrchestraRoleUpdateOutput,
  OrchestraRoleRemoveInput,
  OrchestraRoleRemoveOutput,
  OrchestraProjectCreateInput,
  OrchestraProjectCreateOutput,
  OrchestraProjectUpdateInput,
  OrchestraProjectUpdateOutput,
  OrchestraProjectRemoveInput,
  OrchestraProjectRemoveOutput,
  OrchestraProjectMainInput,
  OrchestraProjectMainOutput,
  OrchestraProjectSessionsInput,
  OrchestraProjectSessionsOutput,
  OrchestraOwnerListOutput,
  OrchestraOwnerSetInput,
  OrchestraOwnerSetOutput,
  OrchestraAccessInput,
  OrchestraAccessOutput,
  OrchestraCategoryInput,
  OrchestraCategoryOutput,
  OrchestraGroupListOutput,
  OrchestraGroupSaveInput,
  OrchestraGroupSaveOutput,
  OrchestraGroupRemoveInput,
  OrchestraGroupRemoveOutput,
  OrchestraGroupLinkInput,
  OrchestraGroupLinkOutput,
  OrchestraLinkSetInput,
  OrchestraLinkSetOutput,
  OrchestraLinkListInput,
  OrchestraLinkListOutput,
} from "./types.js"
import { ClientError } from "./client-error.js"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: RequestInit["headers"]
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: RequestInit["headers"]
  /** Reports every chunk a streaming response receives, including keepalive comments that yield no event. */
  readonly onActivity?: () => void
}

interface RequestDescriptor {
  readonly method: string
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly headers?: Record<string, unknown>
  readonly body?: unknown
  readonly binaryBody?: true
  readonly successStatus: number
  readonly declaredStatuses: ReadonlyArray<number>
  readonly empty: boolean
  readonly binary?: true
}

const maxSseEventBytes = 16 * 1024 * 1024

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    // A leading slash would replace any path prefix on baseUrl, so join relative to it.
    const baseUrl = new URL(options.baseUrl)
    if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/"
    const url = new URL(descriptor.path.slice(1), baseUrl)
    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (descriptor.body !== undefined && !headers.has("content-type"))
      headers.set("content-type", descriptor.binaryBody ? "application/octet-stream" : "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        signal: requestOptions?.signal,
        headers,
        body:
          descriptor.body === undefined
            ? undefined
            : descriptor.binaryBody
              ? (descriptor.body as RequestInit["body"])
              : JSON.stringify(descriptor.body),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    if (descriptor.declaredStatuses.includes(response.status))
      throw declared((await json(response)) as DeclaredErrorBody)
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status }, detail: String(response.status) })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    if (descriptor.binary) return new Uint8Array(await response.arrayBuffer()) as A
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    return (await json(response)) as A
  }

  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions)
      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel()
        } catch {}
        throw new ClientError("UnsupportedContentType", { detail: response.headers.get("content-type") })
      }
      if (response.body === null) throw new ClientError("MalformedResponse")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (true) {
          let next
          try {
            next = await reader.read()
          } catch (cause) {
            throw new ClientError("Transport", { cause })
          }
          if (!next.done) requestOptions?.onActivity?.()
          buffer += decoder.decode(next.value, { stream: !next.done })
          if (buffer.length > maxSseEventBytes) throw new ClientError("SseEventTooLarge")
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r")
          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
          buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
          if (trailingCarriageReturn) buffer += "\r"
          if (next.done && buffer !== "") buffer += "\n\n"
          let boundary = buffer.indexOf("\n\n")
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = block
              .split("\n")
              .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
              .join("\n")
            if (data !== "") {
              try {
                yield JSON.parse(data) as A
              } catch (cause) {
                throw new ClientError("MalformedResponse", { cause })
              }
            }
            boundary = buffer.indexOf("\n\n")
          }
          if (next.done) return
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        reader.releaseLock()
      }
    },
  })

  return {
    server: {
      info: (requestOptions?: RequestOptions) =>
        request<ServerInfoOutput>(
          { method: "GET", path: `/api/info`, successStatus: 200, declaredStatuses: [400, 401], empty: false },
          requestOptions,
        ),
      pair: (requestOptions?: RequestOptions) =>
        request<ServerPairOutput>(
          { method: "POST", path: `/api/pair`, successStatus: 200, declaredStatuses: [400, 401], empty: false },
          requestOptions,
        ),
      connect: (input: ServerConnectInput, requestOptions?: RequestOptions) =>
        request<ServerConnectOutput>(
          {
            method: "GET",
            path: `/auth/connect/${encodeURIComponent(input.code)}`,
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    location: {
      get: (input?: LocationGetInput, requestOptions?: RequestOptions) =>
        request<LocationGetOutput>(
          {
            method: "GET",
            path: `/api/location`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      reload: (requestOptions?: RequestOptions) =>
        request<LocationReloadOutput>(
          {
            method: "POST",
            path: `/api/location/reload`,
            successStatus: 204,
            declaredStatuses: [400, 401, 503],
            empty: true,
          },
          requestOptions,
        ),
    },
    agent: {
      list: (input?: AgentListInput, requestOptions?: RequestOptions) =>
        request<AgentListOutput>(
          {
            method: "GET",
            path: `/api/agent`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: AgentGetInput, requestOptions?: RequestOptions) =>
        request<AgentGetOutput>(
          {
            method: "GET",
            path: `/api/agent/${encodeURIComponent(input.agentID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    plugin: {
      list: (input?: PluginListInput, requestOptions?: RequestOptions) =>
        request<PluginListOutput>(
          {
            method: "GET",
            path: `/api/plugin`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      check: (input?: PluginCheckInput, requestOptions?: RequestOptions) =>
        request<PluginCheckOutput>(
          {
            method: "POST",
            path: `/api/plugin/check`,
            query: { location: input?.["location"] },
            body: { target: input?.["target"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: PluginUpdateInput, requestOptions?: RequestOptions) =>
        request<PluginUpdateOutput>(
          {
            method: "POST",
            path: `/api/plugin/update`,
            query: { location: input["location"] },
            body: { targets: input["targets"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404, 503],
            empty: true,
          },
          requestOptions,
        ),
    },
    session: {
      list: (input?: SessionListInput, requestOptions?: RequestOptions) =>
        request<SessionListOutput>(
          {
            method: "GET",
            path: `/api/session`,
            query: {
              limit: input?.["limit"],
              order: input?.["order"],
              search: input?.["search"],
              parentID: input?.["parentID"],
              archived: input?.["archived"],
              directory: input?.["directory"],
              project: input?.["project"],
              subpath: input?.["subpath"],
              cursor: input?.["cursor"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      stats: (input?: SessionStatsInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionStatsOutput }>(
          {
            method: "GET",
            path: `/api/experimental/session/stats`,
            query: {
              from: input?.["from"],
              to: input?.["to"],
              project: input?.["project"],
              timezone: input?.["timezone"],
              tools: input?.["tools"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      create: (input?: SessionCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionCreateOutput }>(
          {
            method: "POST",
            path: `/api/session`,
            body: {
              id: input?.["id"],
              parentID: input?.["parentID"],
              title: input?.["title"],
              agent: input?.["agent"],
              model: input?.["model"],
              location: input?.["location"],
              metadata: input?.["metadata"],
              permissions: input?.["permissions"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      import: (input: SessionImportInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionImportOutput }>(
          {
            method: "POST",
            path: `/api/experimental/session/import`,
            body: { info: input["info"], messages: input["messages"], location: input["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      export: (input: SessionExportInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionExportOutput }>(
          {
            method: "GET",
            path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/export`,
            query: { sanitize: input["sanitize"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 500],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      active: (requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionActiveOutput }>(
          {
            method: "GET",
            path: `/api/session/active`,
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: SessionGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      remove: (input: SessionRemoveInput, requestOptions?: RequestOptions) =>
        request<SessionRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      fork: (input: SessionForkInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionForkOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/fork`,
            body: { before: input["before"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      switchAgent: (input: SessionSwitchAgentInput, requestOptions?: RequestOptions) =>
        request<SessionSwitchAgentOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/agent`,
            body: { agent: input["agent"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      switchModel: (input: SessionSwitchModelInput, requestOptions?: RequestOptions) =>
        request<SessionSwitchModelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/model`,
            body: { model: input["model"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      update: (input: SessionUpdateInput, requestOptions?: RequestOptions) =>
        request<SessionUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            body: {
              title: input["title"],
              archived: input["archived"],
              metadata: input["metadata"],
              permissions: input["permissions"],
            },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      move: (input: SessionMoveInput, requestOptions?: RequestOptions) =>
        request<SessionMoveOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/move`,
            body: { directory: input["directory"], delivery: input["delivery"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      prompt: (input: SessionPromptInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionPromptOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/prompt`,
            body: {
              id: input["id"],
              text: input["text"],
              files: input["files"],
              agents: input["agents"],
              skills: input["skills"],
              metadata: input["metadata"],
              delivery: input["delivery"],
              resume: input["resume"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409, 422],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      command: (input: SessionCommandInput, requestOptions?: RequestOptions) =>
        request<SessionCommandOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/command`,
            body: {
              name: input["name"],
              text: input["text"],
              files: input["files"],
              agents: input["agents"],
              skills: input["skills"],
              delivery: input["delivery"],
            },
            successStatus: 204,
            declaredStatuses: [400, 401, 404, 500],
            empty: true,
          },
          requestOptions,
        ),
      skill: (input: SessionSkillInput, requestOptions?: RequestOptions) =>
        request<SessionSkillOutput>(
          {
            method: "POST",
            path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/skill`,
            body: { id: input["id"], resume: input["resume"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      synthetic: (input: SessionSyntheticInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionSyntheticOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/synthetic`,
            body: {
              id: input["id"],
              text: input["text"],
              description: input["description"],
              metadata: input["metadata"],
              delivery: input["delivery"],
              resume: input["resume"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      shell: (input: SessionShellInput, requestOptions?: RequestOptions) =>
        request<SessionShellOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/shell`,
            body: { id: input["id"], command: input["command"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      compact: (input: SessionCompactInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionCompactOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/compact`,
            body: { id: input["id"], delivery: input["delivery"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      wait: (input: SessionWaitInput, requestOptions?: RequestOptions) =>
        request<SessionWaitOutput>(
          {
            method: "POST",
            path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/wait`,
            successStatus: 204,
            declaredStatuses: [400, 401, 404, 503],
            empty: true,
          },
          requestOptions,
        ),
      revert: {
        stage: (input: SessionRevertStageInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: SessionRevertStageOutput }>(
            {
              method: "POST",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/stage`,
              body: { messageID: input["messageID"], files: input["files"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404, 409, 500],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        clear: (input: SessionRevertClearInput, requestOptions?: RequestOptions) =>
          request<SessionRevertClearOutput>(
            {
              method: "DELETE",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/revert`,
              successStatus: 204,
              declaredStatuses: [400, 401, 404, 409, 500],
              empty: true,
            },
            requestOptions,
          ),
        commit: (input: SessionRevertCommitInput, requestOptions?: RequestOptions) =>
          request<SessionRevertCommitOutput>(
            {
              method: "POST",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
              successStatus: 204,
              declaredStatuses: [400, 401, 404, 409],
              empty: true,
            },
            requestOptions,
          ),
      },
      context: (input: SessionContextInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionContextOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/context`,
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 500],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      diff: (input: SessionDiffInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionDiffOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/diff`,
            query: { from: input["from"], to: input["to"], context: input["context"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 500],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      inbox: {
        list: (input: SessionInboxListInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: SessionInboxListOutput }>(
            {
              method: "GET",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/inbox`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        cancel: (input: SessionInboxCancelInput, requestOptions?: RequestOptions) =>
          request<SessionInboxCancelOutput>(
            {
              method: "DELETE",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/inbox/${encodeURIComponent(input.inboxID)}`,
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
        update: (input: SessionInboxUpdateInput, requestOptions?: RequestOptions) =>
          request<SessionInboxUpdateOutput>(
            {
              method: "PATCH",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/inbox/${encodeURIComponent(input.inboxID)}`,
              body: { delivery: input["delivery"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404, 409],
              empty: true,
            },
            requestOptions,
          ),
      },
      instructions: {
        entry: {
          list: (input: SessionInstructionsEntryListInput, requestOptions?: RequestOptions) =>
            request<{ readonly data: SessionInstructionsEntryListOutput }>(
              {
                method: "GET",
                path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/instructions/entries`,
                successStatus: 200,
                declaredStatuses: [400, 401, 404],
                empty: false,
              },
              requestOptions,
            ).then((value) => value.data),
          put: (input: SessionInstructionsEntryPutInput, requestOptions?: RequestOptions) =>
            request<SessionInstructionsEntryPutOutput>(
              {
                method: "PUT",
                path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/instructions/entries/${encodeURIComponent(input.key)}`,
                body: { value: input["value"] },
                successStatus: 204,
                declaredStatuses: [400, 401, 404, 413],
                empty: true,
              },
              requestOptions,
            ),
          remove: (input: SessionInstructionsEntryRemoveInput, requestOptions?: RequestOptions) =>
            request<SessionInstructionsEntryRemoveOutput>(
              {
                method: "DELETE",
                path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/instructions/entries/${encodeURIComponent(input.key)}`,
                successStatus: 204,
                declaredStatuses: [400, 401, 404],
                empty: true,
              },
              requestOptions,
            ),
        },
      },
      generate: (input: SessionGenerateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionGenerateOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/generate`,
            body: { prompt: input["prompt"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 503],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      log: (input: SessionLogInput, requestOptions?: RequestOptions): AsyncIterable<SessionLogOutput> =>
        sse<SessionLogOutput>(
          {
            method: "GET",
            path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/log`,
            query: { after: input["after"], follow: input["follow"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      interrupt: (input: SessionInterruptInput, requestOptions?: RequestOptions) =>
        request<SessionInterruptOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/interrupt`,
            query: { resume: input["resume"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      background: (input: SessionBackgroundInput, requestOptions?: RequestOptions) =>
        request<SessionBackgroundOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/background`,
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      message: {
        get: (input: SessionMessageGetInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: SessionMessageGetOutput }>(
            {
              method: "GET",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
      },
      form: {
        list: (input: SessionFormListInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: SessionFormListOutput }>(
            {
              method: "GET",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/form`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        create: (input: SessionFormCreateInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: SessionFormCreateOutput }>(
            {
              method: "POST",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/form`,
              body: { id: input["id"], title: input["title"], metadata: input["metadata"], fields: input["fields"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404, 409],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        get: (input: SessionFormGetInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: SessionFormGetOutput }>(
            {
              method: "GET",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        reply: (input: SessionFormReplyInput, requestOptions?: RequestOptions) =>
          request<SessionFormReplyOutput>(
            {
              method: "POST",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}/reply`,
              body: { answer: input["answer"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404, 409],
              empty: true,
            },
            requestOptions,
          ),
        cancel: (input: SessionFormCancelInput, requestOptions?: RequestOptions) =>
          request<SessionFormCancelOutput>(
            {
              method: "DELETE",
              path: `/api/session/${encodeURIComponent(input.sessionID)}/form/${encodeURIComponent(input.formID)}`,
              query: { message: input["message"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404, 409],
              empty: true,
            },
            requestOptions,
          ),
      },
      environment: (input: SessionEnvironmentInput, requestOptions?: RequestOptions) =>
        request<SessionEnvironmentOutput>(
          {
            method: "PUT",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/environment`,
            body: { variables: input["variables"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      view: (input: SessionViewInput, requestOptions?: RequestOptions) =>
        request<SessionViewOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/view`,
            body: { idle: input["idle"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
    },
    message: {
      list: (input: MessageListInput, requestOptions?: RequestOptions) =>
        request<MessageListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message`,
            query: { limit: input["limit"], order: input["order"], cursor: input["cursor"], type: input["type"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 500],
            empty: false,
          },
          requestOptions,
        ),
    },
    model: {
      list: (input?: ModelListInput, requestOptions?: RequestOptions) =>
        request<ModelListOutput>(
          {
            method: "GET",
            path: `/api/model`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 503],
            empty: false,
          },
          requestOptions,
        ),
      default: (input?: ModelDefaultInput, requestOptions?: RequestOptions) =>
        request<ModelDefaultOutput>(
          {
            method: "GET",
            path: `/api/model/default`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 503],
            empty: false,
          },
          requestOptions,
        ),
    },
    generate: {
      text: (input: GenerateTextInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: GenerateTextOutput }>(
          {
            method: "POST",
            path: `/api/experimental/generate`,
            body: { prompt: input["prompt"], model: input["model"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 503],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
    },
    provider: {
      list: (input?: ProviderListInput, requestOptions?: RequestOptions) =>
        request<ProviderListOutput>(
          {
            method: "GET",
            path: `/api/provider`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 503],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ProviderGetInput, requestOptions?: RequestOptions) =>
        request<ProviderGetOutput>(
          {
            method: "GET",
            path: `/api/provider/${encodeURIComponent(input.providerID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 503],
            empty: false,
          },
          requestOptions,
        ),
    },
    integration: {
      list: (input?: IntegrationListInput, requestOptions?: RequestOptions) =>
        request<IntegrationListOutput>(
          {
            method: "GET",
            path: `/api/integration`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: IntegrationGetInput, requestOptions?: RequestOptions) =>
        request<IntegrationGetOutput>(
          {
            method: "GET",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      wellknown: {
        add: (input: IntegrationWellknownAddInput, requestOptions?: RequestOptions) =>
          request<IntegrationWellknownAddOutput>(
            {
              method: "POST",
              path: `/api/experimental/integration/wellknown`,
              query: { location: input["location"] },
              body: { url: input["url"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
      },
      connect: {
        key: (input: IntegrationConnectKeyInput, requestOptions?: RequestOptions) =>
          request<IntegrationConnectKeyOutput>(
            {
              method: "POST",
              path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
              query: { location: input["location"] },
              body: { key: input["key"], answer: input["answer"], label: input["label"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
        external: (input: IntegrationConnectExternalInput, requestOptions?: RequestOptions) =>
          request<IntegrationConnectExternalOutput>(
            {
              method: "POST",
              path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/external`,
              query: { location: input["location"] },
              body: { methodID: input["methodID"], answer: input["answer"], label: input["label"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
      },
      oauth: {
        connect: (input: IntegrationOauthConnectInput, requestOptions?: RequestOptions) =>
          request<IntegrationOauthConnectOutput>(
            {
              method: "POST",
              path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth`,
              query: { location: input["location"] },
              body: { methodID: input["methodID"], answer: input["answer"], label: input["label"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        status: (input: IntegrationOauthStatusInput, requestOptions?: RequestOptions) =>
          request<IntegrationOauthStatusOutput>(
            {
              method: "GET",
              path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}`,
              query: { location: input["location"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        complete: (input: IntegrationOauthCompleteInput, requestOptions?: RequestOptions) =>
          request<IntegrationOauthCompleteOutput>(
            {
              method: "POST",
              path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}/complete`,
              query: { location: input["location"] },
              body: { code: input["code"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
        cancel: (input: IntegrationOauthCancelInput, requestOptions?: RequestOptions) =>
          request<IntegrationOauthCancelOutput>(
            {
              method: "DELETE",
              path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth/${encodeURIComponent(input.attemptID)}`,
              query: { location: input["location"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
      },
      command: {
        connect: (input: IntegrationCommandConnectInput, requestOptions?: RequestOptions) =>
          request<IntegrationCommandConnectOutput>(
            {
              method: "POST",
              path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command`,
              query: { location: input["location"] },
              body: { methodID: input["methodID"], label: input["label"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        status: (input: IntegrationCommandStatusInput, requestOptions?: RequestOptions) =>
          request<IntegrationCommandStatusOutput>(
            {
              method: "GET",
              path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command/${encodeURIComponent(input.attemptID)}`,
              query: { location: input["location"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        cancel: (input: IntegrationCommandCancelInput, requestOptions?: RequestOptions) =>
          request<IntegrationCommandCancelOutput>(
            {
              method: "DELETE",
              path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/command/${encodeURIComponent(input.attemptID)}`,
              query: { location: input["location"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
      },
    },
    mcp: {
      list: (input?: McpListInput, requestOptions?: RequestOptions) =>
        request<McpListOutput>(
          {
            method: "GET",
            path: `/api/mcp`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      add: (input: McpAddInput, requestOptions?: RequestOptions) =>
        request<McpAddOutput>(
          {
            method: "PUT",
            path: `/api/experimental/mcp/${encodeURIComponent(input.server)}`,
            query: { location: input["location"] },
            body: { config: input["config"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      remove: (input: McpRemoveInput, requestOptions?: RequestOptions) =>
        request<McpRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/experimental/mcp/${encodeURIComponent(input.server)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      connect: (input: McpConnectInput, requestOptions?: RequestOptions) =>
        request<McpConnectOutput>(
          {
            method: "POST",
            path: `/api/experimental/mcp/${encodeURIComponent(input.server)}/connect`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      disconnect: (input: McpDisconnectInput, requestOptions?: RequestOptions) =>
        request<McpDisconnectOutput>(
          {
            method: "POST",
            path: `/api/experimental/mcp/${encodeURIComponent(input.server)}/disconnect`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      resource: {
        catalog: (input?: McpResourceCatalogInput, requestOptions?: RequestOptions) =>
          request<McpResourceCatalogOutput>(
            {
              method: "GET",
              path: `/api/mcp/resource`,
              query: { location: input?.["location"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    credential: {
      list: (requestOptions?: RequestOptions) =>
        request<{ readonly data: CredentialListOutput }>(
          { method: "GET", path: `/api/credential`, successStatus: 200, declaredStatuses: [400, 401], empty: false },
          requestOptions,
        ).then((value) => value.data),
      create: (input: CredentialCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: CredentialCreateOutput }>(
          {
            method: "POST",
            path: `/api/credential`,
            body: {
              id: input["id"],
              integrationID: input["integrationID"],
              label: input["label"],
              value: input["value"],
              activate: input["activate"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 409],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      update: (input: CredentialUpdateInput, requestOptions?: RequestOptions) =>
        request<CredentialUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            body: { label: input["label"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      activate: (input: CredentialActivateInput, requestOptions?: RequestOptions) =>
        request<CredentialActivateOutput>(
          {
            method: "POST",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}/activate`,
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      remove: (input: CredentialRemoveInput, requestOptions?: RequestOptions) =>
        request<CredentialRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    project: {
      list: (requestOptions?: RequestOptions) =>
        request<ProjectListOutput>(
          { method: "GET", path: `/api/project`, successStatus: 200, declaredStatuses: [400, 401, 404], empty: false },
          requestOptions,
        ),
      update: (input: ProjectUpdateInput, requestOptions?: RequestOptions) =>
        request<ProjectUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/project/${encodeURIComponent(input.projectID)}`,
            body: {
              canonical: input["canonical"],
              name: input["name"],
              icon: input["icon"],
              commands: input["commands"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    form: {
      list: (input?: FormListInput, requestOptions?: RequestOptions) =>
        request<FormListOutput>(
          {
            method: "GET",
            path: `/api/form`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    permission: {
      request: {
        list: (input?: PermissionRequestListInput, requestOptions?: RequestOptions) =>
          request<PermissionRequestListOutput>(
            {
              method: "GET",
              path: `/api/permission/request`,
              query: { location: input?.["location"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
      },
      saved: {
        list: (input?: PermissionSavedListInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: PermissionSavedListOutput }>(
            {
              method: "GET",
              path: `/api/permission/saved`,
              query: { projectID: input?.["projectID"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        remove: (input: PermissionSavedRemoveInput, requestOptions?: RequestOptions) =>
          request<PermissionSavedRemoveOutput>(
            {
              method: "DELETE",
              path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
      },
      create: (input: PermissionCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionCreateOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            body: {
              id: input["id"],
              action: input["action"],
              resources: input["resources"],
              save: input["save"],
              metadata: input["metadata"],
              source: input["source"],
              agent: input["agent"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      list: (input: PermissionListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: PermissionGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}`,
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: PermissionReplyInput, requestOptions?: RequestOptions) =>
        request<PermissionReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
            body: { decision: input["decision"], message: input["message"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
    },
    file: {
      read: (input: FileReadInput, requestOptions?: RequestOptions) =>
        request<FileReadOutput>(
          {
            method: "GET",
            path: `/api/fs/read/${encodePath(input.path)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
            binary: true,
          },
          requestOptions,
        ),
      list: (input?: FileListInput, requestOptions?: RequestOptions) =>
        request<FileListOutput>(
          {
            method: "GET",
            path: `/api/fs/list`,
            query: { location: input?.["location"], path: input?.["path"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      find: (input: FileFindInput, requestOptions?: RequestOptions) =>
        request<FileFindOutput>(
          {
            method: "GET",
            path: `/api/fs/find`,
            query: { location: input["location"], query: input["query"], type: input["type"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      write: (input: FileWriteInput, requestOptions?: RequestOptions) =>
        request<FileWriteOutput>(
          {
            method: "POST",
            path: `/api/experimental/fs/write`,
            query: { location: input["location"], path: input["path"] },
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
            binaryBody: true,
          },
          requestOptions,
        ),
    },
    command: {
      list: (input?: CommandListInput, requestOptions?: RequestOptions) =>
        request<CommandListOutput>(
          {
            method: "GET",
            path: `/api/command`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    skill: {
      list: (input?: SkillListInput, requestOptions?: RequestOptions) =>
        request<SkillListOutput>(
          {
            method: "GET",
            path: `/api/skill`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    rpc: {
      call: (input: RpcCallInput, requestOptions?: RequestOptions) =>
        request<RpcCallOutput>(
          {
            method: "POST",
            path: `/api/rpc/${encodeURIComponent(input.rpcID)}/${encodeURIComponent(input.method)}`,
            query: { location: input["location"] },
            body: { input: input["input"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 500],
            empty: false,
          },
          requestOptions,
        ),
    },
    event: {
      subscribe: (requestOptions?: RequestOptions): AsyncIterable<EventSubscribeOutput> =>
        sse<EventSubscribeOutput>(
          { method: "GET", path: `/api/event`, successStatus: 200, declaredStatuses: [400, 401], empty: false },
          requestOptions,
        ),
    },
    pty: {
      list: (input?: PtyListInput, requestOptions?: RequestOptions) =>
        request<PtyListOutput>(
          {
            method: "GET",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: PtyCreateInput, requestOptions?: RequestOptions) =>
        request<PtyCreateOutput>(
          {
            method: "POST",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            body: {
              command: input?.["command"],
              args: input?.["args"],
              cwd: input?.["cwd"],
              title: input?.["title"],
              env: input?.["env"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: PtyGetInput, requestOptions?: RequestOptions) =>
        request<PtyGetOutput>(
          {
            method: "GET",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: PtyUpdateInput, requestOptions?: RequestOptions) =>
        request<PtyUpdateOutput>(
          {
            method: "PUT",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            body: { title: input["title"], size: input["size"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: PtyRemoveInput, requestOptions?: RequestOptions) =>
        request<PtyRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      connect: {
        token: (input: PtyConnectTokenInput, requestOptions?: RequestOptions) =>
          request<PtyConnectTokenOutput>(
            {
              method: "POST",
              path: `/api/pty/${encodeURIComponent(input.ptyID)}/connect-token`,
              query: { location: input["location"] },
              headers: { "x-opencode-ticket": input["x-opencode-ticket"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 404],
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    experimental: {
      persistentPty: {
        read: (input: ExperimentalPersistentPtyReadInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: ExperimentalPersistentPtyReadOutput }>(
            {
              method: "GET",
              path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/terminal/read`,
              query: { lines: input["lines"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 503],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        list: (input: ExperimentalPersistentPtyListInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: ExperimentalPersistentPtyListOutput }>(
            {
              method: "GET",
              path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/terminal`,
              successStatus: 200,
              declaredStatuses: [400, 401, 503],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        create: (input: ExperimentalPersistentPtyCreateInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: ExperimentalPersistentPtyCreateOutput }>(
            {
              method: "POST",
              path: `/api/experimental/session/${encodeURIComponent(input.sessionID)}/terminal`,
              body: {
                command: input["command"],
                args: input["args"],
                cwd: input["cwd"],
                title: input["title"],
                env: input["env"],
                size: input["size"],
              },
              successStatus: 200,
              declaredStatuses: [400, 401, 503],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        shutdown: (requestOptions?: RequestOptions) =>
          request<ExperimentalPersistentPtyShutdownOutput>(
            {
              method: "POST",
              path: `/api/experimental/persistent-pty/shutdown`,
              successStatus: 204,
              declaredStatuses: [400, 401, 503],
              empty: true,
            },
            requestOptions,
          ),
        handoff: (requestOptions?: RequestOptions) =>
          request<ExperimentalPersistentPtyHandoffOutput>(
            {
              method: "POST",
              path: `/api/experimental/persistent-pty/handoff`,
              successStatus: 200,
              declaredStatuses: [400, 401, 503],
              empty: false,
            },
            requestOptions,
          ),
        get: (input: ExperimentalPersistentPtyGetInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: ExperimentalPersistentPtyGetOutput }>(
            {
              method: "GET",
              path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404, 503],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        update: (input: ExperimentalPersistentPtyUpdateInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: ExperimentalPersistentPtyUpdateOutput }>(
            {
              method: "PUT",
              path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}`,
              body: { attachmentID: input["attachmentID"], size: input["size"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404, 503],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        snapshot: (input: ExperimentalPersistentPtySnapshotInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: ExperimentalPersistentPtySnapshotOutput }>(
            {
              method: "GET",
              path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}/snapshot`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404, 503],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        remove: (input: ExperimentalPersistentPtyRemoveInput, requestOptions?: RequestOptions) =>
          request<ExperimentalPersistentPtyRemoveOutput>(
            {
              method: "DELETE",
              path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}`,
              successStatus: 204,
              declaredStatuses: [400, 401, 404, 503],
              empty: true,
            },
            requestOptions,
          ),
        connectToken: (input: ExperimentalPersistentPtyConnectTokenInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: ExperimentalPersistentPtyConnectTokenOutput }>(
            {
              method: "POST",
              path: `/api/experimental/persistent-pty/${encodeURIComponent(input.ptyID)}/connect-token`,
              headers: { "x-opencode-ticket": input["x-opencode-ticket"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 404, 503],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
      },
    },
    shell: {
      list: (input?: ShellListInput, requestOptions?: RequestOptions) =>
        request<ShellListOutput>(
          {
            method: "GET",
            path: `/api/shell`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: ShellCreateInput, requestOptions?: RequestOptions) =>
        request<ShellCreateOutput>(
          {
            method: "POST",
            path: `/api/shell`,
            query: { location: input["location"] },
            body: {
              command: input["command"],
              cwd: input["cwd"],
              timeout: input["timeout"],
              metadata: input["metadata"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ShellGetInput, requestOptions?: RequestOptions) =>
        request<ShellGetOutput>(
          {
            method: "GET",
            path: `/api/shell/${encodeURIComponent(input.id)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      output: (input: ShellOutputInput, requestOptions?: RequestOptions) =>
        request<ShellOutputOutput>(
          {
            method: "GET",
            path: `/api/shell/${encodeURIComponent(input.id)}/output`,
            query: { location: input["location"], cursor: input["cursor"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ShellRemoveInput, requestOptions?: RequestOptions) =>
        request<ShellRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/shell/${encodeURIComponent(input.id)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
    },
    reference: {
      list: (input?: ReferenceListInput, requestOptions?: RequestOptions) =>
        request<ReferenceListOutput>(
          {
            method: "GET",
            path: `/api/reference`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    worktree: {
      list: (input: WorktreeListInput, requestOptions?: RequestOptions) =>
        request<WorktreeListOutput>(
          {
            method: "GET",
            path: `/api/worktree`,
            query: { projectID: input["projectID"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: WorktreeCreateInput, requestOptions?: RequestOptions) =>
        request<WorktreeCreateOutput>(
          {
            method: "POST",
            path: `/api/worktree`,
            body: {
              projectID: input["projectID"],
              from: input["from"],
              branch: input["branch"],
              directory: input["directory"],
              name: input["name"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: WorktreeRemoveInput, requestOptions?: RequestOptions) =>
        request<WorktreeRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/worktree`,
            body: { projectID: input["projectID"], directory: input["directory"], force: input["force"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      refresh: (input: WorktreeRefreshInput, requestOptions?: RequestOptions) =>
        request<WorktreeRefreshOutput>(
          {
            method: "POST",
            path: `/api/worktree/refresh`,
            body: { projectID: input["projectID"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
    },
    vcs: {
      init: (input?: VcsInitInput, requestOptions?: RequestOptions) =>
        request<VcsInitOutput>(
          {
            method: "POST",
            path: `/api/vcs/init`,
            query: { location: input?.["location"], provider: input?.["provider"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404, 409, 501, 503],
            empty: true,
          },
          requestOptions,
        ),
      get: (input?: VcsGetInput, requestOptions?: RequestOptions) =>
        request<VcsGetOutput>(
          {
            method: "GET",
            path: `/api/vcs`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      base: (input?: VcsBaseInput, requestOptions?: RequestOptions) =>
        request<VcsBaseOutput>(
          {
            method: "GET",
            path: `/api/vcs/base`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 503],
            empty: false,
          },
          requestOptions,
        ),
      status: (input?: VcsStatusInput, requestOptions?: RequestOptions) =>
        request<VcsStatusOutput>(
          {
            method: "GET",
            path: `/api/vcs/status`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      branch: {
        list: (input?: VcsBranchListInput, requestOptions?: RequestOptions) =>
          request<VcsBranchListOutput>(
            {
              method: "GET",
              path: `/api/vcs/branch`,
              query: { location: input?.["location"], search: input?.["search"], limit: input?.["limit"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
      },
      diff: (input: VcsDiffInput, requestOptions?: RequestOptions) =>
        request<VcsDiffOutput>(
          {
            method: "GET",
            path: `/api/vcs/diff`,
            query: { location: input["location"], mode: input["mode"], base: input["base"], context: input["context"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 503],
            empty: false,
          },
          requestOptions,
        ),
    },
    note: {
      list: (input?: NoteListInput, requestOptions?: RequestOptions) =>
        request<NoteListOutput>(
          {
            method: "GET",
            path: `/api/note`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: NoteGetInput, requestOptions?: RequestOptions) =>
        request<NoteGetOutput>(
          {
            method: "GET",
            path: `/api/note/${encodeURIComponent(input.name)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      bound: (input: NoteBoundInput, requestOptions?: RequestOptions) =>
        request<NoteBoundOutput>(
          {
            method: "GET",
            path: `/api/note/session/${encodeURIComponent(input.sessionID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: NoteCreateInput, requestOptions?: RequestOptions) =>
        request<NoteCreateOutput>(
          {
            method: "POST",
            path: `/api/note`,
            query: { location: input["location"] },
            body: {
              name: input["name"],
              title: input["title"],
              body: input["body"],
              status: input["status"],
              tags: input["tags"],
              length: input["length"],
              session: input["session"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      edit: (input: NoteEditInput, requestOptions?: RequestOptions) =>
        request<NoteEditOutput>(
          {
            method: "POST",
            path: `/api/note/${encodeURIComponent(input.name)}/edit`,
            query: { location: input["location"] },
            body: { body: input["body"], mode: input["mode"], expectedMtime: input["expectedMtime"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: NoteUpdateInput, requestOptions?: RequestOptions) =>
        request<NoteUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/note/${encodeURIComponent(input.name)}`,
            query: { location: input["location"] },
            body: {
              title: input["title"],
              status: input["status"],
              tags: input["tags"],
              length: input["length"],
              expectedMtime: input["expectedMtime"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      link: (input: NoteLinkInput, requestOptions?: RequestOptions) =>
        request<NoteLinkOutput>(
          {
            method: "POST",
            path: `/api/note/${encodeURIComponent(input.name)}/link`,
            query: { location: input["location"] },
            body: { session: input["session"], expectedMtime: input["expectedMtime"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 409, 503],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: NoteRemoveInput, requestOptions?: RequestOptions) =>
        request<NoteRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/note/${encodeURIComponent(input.name)}`,
            query: { location: input["location"], expectedMtime: input["expectedMtime"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404, 409, 503],
            empty: true,
          },
          requestOptions,
        ),
    },
    debug: {
      location: {
        list: (requestOptions?: RequestOptions) =>
          request<DebugLocationListOutput>(
            {
              method: "GET",
              path: `/api/debug/location`,
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        evict: (input?: DebugLocationEvictInput, requestOptions?: RequestOptions) =>
          request<DebugLocationEvictOutput>(
            {
              method: "DELETE",
              path: `/api/debug/location`,
              query: { location: input?.["location"] },
              successStatus: 204,
              declaredStatuses: [400, 401],
              empty: true,
            },
            requestOptions,
          ),
      },
    },
    migration: {
      v1: {
        status: (requestOptions?: RequestOptions) =>
          request<MigrationV1StatusOutput>(
            {
              method: "GET",
              path: `/api/experimental/migration/v1`,
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    websearch: {
      providers: (input?: WebsearchProvidersInput, requestOptions?: RequestOptions) =>
        request<WebsearchProvidersOutput>(
          {
            method: "GET",
            path: `/api/websearch/provider`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 503],
            empty: false,
          },
          requestOptions,
        ),
      query: (input: WebsearchQueryInput, requestOptions?: RequestOptions) =>
        request<WebsearchQueryOutput>(
          {
            method: "POST",
            path: `/api/websearch`,
            query: { location: input["location"] },
            body: { query: input["query"], providerID: input["providerID"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404, 503],
            empty: false,
          },
          requestOptions,
        ),
    },
    config: {
      get: (input?: ConfigGetInput, requestOptions?: RequestOptions) =>
        request<ConfigGetOutput>(
          {
            method: "GET",
            path: `/api/config`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      shells: (requestOptions?: RequestOptions) =>
        request<ConfigShellsOutput>(
          {
            method: "GET",
            path: `/api/config/shell`,
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      update: (input?: ConfigUpdateInput, requestOptions?: RequestOptions) =>
        request<ConfigUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/experimental/config`,
            body: {
              shell: input?.["shell"],
              model: input?.["model"],
              mcpServers: input?.["mcpServers"],
              proxy: input?.["proxy"],
              compatibilityEnabled: input?.["compatibilityEnabled"],
            },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      compatibility: {
        get: (input?: ConfigCompatibilityGetInput, requestOptions?: RequestOptions) =>
          request<ConfigCompatibilityGetOutput>(
            {
              method: "GET",
              path: `/api/config/compatibility`,
              query: { location: input?.["location"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        update: (input: ConfigCompatibilityUpdateInput, requestOptions?: RequestOptions) =>
          request<ConfigCompatibilityUpdateOutput>(
            {
              method: "POST",
              path: `/api/config/compatibility`,
              query: { location: input["location"] },
              body: { ecosystem: input["ecosystem"], enabled: input["enabled"], trusted: input["trusted"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    room: {
      list: (requestOptions?: RequestOptions) =>
        request<{ readonly data: RoomListOutput }>(
          { method: "GET", path: `/api/room`, successStatus: 200, declaredStatuses: [400, 401], empty: false },
          requestOptions,
        ).then((value) => value.data),
      create: (input: RoomCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: RoomCreateOutput }>(
          {
            method: "POST",
            path: `/api/room`,
            body: {
              sessionID: input["sessionID"],
              name: input["name"],
              hostName: input["hostName"],
              ai: input["ai"],
              guestApprovals: input["guestApprovals"],
              defaultRole: input["defaultRole"],
              open: input["open"],
              rules: input["rules"],
              directory: input["directory"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      update: (input: RoomUpdateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: RoomUpdateOutput }>(
          {
            method: "PATCH",
            path: `/api/room/${encodeURIComponent(input.roomID)}`,
            body: {
              name: input["name"],
              hostName: input["hostName"],
              ai: input["ai"],
              guestApprovals: input["guestApprovals"],
              defaultRole: input["defaultRole"],
              open: input["open"],
              rules: input["rules"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      remove: (input: RoomRemoveInput, requestOptions?: RequestOptions) =>
        request<RoomRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/room/${encodeURIComponent(input.roomID)}`,
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      dod: {
        get: (input: RoomDodGetInput, requestOptions?: RequestOptions) =>
          request<RoomDodGetOutput>(
            {
              method: "GET",
              path: `/api/room/${encodeURIComponent(input.roomID)}/dod`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        release: (input: RoomDodReleaseInput, requestOptions?: RequestOptions) =>
          request<RoomDodReleaseOutput>(
            {
              method: "POST",
              path: `/api/room/${encodeURIComponent(input.roomID)}/dod/release`,
              body: { id: input["id"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
      },
      feed: (input: RoomFeedInput, requestOptions?: RequestOptions) =>
        request<RoomFeedOutput>(
          {
            method: "GET",
            path: `/api/room/${encodeURIComponent(input.roomID)}/feed`,
            query: { after: input["after"], wait: input["wait"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      code: (input: RoomCodeInput, requestOptions?: RequestOptions) =>
        request<RoomCodeOutput>(
          {
            method: "POST",
            path: `/api/room/${encodeURIComponent(input.roomID)}/code`,
            successStatus: 200,
            declaredStatuses: [400, 401, 404],
            empty: false,
          },
          requestOptions,
        ),
      public: (requestOptions?: RequestOptions) =>
        request<RoomPublicOutput>(
          { method: "GET", path: `/api/room/public`, successStatus: 200, declaredStatuses: [400, 401], empty: false },
          requestOptions,
        ),
      join: (input: RoomJoinInput, requestOptions?: RequestOptions) =>
        request<RoomJoinOutput>(
          {
            method: "POST",
            path: `/api/room/join`,
            body: { code: input["code"], roomID: input["roomID"], name: input["name"], device: input["device"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      guest: {
        get: (input: RoomGuestGetInput, requestOptions?: RequestOptions) =>
          request<RoomGuestGetOutput>(
            {
              method: "GET",
              path: `/api/room/${encodeURIComponent(input.roomID)}/guest`,
              query: { sessionID: input["sessionID"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        session: {
          messages: (input: RoomGuestSessionMessagesInput, requestOptions?: RequestOptions) =>
            request<RoomGuestSessionMessagesOutput>(
              {
                method: "GET",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/session/message`,
                query: {
                  limit: input["limit"],
                  order: input["order"],
                  cursor: input["cursor"],
                  type: input["type"],
                  sessionID: input["sessionID"],
                },
                successStatus: 200,
                declaredStatuses: [400, 401, 404, 500],
                empty: false,
              },
              requestOptions,
            ),
          list: (input: RoomGuestSessionListInput, requestOptions?: RequestOptions) =>
            request<RoomGuestSessionListOutput>(
              {
                method: "GET",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/session`,
                successStatus: 200,
                declaredStatuses: [400, 401, 404],
                empty: false,
              },
              requestOptions,
            ),
          create: (input: RoomGuestSessionCreateInput, requestOptions?: RequestOptions) =>
            request<{ readonly data: RoomGuestSessionCreateOutput }>(
              {
                method: "POST",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/session`,
                body: { title: input["title"] },
                successStatus: 200,
                declaredStatuses: [400, 401, 403, 404],
                empty: false,
              },
              requestOptions,
            ).then((value) => value.data),
          model: (input: RoomGuestSessionModelInput, requestOptions?: RequestOptions) =>
            request<RoomGuestSessionModelOutput>(
              {
                method: "POST",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/session/${encodeURIComponent(input.sessionID)}/model`,
                body: { model: input["model"] },
                successStatus: 204,
                declaredStatuses: [400, 401, 403, 404],
                empty: true,
              },
              requestOptions,
            ),
          agent: (input: RoomGuestSessionAgentInput, requestOptions?: RequestOptions) =>
            request<RoomGuestSessionAgentOutput>(
              {
                method: "POST",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/session/${encodeURIComponent(input.sessionID)}/agent`,
                body: { agent: input["agent"] },
                successStatus: 204,
                declaredStatuses: [400, 401, 403, 404],
                empty: true,
              },
              requestOptions,
            ),
          command: (input: RoomGuestSessionCommandInput, requestOptions?: RequestOptions) =>
            request<RoomGuestSessionCommandOutput>(
              {
                method: "POST",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/session/${encodeURIComponent(input.sessionID)}/command`,
                body: { name: input["name"], text: input["text"] },
                successStatus: 204,
                declaredStatuses: [400, 401, 403, 404, 500],
                empty: true,
              },
              requestOptions,
            ),
        },
        passport: (input: RoomGuestPassportInput, requestOptions?: RequestOptions) =>
          request<RoomGuestPassportOutput>(
            {
              method: "GET",
              path: `/api/room/${encodeURIComponent(input.roomID)}/guest/passport`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        run: (input: RoomGuestRunInput, requestOptions?: RequestOptions) =>
          request<RoomGuestRunOutput>(
            {
              method: "POST",
              path: `/api/room/${encodeURIComponent(input.roomID)}/guest/run`,
              body: { command: input["command"], sessionID: input["sessionID"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 404],
              empty: false,
            },
            requestOptions,
          ),
        dod: {
          get: (input: RoomGuestDodGetInput, requestOptions?: RequestOptions) =>
            request<RoomGuestDodGetOutput>(
              {
                method: "GET",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/dod`,
                successStatus: 200,
                declaredStatuses: [400, 401, 404],
                empty: false,
              },
              requestOptions,
            ),
          claim: (input: RoomGuestDodClaimInput, requestOptions?: RequestOptions) =>
            request<RoomGuestDodClaimOutput>(
              {
                method: "POST",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/dod`,
                body: {
                  id: input["id"],
                  next: input["next"],
                  take: input["take"],
                  handover: input["handover"],
                  sessionID: input["sessionID"],
                  paths: input["paths"],
                },
                successStatus: 200,
                declaredStatuses: [400, 401, 403, 404],
                empty: false,
              },
              requestOptions,
            ),
          submit: (input: RoomGuestDodSubmitInput, requestOptions?: RequestOptions) =>
            request<RoomGuestDodSubmitOutput>(
              {
                method: "POST",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/dod/submit`,
                body: { id: input["id"], handover: input["handover"] },
                successStatus: 200,
                declaredStatuses: [400, 401, 403, 404],
                empty: false,
              },
              requestOptions,
            ),
        },
        feed: (input: RoomGuestFeedInput, requestOptions?: RequestOptions) =>
          request<RoomGuestFeedOutput>(
            {
              method: "GET",
              path: `/api/room/${encodeURIComponent(input.roomID)}/guest/feed`,
              query: { after: input["after"], wait: input["wait"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        leave: (input: RoomGuestLeaveInput, requestOptions?: RequestOptions) =>
          request<RoomGuestLeaveOutput>(
            {
              method: "DELETE",
              path: `/api/room/${encodeURIComponent(input.roomID)}/guest`,
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
        model: {
          list: (input: RoomGuestModelListInput, requestOptions?: RequestOptions) =>
            request<{ readonly data: RoomGuestModelListOutput }>(
              {
                method: "GET",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/model`,
                successStatus: 200,
                declaredStatuses: [400, 401, 404],
                empty: false,
              },
              requestOptions,
            ).then((value) => value.data),
        },
        agent: {
          list: (input: RoomGuestAgentListInput, requestOptions?: RequestOptions) =>
            request<{ readonly data: RoomGuestAgentListOutput }>(
              {
                method: "GET",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/agent`,
                successStatus: 200,
                declaredStatuses: [400, 401, 404],
                empty: false,
              },
              requestOptions,
            ).then((value) => value.data),
        },
        mcp: {
          list: (input: RoomGuestMcpListInput, requestOptions?: RequestOptions) =>
            request<{ readonly data: RoomGuestMcpListOutput }>(
              {
                method: "GET",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/mcp`,
                successStatus: 200,
                declaredStatuses: [400, 401, 404],
                empty: false,
              },
              requestOptions,
            ).then((value) => value.data),
        },
        command: {
          list: (input: RoomGuestCommandListInput, requestOptions?: RequestOptions) =>
            request<{ readonly data: RoomGuestCommandListOutput }>(
              {
                method: "GET",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/command`,
                successStatus: 200,
                declaredStatuses: [400, 401, 404],
                empty: false,
              },
              requestOptions,
            ).then((value) => value.data),
        },
        log: (input: RoomGuestLogInput, requestOptions?: RequestOptions): AsyncIterable<RoomGuestLogOutput> =>
          sse<RoomGuestLogOutput>(
            {
              method: "GET",
              path: `/api/room/${encodeURIComponent(input.roomID)}/guest/log`,
              query: { sessionID: input["sessionID"], after: input["after"], follow: input["follow"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        messages: (input: RoomGuestMessagesInput, requestOptions?: RequestOptions) =>
          request<RoomGuestMessagesOutput>(
            {
              method: "GET",
              path: `/api/room/${encodeURIComponent(input.roomID)}/guest/message`,
              query: { sessionID: input["sessionID"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        note: (input: RoomGuestNoteInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: RoomGuestNoteOutput }>(
            {
              method: "GET",
              path: `/api/room/${encodeURIComponent(input.roomID)}/guest/note`,
              query: { sessionID: input["sessionID"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        prompt: (input: RoomGuestPromptInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: RoomGuestPromptOutput }>(
            {
              method: "POST",
              path: `/api/room/${encodeURIComponent(input.roomID)}/guest/prompt`,
              body: { id: input["id"], text: input["text"], sessionID: input["sessionID"], ai: input["ai"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        permission: {
          list: (input: RoomGuestPermissionListInput, requestOptions?: RequestOptions) =>
            request<{ readonly data: RoomGuestPermissionListOutput }>(
              {
                method: "GET",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/permission`,
                query: { sessionID: input["sessionID"] },
                successStatus: 200,
                declaredStatuses: [400, 401, 404],
                empty: false,
              },
              requestOptions,
            ).then((value) => value.data),
          reply: (input: RoomGuestPermissionReplyInput, requestOptions?: RequestOptions) =>
            request<RoomGuestPermissionReplyOutput>(
              {
                method: "POST",
                path: `/api/room/${encodeURIComponent(input.roomID)}/guest/permission/${encodeURIComponent(input.requestID)}/reply`,
                body: { decision: input["decision"], message: input["message"], sessionID: input["sessionID"] },
                successStatus: 204,
                declaredStatuses: [400, 401, 403, 404],
                empty: true,
              },
              requestOptions,
            ),
        },
      },
      link: {
        list: (requestOptions?: RequestOptions) =>
          request<{ readonly data: RoomLinkListOutput }>(
            { method: "GET", path: `/api/room/link`, successStatus: 200, declaredStatuses: [400, 401], empty: false },
            requestOptions,
          ).then((value) => value.data),
        save: (input: RoomLinkSaveInput, requestOptions?: RequestOptions) =>
          request<RoomLinkSaveOutput>(
            {
              method: "PUT",
              path: `/api/room/link`,
              body: {
                url: input["url"],
                roomID: input["roomID"],
                token: input["token"],
                name: input["name"],
                guest: input["guest"],
              },
              successStatus: 204,
              declaredStatuses: [400, 401],
              empty: true,
            },
            requestOptions,
          ),
        remove: (input: RoomLinkRemoveInput, requestOptions?: RequestOptions) =>
          request<RoomLinkRemoveOutput>(
            {
              method: "POST",
              path: `/api/room/link/remove`,
              body: { url: input["url"], roomID: input["roomID"] },
              successStatus: 204,
              declaredStatuses: [400, 401],
              empty: true,
            },
            requestOptions,
          ),
      },
      member: {
        list: (input: RoomMemberListInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: RoomMemberListOutput }>(
            {
              method: "GET",
              path: `/api/room/${encodeURIComponent(input.roomID)}/member`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        update: (input: RoomMemberUpdateInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: RoomMemberUpdateOutput }>(
            {
              method: "PATCH",
              path: `/api/room/${encodeURIComponent(input.roomID)}/member/${encodeURIComponent(input.guestID)}`,
              body: { role: input["role"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        remove: (input: RoomMemberRemoveInput, requestOptions?: RequestOptions) =>
          request<RoomMemberRemoveOutput>(
            {
              method: "DELETE",
              path: `/api/room/${encodeURIComponent(input.roomID)}/member/${encodeURIComponent(input.guestID)}`,
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
        ban: (input: RoomMemberBanInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: RoomMemberBanOutput }>(
            {
              method: "POST",
              path: `/api/room/${encodeURIComponent(input.roomID)}/member/${encodeURIComponent(input.guestID)}/ban`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
      },
      ban: {
        list: (input: RoomBanListInput, requestOptions?: RequestOptions) =>
          request<{ readonly data: RoomBanListOutput }>(
            {
              method: "GET",
              path: `/api/room/${encodeURIComponent(input.roomID)}/ban`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ).then((value) => value.data),
        remove: (input: RoomBanRemoveInput, requestOptions?: RequestOptions) =>
          request<RoomBanRemoveOutput>(
            {
              method: "DELETE",
              path: `/api/room/${encodeURIComponent(input.roomID)}/ban/${encodeURIComponent(input.banID)}`,
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
      },
      mesh: {
        status: (requestOptions?: RequestOptions) =>
          request<RoomMeshStatusOutput>(
            {
              method: "GET",
              path: `/api/room/mesh`,
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 503],
              empty: false,
            },
            requestOptions,
          ),
        invite: (requestOptions?: RequestOptions) =>
          request<RoomMeshInviteOutput>(
            {
              method: "GET",
              path: `/api/room/mesh/invite`,
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 503],
              empty: false,
            },
            requestOptions,
          ),
        create: (input: RoomMeshCreateInput, requestOptions?: RequestOptions) =>
          request<RoomMeshCreateOutput>(
            {
              method: "POST",
              path: `/api/room/mesh`,
              body: { url: input["url"], name: input["name"], directory: input["directory"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 503],
              empty: false,
            },
            requestOptions,
          ),
        join: (input: RoomMeshJoinInput, requestOptions?: RequestOptions) =>
          request<RoomMeshJoinOutput>(
            {
              method: "POST",
              path: `/api/room/mesh/join`,
              body: {
                seedURL: input["seedURL"],
                token: input["token"],
                url: input["url"],
                name: input["name"],
                directory: input["directory"],
              },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 503],
              empty: false,
            },
            requestOptions,
          ),
        leave: (requestOptions?: RequestOptions) =>
          request<RoomMeshLeaveOutput>(
            {
              method: "POST",
              path: `/api/room/mesh/leave`,
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 503],
              empty: false,
            },
            requestOptions,
          ),
        activate: (requestOptions?: RequestOptions) =>
          request<RoomMeshActivateOutput>(
            {
              method: "POST",
              path: `/api/room/mesh/activate`,
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 503],
              empty: false,
            },
            requestOptions,
          ),
        append: (input: RoomMeshAppendInput, requestOptions?: RequestOptions) =>
          request<RoomMeshAppendOutput>(
            {
              method: "POST",
              path: `/api/room/mesh/append`,
              body: { id: input["id"], kind: input["kind"], payload: input["payload"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 503],
              empty: false,
            },
            requestOptions,
          ),
        feed: (input?: RoomMeshFeedInput, requestOptions?: RequestOptions) =>
          request<RoomMeshFeedOutput>(
            {
              method: "GET",
              path: `/api/room/mesh/feed`,
              query: { after: input?.["after"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 503],
              empty: false,
            },
            requestOptions,
          ),
        rpc: (input: RoomMeshRpcInput, requestOptions?: RequestOptions) =>
          request<RoomMeshRpcOutput>(
            {
              method: "POST",
              path: `/api/room/mesh/rpc`,
              body: input["payload"],
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 503],
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    orchestra: {
      project: {
        list: (requestOptions?: RequestOptions) =>
          request<OrchestraProjectListOutput>(
            {
              method: "GET",
              path: `/api/orchestra/project`,
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        create: (input: OrchestraProjectCreateInput, requestOptions?: RequestOptions) =>
          request<OrchestraProjectCreateOutput>(
            {
              method: "POST",
              path: `/api/orchestra/project`,
              body: {
                name: input["name"],
                directory: input["directory"],
                template: input["template"],
                isolation: input["isolation"],
              },
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        update: (input: OrchestraProjectUpdateInput, requestOptions?: RequestOptions) =>
          request<OrchestraProjectUpdateOutput>(
            {
              method: "PATCH",
              path: `/api/orchestra/project/${encodeURIComponent(input.projectID)}`,
              body: { name: input["name"], directory: input["directory"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        remove: (input: OrchestraProjectRemoveInput, requestOptions?: RequestOptions) =>
          request<OrchestraProjectRemoveOutput>(
            {
              method: "DELETE",
              path: `/api/orchestra/project/${encodeURIComponent(input.projectID)}`,
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
        main: (input: OrchestraProjectMainInput, requestOptions?: RequestOptions) =>
          request<OrchestraProjectMainOutput>(
            {
              method: "POST",
              path: `/api/orchestra/project/${encodeURIComponent(input.projectID)}/main`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
        sessions: (input: OrchestraProjectSessionsInput, requestOptions?: RequestOptions) =>
          request<OrchestraProjectSessionsOutput>(
            {
              method: "GET",
              path: `/api/orchestra/project/${encodeURIComponent(input.projectID)}/session`,
              successStatus: 200,
              declaredStatuses: [400, 401, 404],
              empty: false,
            },
            requestOptions,
          ),
      },
      template: {
        list: (requestOptions?: RequestOptions) =>
          request<OrchestraTemplateListOutput>(
            {
              method: "GET",
              path: `/api/orchestra/template`,
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        create: (input: OrchestraTemplateCreateInput, requestOptions?: RequestOptions) =>
          request<OrchestraTemplateCreateOutput>(
            {
              method: "POST",
              path: `/api/orchestra/template`,
              body: {
                name: input["name"],
                description: input["description"],
                members: input["members"],
                playbook: input["playbook"],
              },
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        update: (input: OrchestraTemplateUpdateInput, requestOptions?: RequestOptions) =>
          request<OrchestraTemplateUpdateOutput>(
            {
              method: "PUT",
              path: `/api/orchestra/template/${encodeURIComponent(input.templateID)}`,
              body: {
                name: input["name"],
                description: input["description"],
                members: input["members"],
                playbook: input["playbook"],
              },
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        remove: (input: OrchestraTemplateRemoveInput, requestOptions?: RequestOptions) =>
          request<OrchestraTemplateRemoveOutput>(
            {
              method: "DELETE",
              path: `/api/orchestra/template/${encodeURIComponent(input.templateID)}`,
              successStatus: 204,
              declaredStatuses: [400, 401],
              empty: true,
            },
            requestOptions,
          ),
      },
      role: {
        list: (requestOptions?: RequestOptions) =>
          request<OrchestraRoleListOutput>(
            {
              method: "GET",
              path: `/api/orchestra/role`,
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        create: (input: OrchestraRoleCreateInput, requestOptions?: RequestOptions) =>
          request<OrchestraRoleCreateOutput>(
            {
              method: "POST",
              path: `/api/orchestra/role`,
              body: {
                name: input["name"],
                description: input["description"],
                rules: input["rules"],
                category: input["category"],
                readOnly: input["readOnly"],
                model: input["model"],
                models: input["models"],
                tools: input["tools"],
                autoTools: input["autoTools"],
                hub: input["hub"],
                registry: input["registry"],
              },
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        update: (input: OrchestraRoleUpdateInput, requestOptions?: RequestOptions) =>
          request<OrchestraRoleUpdateOutput>(
            {
              method: "PUT",
              path: `/api/orchestra/role/${encodeURIComponent(input.roleID)}`,
              body: {
                name: input["name"],
                description: input["description"],
                rules: input["rules"],
                category: input["category"],
                readOnly: input["readOnly"],
                model: input["model"],
                models: input["models"],
                tools: input["tools"],
                autoTools: input["autoTools"],
                hub: input["hub"],
                registry: input["registry"],
              },
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        remove: (input: OrchestraRoleRemoveInput, requestOptions?: RequestOptions) =>
          request<OrchestraRoleRemoveOutput>(
            {
              method: "DELETE",
              path: `/api/orchestra/role/${encodeURIComponent(input.roleID)}`,
              successStatus: 204,
              declaredStatuses: [400, 401],
              empty: true,
            },
            requestOptions,
          ),
      },
      owner: {
        list: (requestOptions?: RequestOptions) =>
          request<OrchestraOwnerListOutput>(
            {
              method: "GET",
              path: `/api/orchestra/owner`,
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        set: (input: OrchestraOwnerSetInput, requestOptions?: RequestOptions) =>
          request<OrchestraOwnerSetOutput>(
            {
              method: "PUT",
              path: `/api/orchestra/owner/${encodeURIComponent(input.sessionID)}`,
              body: { projectID: input["projectID"] },
              successStatus: 204,
              declaredStatuses: [400, 401, 404],
              empty: true,
            },
            requestOptions,
          ),
      },
      access: (input: OrchestraAccessInput, requestOptions?: RequestOptions) =>
        request<OrchestraAccessOutput>(
          {
            method: "PUT",
            path: `/api/orchestra/access/${encodeURIComponent(input.sessionID)}`,
            body: { access: input["access"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      category: (input: OrchestraCategoryInput, requestOptions?: RequestOptions) =>
        request<OrchestraCategoryOutput>(
          {
            method: "PUT",
            path: `/api/orchestra/category/${encodeURIComponent(input.sessionID)}`,
            body: { category: input["category"] },
            successStatus: 204,
            declaredStatuses: [400, 401, 404],
            empty: true,
          },
          requestOptions,
        ),
      group: {
        list: (requestOptions?: RequestOptions) =>
          request<OrchestraGroupListOutput>(
            {
              method: "GET",
              path: `/api/orchestra/group`,
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
        save: (input: OrchestraGroupSaveInput, requestOptions?: RequestOptions) =>
          request<OrchestraGroupSaveOutput>(
            {
              method: "PUT",
              path: `/api/orchestra/group`,
              body: {
                name: input["name"],
                projects: input["projects"],
                mode: input["mode"],
                supervisor: input["supervisor"],
              },
              successStatus: 204,
              declaredStatuses: [400, 401],
              empty: true,
            },
            requestOptions,
          ),
        remove: (input: OrchestraGroupRemoveInput, requestOptions?: RequestOptions) =>
          request<OrchestraGroupRemoveOutput>(
            {
              method: "DELETE",
              path: `/api/orchestra/group/${encodeURIComponent(input.name)}`,
              successStatus: 204,
              declaredStatuses: [400, 401],
              empty: true,
            },
            requestOptions,
          ),
        link: (input: OrchestraGroupLinkInput, requestOptions?: RequestOptions) =>
          request<OrchestraGroupLinkOutput>(
            {
              method: "POST",
              path: `/api/orchestra/group/${encodeURIComponent(input.name)}/link`,
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
      },
      link: {
        set: (input: OrchestraLinkSetInput, requestOptions?: RequestOptions) =>
          request<OrchestraLinkSetOutput>(
            {
              method: "POST",
              path: `/api/orchestra/link`,
              body: { a: input["a"], b: input["b"], linked: input["linked"] },
              successStatus: 204,
              declaredStatuses: [400, 401],
              empty: true,
            },
            requestOptions,
          ),
        list: (input: OrchestraLinkListInput, requestOptions?: RequestOptions) =>
          request<OrchestraLinkListOutput>(
            {
              method: "GET",
              path: `/api/orchestra/link/${encodeURIComponent(input.projectID)}`,
              successStatus: 200,
              declaredStatuses: [400, 401],
              empty: false,
            },
            requestOptions,
          ),
      },
    },
  }
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/")
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return
  if (value === null) {
    params.append(key, "null")
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType", { detail: response.headers.get("content-type") })
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

type DeclaredErrorBody = {
  readonly _tag?: string
  readonly message?: string
  readonly data?: { readonly message?: string }
}

/** Throw declared error bodies as Errors. The body's fields stay on the error, so narrowing on `_tag` or `name` still works. */
function declared(body: DeclaredErrorBody) {
  const error = Object.assign(new Error(body.message ?? body.data?.message), body)
  if (body._tag) error.name = body._tag
  return error
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
