import type { GhostModelMetadata, GhostProgressPhase, GhostRequestStatus, GhostStopReason } from './ghostState'
import type { CustomResponseFormat, OpenAiProfileId } from '../services/providerProfiles'
import type { GhostLogLevel } from '../config'
import type { GhostModelAliases, GhostModelProfiles, GhostModelRole } from '../services/modelProfiles'
import { GHOST_POLICY } from '../ghostPolicy'
import type {
  GhostAutoAcceptScope,
  GhostMode,
  GhostProvider,
  GhostResponseLength,
  GhostViewStatus
} from '../webview/ghostProtocolTypes'

export const GHOST_WEBVIEW_PROTOCOL_VERSION = 2 as const
export const GHOST_SUPPORTED_PROTOCOL_VERSIONS = [1, GHOST_WEBVIEW_PROTOCOL_VERSION] as const
export type GhostProtocolVersion = typeof GHOST_SUPPORTED_PROTOCOL_VERSIONS[number]
export const GHOST_PERSISTENCE_SCHEMA_VERSION = 2 as const
export const MAX_GHOST_WEBVIEW_MESSAGE_BYTES = GHOST_POLICY.protocol.maxWebviewMessageBytes

export type {
  GhostViewStatus,
  GhostProvider,
  GhostAutoAcceptScope,
  GhostMode,
  GhostResponseLength
}
export type GhostOpenAiProfile = OpenAiProfileId
export type GhostContextKey = 'workspace' | 'folders' | 'activeFile' | 'selection' | 'openFiles' | 'tools'
export type { GhostRequestStatus }
export type { GhostProgressPhase }
export type { GhostStopReason }
export type { GhostModelMetadata }
export type { GhostModelAliases, GhostModelProfiles, GhostModelRole }

export type GhostToolApprovalDecision = 'once' | 'file' | 'request' | 'session' | 'workspace' | 'always' | 'reject'

export interface GhostToolArguments {
  [key: string]: unknown
}

export interface GhostToolDiffPreview {
  path: string
  files?: string[]
  before: string
  after: string
  truncated?: boolean
  previewKind?: 'staged' | 'text'
  hunks?: Array<{ startLine: number; endLine: number; replacement: string }>
}

export interface GhostAttachment {
  name: string
  path?: string
  content?: string
  mimeType?: string
}

export interface GhostTaskPlan {
  steps: Array<{ id: string; title: string; checked: boolean; evidence?: string }>
  currentStep?: string
  blockedReason?: string
  completionEvidence: string[]
  updatedAt: number
}

export interface GhostCompletionRecord {
  changedFiles: string[]
  checksRun: string[]
  failures: string[]
  remainingWork: string[]
  recordedAt: number
}

export interface GhostContinuation {
  prompt: string
  lastFailure?: {
    tool: string
    arguments?: GhostToolArguments
    result?: string
  }
  filePaths: string[]
  remainingPlan?: GhostTaskPlan
}

export type GhostRequestEventType = 'request-started' | 'thinking' | 'text-delta' | 'code-delta' | 'tool-requested' | 'tool-result' | 'task-plan' | 'warning' | 'error' | 'request-completed'

export interface GhostRequestEvent {
  timestamp: number
  elapsedMs: number
  type: GhostRequestEventType
  status: GhostRequestStatus
  phase?: GhostProgressPhase
  detail?: string
}

export interface GhostWebviewRequestOptions {
  provider?: GhostProvider
  model?: string
  modelProfile?: string
  modelRole?: GhostModelRole
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  repeatPenalty?: number
  maxContextTokens?: number
  maxTokens?: number
  mode?: GhostMode
  context?: Partial<Record<GhostContextKey, boolean>>
  showReasoning?: boolean
  customSystemInstructions?: string
  workspaceRoot?: string
  additionalContext?: string
}

