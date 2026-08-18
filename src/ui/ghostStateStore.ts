import * as vscode from 'vscode'

import type { GhostToolApproval } from '../agent/chatParticipant'
import type { LocalToolCall } from '../agent/toolCallParser'
import type { GhostProvider, GhostSettings } from '../config'
import type { CompletionRecord } from '../agent/completionRecord'
import type {
  GhostPersistedState,
  GhostRequestEvent,
  GhostViewStatus
} from './ghostProtocol'
import type { ProviderStatus, ProviderStatusCache } from './ghostProviderState'
import type { GhostRequestStatus, GhostStopReason } from './ghostState'
import { GhostRequestOrchestrator } from './ghostRequestOrchestrator'
import type { WorkspaceFileSnapshot } from '../tools/workspaceFile'
import type { GhostStorage } from '../runtimeDependencies'

export type GhostStateEventType = 'settings' | 'conversation' | 'request' | 'approval' | 'provider' | 'persistence' | 'status'

export interface GhostStateEvent {
  type: GhostStateEventType
}

export interface RequestTiming {
  providerStartedAt?: number
  firstTokenAt?: number
  toolStartedAt: Map<string, number>
  toolExecutionMs: number
  approvalStartedAt: Map<string, number>
  approvalWaitMs: number
  verificationStartedAt?: number
  verificationMs: number
}

export const createRequestTiming = (): RequestTiming => ({
  toolStartedAt: new Map(),
  toolExecutionMs: 0,
  approvalStartedAt: new Map(),
  approvalWaitMs: 0,
  verificationMs: 0
})

export interface GhostRequestState {
  cancellation: vscode.CancellationTokenSource
  conversationId: string
  sequence: number
  codeMode: boolean
  status: GhostRequestStatus
  attempt: number
  startedAt: number
  lastActivityAt: number
  timedOut: boolean
  stopReason?: GhostStopReason
  stopMessage?: string
  model: string
  provider?: GhostProvider
  outputTokens: number
  eventLog: GhostRequestEvent[]
  completionRecord?: CompletionRecord
  autoAcceptFilePath?: string
  approvedFilePaths?: Set<string>
  approveAllFileEdits?: boolean
  autoAcceptDisabled?: boolean
  pendingTool?: { toolCallId: string; name: string }
  timing: RequestTiming
}

export interface PendingToolApproval {
  requestId: string
  conversationId: string
  toolCallId: string
  call: LocalToolCall
  expectedContent?: string
  expectedFileExists?: boolean
  expectedFiles?: Record<string, WorkspaceFileSnapshot>
  resolve: (approval: GhostToolApproval) => void
}

export interface RecoveryRecord {
  requestId: string
  conversationId: string
  toolCallId: string
  files: Array<{ path: string; before: WorkspaceFileSnapshot; after: WorkspaceFileSnapshot }>
  applied: boolean
}

export interface FailedToolRetry {
  requestId: string
  conversationId: string
  call: LocalToolCall
}

export interface StagedEdit {
  requestId: string
  conversationId: string
  toolCallId: string
  call: LocalToolCall
  uri: vscode.Uri
  before: string
  after: string
}

export interface WorkspaceContextSnapshot {
  workspaceName: string
  folders: string[]
  activeFile?: { name: string; path: string; languageId: string; hasSelection: boolean }
  openFiles: string[]
}

export class GhostStateStore {
  readonly requestOrchestrator = new GhostRequestOrchestrator<GhostRequestState>()
  readonly pendingApprovals = new Map<string, PendingToolApproval>()
  readonly stagedEdits = new Map<string, StagedEdit>()
  readonly recoveryRecords = new Map<string, RecoveryRecord>()
  readonly failedToolRetries = new Map<string, FailedToolRetry>()
  readonly sessionApprovedTools = new Set<string>()
  readonly globalState?: GhostStorage
  readonly workspaceState?: GhostStorage

  sessionApprovedFileEdits = false
  workspaceApprovedFileEdits = false
  private _status: GhostViewStatus = 'ready'
  controlsStateGeneration = 0
  providerStatusCache?: ProviderStatusCache
  providerStatusRequest?: { key: string; promise: Promise<ProviderStatus> }
  workspaceContextCache?: WorkspaceContextSnapshot
  persistedGlobalSnapshot?: string
  persistedWorkspaceSnapshot?: string
  conversationState?: GhostPersistedState
  settings: GhostSettings
  private readonly listeners = new Set<(event: GhostStateEvent) => void>()

  constructor(options: {
    settings: GhostSettings
    globalState?: GhostStorage
    workspaceState?: GhostStorage
  }) {
    this.settings = options.settings
    this.globalState = options.globalState
    this.workspaceState = options.workspaceState
    this.workspaceApprovedFileEdits = options.workspaceState?.get<boolean>('ghost.workspace.approvedFileEdits') === true
  }

  updateSettings(settings: GhostSettings): void {
    this.settings = settings
    this.emit({ type: 'settings' })
  }

  get status(): GhostViewStatus {
    return this._status
  }

  set status(value: GhostViewStatus) {
    this._status = value
    this.emit({ type: 'status' })
  }

  subscribe(listener: (event: GhostStateEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notify(type: GhostStateEventType): void {
    this.emit({ type })
  }

  setConversationState(state: GhostPersistedState): void {
    this.conversationState = state
    this.emit({ type: 'conversation' })
  }

  clearTransientState(): void {
    this.pendingApprovals.clear()
    this.stagedEdits.clear()
    this.recoveryRecords.clear()
    this.failedToolRetries.clear()
    this.sessionApprovedTools.clear()
    this.sessionApprovedFileEdits = false
    this.emit({ type: 'approval' })
  }

  private emit(event: GhostStateEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}
