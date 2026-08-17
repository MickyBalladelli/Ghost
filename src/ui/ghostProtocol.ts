import type { GhostProgressPhase, GhostRequestStatus, GhostStopReason } from './ghostState'

export const GHOST_WEBVIEW_PROTOCOL_VERSION = 1 as const
export const GHOST_PERSISTENCE_SCHEMA_VERSION = 2 as const

export type GhostViewStatus = 'ready' | 'offline'
export type GhostProvider = 'ollama' | 'mlx-vlm' | 'openai-compatible'
export type GhostMode = 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
export type GhostResponseLength = 'short' | 'balanced' | 'long' | 'unlimited'
export type GhostContextKey = 'workspace' | 'folders' | 'activeFile' | 'selection' | 'openFiles' | 'tools'
export type { GhostRequestStatus }
export type { GhostProgressPhase }
export type { GhostStopReason }

export type GhostToolApprovalDecision = 'once' | 'session' | 'reject'

export interface GhostToolArguments {
  [key: string]: unknown
}

export interface GhostToolDiffPreview {
  path: string
  before: string
  after: string
  truncated?: boolean
  hunks?: Array<{ startLine: number; endLine: number; replacement: string }>
}

export interface GhostAttachment {
  name: string
  path?: string
  content?: string
  mimeType?: string
}

export interface GhostWebviewRequestOptions {
  provider?: GhostProvider
  model?: string
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
}

export interface GhostSettingsUpdate {
  provider?: GhostProvider
  chatModel?: string
  autocompleteModel?: string
  maxContextTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  repeatPenalty?: number
  responseLength?: GhostResponseLength
  mode?: GhostMode
  fileEditApproval?: 'confirm' | 'auto'
  enableConversationPersistence?: boolean
  enableDebugLogging?: boolean
  ollamaUrl?: string
  mlxUrl?: string
  openaiUrl?: string
  workspaceOnly?: boolean
  toolAllowlist?: string[]
  toolDenylist?: string[]
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
  version: typeof GHOST_WEBVIEW_PROTOCOL_VERSION
}

interface GhostRequestEnvelope extends GhostWebviewEnvelope {
  requestId: string
  conversationId: string
}

export type GhostWebviewMessage =
  | (GhostWebviewEnvelope & { type: 'ready' })
  | (GhostWebviewEnvelope & { type: 'reset' | 'clear' | 'import' | 'check-status' | 'test-provider' })
  | (GhostWebviewEnvelope & { type: 'export'; state?: GhostPersistedState })
  | (GhostWebviewEnvelope & { type: 'persist-state'; state: GhostPersistedState })
  | (GhostRequestEnvelope & {
      type: 'submit'
      prompt: string
      options?: GhostWebviewRequestOptions
      attachments?: GhostAttachment[]
    })
  | (GhostRequestEnvelope & { type: 'cancel' })
  | (GhostRequestEnvelope & { type: 'retry-tool'; toolCallId: string; tool: string; arguments: GhostToolArguments })
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
  version: typeof GHOST_WEBVIEW_PROTOCOL_VERSION
}

export type GhostStreamEvent =
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'request-started'; sequence: number })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'thinking'; sequence: number; detail: string })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'text-delta' | 'code-delta'; sequence: number; delta: string })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'tool-requested'; sequence: number; tool: string; toolCallId: string; arguments?: GhostToolArguments; requiresApproval: boolean; diffPreview?: GhostToolDiffPreview; detail?: string })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'tool-result'; sequence: number; tool: string; toolCallId: string; detail: string; resultStatus?: 'completed' | 'rejected' | 'failed' })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'warning'; sequence: number; message: string })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'error'; sequence: number; message: string; stopReason?: GhostStopReason })
  | (GhostExtensionEnvelope & GhostRequestEnvelopeBase & { type: 'request-completed'; sequence: number; status: 'completed' | 'cancelled' | 'failed'; stopReason?: GhostStopReason; message?: string })

interface GhostRequestEnvelopeBase {
  requestId: string
  conversationId: string
  state?: GhostRequestStatus
  phase?: GhostProgressPhase
  elapsedMs?: number
  model?: string
  tokenCount?: number
  tokensPerSecond?: number
  startedAt?: number
}