export interface GhostSettingsUpdate {
  provider?: GhostProvider
  chatModel?: string
  autocompleteModel?: string
  modelProfile?: string
  modelAliases?: GhostModelAliases
  modelProfiles?: GhostModelProfiles
  maxContextTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  repeatPenalty?: number
  responseLength?: GhostResponseLength
  mode?: GhostMode
  fileEditApproval?: GhostAutoAcceptScope | 'auto'
  autoAcceptScope?: GhostAutoAcceptScope
  enableInlineCompletions?: boolean
  enableConversationPersistence?: boolean
  enableDebugLogging?: boolean
  logLevel?: GhostLogLevel
  ollamaUrl?: string
  mlxUrl?: string
  openaiUrl?: string
  openaiProfile?: GhostOpenAiProfile
  openaiApiVersion?: string
  openaiCustomModelsPath?: string
  openaiCustomChatPath?: string
  openaiCustomRequestTemplate?: string
  openaiCustomResponseFormat?: CustomResponseFormat
  openaiApiKeyHeader?: string
  openaiApiKeyPrefix?: string
  openaiOrganizationHeader?: string
  openaiOrganization?: string
  openaiProjectHeader?: string
  openaiProject?: string
  openaiProxy?: string
  openaiNoProxy?: string
  openaiTlsRejectUnauthorized?: boolean
  openaiTlsCaFile?: string
  openaiTlsCertFile?: string
  openaiTlsKeyFile?: string
  openCodeUrl?: string
  openCodeUsername?: string
  openCodeAgent?: string
  openCodeSessionReuse?: 'workspace' | 'new'
  workspaceOnly?: boolean
  toolAllowlist?: string[]
  toolAsklist?: string[]
  toolDenylist?: string[]
  terminalEnvironmentAllowlist?: string[]
  terminalEnvironmentAsklist?: string[]
}

export interface GhostPersistedState {
  schemaVersion: number
  conversations?: unknown[]
  activeConversationId?: string
  promptHistory?: string[]
  presets?: unknown[]
  showReasoning?: boolean
  preferences?: Record<string, unknown>
}

interface GhostWebviewEnvelope {
  source: 'ghost-webview'
  version: GhostProtocolVersion
  supportedVersions?: number[]
}

interface GhostRequestEnvelope extends GhostWebviewEnvelope {
  requestId: string
  conversationId: string
}

export type GhostWebviewMessage =
  | (GhostWebviewEnvelope & { type: 'ready' })
  | (GhostWebviewEnvelope & { type: 'reset' | 'clear' | 'import' | 'check-status' | 'test-provider' | 'set-provider-api-key' | 'complete-first-run' })
  | (GhostWebviewEnvelope & { type: 'export'; state?: GhostPersistedState })
  | (GhostWebviewEnvelope & { type: 'persist-state'; state: GhostPersistedState })
  | (GhostRequestEnvelope & {
      type: 'submit'
      prompt: string
      options?: GhostWebviewRequestOptions
      attachments?: GhostAttachment[]
    })
  | (GhostRequestEnvelope & { type: 'cancel' })
  | (GhostRequestEnvelope & { type: 'disable-auto-accept' })
  | (GhostRequestEnvelope & { type: 'retry-tool'; toolCallId: string; tool: string; arguments: GhostToolArguments })
  | (GhostRequestEnvelope & { type: 'approve-all-files' })
  | (GhostRequestEnvelope & { type: 'continue'; resume: GhostContinuation; options?: GhostWebviewRequestOptions })
  | (GhostRequestEnvelope & { type: 'approve-tool'; toolCallId: string; decision: Exclude<GhostToolApprovalDecision, 'reject'>; selectedHunkIndexes?: number[] })
  | (GhostRequestEnvelope & { type: 'reject-tool' | 'cancel-tool'; toolCallId: string })
  | (GhostRequestEnvelope & { type: 'edit-tool'; toolCallId: string; arguments: GhostToolArguments })
  | (GhostRequestEnvelope & { type: 'restore-tool'; toolCallId: string })
  | (GhostRequestEnvelope & { type: 'open-file'; path: string; line?: number })
  | (GhostRequestEnvelope & { type: 'retry' | 'regenerate'; messageId: string })
  | (GhostRequestEnvelope & { type: 'edit'; messageId: string; prompt: string })
  | (GhostRequestEnvelope & { type: 'attach'; attachments: GhostAttachment[] })
  | (GhostRequestEnvelope & { type: 'remove-context'; contextKey: GhostContextKey })
  | (GhostRequestEnvelope & { type: 'select-model'; model: string })
  | (GhostWebviewEnvelope & { type: 'load-controls' | 'refresh-models' | 'pick-file' })
  | (GhostRequestEnvelope & { type: 'update-settings'; settings: GhostSettingsUpdate })

