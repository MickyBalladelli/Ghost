import type { GhostPilotProgressPhase, GhostPilotRequestStatus } from './ghostPilotState'

export const GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION = 1 as const

export type GhostPilotViewStatus = 'ready' | 'offline'
export type GhostPilotProvider = 'ollama' | 'mlx-vlm' | 'openai-compatible'
export type GhostPilotMode = 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
export type GhostPilotResponseLength = 'short' | 'balanced' | 'long' | 'unlimited'
export type GhostPilotContextKey = 'workspace' | 'folders' | 'activeFile' | 'selection' | 'openFiles' | 'tools'
export type { GhostPilotRequestStatus }
export type { GhostPilotProgressPhase }

export type GhostPilotToolApprovalDecision = 'once' | 'session' | 'reject'

export interface GhostPilotToolArguments {
  [key: string]: unknown
}

export interface GhostPilotToolDiffPreview {
  path: string
  before: string
  after: string
  truncated?: boolean
}

export interface GhostPilotAttachment {
  name: string
  path?: string
  content?: string
  mimeType?: string
}

export interface GhostPilotWebviewRequestOptions {
  model?: string
  temperature?: number
  maxContextTokens?: number
  maxTokens?: number
  mode?: GhostPilotMode
  context?: Partial<Record<GhostPilotContextKey, boolean>>
  showReasoning?: boolean
}

export interface GhostPilotSettingsUpdate {
  provider?: GhostPilotProvider
  chatModel?: string
  autocompleteModel?: string
  maxContextTokens?: number
  temperature?: number
  responseLength?: GhostPilotResponseLength
  mode?: GhostPilotMode
}

interface GhostPilotWebviewEnvelope {
  source: 'ghostpilot-webview'
  version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
}

interface GhostPilotRequestEnvelope extends GhostPilotWebviewEnvelope {
  requestId: string
  conversationId: string
}

export type GhostPilotWebviewMessage =
  | (GhostPilotWebviewEnvelope & { type: 'ready' })
  | (GhostPilotWebviewEnvelope & { type: 'reset' | 'clear' | 'export' | 'check-status' })
  | (GhostPilotRequestEnvelope & {
      type: 'submit'
      prompt: string
      options?: GhostPilotWebviewRequestOptions
      attachments?: GhostPilotAttachment[]
    })
  | (GhostPilotRequestEnvelope & { type: 'cancel' })
  | (GhostPilotRequestEnvelope & { type: 'approve-tool'; toolCallId: string; decision: Exclude<GhostPilotToolApprovalDecision, 'reject'> })
  | (GhostPilotRequestEnvelope & { type: 'reject-tool' | 'cancel-tool'; toolCallId: string })
  | (GhostPilotRequestEnvelope & { type: 'edit-tool'; toolCallId: string; arguments: GhostPilotToolArguments })
  | (GhostPilotRequestEnvelope & { type: 'retry' | 'regenerate'; messageId: string })
  | (GhostPilotRequestEnvelope & { type: 'edit'; messageId: string; prompt: string })
  | (GhostPilotRequestEnvelope & { type: 'attach'; attachments: GhostPilotAttachment[] })
  | (GhostPilotRequestEnvelope & { type: 'remove-context'; contextKey: GhostPilotContextKey })
  | (GhostPilotRequestEnvelope & { type: 'select-model'; model: string })
  | (GhostPilotWebviewEnvelope & { type: 'load-controls' | 'refresh-models' | 'pick-file' })
  | (GhostPilotRequestEnvelope & { type: 'update-settings'; settings: GhostPilotSettingsUpdate })

interface GhostPilotExtensionEnvelope {
  source: 'ghostpilot-extension'
  version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
}

export type GhostPilotStreamEvent =
  | (GhostPilotExtensionEnvelope & GhostPilotRequestEnvelopeBase & { type: 'request-started'; sequence: number })
  | (GhostPilotExtensionEnvelope & GhostPilotRequestEnvelopeBase & { type: 'thinking'; sequence: number; detail: string })
  | (GhostPilotExtensionEnvelope & GhostPilotRequestEnvelopeBase & { type: 'text-delta' | 'code-delta'; sequence: number; delta: string })
  | (GhostPilotExtensionEnvelope & GhostPilotRequestEnvelopeBase & { type: 'tool-requested'; sequence: number; tool: string; toolCallId: string; arguments?: GhostPilotToolArguments; requiresApproval: boolean; diffPreview?: GhostPilotToolDiffPreview; detail?: string })
  | (GhostPilotExtensionEnvelope & GhostPilotRequestEnvelopeBase & { type: 'tool-result'; sequence: number; tool: string; toolCallId: string; detail: string })
  | (GhostPilotExtensionEnvelope & GhostPilotRequestEnvelopeBase & { type: 'warning'; sequence: number; message: string })
  | (GhostPilotExtensionEnvelope & GhostPilotRequestEnvelopeBase & { type: 'error'; sequence: number; message: string })
  | (GhostPilotExtensionEnvelope & GhostPilotRequestEnvelopeBase & { type: 'request-completed'; sequence: number; status: 'completed' | 'cancelled' | 'failed' })

