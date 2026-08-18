export type GhostRequestStatus =
  | 'idle'
  | 'preparing'
  | 'connecting'
  | 'thinking'
  | 'streaming'
  | 'waiting-for-approval'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type GhostStopReason =
  | 'failed-tool'
  | 'invalid-model-response'
  | 'cancelled'
  | 'timeout'
  | 'approval-rejected'
  | 'context-limit'
  | 'budget-limit'
  | 'provider-failure'

export type GhostProgressPhase = 'context' | 'provider' | 'thinking' | 'streaming' | 'tool' | 'complete' | 'error'

export type GhostMessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface GhostTextPart {
  kind: 'text'
  text: string
}

export interface GhostProgressPart {
  kind: 'reasoning' | 'progress'
  text: string
  phase?: GhostProgressPhase
  elapsedMs?: number
  tokenCount?: number
  tokensPerSecond?: number
  model?: string
}

export interface GhostToolCall {
  id: string
  round: number
  name: string
  arguments?: string
  requiresApproval?: boolean
  approval?: 'pending' | 'approved' | 'rejected'
  diffPreview?: { path: string; before: string; after: string; truncated?: boolean }
  status: 'requested' | 'running' | 'completed' | 'rejected' | 'failed'
  result?: string
  startedAt: number
  completedAt?: number
}

export interface GhostToolPart {
  kind: 'tool'
  toolCall: GhostToolCall
}

export interface GhostErrorPart {
  kind: 'error'
  message: string
  recoverable?: boolean
}

export interface GhostWarningPart {
  kind: 'warning'
  message: string
}

export type GhostMessagePart =
  | GhostTextPart
  | GhostProgressPart
  | GhostToolPart
  | GhostErrorPart
  | GhostWarningPart

export interface GhostAttachmentState {
  id: string
  name: string
  path?: string
  mimeType?: string
  size?: number
}

export interface GhostMessage {
  id: string
  role: GhostMessageRole
  parts: GhostMessagePart[]
  requestId?: string
  status?: GhostRequestStatus
  stopReason?: GhostStopReason
  createdAt: number
  updatedAt: number
}

export interface GhostConversation {
  id: string
  title: string
  messages: GhostMessage[]
  draft: string
  promptHistory: string[]
  activeRequestId?: string
  createdAt: number
  updatedAt: number
}

export interface GhostModelMetadata {
  id: string
  label: string
  provider: string
  contextWindow?: number
  outputLimit?: number
  nativeApi?: string
  supportsTools?: boolean
  supportsJsonMode?: boolean
  supportsVision?: boolean
  supportsFIM?: boolean
  supportsStreaming?: boolean
  supportsSampling?: {
    temperature: boolean
    topP: boolean
    topK: boolean
    minP: boolean
    presencePenalty: boolean
    repeatPenalty: boolean
  }
  capabilities?: string[]
}

export interface GhostConversationState {
  schemaVersion: number
  conversations: GhostConversation[]
  activeConversationId: string
  promptHistory?: string[]
  presets?: unknown[]
  showReasoning?: boolean
  preferences?: Record<string, unknown>
}