interface GhostExtensionEnvelope {
  source: 'ghost-extension'
  version: GhostProtocolVersion
}

export type GhostStreamEvent =
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'request-started'; sequence: number })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'thinking'; sequence: number; detail: string })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'text-delta' | 'code-delta'; sequence: number; delta: string })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'tool-requested'; sequence: number; tool: string; toolCallId: string; arguments?: GhostToolArguments; requiresApproval: boolean; approvalKind?: 'tool' | 'provider-permission'; diffPreview?: GhostToolDiffPreview; detail?: string })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'tool-result'; sequence: number; tool: string; toolCallId: string; detail: string; resultStatus?: 'completed' | 'rejected' | 'failed' })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'task-plan'; sequence: number; plan: GhostTaskPlan })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'warning'; sequence: number; message: string })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'error'; sequence: number; message: string; stopReason?: GhostStopReason })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'request-completed'; sequence: number; status: 'completed' | 'cancelled' | 'failed'; stopReason?: GhostStopReason; message?: string; completionRecord?: GhostCompletionRecord; eventLog?: GhostRequestEvent[] })

interface GhostRequestEnvelopeBase {
  requestId: string
  conversationId: string
  state?: GhostRequestStatus
  phase?: GhostProgressPhase
  elapsedMs?: number
  model?: string
  provider?: GhostProvider
  tokenCount?: number
  tokensPerSecond?: number
  startedAt?: number
  detail?: string
  stopReason?: GhostStopReason
}

export type GhostExtensionMessage =
  | (GhostExtensionEnvelope & { type: 'protocol-negotiated'; negotiatedVersion: GhostProtocolVersion; supportedVersions: GhostProtocolVersion[] })
  | (GhostExtensionEnvelope & { type: 'state'; status: GhostViewStatus; detail: string })
  | (GhostExtensionEnvelope & { type: 'reset' | 'clear'; action: 'explicit-user-command' })
  | (GhostExtensionEnvelope & { type: 'open-first-run' })
  | (GhostExtensionEnvelope & { type: 'persisted-state'; state: GhostPersistedState })
  | (GhostExtensionEnvelope & {
      type: 'controls-state'
      settings: {
        provider: GhostProvider
        chatModel: string
        autocompleteModel: string
        modelProfile: string
        modelAliases: GhostModelAliases
        modelProfiles: GhostModelProfiles
        maxContextTokens: number
        temperature: number
        topP: number
        topK: number
        minP: number
        presencePenalty: number
        repeatPenalty: number
        responseLength: GhostResponseLength
        mode: GhostMode
        autoAcceptScope: GhostAutoAcceptScope
        enableInlineCompletions: boolean
        enableConversationPersistence: boolean
        ollamaUrl: string
        mlxUrl: string
        openaiUrl: string
        openaiProfile: GhostOpenAiProfile
        openaiApiVersion: string
        openaiCustomModelsPath: string
        openaiCustomChatPath: string
        openaiCustomRequestTemplate: string
        openaiCustomResponseFormat: CustomResponseFormat
        openaiApiKeyHeader: string
        openaiApiKeyPrefix: string
        openaiOrganizationHeader: string
        openaiOrganization: string
        openaiProjectHeader: string
        openaiProject: string
        openaiProxy: string
        openaiNoProxy: string
        openaiTlsRejectUnauthorized: boolean
        openaiTlsCaFile: string
        openaiTlsCertFile: string
        openaiTlsKeyFile: string
        openCodeUrl: string
        openCodeUsername: string
        openCodeAgent: string
        openCodeSessionReuse: 'workspace' | 'new'
        toolAllowlist: string[]
        toolAsklist: string[]
        toolDenylist: string[]
        terminalEnvironmentAllowlist: string[]
        terminalEnvironmentAsklist: string[]
        enableDebugLogging: boolean
        logLevel: GhostLogLevel
        networkAccess: 'local' | 'external'
      }
      models: string[]
      modelMetadata?: GhostModelMetadata[]
      connection: 'online' | 'offline' | 'unknown'
      firstRunSetupComplete: boolean
      context: {
        workspaceName: string
        folders: string[]
        activeFile?: { name: string; path: string; languageId: string; hasSelection: boolean }
        openFiles: string[]
      }
      tools: string[]
    })
  | (GhostExtensionEnvelope & { type: 'file-picked'; attachments: GhostAttachment[] })
  | GhostStreamEvent

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const isBoundedString = (value: unknown, maximum: number): value is string => (
  typeof value === 'string' && value.length <= maximum
)

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
)