interface GhostPilotRequestEnvelopeBase {
  requestId: string
  conversationId: string
  state?: GhostPilotRequestStatus
  phase?: GhostPilotProgressPhase
  elapsedMs?: number
  model?: string
  tokenCount?: number
  tokensPerSecond?: number
  startedAt?: number
}

export type GhostPilotExtensionMessage =
  | (GhostPilotExtensionEnvelope & { type: 'state'; status: GhostPilotViewStatus; detail: string })
  | (GhostPilotExtensionEnvelope & { type: 'reset' | 'clear' })
  | (GhostPilotExtensionEnvelope & {
      type: 'controls-state'
      settings: {
        provider: GhostPilotProvider
        chatModel: string
        autocompleteModel: string
        maxContextTokens: number
        temperature: number
        responseLength: GhostPilotResponseLength
        mode: GhostPilotMode
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
  | (GhostPilotExtensionEnvelope & { type: 'file-picked'; attachments: GhostPilotAttachment[] })
  | GhostPilotStreamEvent

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
)

const isRequestEnvelope = (message: Record<string, unknown>): boolean => (
  isNonEmptyString(message.requestId) && isNonEmptyString(message.conversationId)
)

const isAttachment = (value: unknown): value is GhostPilotAttachment => {
  if (!isRecord(value) || !isNonEmptyString(value.name)) {
    return false
  }
  return (
    (value.path === undefined || isNonEmptyString(value.path)) &&
    (value.content === undefined || typeof value.content === 'string') &&
    (value.mimeType === undefined || typeof value.mimeType === 'string')
  )
}

const isOptions = (value: unknown): value is GhostPilotWebviewRequestOptions => {
  if (value === undefined) {
    return true
  }
  if (!isRecord(value)) {
    return false
  }
  if (
    (value.model !== undefined && typeof value.model !== 'string') ||
    (value.temperature !== undefined && typeof value.temperature !== 'number') ||
    (value.maxContextTokens !== undefined && typeof value.maxContextTokens !== 'number') ||
    (value.maxTokens !== undefined && typeof value.maxTokens !== 'number') ||
    (value.showReasoning !== undefined && typeof value.showReasoning !== 'boolean') ||
    (value.mode !== undefined && !['ask', 'edit', 'agent', 'explain', 'inline'].includes(value.mode as string))
  ) {
    return false
  }
  return value.context === undefined || isRecord(value.context)
}

const isSettingsUpdate = (value: unknown): value is GhostPilotSettingsUpdate => {
  if (!isRecord(value)) {
    return false
  }
  return (
    (value.provider === undefined || ['ollama', 'mlx-vlm', 'openai-compatible'].includes(value.provider as string)) &&
    (value.chatModel === undefined || typeof value.chatModel === 'string') &&
    (value.autocompleteModel === undefined || typeof value.autocompleteModel === 'string') &&
    (value.maxContextTokens === undefined || typeof value.maxContextTokens === 'number') &&
    (value.temperature === undefined || typeof value.temperature === 'number') &&
    (value.responseLength === undefined || ['short', 'balanced', 'long', 'unlimited'].includes(value.responseLength as string)) &&
    (value.mode === undefined || ['ask', 'edit', 'agent', 'explain', 'inline'].includes(value.mode as string))
  )
}

export function isGhostPilotWebviewMessage(value: unknown): value is GhostPilotWebviewMessage {
  if (!isRecord(value) || value.source !== 'ghostpilot-webview' || value.version !== GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION || !isNonEmptyString(value.type)) {
    return false
  }

  if (['ready', 'reset', 'clear', 'export', 'check-status', 'load-controls', 'refresh-models', 'pick-file'].includes(value.type)) {
    return true
  }
  if (!isRequestEnvelope(value)) {
    return false
  }
  if (value.type === 'submit') {
    return (
      isNonEmptyString(value.prompt) &&
      isOptions(value.options) &&
      (value.attachments === undefined || (Array.isArray(value.attachments) && value.attachments.length <= 8 && value.attachments.every(isAttachment)))
    )
  }
  if (value.type === 'cancel' || value.type === 'retry' || value.type === 'regenerate') {
    return value.type === 'cancel' || isNonEmptyString(value.messageId)
  }
  if (value.type === 'approve-tool') {
    return isNonEmptyString(value.toolCallId) && (value.decision === 'once' || value.decision === 'session')
  }
  if (value.type === 'reject-tool' || value.type === 'cancel-tool') {
    return isNonEmptyString(value.toolCallId)
  }
  if (value.type === 'edit-tool') {
    return isNonEmptyString(value.toolCallId) && isRecord(value.arguments)
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