export type GhostExtensionMessage =
  | (GhostExtensionEnvelope & { type: 'state'; status: GhostViewStatus; detail: string })
  | (GhostExtensionEnvelope & { type: 'reset' | 'clear' })
  | (GhostExtensionEnvelope & { type: 'persisted-state'; state: GhostPersistedState })
  | (GhostExtensionEnvelope & {
      type: 'controls-state'
      settings: {
        provider: GhostProvider
        chatModel: string
        autocompleteModel: string
        maxContextTokens: number
        temperature: number
        topP: number
        topK: number
        minP: number
        presencePenalty: number
        repeatPenalty: number
        responseLength: GhostResponseLength
        mode: GhostMode
        fileEditApproval: 'confirm' | 'auto'
        enableConversationPersistence: boolean
        ollamaUrl: string
        mlxUrl: string
        openaiUrl: string
        toolAllowlist: string[]
        toolDenylist: string[]
        enableDebugLogging: boolean
        networkAccess: 'local' | 'external'
      }
      models: string[]
      connection: 'online' | 'offline' | 'unknown'
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

const isPersistedState = (value: unknown): value is GhostPersistedState => (
  isRecord(value) &&
  (value.schemaVersion === 1 || value.schemaVersion === GHOST_PERSISTENCE_SCHEMA_VERSION) &&
  (value.conversations === undefined || Array.isArray(value.conversations)) &&
  (value.activeConversationId === undefined || typeof value.activeConversationId === 'string') &&
  (value.promptHistory === undefined || (Array.isArray(value.promptHistory) && value.promptHistory.every(item => typeof item === 'string'))) &&
  (value.presets === undefined || Array.isArray(value.presets)) &&
  (value.showReasoning === undefined || typeof value.showReasoning === 'boolean') &&
  (value.preferences === undefined || isRecord(value.preferences))
)

const isRequestEnvelope = (message: Record<string, unknown>): boolean => (
  isNonEmptyString(message.requestId) && isNonEmptyString(message.conversationId)
)

const isAttachment = (value: unknown): value is GhostAttachment => {
  if (!isRecord(value) || !isNonEmptyString(value.name)) {
    return false
  }
  return (
    (value.path === undefined || isNonEmptyString(value.path)) &&
    (value.content === undefined || (typeof value.content === 'string' && value.content.length <= 1024 * 1024)) &&
    (value.mimeType === undefined || typeof value.mimeType === 'string')
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
    (value.provider !== undefined && !['ollama', 'mlx-vlm', 'openai-compatible'].includes(value.provider as string)) ||
    (value.model !== undefined && typeof value.model !== 'string') ||
    (value.temperature !== undefined && typeof value.temperature !== 'number') ||
    (value.topP !== undefined && typeof value.topP !== 'number') ||
    (value.topK !== undefined && typeof value.topK !== 'number') ||
    (value.minP !== undefined && typeof value.minP !== 'number') ||
    (value.presencePenalty !== undefined && typeof value.presencePenalty !== 'number') ||
    (value.repeatPenalty !== undefined && typeof value.repeatPenalty !== 'number') ||
    (value.maxContextTokens !== undefined && typeof value.maxContextTokens !== 'number') ||
    (value.maxTokens !== undefined && typeof value.maxTokens !== 'number') ||
    (value.showReasoning !== undefined && typeof value.showReasoning !== 'boolean') ||
    (value.customSystemInstructions !== undefined && typeof value.customSystemInstructions !== 'string') ||
    (value.mode !== undefined && !['ask', 'edit', 'agent', 'explain', 'inline'].includes(value.mode as string))
  ) {
    return false
  }
  return value.context === undefined || isRecord(value.context)
}

const isSettingsUpdate = (value: unknown): value is GhostSettingsUpdate => {
  if (!isRecord(value)) {
    return false
  }
  return (
    (value.provider === undefined || ['ollama', 'mlx-vlm', 'openai-compatible'].includes(value.provider as string)) &&
    (value.chatModel === undefined || typeof value.chatModel === 'string') &&
    (value.autocompleteModel === undefined || typeof value.autocompleteModel === 'string') &&
    (value.maxContextTokens === undefined || typeof value.maxContextTokens === 'number') &&
    (value.temperature === undefined || typeof value.temperature === 'number') &&
    (value.topP === undefined || typeof value.topP === 'number') &&
    (value.topK === undefined || typeof value.topK === 'number') &&
    (value.minP === undefined || typeof value.minP === 'number') &&
    (value.presencePenalty === undefined || typeof value.presencePenalty === 'number') &&
    (value.repeatPenalty === undefined || typeof value.repeatPenalty === 'number') &&
    (value.responseLength === undefined || ['short', 'balanced', 'long', 'unlimited'].includes(value.responseLength as string)) &&
    (value.mode === undefined || ['ask', 'edit', 'agent', 'explain', 'inline'].includes(value.mode as string)) &&
    (value.fileEditApproval === undefined || ['confirm', 'auto'].includes(value.fileEditApproval as string)) &&
    (value.enableConversationPersistence === undefined || typeof value.enableConversationPersistence === 'boolean') &&
    (value.enableDebugLogging === undefined || typeof value.enableDebugLogging === 'boolean') &&
    (value.ollamaUrl === undefined || typeof value.ollamaUrl === 'string')
    && (value.mlxUrl === undefined || typeof value.mlxUrl === 'string')
    && (value.openaiUrl === undefined || typeof value.openaiUrl === 'string')
    && (value.workspaceOnly === undefined || typeof value.workspaceOnly === 'boolean')
    && (value.toolAllowlist === undefined || (Array.isArray(value.toolAllowlist) && value.toolAllowlist.every(item => typeof item === 'string')))
    && (value.toolDenylist === undefined || (Array.isArray(value.toolDenylist) && value.toolDenylist.every(item => typeof item === 'string')))
  )
}

export function isGhostWebviewMessage(value: unknown): value is GhostWebviewMessage {
  if (!isRecord(value) || value.source !== 'ghost-webview' || value.version !== GHOST_WEBVIEW_PROTOCOL_VERSION || !isNonEmptyString(value.type)) {
    return false
  }

  if (['ready', 'reset', 'clear', 'import', 'check-status', 'test-provider', 'load-controls', 'refresh-models', 'pick-file'].includes(value.type)) {
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
  if (value.type === 'cancel' || value.type === 'retry' || value.type === 'regenerate') {
    return value.type === 'cancel' || isNonEmptyString(value.messageId)
  }
  if (value.type === 'retry-tool') {
    return isNonEmptyString(value.toolCallId) &&
      ['ghost_read_file', 'ghost_write_file', 'ghost_apply_edit', 'ghost_apply_transaction', 'ghost_run_terminal_command', 'ghost_list_directory'].includes(value.tool as string) &&
      isRecord(value.arguments)
  }
  if (value.type === 'approve-tool') {
    return isNonEmptyString(value.toolCallId) && (value.decision === 'once' || value.decision === 'session') && (value.selectedHunkIndexes === undefined || (Array.isArray(value.selectedHunkIndexes) && value.selectedHunkIndexes.every(index => Number.isInteger(index) && index >= 0)))
  }
  if (value.type === 'reject-tool' || value.type === 'cancel-tool') {
    return isNonEmptyString(value.toolCallId)
  }
  if (value.type === 'edit-tool') {
    return isNonEmptyString(value.toolCallId) && isRecord(value.arguments)
  }
  if (value.type === 'restore-tool') {
    return isNonEmptyString(value.toolCallId)
  }
  if (value.type === 'open-file') {
    const line = value.line
    return isNonEmptyString(value.path) && (line === undefined || (typeof line === 'number' && Number.isInteger(line) && line >= 1))
  }
  if (value.type === 'edit') {
    return isNonEmptyString(value.messageId) && typeof value.prompt === 'string'
  }
  if (value.type === 'attach') {
    return Array.isArray(value.attachments) && value.attachments.length <= 8 && value.attachments.every(isAttachment)
  }
  if (value.type === 'remove-context') {
    return ['workspace', 'folders', 'activeFile', 'selection', 'openFiles', 'tools'].includes(value.contextKey as string)
  }
  if (value.type === 'select-model') {
    return isNonEmptyString(value.model)
  }
  if (value.type === 'update-settings') {
    return isSettingsUpdate(value.settings)
  }
  return false
}