export function negotiateGhostProtocolVersion(peerVersions: readonly number[]): GhostProtocolVersion | undefined {
  return [...GHOST_SUPPORTED_PROTOCOL_VERSIONS]
    .reverse()
    .find(version => peerVersions.includes(version))
}

export function migrateGhostWebviewMessage(value: unknown): unknown {
  if (!isRecord(value) || value.source !== 'ghost-webview' || value.version !== 1) {
    return value
  }
  return {
    ...value,
    ...(value.type === 'ready' && value.supportedVersions === undefined ? { supportedVersions: [1] } : {})
  }
}

const isPersistedState = (value: unknown): value is GhostPersistedState => (
  isRecord(value) &&
  (value.schemaVersion === 1 || value.schemaVersion === GHOST_PERSISTENCE_SCHEMA_VERSION) &&
  (value.conversations === undefined || (Array.isArray(value.conversations) && value.conversations.length <= 1000)) &&
  (value.activeConversationId === undefined || isBoundedString(value.activeConversationId, 256)) &&
  (value.promptHistory === undefined || (Array.isArray(value.promptHistory) && value.promptHistory.length <= 100 && value.promptHistory.every(item => isBoundedString(item, 20000)))) &&
  (value.presets === undefined || Array.isArray(value.presets)) &&
  (value.showReasoning === undefined || typeof value.showReasoning === 'boolean') &&
  (value.preferences === undefined || isRecord(value.preferences))
)

const isRequestEnvelope = (message: Record<string, unknown>): boolean => (
  isBoundedString(message.requestId, 256) && message.requestId.trim().length > 0 &&
  isBoundedString(message.conversationId, 256) && message.conversationId.trim().length > 0
)

const isAttachment = (value: unknown): value is GhostAttachment => {
  if (!isRecord(value) || !isNonEmptyString(value.name)) {
    return false
  }
  return (
    (value.path === undefined || (isBoundedString(value.path, 4096) && value.path.trim().length > 0)) &&
    (value.content === undefined || (typeof value.content === 'string' && value.content.length <= 1024 * 1024)) &&
    (value.mimeType === undefined || isBoundedString(value.mimeType, 256))
  )
}

const isOptions = (value: unknown): value is GhostWebviewRequestOptions => {
  if (value === undefined) {
    return true
  }
  if (!isRecord(value)) {
    return false
  }
  if (
    (value.provider !== undefined && !['ollama', 'mlx-vlm', 'openai-compatible', 'opencode'].includes(value.provider as string)) ||
    (value.model !== undefined && !isBoundedString(value.model, 512)) ||
    (value.modelProfile !== undefined && !isBoundedString(value.modelProfile, 256)) ||
    (value.modelRole !== undefined && !['chat', 'agent', 'vision', 'autocomplete'].includes(value.modelRole as string)) ||
    (value.temperature !== undefined && !isFiniteNumber(value.temperature)) ||
    (value.topP !== undefined && !isFiniteNumber(value.topP)) ||
    (value.topK !== undefined && !isFiniteNumber(value.topK)) ||
    (value.minP !== undefined && !isFiniteNumber(value.minP)) ||
    (value.presencePenalty !== undefined && !isFiniteNumber(value.presencePenalty)) ||
    (value.repeatPenalty !== undefined && !isFiniteNumber(value.repeatPenalty)) ||
    (value.maxContextTokens !== undefined && !isFiniteNumber(value.maxContextTokens)) ||
    (value.maxTokens !== undefined && !isFiniteNumber(value.maxTokens)) ||
    (value.showReasoning !== undefined && typeof value.showReasoning !== 'boolean') ||
    (value.customSystemInstructions !== undefined && !isBoundedString(value.customSystemInstructions, 8000)) ||
    (value.workspaceRoot !== undefined && !isBoundedString(value.workspaceRoot, 4096)) ||
    (value.additionalContext !== undefined && !isBoundedString(value.additionalContext, 24000)) ||
    (value.mode !== undefined && !['ask', 'edit', 'agent', 'explain', 'inline'].includes(value.mode as string))
  ) {
    return false
  }
  return value.context === undefined || (
    isRecord(value.context) &&
    Object.entries(value.context).every(([key, item]) => (
      ['workspace', 'folders', 'activeFile', 'selection', 'openFiles', 'tools'].includes(key) && typeof item === 'boolean'
    ))
  )
}

