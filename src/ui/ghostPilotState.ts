export type GhostPilotRequestStatus =
  | 'idle'
  | 'preparing'
  | 'connecting'
  | 'thinking'
  | 'streaming'
  | 'waiting-for-approval'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type GhostPilotProgressPhase = 'context' | 'provider' | 'thinking' | 'streaming' | 'tool' | 'complete' | 'error'

export type GhostPilotMessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface GhostPilotTextPart {
  kind: 'text'
  text: string
}

export interface GhostPilotProgressPart {
  kind: 'reasoning' | 'progress'
  text: string
  phase?: GhostPilotProgressPhase
  elapsedMs?: number
  tokenCount?: number
  tokensPerSecond?: number
  model?: string
}

export interface GhostPilotToolCall {
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

export interface GhostPilotToolPart {
  kind: 'tool'
  toolCall: GhostPilotToolCall
}

export interface GhostPilotErrorPart {
  kind: 'error'
  message: string
  recoverable?: boolean
}

export interface GhostPilotWarningPart {
  kind: 'warning'
  message: string
}

export type GhostPilotMessagePart =
  | GhostPilotTextPart
  | GhostPilotProgressPart
  | GhostPilotToolPart
  | GhostPilotErrorPart
  | GhostPilotWarningPart

export interface GhostPilotAttachmentState {
  id: string
  name: string
  path?: string
  mimeType?: string
  size?: number
}

export interface GhostPilotMessage {
  id: string
  role: GhostPilotMessageRole
  parts: GhostPilotMessagePart[]
  requestId?: string
  status?: GhostPilotRequestStatus
  createdAt: number
  updatedAt: number
}

export interface GhostPilotConversation {
  id: string
  title: string
  messages: GhostPilotMessage[]
  draft: string
  activeRequestId?: string
  createdAt: number
  updatedAt: number
}

export interface GhostPilotModelMetadata {
  id: string
  label: string
  provider: string
  contextWindow?: number
  capabilities?: string[]
}

export interface GhostPilotConversationState {
  schemaVersion: number
  conversations: GhostPilotConversation[]
  activeConversationId: string
  promptHistory?: string[]
  presets?: unknown[]
  showReasoning?: boolean
  preferences?: Record<string, unknown>
}