const isSettingsUpdate = (value: unknown): value is GhostSettingsUpdate => {
  if (!isRecord(value)) {
    return false
  }
  return (
    (value.provider === undefined || ['ollama', 'mlx-vlm', 'openai-compatible', 'opencode'].includes(value.provider as string)) &&
    (value.openaiProfile === undefined || ['generic', 'anthropic', 'gemini', 'azure-openai', 'lm-studio', 'llama-cpp', 'vllm', 'litellm', 'custom'].includes(value.openaiProfile as string)) &&
    (value.chatModel === undefined || isBoundedString(value.chatModel, 512)) &&
    (value.autocompleteModel === undefined || isBoundedString(value.autocompleteModel, 512)) &&
    (value.modelProfile === undefined || isBoundedString(value.modelProfile, 256)) &&
    (value.modelAliases === undefined || (
      isRecord(value.modelAliases) &&
      Object.entries(value.modelAliases).length <= 100 &&
      Object.entries(value.modelAliases).every(([key, item]) => isBoundedString(key, 256) && isBoundedString(item, 512))
    )) &&
    (value.modelProfiles === undefined || (
      isRecord(value.modelProfiles) &&
      Object.entries(value.modelProfiles).length <= 100 &&
      Object.values(value.modelProfiles).every(item => isRecord(item))
    )) &&
    (value.maxContextTokens === undefined || isFiniteNumber(value.maxContextTokens)) &&
    (value.temperature === undefined || isFiniteNumber(value.temperature)) &&
    (value.topP === undefined || isFiniteNumber(value.topP)) &&
    (value.topK === undefined || isFiniteNumber(value.topK)) &&
    (value.minP === undefined || isFiniteNumber(value.minP)) &&
    (value.presencePenalty === undefined || isFiniteNumber(value.presencePenalty)) &&
    (value.repeatPenalty === undefined || isFiniteNumber(value.repeatPenalty)) &&
    (value.responseLength === undefined || ['short', 'balanced', 'long', 'unlimited'].includes(value.responseLength as string)) &&
    (value.mode === undefined || ['ask', 'edit', 'agent', 'explain', 'inline'].includes(value.mode as string)) &&
    (value.fileEditApproval === undefined || ['confirm', 'auto', 'one-edit', 'current-file', 'request', 'session', 'workspace', 'always'].includes(value.fileEditApproval as string)) &&
    (value.autoAcceptScope === undefined || ['confirm', 'one-edit', 'current-file', 'request', 'session', 'workspace', 'always'].includes(value.autoAcceptScope as string)) &&
    (value.enableInlineCompletions === undefined || typeof value.enableInlineCompletions === 'boolean') &&
    (value.enableConversationPersistence === undefined || typeof value.enableConversationPersistence === 'boolean') &&
    (value.enableDebugLogging === undefined || typeof value.enableDebugLogging === 'boolean') &&
    (value.logLevel === undefined || ['off', 'error', 'warn', 'info', 'debug'].includes(value.logLevel as string)) &&
    (value.ollamaUrl === undefined || isBoundedString(value.ollamaUrl, 4096))
    && (value.mlxUrl === undefined || isBoundedString(value.mlxUrl, 4096))
    && (value.openaiUrl === undefined || isBoundedString(value.openaiUrl, 4096))
    && (value.openaiApiVersion === undefined || isBoundedString(value.openaiApiVersion, 128))
    && (value.openaiCustomModelsPath === undefined || isBoundedString(value.openaiCustomModelsPath, 4096))
    && (value.openaiCustomChatPath === undefined || isBoundedString(value.openaiCustomChatPath, 4096))
    && (value.openaiCustomRequestTemplate === undefined || isBoundedString(value.openaiCustomRequestTemplate, 65536))
    && (value.openaiCustomResponseFormat === undefined || ['openai-sse', 'json'].includes(value.openaiCustomResponseFormat as string))
    && (value.openaiApiKeyHeader === undefined || isBoundedString(value.openaiApiKeyHeader, 256))
    && (value.openaiApiKeyPrefix === undefined || isBoundedString(value.openaiApiKeyPrefix, 256))
    && (value.openaiOrganizationHeader === undefined || isBoundedString(value.openaiOrganizationHeader, 256))
    && (value.openaiOrganization === undefined || isBoundedString(value.openaiOrganization, 512))
    && (value.openaiProjectHeader === undefined || isBoundedString(value.openaiProjectHeader, 256))
    && (value.openaiProject === undefined || isBoundedString(value.openaiProject, 512))
    && (value.openaiProxy === undefined || isBoundedString(value.openaiProxy, 4096))
    && (value.openaiNoProxy === undefined || isBoundedString(value.openaiNoProxy, 4096))
    && (value.openaiTlsRejectUnauthorized === undefined || typeof value.openaiTlsRejectUnauthorized === 'boolean')
    && (value.openaiTlsCaFile === undefined || isBoundedString(value.openaiTlsCaFile, 4096))
    && (value.openaiTlsCertFile === undefined || isBoundedString(value.openaiTlsCertFile, 4096))
    && (value.openaiTlsKeyFile === undefined || isBoundedString(value.openaiTlsKeyFile, 4096))
    && (value.workspaceOnly === undefined || typeof value.workspaceOnly === 'boolean')
    && (value.toolAllowlist === undefined || (Array.isArray(value.toolAllowlist) && value.toolAllowlist.length <= 100 && value.toolAllowlist.every(item => isBoundedString(item, 256))))
    && (value.toolAsklist === undefined || (Array.isArray(value.toolAsklist) && value.toolAsklist.length <= 100 && value.toolAsklist.every(item => isBoundedString(item, 256))))
    && (value.toolDenylist === undefined || (Array.isArray(value.toolDenylist) && value.toolDenylist.length <= 100 && value.toolDenylist.every(item => isBoundedString(item, 256))))
    && (value.terminalEnvironmentAllowlist === undefined || (Array.isArray(value.terminalEnvironmentAllowlist) && value.terminalEnvironmentAllowlist.length <= 100 && value.terminalEnvironmentAllowlist.every(item => isBoundedString(item, 256))))
    && (value.terminalEnvironmentAsklist === undefined || (Array.isArray(value.terminalEnvironmentAsklist) && value.terminalEnvironmentAsklist.length <= 100 && value.terminalEnvironmentAsklist.every(item => isBoundedString(item, 256))))
  )
}

export function decodeGhostWebviewMessage(value: unknown): GhostWebviewMessage | undefined {
  const migrated = migrateGhostWebviewMessage(value)
  return isGhostWebviewMessage(migrated) ? migrated : undefined
}

export function isGhostWebviewMessage(value: unknown): value is GhostWebviewMessage {
  if (!isRecord(value)) {
    return false
  }
  try {
    if (JSON.stringify(value).length > MAX_GHOST_WEBVIEW_MESSAGE_BYTES) {
      return false
    }
  } catch {
    return false
  }
  if (!isRecord(value) || value.source !== 'ghost-webview' || !GHOST_SUPPORTED_PROTOCOL_VERSIONS.includes(value.version as GhostProtocolVersion) || !isNonEmptyString(value.type)) {
    return false
  }

  if (value.supportedVersions !== undefined && (!Array.isArray(value.supportedVersions) || value.supportedVersions.length === 0 || value.supportedVersions.length > GHOST_SUPPORTED_PROTOCOL_VERSIONS.length || !value.supportedVersions.every(version => typeof version === 'number' && GHOST_SUPPORTED_PROTOCOL_VERSIONS.includes(version as GhostProtocolVersion)))) {
    return false
  }

  if (['ready', 'reset', 'clear', 'import', 'check-status', 'test-provider', 'set-provider-api-key', 'complete-first-run', 'load-controls', 'refresh-models', 'pick-file'].includes(value.type)) {
    return true
  }
  if (value.type === 'export') {
    return value.state === undefined || isPersistedState(value.state)
  }
  if (value.type === 'persist-state') {
    return isPersistedState(value.state)
  }
  if (!isRequestEnvelope(value)) {
    return false
  }
  if (value.type === 'submit') {
    return (
      isNonEmptyString(value.prompt) && value.prompt.length <= 20000 &&
      isOptions(value.options) &&
      (value.attachments === undefined || (Array.isArray(value.attachments) && value.attachments.length <= 8 && value.attachments.every(isAttachment)))
    )
  }
  if (value.type === 'cancel' || value.type === 'disable-auto-accept' || value.type === 'retry' || value.type === 'regenerate' || value.type === 'approve-all-files') {
    return value.type === 'cancel' || isNonEmptyString(value.messageId)
  }
  if (value.type === 'retry-tool') {
    return isBoundedString(value.toolCallId, 256) && value.toolCallId.trim().length > 0 &&
      ['ghost_read_file', 'ghost_search_workspace', 'ghost_get_diagnostics', 'ghost_git_context', 'ghost_update_task_plan', 'ghost_record_completion', 'ghost_write_file', 'ghost_apply_edit', 'ghost_apply_transaction', 'ghost_run_terminal_command', 'ghost_list_directory'].includes(value.tool as string) &&
      isRecord(value.arguments)
  }
  if (value.type === 'continue') {
    const resume = value.resume
    if (!isRecord(resume) || !isNonEmptyString(resume.prompt) || resume.prompt.length > 20000 || !Array.isArray(resume.filePaths) || resume.filePaths.length > 12 || !resume.filePaths.every(item => isBoundedString(item, 4096) && item.trim().length > 0)) {
      return false
    }
    if (!isOptions(value.options)) return false
    if (resume.remainingPlan !== undefined && (!isRecord(resume.remainingPlan) || !Array.isArray(resume.remainingPlan.steps) || resume.remainingPlan.steps.length > 50)) {
      return false
    }
    if (resume.lastFailure !== undefined && (!isRecord(resume.lastFailure) || !isBoundedString(resume.lastFailure.tool, 256) || resume.lastFailure.tool.trim().length === 0 || (resume.lastFailure.result !== undefined && !isBoundedString(resume.lastFailure.result, 16000)) || (resume.lastFailure.arguments !== undefined && !isRecord(resume.lastFailure.arguments)))) {
      return false
    }
    return true
  }
  if (value.type === 'approve-tool') {
    return isBoundedString(value.toolCallId, 256) && value.toolCallId.trim().length > 0 && ['once', 'file', 'request', 'session', 'workspace', 'always'].includes(value.decision as string) && (value.selectedHunkIndexes === undefined || (Array.isArray(value.selectedHunkIndexes) && value.selectedHunkIndexes.length <= 1000 && value.selectedHunkIndexes.every(index => Number.isInteger(index) && index >= 0)))
  }
  if (value.type === 'reject-tool' || value.type === 'cancel-tool') {
    return isBoundedString(value.toolCallId, 256) && value.toolCallId.trim().length > 0
  }
  if (value.type === 'edit-tool') {
    return isBoundedString(value.toolCallId, 256) && value.toolCallId.trim().length > 0 && isRecord(value.arguments)
  }
  if (value.type === 'restore-tool') {
    return isNonEmptyString(value.toolCallId)
  }
  if (value.type === 'open-file') {
    const line = value.line
    return isBoundedString(value.path, 4096) && value.path.trim().length > 0 && (line === undefined || (typeof line === 'number' && Number.isInteger(line) && line >= 1))
  }
  if (value.type === 'edit') {
    return isBoundedString(value.messageId, 256) && value.messageId.trim().length > 0 && isBoundedString(value.prompt, 20000)
  }
  if (value.type === 'attach') {
    return Array.isArray(value.attachments) && value.attachments.length <= 8 && value.attachments.every(isAttachment)
  }
  if (value.type === 'remove-context') {
    return ['workspace', 'folders', 'activeFile', 'selection', 'openFiles', 'tools'].includes(value.contextKey as string)
  }
  if (value.type === 'select-model') {
    return isBoundedString(value.model, 512) && value.model.trim().length > 0
  }
  if (value.type === 'update-settings') {
    return isSettingsUpdate(value.settings)
  }
  return false
}
