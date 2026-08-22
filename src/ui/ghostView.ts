import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'

import { createChatParticipantHandler, GhostProviderPermissionRequest, GhostRequestOptions, GhostToolApproval } from '../agent/chatParticipant'
import { LocalToolExecutor } from '../tools/localToolExecutor'
import { auditTerminalCommand, formatTerminalAudit } from '../tools/terminalTools'
import type { LocalToolCall, LocalToolName } from '../agent/toolCallParser'
import { GHOST_TOOL_NAMES, ghostConfig, getGhostSettings, GhostAutoAcceptScope, GhostLogLevel, GhostProvider, GhostSettings } from '../config'
import { legacyFileEditApprovalMirror } from '../settingsMigrations'
import { MlxClient } from '../services/mlxClient'
import { ChatVisionImage } from '../services/chatTypes'
import { OllamaClient } from '../services/ollamaClient'
import { createProviderAdapter } from '../services/providerAdapter'
import { resolveModelSettings } from '../services/modelProfiles'
import { createProfiledProviderClient } from '../services/profiledProviderClient'
import { OpenCodeClient } from '../services/openCodeClient'
import { resolveOpenAiProfileEndpoint } from '../services/providerProfiles'
import { resolveWorkspacePath } from '../tools/workspacePath'
import { applyGhostEdit, parseGhostEdit } from '../tools/editWorkflow'
import { atomicWriteFile } from '../tools/atomicFile'
import { readWorkspaceFile, sameWorkspaceFile, WorkspaceFileSnapshot } from '../tools/workspaceFile'
import { parseFileTransaction, prepareFileTransaction } from '../tools/transactionWorkflow'
import { isExternalEndpoint, redactSensitiveText, redactSensitiveValue } from '../privacy/redact'
import {
  GHOST_WEBVIEW_PROTOCOL_VERSION,
  GHOST_SUPPORTED_PROTOCOL_VERSIONS,
  GHOST_PERSISTENCE_SCHEMA_VERSION,
  GhostAttachment,
  GhostContinuation,
  GhostExtensionMessage,
  GhostPersistedState,
  GhostSettingsUpdate,
  GhostStreamEvent,
  GhostToolArguments,
  GhostToolDiffPreview,
  GhostViewStatus,
  GhostWebviewRequestOptions,
  decodeGhostWebviewMessage,
  negotiateGhostProtocolVersion
} from './ghostProtocol'
import type { GhostProtocolVersion } from './ghostProtocol'
import type { GhostRequestStatus } from './ghostState'
import { getRequestStatusForEvent } from './requestState'
import { migratePersistedState, normalizePromptHistory } from './persistenceModel'
import { compactPersistedState, isStoredRecord, StoredGlobalState, StoredWorkspaceState } from './ghostPersistence'
import {
  getFileEditPaths,
  isFileEditTool,
  resolveToolPermission
} from './ghostApprovalPolicy'
import { providerStatusKey, toGhostModelMetadata } from './ghostProviderState'
import type { ProviderStatus, ProviderStatusCache } from './ghostProviderState'
import { createGhostExportData, parseGhostImportState } from './ghostImportExport'
import { GhostWebviewLifecycle } from './ghostWebviewLifecycle'
import { getGhostWebviewHtml } from './ghostWebviewHtml'
import {
  createRequestTiming,
  FailedToolRetry,
  GhostRequestState,
  GhostStateStore,
  PendingToolApproval,
  RecoveryRecord,
  StagedEdit,
  WorkspaceContextSnapshot
} from './ghostStateStore'
import { parseTaskPlanMarker } from '../agent/taskPlan'
import { parseCompletionRecordMarker } from '../agent/completionRecord'
import { awaitCancellable } from '../tools/cancellation'
import { GHOST_RETRY_POLICIES, retryDelay } from '../agent/retryPolicy'
import { effectiveGhostLogLevel, writeGhostLog } from '../logging/ghostLogger'
import { GhostError, toGhostError } from '../ghostErrors'
import { GhostClock, GhostStorage, GhostWebviewMessenger, systemClock } from '../runtimeDependencies'
import { ApprovalRaceGuard } from './approvalRaceGuard'

interface NativeChatApprovalState {
  autoAcceptFilePath?: string
  approveAllFileEdits?: boolean
  approvedFilePaths: Set<string>
}

interface PendingProviderPermissionApproval {
  requestId: string
  conversationId: string
  toolCallId: string
  permission: GhostProviderPermissionRequest
  resolve: (approval: GhostToolApproval) => void
}

export class GhostViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'ghost.chat'

  private readonly webviewLifecycle = new GhostWebviewLifecycle()
  private readonly stateStore: GhostStateStore
  private readonly disposables: vscode.Disposable[] = []
  private readonly stagedEditChanges = new vscode.EventEmitter<void>()
  private readonly approvalRaceGuard = new ApprovalRaceGuard()
  private readonly nativeChatApproval = new Map<string, NativeChatApprovalState>()
  private readonly pendingProviderPermissionApprovals = new Map<string, PendingProviderPermissionApproval>()
  private readonly providerApiKey?: (provider: GhostProvider) => string | undefined
  private readonly clock: GhostClock
  private readonly messenger?: GhostWebviewMessenger
  private negotiatedProtocolVersion: GhostProtocolVersion = GHOST_WEBVIEW_PROTOCOL_VERSION
  private static readonly globalStateKey = 'ghost.global.v2'
  private static readonly workspaceStateKey = 'ghost.workspace.v2'
  private static readonly firstRunSetupCompleteKey = 'ghost.global.firstRunSetupComplete'
  private static readonly providerStatusCacheTtlMs = 30_000
  private static readonly providerStatusPollIntervalMs = 2_000
  private providerStatusPollTimer?: ReturnType<typeof setTimeout>
  private providerStatusPollKey?: string

  private readonly chatHandler: vscode.ChatRequestHandler

  private get view(): vscode.WebviewView | undefined { return this.webviewLifecycle.view }
  private set view(value: vscode.WebviewView | undefined) { this.webviewLifecycle.view = value }
  private get pendingMessages(): GhostExtensionMessage[] { return this.webviewLifecycle.pendingMessages }
  private set pendingMessages(value: GhostExtensionMessage[]) { this.webviewLifecycle.pendingMessages = value }
  private get disposed(): boolean { return this.webviewLifecycle.disposed }
  private get requestOrchestrator() { return this.stateStore.requestOrchestrator }
  private get pendingApprovals() { return this.stateStore.pendingApprovals }
  private get stagedEdits() { return this.stateStore.stagedEdits }
  private get recoveryRecords() { return this.stateStore.recoveryRecords }
  private get failedToolRetries() { return this.stateStore.failedToolRetries }
  private get sessionApprovedTools() { return this.stateStore.sessionApprovedTools }
  private get persistentApprovedTools() { return this.stateStore.persistentApprovedTools }
  private get sessionApprovedFileEdits() { return this.stateStore.sessionApprovedFileEdits }
  private set sessionApprovedFileEdits(value: boolean) { this.stateStore.sessionApprovedFileEdits = value }
  private get sessionAutoAcceptActive() { return this.stateStore.sessionAutoAcceptActive }
  private set sessionAutoAcceptActive(value: boolean) { this.stateStore.sessionAutoAcceptActive = value }
  private get oneEditConsumed() { return this.stateStore.oneEditConsumed }
  private set oneEditConsumed(value: boolean) { this.stateStore.oneEditConsumed = value }
  private get persistentApprovedFileEdits() { return this.stateStore.persistentApprovedFileEdits }
  private set persistentApprovedFileEdits(value: boolean) { this.stateStore.persistentApprovedFileEdits = value }
  private get workspaceApprovedFileEdits() { return this.stateStore.workspaceApprovedFileEdits }
  private set workspaceApprovedFileEdits(value: boolean) { this.stateStore.workspaceApprovedFileEdits = value }
  private get globalState() { return this.stateStore.globalState }
  private get workspaceState() { return this.stateStore.workspaceState }
  private get status() { return this.stateStore.status }
  private set status(value: GhostViewStatus) { this.stateStore.status = value }
  private get controlsStateGeneration() { return this.stateStore.controlsStateGeneration }
  private set controlsStateGeneration(value: number) { this.stateStore.controlsStateGeneration = value }
  private get providerStatusCache() { return this.stateStore.providerStatusCache }
  private set providerStatusCache(value: ProviderStatusCache | undefined) { this.stateStore.providerStatusCache = value }
  private get providerStatusRequest() { return this.stateStore.providerStatusRequest }
  private set providerStatusRequest(value: { key: string; promise: Promise<ProviderStatus> } | undefined) { this.stateStore.providerStatusRequest = value }
  private get workspaceContextCache() { return this.stateStore.workspaceContextCache }
  private set workspaceContextCache(value: WorkspaceContextSnapshot | undefined) { this.stateStore.workspaceContextCache = value }
  private get persistedGlobalSnapshot() { return this.stateStore.persistedGlobalSnapshot }
  private set persistedGlobalSnapshot(value: string | undefined) { this.stateStore.persistedGlobalSnapshot = value }
  private get persistedWorkspaceSnapshot() { return this.stateStore.persistedWorkspaceSnapshot }
  private set persistedWorkspaceSnapshot(value: string | undefined) { this.stateStore.persistedWorkspaceSnapshot = value }
  private get settings() { return this.stateStore.settings }
  private get requests(): Map<string, GhostRequestState> { return this.requestOrchestrator.requests }
  private get activeRequestByConversation(): Map<string, string> { return this.requestOrchestrator.activeRequestByConversation }
  private get completedRequests(): Set<string> { return this.requestOrchestrator.completedRequests }

  private log(level: GhostLogLevel, message: string, details?: unknown): void {
    const settings = this.settings
    writeGhostLog(level, effectiveGhostLogLevel(settings.logLevel, settings.enableDebugLogging), message, details)
  }

  private debugLog(message: string, details?: unknown): void {
    this.log('debug', message, details)
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    options: { chatHandler?: vscode.ChatRequestHandler; globalState?: GhostStorage; workspaceState?: GhostStorage; providerApiKey?: (provider: GhostProvider) => string | undefined; clock?: GhostClock; messenger?: GhostWebviewMessenger } = {}
  ) {
    this.stateStore = new GhostStateStore({
      settings: getGhostSettings(),
      globalState: options.globalState,
      workspaceState: options.workspaceState
    })
    this.providerApiKey = options.providerApiKey
    this.clock = options.clock ?? systemClock
    this.messenger = options.messenger
    this.chatHandler = options.chatHandler ?? createChatParticipantHandler()
    this.debugLog('view provider created')
    void this.resetPersistedSessionAutoAccept()
    const invalidateWorkspaceContext = (): void => {
      this.workspaceContextCache = undefined
      void this.sendControlsState()
    }
    this.disposables.push(ghostConfig.onDidChange((settings, event) => {
      this.stateStore.updateSettings(settings)
      const autoAcceptOnly = event.affectsConfiguration('ghost.autoAcceptScope')
        || event.affectsConfiguration('ghost.fileEditApproval')
      if (event.affectsConfiguration('ghost') && !autoAcceptOnly) {
        this.cancelRequests()
      }
      void this.sendControlsState()
    }), this.stagedEditChanges)
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(invalidateWorkspaceContext),
      vscode.window.onDidChangeTextEditorSelection(invalidateWorkspaceContext),
      vscode.window.tabGroups.onDidChangeTabs(invalidateWorkspaceContext),
      vscode.workspace.onDidChangeWorkspaceFolders(invalidateWorkspaceContext)
    )
    this.disposables.push(
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
        onDidChangeCodeLenses: this.stagedEditChanges.event,
        provideCodeLenses: document => [...this.stagedEdits.values()]
          .filter(edit => edit.uri.toString() === document.uri.toString())
          .flatMap(edit => {
            const range = new vscode.Range(0, 0, 0, 0)
            return [
              new vscode.CodeLens(range, {
                title: '$(check) Accept Ghost edit',
                command: 'ghost.acceptEditPreview',
                arguments: [edit.toolCallId]
              }),
              new vscode.CodeLens(range, {
                title: '$(close) Reject Ghost edit',
                command: 'ghost.rejectEditPreview',
                arguments: [edit.toolCallId]
              })
            ]
          })
      }),
      vscode.commands.registerCommand('ghost.acceptEditPreview', (toolCallId: string) => this.acceptStagedEdit(toolCallId)),
      vscode.commands.registerCommand('ghost.rejectEditPreview', (toolCallId: string) => this.rejectStagedEdit(toolCallId))
    )
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.negotiatedProtocolVersion = GHOST_WEBVIEW_PROTOCOL_VERSION
    this.webviewLifecycle.attach(webviewView)
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out'), this.extensionUri]
    }
    webviewView.webview.html = getGhostWebviewHtml(webviewView.webview, this.extensionUri)

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message)),
      webviewView.onDidDispose(() => {
        this.cancelRequests()
        this.webviewLifecycle.detach(webviewView)
      })
    )

    const pendingMessages = this.webviewLifecycle.takePendingMessages()
    for (const message of pendingMessages) {
      this.postMessage(message)
    }
    void this.sendControlsState()
  }

  setStatus(status: GhostViewStatus): void {
    this.status = status
    this.postState()
    void this.sendControlsState()
  }

  openSetup(): void {
    this.postMessage({
      source: 'ghost-extension',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'open-first-run'
    })
  }

  async approveChatTool(call: LocalToolCall, requestKey: string): Promise<GhostToolApproval> {
    let state = this.nativeChatApproval.get(requestKey)
    if (!state) {
      state = { approvedFilePaths: new Set<string>() }
      this.nativeChatApproval.set(requestKey, state)
      while (this.nativeChatApproval.size > 16) {
        const oldest = this.nativeChatApproval.keys().next().value
        if (typeof oldest !== 'string') {
          break
        }
        this.nativeChatApproval.delete(oldest)
      }
    }
    return this.requestToolApproval(requestKey, undefined, call, state)
  }

  async reset(): Promise<void> {
    const confirmation = await vscode.window.showWarningMessage(
      'Delete all Ghost conversation history and preferences?',
      { modal: true, detail: 'This removes saved global and workspace chat data.' },
      'Delete all history'
    )
    if (confirmation !== 'Delete all history') {
      return
    }
    this.cancelRequests()
    await this.clearPersistedState()
    this.status = 'ready'
    this.postMessage(this.createMessage('reset'))
    this.postState()
  }

  clear(): void {
    this.cancelRequests()
    this.postMessage(this.createMessage('clear'))
  }

  private async submit(
    requestId: string,
    conversationId: string,
    prompt: string,
    options: GhostWebviewRequestOptions = {},
    attachments: GhostAttachment[] = [],
    continuationContext = ''
  ): Promise<void> {
    if (this.disposed || this.requests.has(requestId) || this.completedRequests.has(requestId)) {
      return
    }
    const previousRequestId = this.activeRequestByConversation.get(conversationId)
    if (previousRequestId && previousRequestId !== requestId) {
      this.cancel(previousRequestId, conversationId)
    }
    this.debugLog('request started', { requestId, conversationId, promptLength: prompt.length })

    const cancellation = new vscode.CancellationTokenSource()
    const settings = this.settings
    const modelRole = attachments.some(attachment => attachment.mimeType?.toLowerCase().startsWith('image/'))
      ? 'vision'
      : options.modelRole ?? (options.mode === 'agent' ? 'agent' : 'chat')
    const modelSettings = resolveModelSettings(settings, modelRole, options.modelProfile, {
      provider: options.provider,
      model: options.model,
      temperature: options.temperature,
      topP: options.topP,
      topK: options.topK,
      minP: options.minP,
      presencePenalty: options.presencePenalty,
      repeatPenalty: options.repeatPenalty,
      maxContextTokens: options.maxContextTokens,
      maxTokens: options.maxTokens
    })
    const request: GhostRequestState = {
      cancellation,
      conversationId,
      sequence: 0,
      codeMode: false,
      status: 'preparing',
      attempt: 0,
      startedAt: this.clock.now(),
      lastActivityAt: this.clock.now(),
      timedOut: false,
      model: modelSettings.model,
      provider: modelSettings.provider,
      outputTokens: 0,
      eventLog: [],
      timing: createRequestTiming()
    }
    this.requests.set(requestId, request)
    this.activeRequestByConversation.set(conversationId, requestId)
    this.stateStore.notify('request')
    this.postStreamEvent(requestId, request, {
      type: 'request-started'
    })

    let pendingTool: { toolCallId: string; name: string } | undefined
    const response = {
      markdown: (delta: string) => {
        if (pendingTool) {
          this.finishToolExecution(request, pendingTool.toolCallId)
          this.markRecoveryApplied(pendingTool.toolCallId, `Tool failed: ${pendingTool.name} ended before a result was received`)
          this.postStreamEvent(requestId, request, {
            type: 'tool-result',
            tool: pendingTool.name,
            detail: `Tool failed: ${pendingTool.name} ended before a result was received`,
            toolCallId: pendingTool.toolCallId,
            resultStatus: 'failed',
            phase: 'tool'
          })
          pendingTool = undefined
          request.pendingTool = undefined
        }
        const markerCount = (delta.match(/```/g) ?? []).length
        const type = request.codeMode || markerCount > 0 ? 'code-delta' : 'text-delta'
        request.outputTokens += Math.max(1, Math.ceil(delta.length / 4))
        if (markerCount % 2 === 1) {
          request.codeMode = !request.codeMode
        }
        this.postStreamEvent(requestId, request, {
          type,
          phase: 'streaming',
          delta
        })
      },
      progress: (progress: string) => {
        if (progress.startsWith('Running ')) {
          pendingTool = request.pendingTool ?? {
            toolCallId: this.createToolCallId(),
            name: progress.slice('Running '.length)
          }
          this.startToolExecution(request, pendingTool.toolCallId)
          request.pendingTool = pendingTool
          return
        }
        if (progress.startsWith('Tool result:')) {
          const result = /^Tool result:\s*([^:]+):\s*(.*)$/s.exec(progress)
          const resultTool = pendingTool ?? request.pendingTool
          if (resultTool && result) {
            this.finishToolExecution(request, resultTool.toolCallId)
            this.markRecoveryApplied(resultTool.toolCallId, result[2])
            const taskPlan = parseTaskPlanMarker(result[2])
            if (taskPlan) {
              this.postStreamEvent(requestId, request, {
                type: 'task-plan',
                plan: taskPlan,
                phase: 'tool'
              })
            }
            const completionRecord = parseCompletionRecordMarker(result[2])
            if (completionRecord) {
              request.completionRecord = completionRecord
            }
            const resultStatus = completionRecord
              ? 'completed'
              : /rejected|denied/i.test(result[2])
                ? 'rejected'
                : /error|failed|cancelled/i.test(result[2])
                  ? 'failed'
                  : 'completed'
            if (resultStatus === 'completed') {
              this.failedToolRetries.delete(resultTool.toolCallId)
            }
            this.postStreamEvent(requestId, request, {
              type: 'tool-result',
              tool: resultTool.name,
              toolCallId: resultTool.toolCallId,
              detail: taskPlan ? 'Task plan updated.' : result[2],
              resultStatus,
              phase: 'tool'
            })
            pendingTool = undefined
            request.pendingTool = undefined
            return
          }
        }
        if (progress.startsWith('Tool result')) {
          return
        }
        const normalizedProgress = progress.toLowerCase()
        const phase = normalizedProgress.startsWith('context:') || normalizedProgress.includes('reading ') || normalizedProgress.includes('searching ') || normalizedProgress.includes('preparing attachment')
          ? 'context'
          : 'thinking'
        this.postStreamEvent(requestId, request, { type: 'thinking', detail: progress, phase })
      }
    } as unknown as vscode.ChatResponseStream

    const safeAttachments = attachments.slice(0, 8).map(attachment => ({
      ...attachment,
      name: attachment.name.slice(0, 200),
      content: attachment.content?.slice(0, 1024 * 1024)
    }))
    const workspaceReferences = safeAttachments.flatMap(attachment => {
      if (!attachment.path || attachment.mimeType?.toLowerCase().startsWith('image/')) {
        return []
      }
      const uri = vscode.Uri.file(attachment.path)
      return vscode.workspace.getWorkspaceFolder(uri)
        ? [{ value: uri, id: attachment.name, modelDescription: attachment.name }]
        : []
    })
    const droppedContext = safeAttachments
      .filter(attachment => attachment.content && !attachment.mimeType?.toLowerCase().startsWith('image/'))
      .map(attachment => `Dropped attachment: ${attachment.name}\n\n${attachment.content}`)
      .join('\n\n')
    const requestOptions: GhostRequestOptions = {
      ...options,
      modelProfile: options.modelProfile,
      modelRole,
      images: safeAttachments.flatMap<ChatVisionImage>(attachment => {
        if (!attachment.mimeType?.toLowerCase().startsWith('image/')) return []
        if (attachment.path) return [{ path: attachment.path, mimeType: attachment.mimeType }]
        if (attachment.content) return [{ data: attachment.content, mimeType: attachment.mimeType }]
        return []
      }),
      additionalContext: [options.additionalContext, continuationContext, droppedContext].filter(Boolean).join('\n\n') || undefined,
      approveTool: call => this.requestToolApproval(requestId, request, call),
      approveProviderPermission: permission => this.requestProviderPermissionApproval(requestId, request, permission),
      confirmContinue: toolCallCount => this.confirmToolLimit(requestId, request, toolCallCount),
      confirmBudgetContinue: reason => this.confirmBudgetContinue(requestId, request, reason),
      onStop: (reason, message) => {
        if (request.stopReason) {
          return
        }
        request.stopReason = reason
        request.stopMessage = redactSensitiveText(message)
        request.status = reason === 'cancelled' ? 'cancelled' : 'failed'
      }
    }

    const requestTimeoutMs = Math.max(1, Math.floor(settings.requestTimeLimitMinutes)) * 60 * 1000
    const timeout = setTimeout(() => {
      if (!this.requests.has(requestId)) {
        return
      }
      request.timedOut = true
      request.stopReason = 'budget-limit'
      request.stopMessage = 'The Ghost agent request time limit expired (ghost.requestTimeLimitMinutes). This is the agent safety budget, not the provider HTTP timeout (ghost.providerRequestTimeoutMinutes).'
      request.status = 'failed'
      request.cancellation.cancel()
      this.postStreamEvent(requestId, request, {
        type: 'warning',
        message: 'Ghost stopped because the agent request time limit expired. You can retry this request.'
      })
      this.postStreamEvent(requestId, request, {
        type: 'error',
        message: request.stopMessage,
        stopReason: request.stopReason
      })
    }, requestTimeoutMs)

    const waitForBackoff = (milliseconds: number): Promise<boolean> => new Promise(resolve => {
      const timer = setTimeout(() => resolve(true), milliseconds)
      const cancellationListener = cancellation.token.onCancellationRequested(() => {
        clearTimeout(timer)
        cancellationListener.dispose()
        resolve(false)
      })
    })

    const isRecoverable = (error: unknown): boolean => {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
      return /timeout|timed out|network|fetch|connect|socket|econn|429|500|502|503|504|temporarily unavailable|offline/.test(message)
    }

    try {
      let lastError: unknown
      for (let attempt = 1; attempt <= GHOST_RETRY_POLICIES.providerConnectivity.maxRetries + 1; attempt += 1) {
        request.attempt = attempt
        request.status = 'connecting'
        request.lastActivityAt = this.clock.now()
        this.postStreamEvent(requestId, request, {
          type: 'thinking',
          state: 'connecting',
          phase: 'provider',
          detail: attempt === 1 ? 'Connecting to provider…' : `Reconnecting to provider (attempt ${attempt})…`
        })
        try {
          await this.chatHandler(
            {
              prompt,
              references: workspaceReferences,
              ghost: requestOptions
            } as unknown as vscode.ChatRequest,
            {} as vscode.ChatContext,
            response,
            cancellation.token
          )
          lastError = undefined
          break
        } catch (error) {
          lastError = error
          if (cancellation.token.isCancellationRequested || !isRecoverable(error) || attempt > GHOST_RETRY_POLICIES.providerConnectivity.maxRetries) {
            throw error
          }
          const delay = retryDelay(GHOST_RETRY_POLICIES.providerConnectivity, attempt - 1)
          this.postStreamEvent(requestId, request, {
            type: 'warning',
            message: `Provider failed. Retrying in ${delay} ms.`
          })
          if (!await waitForBackoff(delay)) {
            break
          }
        }
      }
      if (lastError && !cancellation.token.isCancellationRequested) {
        throw lastError
      }
      const completedStatus = request.stopReason === 'cancelled'
        ? 'cancelled'
        : request.stopReason
          ? 'failed'
          : cancellation.token.isCancellationRequested
            ? 'cancelled'
            : 'completed'
      this.postStreamEvent(requestId, request, {
        type: 'request-completed',
        phase: 'complete',
        status: completedStatus,
        ...(request.stopReason ? { stopReason: request.stopReason, message: request.stopMessage } : {})
      })
    } catch (error) {
      const ghostError = toGhostError(error, 'ui.request-failed', { retryable: true })
      const message = redactSensitiveText(ghostError.message || 'Ghost request failed')
      if (!request.stopReason) {
        request.stopReason = request.timedOut
          ? 'timeout'
          : cancellation.token.isCancellationRequested
            ? 'cancelled'
            : /context|context window|maximum token|token limit|too many tokens/i.test(message)
              ? 'context-limit'
              : 'provider-failure'
        request.stopMessage = message
      }
      if (!cancellation.token.isCancellationRequested || !request.timedOut) {
        this.log('error', 'request failed', message)
        this.postStreamEvent(requestId, request, { type: 'error', phase: 'error', message, stopReason: request.stopReason })
      }
      this.postStreamEvent(requestId, request, {
        type: 'request-completed',
        status: request.stopReason === 'cancelled' ? 'cancelled' : 'failed',
        stopReason: request.stopReason,
        message: request.stopMessage
      })
    } finally {
      clearTimeout(timeout)
      this.debugLog('request timing', { requestId, conversationId, ...this.timingSummary(request) })
      this.resolvePendingApprovals(requestId, { decision: 'reject' })
      this.requestOrchestrator.markCompleted(requestId, conversationId)
      this.stateStore.notify('request')
      cancellation.dispose()
    }
  }

  private cancel(requestId: string, conversationId?: string): void {
    const request = this.requests.get(requestId)
    if (!request || (conversationId !== undefined && request.conversationId !== conversationId)) {
      return
    }
    this.resolvePendingApprovals(requestId, { decision: 'reject' })
    request.status = 'cancelled'
    request.stopReason = 'cancelled'
    request.stopMessage = 'The request was cancelled.'
    request.cancellation.cancel()
    this.stateStore.notify('request')
  }

  private disableAutoAccept(requestId: string, conversationId: string): void {
    const request = this.requests.get(requestId)
    if (!request || request.conversationId !== conversationId) {
      return
    }
    request.autoAcceptDisabled = true
    this.postStreamEvent(requestId, request, {
      type: 'warning',
      message: 'Auto-accept disabled for this request. Future file edits will ask for approval.'
    })
  }

  private async continueRequest(
    requestId: string,
    conversationId: string,
    resume: GhostContinuation,
    options: GhostWebviewRequestOptions = {}
  ): Promise<void> {
    const sections = [
      'Continue the previous task from the saved state. Do not replay the whole conversation.',
      `Original request:\n${resume.prompt}`
    ]
    if (resume.lastFailure) {
      sections.push(`Last failed tool:\n${JSON.stringify(resume.lastFailure)}`)
    }
    if (resume.remainingPlan) {
      sections.push(`Remaining task plan:\n${JSON.stringify(resume.remainingPlan)}`)
    }
    for (const filePath of resume.filePaths.slice(0, 12)) {
      try {
        const uri = resolveWorkspacePath(filePath)
        const snapshot = await readWorkspaceFile(uri)
        const content = snapshot.exists ? snapshot.content.slice(0, 12000) : '[file does not exist]'
        sections.push(`Current file state: ${uri.fsPath}${snapshot.exists && snapshot.content.length > content.length ? ' (truncated)' : ''}\n${content}`)
      } catch {
        sections.push(`Current file state unavailable: ${filePath}`)
      }
    }
    await this.submit(
      requestId,
      conversationId,
      'Continue from the saved state. Inspect and finish the original request.',
      options,
      [],
      sections.join('\n\n')
    )
  }

  private cancelRequests(): void {
    for (const requestId of this.requests.keys()) {
      this.cancel(requestId)
    }
  }

  private createToolCallId(): string {
    return `tool-${this.clock.now()}-${randomBytes(6).toString('hex')}`
  }

  private async retryFailedTool(
    requestId: string,
    conversationId: string,
    failedToolCallId: string,
    fallbackCall: LocalToolCall
  ): Promise<void> {
    if (this.disposed || this.requests.has(requestId) || this.completedRequests.has(requestId)) {
      return
    }
    const stored = this.failedToolRetries.get(failedToolCallId)
    if (!stored || stored.requestId !== requestId || stored.conversationId !== conversationId || stored.call.name !== fallbackCall.name) {
      return
    }
    const call = stored?.call ?? fallbackCall
    const cancellation = new vscode.CancellationTokenSource()
    const request: GhostRequestState = {
      cancellation,
      conversationId,
      sequence: 0,
      codeMode: false,
      status: 'preparing',
      attempt: 1,
      startedAt: this.clock.now(),
      lastActivityAt: this.clock.now(),
      timedOut: false,
      model: this.settings.chatModel,
      outputTokens: 0,
      eventLog: [],
      timing: createRequestTiming()
    }
    this.requests.set(requestId, request)
    this.activeRequestByConversation.set(conversationId, requestId)
    this.stateStore.notify('request')
    this.postStreamEvent(requestId, request, { type: 'request-started' })

    try {
      const approval = await this.requestToolApproval(requestId, request, call)
      if (cancellation.token.isCancellationRequested) {
        request.status = 'cancelled'
        this.postStreamEvent(requestId, request, {
          type: 'request-completed',
          status: 'cancelled',
          stopReason: 'cancelled',
          message: 'The tool retry was cancelled.'
        })
        return
      }
      const toolCallId = request.pendingTool?.toolCallId ?? this.createToolCallId()
      const toolExecutor = new LocalToolExecutor()
      if (approval.decision === 'reject') {
        const message = approval.reason ?? 'User rejected this tool retry.'
        this.postStreamEvent(requestId, request, {
          type: 'tool-result',
          tool: call.name,
          toolCallId,
          detail: message,
          resultStatus: 'rejected',
          phase: 'tool'
        })
        this.postStreamEvent(requestId, request, {
          type: 'request-completed',
          status: 'failed',
          stopReason: 'approval-rejected',
          message
        })
        return
      }

      const result = await toolExecutor.execute(call, cancellation.token, {
        approved: true,
        expectedContent: approval.expectedContent,
        expectedFileExists: approval.expectedFileExists,
        expectedFiles: approval.expectedFiles,
        alreadyApplied: approval.alreadyApplied,
        appliedContent: approval.appliedContent,
        selectedHunkIndexes: approval.selectedHunkIndexes
      })
      const detail = redactSensitiveText(result.text).slice(0, 16000)
      const failed = result.status !== 'success' && result.status !== 'no-op'
      this.postStreamEvent(requestId, request, {
        type: 'tool-result',
        tool: call.name,
        toolCallId,
        detail,
        resultStatus: failed ? 'failed' : 'completed',
        phase: 'tool'
      })
      if (failed) {
        this.failedToolRetries.set(toolCallId, { requestId, conversationId, call })
        const message = `Ghost stopped because the tool failed: ${detail} Review the arguments and retry.`
        this.postStreamEvent(requestId, request, {
          type: 'error',
          phase: 'error',
          message,
          stopReason: 'failed-tool'
        })
        this.postStreamEvent(requestId, request, {
          type: 'request-completed',
          status: 'failed',
          stopReason: 'failed-tool',
          message
        })
        return
      }
      this.failedToolRetries.delete(failedToolCallId)
      this.failedToolRetries.delete(toolCallId)
      this.postStreamEvent(requestId, request, {
        type: 'request-completed',
        phase: 'complete',
        status: 'completed'
      })
    } catch (error) {
      const message = redactSensitiveText(error instanceof Error ? error.message : 'Ghost could not retry the tool.')
      this.postStreamEvent(requestId, request, {
        type: 'error',
        phase: 'error',
        message,
        stopReason: 'failed-tool'
      })
      this.postStreamEvent(requestId, request, {
        type: 'request-completed',
        status: 'failed',
        stopReason: 'failed-tool',
        message
      })
    } finally {
      this.debugLog('tool retry timing', { requestId, conversationId, ...this.timingSummary(request) })
      this.resolvePendingApprovals(requestId, { decision: 'reject' })
      this.requestOrchestrator.markCompleted(requestId, conversationId)
      this.stateStore.notify('request')
      cancellation.dispose()
    }
  }

  private async confirmToolLimit(requestId: string, request: GhostRequestState, toolCallCount: number): Promise<boolean> {
    this.postStreamEvent(requestId, request, {
      type: 'warning',
      message: `Ghost reached ${toolCallCount} tool calls. Choose Continue or Stop.`
    })
    const choice = await awaitCancellable(vscode.window.showWarningMessage(
      `Ghost reached ${toolCallCount} tool calls. Continue working?`,
      { modal: true, detail: 'Choose Continue to allow another batch of tool calls, or Stop to end this request.' },
      'Continue',
      'Stop'
    ), request.cancellation.token).catch(() => undefined)
    return choice === 'Continue'
  }

  private async confirmBudgetContinue(requestId: string, request: GhostRequestState, reason: string): Promise<boolean> {
    this.postStreamEvent(requestId, request, {
      type: 'warning',
      message: `Ghost reached a request budget limit: ${reason}. Choose Continue or Stop.`
    })
    const choice = await awaitCancellable(vscode.window.showWarningMessage(
      `Ghost reached a request budget limit: ${reason}. Continue working?`,
      { modal: true, detail: 'Choose Continue to start a fresh budget window, or Stop to end this request.' },
      'Continue',
      'Stop'
    ), request.cancellation.token).catch(() => undefined)
    return choice === 'Continue'
  }

  private async getDiffPreview(call: LocalToolCall, approvalContext: Pick<StagedEdit, 'requestId' | 'conversationId' | 'toolCallId'>): Promise<GhostToolDiffPreview | undefined> {
    if (call.name === 'ghost_apply_transaction') {
      try {
        const prepared = await prepareFileTransaction(parseFileTransaction(call.arguments))
        const limit = 20000
        const before = prepared.map(file => `--- ${file.path}\n${file.before.content}`).join('\n\n')
        const after = prepared.map(file => `+++ ${file.path}\n${file.after}`).join('\n\n')
        const files = prepared.map(file => file.path)
        return {
          path: files.length === 1 ? files[0] : `${files.length} files`,
          files,
          before: before.slice(0, limit),
          after: after.slice(0, limit),
          truncated: before.length > limit || after.length > limit,
          previewKind: 'text' as const
        }
      } catch {
        return undefined
      }
    }
    if ((call.name !== 'ghost_write_file' && call.name !== 'ghost_apply_edit') || typeof call.arguments.path !== 'string') {
      return undefined
    }
    try {
      const uri = resolveWorkspacePath(call.arguments.path)
      const existingStage = this.stagedEdits.get(approvalContext.toolCallId)
      if (existingStage) {
        await this.restoreStagedEdit(existingStage)
      }
      let before = ''
      try {
        before = (await vscode.workspace.openTextDocument(uri)).getText()
      } catch {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri)
          before = Buffer.from(bytes).toString('utf8')
        } catch {
          before = ''
        }
      }
      const parsedEdit = call.name === 'ghost_apply_edit' ? parseGhostEdit(call.arguments) : undefined
      const after = call.name === 'ghost_write_file'
        ? typeof call.arguments.content === 'string' ? call.arguments.content : undefined
        : applyGhostEdit(before, parsedEdit as NonNullable<typeof parsedEdit>)
      if (after === undefined) {
        return undefined
      }
      const limit = 20000
      const preview = {
        path: uri.fsPath,
        files: [uri.fsPath],
        before: before.slice(0, limit),
        after: after.slice(0, limit),
        truncated: before.length > limit || after.length > limit,
        previewKind: 'staged' as const,
        ...(parsedEdit ? { hunks: parsedEdit.hunks } : {})
      }
      try {
        const document = await vscode.workspace.openTextDocument(uri)
        if (document.getText() === before) {
          const edit = new vscode.WorkspaceEdit()
          edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), after)
          if (await vscode.workspace.applyEdit(edit)) {
            this.stagedEdits.set(approvalContext.toolCallId, {
              ...approvalContext,
              call,
              uri,
              before,
              after,
              documentVersion: document.version,
              mtimeMs: await vscode.workspace.fs.stat(uri).then(stat => Number(stat.mtime), () => undefined)
            })
            this.stagedEditChanges.fire()
            const editor = await vscode.window.showTextDocument(document, { preview: false })
            const line = parsedEdit?.hunks[0]?.startLine ?? 1
            const position = new vscode.Position(Math.max(0, line - 1), 0)
            editor.selection = new vscode.Selection(position, position)
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
          }
        }
      } catch {
        // The webview preview remains available when the source file cannot be staged.
      }
      return preview
    } catch {
      return undefined
    }
  }

  private async restoreStagedEdit(staged: StagedEdit): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(staged.uri)
      const buffer = document.getText()
      if (buffer !== staged.after && buffer !== staged.before) {
        throw new GhostError('The source file changed while Ghost was waiting for edit approval.', { code: 'approval.conflict', retryable: true })
      }
      if (document.isDirty && document.version !== staged.documentVersion && buffer !== staged.after && buffer !== staged.before) {
        throw new GhostError('The editor buffer changed while Ghost was waiting for edit approval. Restore was skipped to avoid overwriting your edits.', { code: 'approval.conflict', retryable: true })
      }
      const current = await readWorkspaceFile(staged.uri)
      if (buffer === staged.after && !sameWorkspaceFile(current, { exists: true, content: staged.before }) && !sameWorkspaceFile(current, { exists: true, content: staged.after })) {
        throw new GhostError('File changed externally while Ghost was waiting for edit approval. Refresh and rebase the edit before retrying.', { code: 'approval.conflict', retryable: true })
      }
      if (staged.mtimeMs !== undefined) {
        try {
          const stat = await vscode.workspace.fs.stat(staged.uri)
          if (Number(stat.mtime) !== staged.mtimeMs && current.content !== staged.before && current.content !== staged.after) {
            throw new GhostError('File changed externally while Ghost was waiting for edit approval. Refresh and rebase the edit before retrying.', { code: 'approval.conflict', retryable: true })
          }
        } catch (error) {
          if (error instanceof GhostError) {
            throw error
          }
        }
      }
      if (buffer !== staged.before) {
        const edit = new vscode.WorkspaceEdit()
        edit.replace(staged.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), staged.before)
        if (!await vscode.workspace.applyEdit(edit)) {
          throw new GhostError('Ghost could not restore the source file.', { code: 'approval.failed', retryable: true })
        }
      }
      if (document.isDirty) {
        await document.save()
      }
      const restored = await readWorkspaceFile(staged.uri)
      if (!sameWorkspaceFile(restored, { exists: true, content: staged.before })) {
        throw new GhostError('Ghost could not verify the restored source file.', { code: 'approval.failed', retryable: true })
      }
    } finally {
      this.stagedEdits.delete(staged.toolCallId)
      this.stagedEditChanges.fire()
    }
  }

  private async acceptStagedEdit(toolCallId: string): Promise<void> {
    const staged = this.stagedEdits.get(toolCallId)
    const pending = this.pendingApprovals.get(toolCallId)
    if (!staged || !pending) {
      return
    }
    try {
      await this.saveStagedEdit(staged)
      this.stagedEdits.delete(toolCallId)
      this.stagedEditChanges.fire()
      await this.finishAlreadyAppliedEdit(pending, {
        decision: 'once',
        alreadyApplied: true,
        appliedContent: staged.after,
        expectedContent: staged.before
      })
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Ghost could not accept the edit.')
    }
  }

  private async rejectStagedEdit(toolCallId: string): Promise<void> {
    const staged = this.stagedEdits.get(toolCallId)
    const pending = this.pendingApprovals.get(toolCallId)
    if (!staged || !pending) {
      return
    }
    try {
      await this.restoreStagedEdit(staged)
      this.pendingApprovals.delete(toolCallId)
      pending.resolve({ decision: 'reject', reason: 'User rejected the edit in the source file.' })
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Ghost could not reject the edit.')
    }
  }

  private async getExpectedFileSnapshot(call: LocalToolCall): Promise<WorkspaceFileSnapshot | undefined> {
    if ((call.name !== 'ghost_write_file' && call.name !== 'ghost_apply_edit') || typeof call.arguments.path !== 'string') {
      return undefined
    }
    try {
      return await readWorkspaceFile(resolveWorkspacePath(call.arguments.path))
    } catch {
      return undefined
    }
  }

  private async getExpectedFileSnapshots(call: LocalToolCall): Promise<Record<string, WorkspaceFileSnapshot> | undefined> {
    if (call.name === 'ghost_apply_transaction') {
      try {
        const transaction = parseFileTransaction(call.arguments)
        const snapshots = await Promise.all(transaction.edits.map(async edit => {
          const uri = resolveWorkspacePath(edit.path)
          return [uri.fsPath, await readWorkspaceFile(uri)] as const
        }))
        return Object.fromEntries(snapshots)
      } catch {
        return undefined
      }
    }
    const snapshot = await this.getExpectedFileSnapshot(call)
    if (!snapshot || typeof call.arguments.path !== 'string') {
      return undefined
    }
    try {
      return { [resolveWorkspacePath(call.arguments.path).fsPath]: snapshot }
    } catch {
      return undefined
    }
  }

  private getUnsavedEditorWarning(call: LocalToolCall): string | undefined {
    let paths: string[] = []
    try {
      paths = call.name === 'ghost_apply_transaction'
        ? parseFileTransaction(call.arguments).edits.map(edit => edit.path)
        : typeof call.arguments.path === 'string' ? [call.arguments.path] : []
    } catch {
      return undefined
    }
    const dirtyPaths = paths.flatMap(filePath => {
      try {
        const uri = resolveWorkspacePath(filePath)
        return vscode.workspace.textDocuments.some(document => document.uri.toString() === uri.toString() && document.isDirty)
          ? [uri.fsPath]
          : []
      } catch {
        return []
      }
    })
    const uniquePaths = [...new Set(dirtyPaths)]
    if (uniquePaths.length === 0) {
      return undefined
    }
    return `Edit blocked: ${uniquePaths.join(', ')} has unsaved editor changes. Read the buffer with ghost_read_file source:"editor", then ask the user to save or discard those changes before editing the disk file.`
  }

  private async rememberRecovery(
    requestId: string,
    conversationId: string,
    toolCallId: string,
    call: LocalToolCall,
    expected: WorkspaceFileSnapshot | undefined,
    expectedSnapshots?: Record<string, WorkspaceFileSnapshot>,
    selectedHunkIndexes?: number[]
  ): Promise<void> {
    try {
      let files: Array<{ path: string; before: WorkspaceFileSnapshot; after: WorkspaceFileSnapshot }>
      if (call.name === 'ghost_apply_transaction') {
        const prepared = await prepareFileTransaction(parseFileTransaction(call.arguments), expectedSnapshots)
        files = prepared.map(file => ({
          path: file.path,
          before: file.before,
          after: { exists: true, content: file.after }
        }))
      } else {
        if ((call.name !== 'ghost_write_file' && call.name !== 'ghost_apply_edit') || typeof call.arguments.path !== 'string') {
          return
        }
        const uri = resolveWorkspacePath(call.arguments.path)
        const before = expected ?? await readWorkspaceFile(uri)
        const after = call.name === 'ghost_write_file'
          ? typeof call.arguments.content === 'string' ? call.arguments.content : undefined
          : applyGhostEdit(before.content, parseGhostEdit(call.arguments), selectedHunkIndexes ? new Set(selectedHunkIndexes) : undefined)
        if (after === undefined) {
          return
        }
        files = [{ path: uri.fsPath, before, after: { exists: true, content: after } }]
      }
      this.recoveryRecords.set(toolCallId, {
        requestId,
        conversationId,
        toolCallId,
        files,
        applied: false
      })
    } catch {
      // The executor reports the validation error.
    }
  }

  private markRecoveryApplied(toolCallId: string, detail: string): void {
    const record = this.recoveryRecords.get(toolCallId)
    if (!record) {
      return
    }
    if (/error|failed|rejected|denied|cancelled/i.test(detail)) {
      this.recoveryRecords.delete(toolCallId)
      return
    }
    record.applied = true
  }

  private async restoreTool(requestId: string, conversationId: string, toolCallId: string): Promise<void> {
    const record = this.recoveryRecords.get(toolCallId)
    if (!record || record.requestId !== requestId || record.conversationId !== conversationId || !record.applied) {
      await vscode.window.showWarningMessage('Ghost has no applied change to restore.')
      return
    }
    try {
      const currentFiles = await Promise.all(record.files.map(async file => {
        const uri = resolveWorkspacePath(file.path)
        const current = await readWorkspaceFile(uri)
        if (!sameWorkspaceFile(current, file.after)) {
          throw new Error(`Ghost cannot restore ${file.path} because it changed after the edit.`)
        }
        return { file, uri, current }
      }))
      for (const { file, uri, current } of currentFiles) {
        if (!file.before.exists) {
          await vscode.workspace.fs.delete(uri, { useTrash: false })
        } else {
          await atomicWriteFile(uri, Buffer.from(file.before.content, 'utf8'), current)
        }
      }
      record.applied = false
      await vscode.window.showInformationMessage(`Restored ${record.files.length} file${record.files.length === 1 ? '' : 's'}.`)
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Ghost could not restore the file.')
    }
  }

  private async openFile(filePath: string, line?: number): Promise<void> {
    try {
      const uri = resolveWorkspacePath(filePath)
      const document = await vscode.workspace.openTextDocument(uri)
      const editor = await vscode.window.showTextDocument(document)
      if (line !== undefined) {
        const targetLine = Math.min(Math.max(line - 1, 0), Math.max(document.lineCount - 1, 0))
        const position = new vscode.Position(targetLine, 0)
        editor.selection = new vscode.Selection(position, position)
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
      }
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Ghost could not open the file.')
    }
  }

  private async requestToolApproval(
    requestId: string,
    request: GhostRequestState | undefined,
    call: LocalToolCall,
    nativeState?: NativeChatApprovalState
  ): Promise<GhostToolApproval> {
    const pathTools = new Set(['ghost_read_file', 'ghost_write_file', 'ghost_apply_edit', 'ghost_list_directory'])
    const requiredArgument = pathTools.has(call.name)
      ? 'path'
      : call.name === 'ghost_search_workspace'
        ? 'query'
      : call.name === 'ghost_apply_transaction'
        ? 'edits'
      : call.name === 'ghost_run_terminal_command'
        ? 'command'
        : undefined
    const missingArgument = requiredArgument === 'edits'
      ? !Array.isArray(call.arguments.edits) || call.arguments.edits.length < 2
      : requiredArgument !== undefined && (typeof call.arguments[requiredArgument] !== 'string' || !call.arguments[requiredArgument].trim())
    if (requiredArgument && missingArgument) {
      const reason = `Tool call rejected: ${call.name} requires a non-empty '${requiredArgument}'. Retry with one JSON tool call using the absolute path from the workspace context.`
      if (request) {
        const pending = { toolCallId: this.createToolCallId(), name: call.name }
        request.pendingTool = pending
        this.failedToolRetries.set(pending.toolCallId, { requestId, conversationId: request.conversationId, call })
        this.postStreamEvent(requestId, request, {
          type: 'tool-requested',
          tool: call.name,
          toolCallId: pending.toolCallId,
          arguments: call.arguments,
          requiresApproval: false,
          detail: reason,
          phase: 'tool'
        })
      }
      return { decision: 'reject', reason }
    }

    const terminalAudit = call.name === 'ghost_run_terminal_command' && typeof call.arguments.command === 'string'
      ? auditTerminalCommand(call.arguments.command)
      : undefined
    if (terminalAudit?.blocked) {
      const reason = formatTerminalAudit(terminalAudit)
      if (request) {
        const pending = { toolCallId: this.createToolCallId(), name: call.name }
        request.pendingTool = pending
        this.failedToolRetries.set(pending.toolCallId, { requestId, conversationId: request.conversationId, call })
        this.postStreamEvent(requestId, request, {
          type: 'tool-requested',
          tool: call.name,
          toolCallId: pending.toolCallId,
          arguments: call.arguments,
          requiresApproval: false,
          detail: reason,
          phase: 'tool'
        })
      }
      return { decision: 'reject', reason }
    }

    const pending = request?.pendingTool?.name === call.name
      ? request.pendingTool
      : { toolCallId: this.createToolCallId(), name: call.name }
    if (request) {
      request.pendingTool = pending
      this.failedToolRetries.set(pending.toolCallId, { requestId, conversationId: request.conversationId, call })
    }
    const settings = this.settings
    const fileEditTool = isFileEditTool(call.name)
    const fileEditPaths = fileEditTool ? getFileEditPaths(call) : []
    const permission = resolveToolPermission(call.name, {
      allowlist: settings.toolAllowlist ?? [...GHOST_TOOL_NAMES],
      asklist: settings.toolAsklist ?? [],
      denylist: settings.toolDenylist ?? [],
      autoAccept: {
        scope: this.effectiveAutoAcceptScope(),
        autoAcceptDisabled: request?.autoAcceptDisabled === true,
        autoAcceptFilePath: request?.autoAcceptFilePath ?? nativeState?.autoAcceptFilePath,
        oneEditConsumed: request?.oneEditConsumed === true || this.oneEditConsumed,
        sessionActive: this.sessionAutoAcceptActive,
        resolveFilePath: filePath => resolveWorkspacePath(filePath).fsPath
      },
      sessionApprovedFileEdits: this.sessionApprovedFileEdits,
      workspaceApprovedFileEdits: this.workspaceApprovedFileEdits,
      persistentApprovedFileEdits: this.persistentApprovedFileEdits,
      sessionApprovedTool: this.sessionApprovedTools.has(call.name),
      persistentApprovedTool: this.persistentApprovedTools.has(call.name),
      requestApprovedFileEdits: request?.approveAllFileEdits === true || nativeState?.approveAllFileEdits === true,
      requestApprovedThisFile: fileEditPaths.length > 0 && fileEditPaths.every(filePath => (
        request?.approvedFilePaths?.has(filePath) === true || nativeState?.approvedFilePaths.has(filePath) === true
      ))
    }, call)
    const unsavedEditorWarning = fileEditTool && !permission.blockedByPolicy
      ? this.getUnsavedEditorWarning(call)
      : undefined
    if (unsavedEditorWarning) {
      if (request) {
        this.postStreamEvent(requestId, request, {
          type: 'tool-requested',
          tool: call.name,
          toolCallId: pending.toolCallId,
          arguments: call.arguments as GhostToolArguments,
          requiresApproval: false,
          detail: unsavedEditorWarning,
          phase: 'tool'
        })
      }
      return { decision: 'reject', reason: unsavedEditorWarning }
    }
    if (permission.nextAutoAcceptFilePath) {
      if (request) {
        request.autoAcceptFilePath = permission.nextAutoAcceptFilePath
      }
      if (nativeState) {
        nativeState.autoAcceptFilePath = permission.nextAutoAcceptFilePath
      }
    }
    if (permission.autoAcceptedFileEdit && permission.consumeOneEdit) {
      if (request) {
        request.oneEditConsumed = true
      }
      this.oneEditConsumed = true
      void this.revertOneEditAutoAccept()
    }
    const argumentsPayload = call.arguments as GhostToolArguments
    const needsInteractiveApproval = permission.needsInteractiveApproval
    const diffPreview = needsInteractiveApproval && request
      ? await this.getDiffPreview(call, {
          requestId,
          conversationId: request.conversationId,
          toolCallId: pending.toolCallId
        })
      : undefined
    if (request?.cancellation.token.isCancellationRequested) {
      return { decision: 'reject', reason: 'The request was cancelled.' }
    }
    const expectedFiles = fileEditTool && !permission.blockedByPolicy
      ? await this.getExpectedFileSnapshots(call)
      : undefined
    if (request?.cancellation.token.isCancellationRequested) {
      return { decision: 'reject', reason: 'The request was cancelled.' }
    }
    if (fileEditTool && !permission.blockedByPolicy && !expectedFiles) {
      return { decision: 'reject', reason: 'Ghost could not read the file safely. Refresh the file and retry.' }
    }
    const expectedSnapshot = typeof call.arguments.path === 'string' && expectedFiles
      ? expectedFiles[resolveWorkspacePath(call.arguments.path).fsPath]
      : undefined
    const expectedContent = expectedSnapshot?.content
    const expectedFileExists = expectedSnapshot?.exists
    if (request) {
      this.postStreamEvent(requestId, request, {
        type: 'tool-requested',
        tool: call.name,
        toolCallId: pending.toolCallId,
        arguments: argumentsPayload,
        requiresApproval: needsInteractiveApproval,
        ...(diffPreview ? { diffPreview } : {}),
        detail: permission.blockedByPolicy
          ? 'Blocked by workspace tool policy'
          : terminalAudit ? formatTerminalAudit(terminalAudit)
          : permission.autoAcceptedFileEdit ? 'Auto-accepting file edit'
          : needsInteractiveApproval ? 'Waiting for approval' : 'Running approved workspace tool',
        phase: 'tool'
      })
    }

    if (permission.blockedByPolicy) {
      return {
        decision: 'reject',
        reason: `Tool '${call.name}' is denied by Ghost's workspace policy. Choose Allow or Ask first in Tool permissions.`
      }
    }
    if (!needsInteractiveApproval) {
      if (request) {
        await this.rememberRecovery(requestId, request.conversationId, pending.toolCallId, call, expectedSnapshot, expectedFiles)
      }
      return { decision: 'once', expectedContent, expectedFileExists, expectedFiles }
    }

    if (!request) {
      const approval = await this.promptNativeChatApproval(call)
      this.applyApprovalMemory(call, approval, undefined, nativeState)
      return { ...approval, expectedContent, expectedFileExists, expectedFiles }
    }

    return new Promise(resolve => {
      this.pendingApprovals.set(pending.toolCallId, {
        requestId,
        conversationId: request.conversationId,
        toolCallId: pending.toolCallId,
        call,
        expectedContent,
        expectedFileExists,
        expectedFiles,
        resolve
      })
      this.stateStore.notify('approval')
    })
  }

  private requestProviderPermissionApproval(
    requestId: string,
    request: GhostRequestState,
    permission: GhostProviderPermissionRequest
  ): Promise<GhostToolApproval> {
    if (request.cancellation.token.isCancellationRequested) {
      return Promise.resolve({ decision: 'reject', reason: 'The request was cancelled.' })
    }
    const toolCallId = this.createToolCallId()
    return new Promise(resolve => {
      this.pendingProviderPermissionApprovals.set(toolCallId, {
        requestId,
        conversationId: request.conversationId,
        toolCallId,
        permission,
        resolve
      })
      this.postStreamEvent(requestId, request, {
        type: 'tool-requested',
        tool: `${permission.provider}_permission`,
        toolCallId,
        arguments: permission.arguments as GhostToolArguments,
        requiresApproval: true,
        approvalKind: 'provider-permission',
        detail: permission.detail,
        phase: 'tool'
      })
      this.stateStore.notify('approval')
    })
  }

  private async promptNativeChatApproval(call: LocalToolCall): Promise<GhostToolApproval> {
    const approveNow = 'Approve now'
    const approveSession = 'Approve for session'
    const approveForever = 'Approve forever'
    const detail = typeof call.arguments.command === 'string'
      ? call.arguments.command
      : typeof call.arguments.path === 'string'
        ? call.arguments.path
        : call.name
    const choice = await vscode.window.showWarningMessage(
      `Allow Ghost to run ${call.name}?`,
      { modal: true, detail },
      approveNow,
      approveSession,
      approveForever
    )
    if (choice === approveNow) {
      return { decision: 'once' }
    }
    if (choice === approveSession) {
      return { decision: 'session' }
    }
    if (choice === approveForever) {
      return { decision: 'always' }
    }
    return { decision: 'reject', reason: 'User rejected this tool call.' }
  }

  private applyApprovalMemory(
    call: LocalToolCall,
    approval: GhostToolApproval,
    request?: GhostRequestState,
    nativeState?: NativeChatApprovalState
  ): void {
    if (approval.decision === 'request') {
      if (request) {
        request.approveAllFileEdits = true
      }
      if (nativeState) {
        nativeState.approveAllFileEdits = true
      }
    }
    if (approval.decision === 'file' && isFileEditTool(call.name)) {
      const paths = getFileEditPaths(call)
      if (paths.length === 1) {
        if (request) {
          request.approvedFilePaths ??= new Set<string>()
          request.approvedFilePaths.add(paths[0])
        }
        nativeState?.approvedFilePaths.add(paths[0])
      }
    }
    if (approval.decision === 'workspace' && isFileEditTool(call.name)) {
      this.workspaceApprovedFileEdits = true
      void this.workspaceState?.update('ghost.workspace.approvedFileEdits', true)
    }
    if (approval.decision === 'session') {
      if (isFileEditTool(call.name)) {
        this.sessionApprovedFileEdits = true
      } else {
        this.sessionApprovedTools.add(call.name)
      }
    }
    if (approval.decision === 'always') {
      if (isFileEditTool(call.name)) {
        this.persistentApprovedFileEdits = true
        void this.globalState?.update('ghost.global.approvedFileEdits', true)
      } else {
        this.persistentApprovedTools.add(call.name)
        void this.globalState?.update('ghost.global.approvedTools', [...this.persistentApprovedTools])
      }
    }
  }

  private resolvePendingApprovals(requestId: string, approval: GhostToolApproval): void {
    for (const [toolCallId, pending] of this.pendingApprovals) {
      if (pending.requestId !== requestId) {
        continue
      }
      const staged = this.stagedEdits.get(toolCallId)
      if (staged) {
        void this.restoreStagedEdit(staged)
      }
      this.pendingApprovals.delete(toolCallId)
      this.approvalRaceGuard.end(toolCallId)
      pending.resolve(approval)
    }
    for (const [toolCallId, pending] of this.pendingProviderPermissionApprovals) {
      if (pending.requestId !== requestId) {
        continue
      }
      this.pendingProviderPermissionApprovals.delete(toolCallId)
      this.approvalRaceGuard.end(toolCallId)
      const request = this.requests.get(requestId)
      if (request) {
        this.postStreamEvent(requestId, request, {
          type: 'tool-result',
          tool: `${pending.permission.provider}_permission`,
          toolCallId,
          detail: approval.reason ?? 'Permission rejected.',
          resultStatus: 'rejected',
          phase: 'tool'
        })
      }
      pending.resolve(approval)
    }
  }

  private approveAllPendingFiles(requestId: string, conversationId: string): void {
    const request = this.requests.get(requestId)
    if (!request || request.conversationId !== conversationId) {
      return
    }
    request.approveAllFileEdits = true
    this.stateStore.notify('approval')
    for (const pending of [...this.pendingApprovals.values()]) {
      if (pending.requestId === requestId && pending.conversationId === conversationId && isFileEditTool(pending.call.name)) {
        this.decideToolApproval(requestId, conversationId, pending.toolCallId, { decision: 'request' })
      }
    }
  }

  private decideToolApproval(
    requestId: string,
    conversationId: string,
    toolCallId: string,
    approval: GhostToolApproval
  ): void {
    const providerPermission = this.pendingProviderPermissionApprovals.get(toolCallId)
    if (providerPermission && providerPermission.requestId === requestId && providerPermission.conversationId === conversationId) {
      if (!this.approvalRaceGuard.begin(toolCallId)) {
        return
      }
      const request = this.requests.get(requestId)
      if (providerPermission.permission.policyTool) {
        this.applyApprovalMemory({
          name: providerPermission.permission.policyTool,
          arguments: providerPermission.permission.arguments
        }, approval, request)
      }
      this.pendingProviderPermissionApprovals.delete(toolCallId)
      if (request?.pendingTool?.toolCallId === toolCallId) {
        request.pendingTool = undefined
      }
      if (request) {
        const approved = approval.decision !== 'reject'
        this.postStreamEvent(requestId, request, {
          type: 'tool-result',
          tool: `${providerPermission.permission.provider}_permission`,
          toolCallId,
          detail: approved
            ? approval.decision === 'session'
              ? 'Permission approved for this Ghost session.'
              : 'Permission approved once.'
            : approval.reason ?? 'Permission rejected.',
          resultStatus: approved ? 'completed' : 'rejected',
          phase: 'tool'
        })
      }
      providerPermission.resolve(approval)
      this.approvalRaceGuard.end(toolCallId)
      this.stateStore.notify('approval')
      return
    }

    const pending = this.pendingApprovals.get(toolCallId)
    if (!pending || pending.requestId !== requestId || pending.conversationId !== conversationId) {
      return
    }
    if (!this.approvalRaceGuard.begin(toolCallId)) {
      return
    }
    this.stateStore.notify('approval')
    const request = this.requests.get(requestId)
    this.applyApprovalMemory(pending.call, approval, request)
    if (isFileEditTool(pending.call.name)) {
      const staged = this.stagedEdits.get(toolCallId)
      if (staged) {
        if (approval.decision === 'reject') {
          void this.rejectStagedEdit(toolCallId).finally(() => this.approvalRaceGuard.end(toolCallId))
          return
        }
        if (approval.selectedHunkIndexes) {
          void this.restoreStagedEdit(staged).then(() => this.verifyExternalEdit(pending, approval)).catch(error => {
            pending.resolve({ decision: 'reject', reason: error instanceof Error ? error.message : 'Ghost could not prepare the selected hunks.' })
          }).finally(() => this.approvalRaceGuard.end(toolCallId))
          return
        }
        void this.acceptStagedApproval(pending, staged, approval).finally(() => this.approvalRaceGuard.end(toolCallId))
        return
      }
      void this.verifyExternalEdit(pending, approval).finally(() => this.approvalRaceGuard.end(toolCallId))
      return
    }
    this.pendingApprovals.delete(toolCallId)
    pending.resolve(approval)
    this.approvalRaceGuard.end(toolCallId)
  }

  private async acceptStagedApproval(
    pending: PendingToolApproval,
    staged: StagedEdit,
    approval: GhostToolApproval
  ): Promise<void> {
    try {
      await this.saveStagedEdit(staged)
      this.stagedEdits.delete(staged.toolCallId)
      this.stagedEditChanges.fire()
      await this.finishAlreadyAppliedEdit(pending, {
        ...approval,
        alreadyApplied: true,
        appliedContent: staged.after,
        expectedContent: staged.before
      })
    } catch (error) {
      const ghostError = toGhostError(error, 'approval.failed', { retryable: true })
      pending.resolve({ decision: 'reject', reason: ghostError.message || 'Ghost could not accept the edit.' })
    }
  }

  private async saveStagedEdit(staged: StagedEdit): Promise<void> {
    const document = await vscode.workspace.openTextDocument(staged.uri)
    if (document.getText() !== staged.after) {
      throw new GhostError('The source file changed while Ghost was waiting for edit approval.', { code: 'approval.conflict', retryable: true })
    }

    const beforeSave = await readWorkspaceFile(staged.uri)
    if (!sameWorkspaceFile(beforeSave, { exists: true, content: staged.before })) {
      throw new GhostError('File changed externally while Ghost was waiting for edit approval. Refresh and rebase the edit before retrying.', { code: 'approval.conflict', retryable: true })
    }

    await document.save()
    const savedContent = await readWorkspaceFile(staged.uri)
    if (!sameWorkspaceFile(savedContent, { exists: true, content: staged.after })) {
      if (!sameWorkspaceFile(savedContent, beforeSave)) {
        throw new GhostError('File changed externally while Ghost was being saved. Refresh and rebase the edit before retrying.', { code: 'approval.conflict', retryable: true })
      }
      await atomicWriteFile(staged.uri, Buffer.from(staged.after, 'utf8'), beforeSave)
    }
  }

  private async finishAlreadyAppliedEdit(pending: PendingToolApproval, approval: GhostToolApproval): Promise<void> {
    this.pendingApprovals.delete(pending.toolCallId)
    if (typeof pending.call.arguments.path !== 'string' || approval.appliedContent === undefined) {
      pending.resolve(approval)
      return
    }
    try {
      const uri = resolveWorkspacePath(pending.call.arguments.path)
      const current = await readWorkspaceFile(uri)
      if (!current.exists || current.content !== approval.appliedContent) {
        pending.resolve({ decision: 'reject', reason: 'The accepted edit changed before Ghost could finish the request.' })
        return
      }
      await this.rememberRecovery(
        pending.requestId,
        pending.conversationId,
        pending.toolCallId,
        pending.call,
        approval.expectedContent === undefined && approval.expectedFileExists === undefined
          ? undefined
          : { exists: approval.expectedFileExists ?? true, content: approval.expectedContent ?? '' },
        undefined,
        approval.selectedHunkIndexes
      )
      pending.resolve(approval)
    } catch {
      pending.resolve({ decision: 'reject', reason: 'Ghost could not verify the accepted edit.' })
    }
  }

  private async verifyExternalEdit(pending: PendingToolApproval, approval: GhostToolApproval): Promise<void> {
    const expected = pending.expectedContent
    const expectedFileExists = pending.expectedFileExists
    const expectedFiles = pending.expectedFiles
    if (!expectedFiles && (expected === undefined && expectedFileExists === undefined || typeof pending.call.arguments.path !== 'string')) {
      this.pendingApprovals.delete(pending.toolCallId)
      pending.resolve(approval)
      return
    }
    const request = this.requests.get(pending.requestId)
    if (request) {
      request.timing.verificationStartedAt = this.clock.now()
    }
    try {
      this.pendingApprovals.delete(pending.toolCallId)
      if (expectedFiles) {
        for (const [path, expectedFile] of Object.entries(expectedFiles)) {
          const current = await readWorkspaceFile(vscode.Uri.file(path))
          if (!sameWorkspaceFile(current, expectedFile)) {
            pending.resolve({ decision: 'reject', reason: 'File changed externally since the diff was shown. Refresh and rebase the transaction before retrying.' })
            return
          }
        }
      } else {
        const uri = resolveWorkspacePath(pending.call.arguments.path as string)
        const current = await readWorkspaceFile(uri)
        if ((expectedFileExists !== undefined && current.exists !== expectedFileExists)
          || (expected !== undefined && current.content !== expected)) {
          pending.resolve({ decision: 'reject', reason: 'File changed externally since the diff was shown. Refresh and rebase the edit before retrying.' })
          return
        }
      }
      await this.rememberRecovery(
        pending.requestId,
        pending.conversationId,
        pending.toolCallId,
        pending.call,
        expectedFiles ? undefined : (expected === undefined && expectedFileExists === undefined
          ? undefined
          : { exists: expectedFileExists ?? true, content: expected ?? '' }),
        expectedFiles,
        approval.selectedHunkIndexes
      )
      pending.resolve({ ...approval, expectedContent: expected, expectedFileExists, expectedFiles })
    } catch {
      this.pendingApprovals.delete(pending.toolCallId)
      pending.resolve({ decision: 'reject', reason: 'Edit path is outside the workspace.' })
    } finally {
      if (request?.timing.verificationStartedAt !== undefined) {
        request.timing.verificationMs += Math.max(0, this.clock.now() - request.timing.verificationStartedAt)
        request.timing.verificationStartedAt = undefined
      }
    }
  }

  private async editToolArguments(
    requestId: string,
    conversationId: string,
    toolCallId: string,
    argumentsPayload: GhostToolArguments
  ): Promise<void> {
    const pending = this.pendingApprovals.get(toolCallId)
    if (!pending || pending.requestId !== requestId || pending.conversationId !== conversationId) {
      return
    }
    const pathTools = new Set(['ghost_read_file', 'ghost_write_file', 'ghost_apply_edit', 'ghost_list_directory'])
    const requiredArgument = pathTools.has(pending.call.name)
      ? 'path'
      : pending.call.name === 'ghost_run_terminal_command'
        ? 'command'
        : undefined
    if (requiredArgument && (typeof argumentsPayload[requiredArgument] !== 'string' || !argumentsPayload[requiredArgument].trim())) {
      const request = this.requests.get(requestId)
      if (!request) {
        return
      }
      this.postStreamEvent(requestId, request, {
        type: 'tool-requested',
        tool: pending.call.name,
        toolCallId,
        arguments: pending.call.arguments,
        requiresApproval: true,
        detail: `Arguments rejected: ${pending.call.name} requires a non-empty '${requiredArgument}'.`,
        phase: 'tool'
      })
      return
    }
    pending.call.arguments = argumentsPayload
    const expectedFiles = isFileEditTool(pending.call.name)
      ? await this.getExpectedFileSnapshots(pending.call)
      : undefined
    if (isFileEditTool(pending.call.name) && !expectedFiles) {
      pending.resolve({ decision: 'reject', reason: 'Ghost could not read the file safely. Refresh the file and retry.' })
      return
    }
    const expectedSnapshot = typeof pending.call.arguments.path === 'string' && expectedFiles
      ? expectedFiles[resolveWorkspacePath(pending.call.arguments.path).fsPath]
      : undefined
    pending.expectedContent = expectedSnapshot?.content
    pending.expectedFileExists = expectedSnapshot?.exists
    pending.expectedFiles = expectedFiles
    const request = this.requests.get(requestId)
    if (!request) {
      return
    }
    const diffPreview = await this.getDiffPreview(pending.call, pending)
    this.postStreamEvent(requestId, request, {
      type: 'tool-requested',
      tool: pending.call.name,
      toolCallId,
      arguments: argumentsPayload,
      requiresApproval: true,
      ...(diffPreview ? { diffPreview } : {}),
      detail: 'Arguments updated. Waiting for approval',
      phase: 'tool'
    })
  }

  private appendRequestEvent(
    request: GhostRequestState,
    event: { type: GhostStreamEvent['type']; [key: string]: unknown },
    status: GhostRequestStatus,
    timestamp: number
  ): void {
    const previous = request.eventLog.at(-1)
    const isDelta = event.type === 'text-delta' || event.type === 'code-delta'
    if (isDelta && previous?.status === status) {
      return
    }
    const detail = event.type === 'thinking' || event.type === 'warning' || event.type === 'error'
      ? typeof event.detail === 'string'
        ? event.detail
        : typeof event.message === 'string'
          ? event.message
          : undefined
      : event.type === 'tool-requested'
        ? typeof event.tool === 'string' ? `Requested ${event.tool}` : 'Tool requested'
        : event.type === 'tool-result'
          ? `${typeof event.tool === 'string' ? event.tool : 'Tool'} ${typeof event.resultStatus === 'string' ? event.resultStatus : 'completed'}`
          : event.type === 'task-plan'
            ? 'Task plan updated'
            : event.type === 'request-completed'
              ? `Request ${typeof event.status === 'string' ? event.status : status}`
              : undefined
    request.eventLog.push({
      timestamp,
      elapsedMs: Math.max(0, timestamp - request.startedAt),
      type: event.type,
      status,
      ...(typeof event.phase === 'string' ? { phase: event.phase as GhostStreamEvent['phase'] } : {}),
      ...(detail ? { detail: redactSensitiveText(detail).slice(0, 500) } : {})
    })
    if (request.eventLog.length > 100) {
      request.eventLog.splice(0, request.eventLog.length - 100)
    }
  }

  private startToolExecution(request: GhostRequestState, toolCallId: string): void {
    if (!request.timing.toolStartedAt.has(toolCallId)) {
      request.timing.toolStartedAt.set(toolCallId, this.clock.now())
    }
  }

  private finishToolExecution(request: GhostRequestState, toolCallId: string): void {
    const startedAt = request.timing.toolStartedAt.get(toolCallId)
    if (startedAt === undefined) {
      return
    }
    request.timing.toolExecutionMs += Math.max(0, this.clock.now() - startedAt)
    request.timing.toolStartedAt.delete(toolCallId)
  }

  private timingSummary(request: GhostRequestState, endedAt = this.clock.now()): Record<string, number> {
    const providerStartedAt = request.timing.providerStartedAt
    const firstTokenAt = request.timing.firstTokenAt
    return {
      contextMs: providerStartedAt === undefined ? Math.max(0, endedAt - request.startedAt) : Math.max(0, providerStartedAt - request.startedAt),
      providerWaitMs: providerStartedAt === undefined || firstTokenAt === undefined ? 0 : Math.max(0, firstTokenAt - providerStartedAt),
      firstTokenMs: firstTokenAt === undefined ? 0 : Math.max(0, firstTokenAt - request.startedAt),
      toolExecutionMs: request.timing.toolExecutionMs,
      approvalWaitMs: request.timing.approvalWaitMs,
      verificationMs: request.timing.verificationMs
    }
  }

  private postStreamEvent(
    requestId: string,
    request: GhostRequestState,
    event: { type: GhostStreamEvent['type']; [key: string]: unknown }
  ): void {
    const timestamp = this.clock.now()
    request.lastActivityAt = timestamp
    request.status = getRequestStatusForEvent(event, request.status)
    if (event.phase === 'provider' && request.timing.providerStartedAt === undefined) {
      request.timing.providerStartedAt = timestamp
    }
    if ((event.type === 'text-delta' || event.type === 'code-delta') && request.timing.firstTokenAt === undefined) {
      request.timing.firstTokenAt = timestamp
    }
    if (event.type === 'tool-requested' && typeof event.toolCallId === 'string') {
      request.timing.approvalStartedAt.set(event.toolCallId, timestamp)
    }
    if (event.type === 'tool-result' && typeof event.toolCallId === 'string') {
      const approvalStartedAt = request.timing.approvalStartedAt.get(event.toolCallId)
      if (approvalStartedAt !== undefined) {
        request.timing.approvalWaitMs += Math.max(0, timestamp - approvalStartedAt)
        request.timing.approvalStartedAt.delete(event.toolCallId)
      }
      this.finishToolExecution(request, event.toolCallId)
    }
    this.appendRequestEvent(request, event, request.status, timestamp)
    request.sequence += 1
    if (event.type === 'tool-requested' && typeof event.toolCallId === 'string' && typeof event.tool === 'string') {
      request.pendingTool = { toolCallId: event.toolCallId, name: event.tool }
    }
    this.postMessage({
      source: 'ghost-extension',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      requestId,
      conversationId: request.conversationId,
      sequence: request.sequence,
      state: request.status,
      phase: event.phase as GhostStreamEvent['phase'],
      elapsedMs: this.clock.now() - request.startedAt,
      model: request.model,
      provider: request.provider,
      tokenCount: request.outputTokens,
      startedAt: request.startedAt,
      ...(request.outputTokens > 0
        ? { tokensPerSecond: request.outputTokens / Math.max((this.clock.now() - request.startedAt) / 1000, 0.001) }
        : {}),
      ...redactSensitiveValue(Object.fromEntries(Object.entries(event).map(([key, value]) => [key, typeof value === 'string' ? redactSensitiveText(value) : value]))),
      ...(event.type === 'request-completed' && request.completionRecord ? { completionRecord: request.completionRecord } : {}),
      ...(event.type === 'request-completed' ? { eventLog: request.eventLog } : {})
    } as GhostStreamEvent)
  }

  private persistenceEnabled(): boolean {
    return this.settings.enableConversationPersistence
  }

  private async readPersistedState(): Promise<GhostPersistedState> {
    const global = this.globalState?.get<StoredGlobalState>(GhostViewProvider.globalStateKey)
    const workspace = this.workspaceState?.get<StoredWorkspaceState>(GhostViewProvider.workspaceStateKey)
    const globalRecord: Record<string, unknown> = isStoredRecord(global) ? global : {}
    const workspaceRecord: Record<string, unknown> = isStoredRecord(workspace) ? workspace : {}
    const state = migratePersistedState({
      schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION,
      conversations: Array.isArray(workspaceRecord.conversations) ? workspaceRecord.conversations : [],
      activeConversationId: typeof workspaceRecord.activeConversationId === 'string' ? workspaceRecord.activeConversationId : undefined,
      promptHistory: globalRecord.promptHistory,
      presets: Array.isArray(globalRecord.presets) ? globalRecord.presets : [],
      showReasoning: typeof globalRecord.showReasoning === 'boolean' ? globalRecord.showReasoning : false,
      preferences: isStoredRecord(globalRecord.preferences) ? globalRecord.preferences : {}
    })
    const safeState = compactPersistedState(JSON.parse(JSON.stringify(state, (_key, value) => typeof value === 'string' ? redactSensitiveText(value) : value)) as GhostPersistedState)
    this.stateStore.setConversationState(safeState)
    return safeState
  }

  private async sendPersistedState(): Promise<void> {
    const state = this.persistenceEnabled()
      ? await this.readPersistedState()
      : { schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION, conversations: [], promptHistory: [], presets: [], showReasoning: false, preferences: {} }
    this.stateStore.setConversationState(state)
    this.postMessage({
      source: 'ghost-extension',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'persisted-state',
      state
    })
  }

  private async persistState(state: GhostPersistedState): Promise<void> {
    this.stateStore.setConversationState(state)
    if (!this.globalState || !this.workspaceState) {
      return
    }
    if (!this.persistenceEnabled()) {
      await this.globalState.update(GhostViewProvider.globalStateKey, undefined)
      await this.workspaceState.update(GhostViewProvider.workspaceStateKey, undefined)
      this.persistedGlobalSnapshot = undefined
      this.persistedWorkspaceSnapshot = undefined
      this.stateStore.notify('persistence')
      return
    }
    const safeState = compactPersistedState(JSON.parse(JSON.stringify(state, (_key, value) => typeof value === 'string' ? redactSensitiveText(value) : value)) as GhostPersistedState)
    const globalState: StoredGlobalState = {
      schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION,
      promptHistory: normalizePromptHistory(safeState.promptHistory),
      presets: safeState.presets ?? [],
      showReasoning: safeState.showReasoning === true,
      preferences: safeState.preferences ?? {}
    }
    const workspaceState: StoredWorkspaceState = {
      schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION,
      conversations: safeState.conversations ?? [],
      activeConversationId: safeState.activeConversationId
    }
    const globalSnapshot = JSON.stringify(globalState)
    const workspaceSnapshot = JSON.stringify(workspaceState)
    const writes: Thenable<void>[] = []
    if (globalSnapshot !== this.persistedGlobalSnapshot) {
      writes.push(this.globalState.update(GhostViewProvider.globalStateKey, globalState))
      this.persistedGlobalSnapshot = globalSnapshot
    }
    if (workspaceSnapshot !== this.persistedWorkspaceSnapshot) {
      writes.push(this.workspaceState.update(GhostViewProvider.workspaceStateKey, workspaceState))
      this.persistedWorkspaceSnapshot = workspaceSnapshot
    }
    await Promise.all(writes)
    this.stateStore.setConversationState(safeState)
    this.stateStore.notify('persistence')
  }

  private async clearPersistedState(): Promise<void> {
    await Promise.all([
      this.globalState?.update(GhostViewProvider.globalStateKey, undefined),
      this.workspaceState?.update(GhostViewProvider.workspaceStateKey, undefined)
    ])
    this.persistedGlobalSnapshot = undefined
    this.persistedWorkspaceSnapshot = undefined
    this.stateStore.setConversationState({
      schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION,
      conversations: [],
      activeConversationId: '',
      promptHistory: [],
      presets: [],
      showReasoning: false,
      preferences: {}
    })
    this.stateStore.notify('persistence')
  }

  private async importState(): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFolders: false,
      canSelectFiles: true,
      openLabel: 'Import Ghost conversations',
      filters: { JSON: ['json'] }
    })
    if (!files?.[0]) {
      return
    }
    try {
      const parsed = JSON.parse(new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(files[0]))) as unknown
      const state = parseGhostImportState(parsed)
      await this.persistState(state)
      this.postMessage({
        source: 'ghost-extension',
        version: GHOST_WEBVIEW_PROTOCOL_VERSION,
        type: 'persisted-state',
        state
      })
      await vscode.window.showInformationMessage('Ghost conversations imported.')
    } catch (error) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Ghost could not import that file.')
    }
  }

  private async readProviderStatus(settings: GhostSettings): Promise<ProviderStatus> {
    const client = settings.provider === 'opencode'
      ? new OpenCodeClient(settings.openCodeUrl, {
          username: settings.openCodeUsername,
          password: () => this.providerApiKey?.('opencode')
        })
      : settings.provider === 'mlx-vlm'
      ? new MlxClient(settings.mlxUrl, undefined, () => this.providerApiKey?.('mlx-vlm'))
      : settings.provider === 'openai-compatible'
        ? createProfiledProviderClient(settings, () => this.providerApiKey?.('openai-compatible'))
        : new OllamaClient(settings.ollamaUrl, 'ollama', undefined, () => this.providerApiKey?.('ollama'))
    const adapter = createProviderAdapter(settings.provider, client)
    const online = await client.checkHealth(3000)
    if (!online) {
      return {
        connection: 'offline',
        models: [],
        modelMetadata: settings.provider === 'opencode' ? [] : [adapter.capabilities(settings.chatModel)]
      }
    }

    let normalizedModels: string[] = []
    let modelMetadata: ReturnType<typeof adapter.capabilities>[] = []
    try {
      if (settings.provider === 'opencode' && client instanceof OpenCodeClient) {
        const discoveredModels = await client.listModelsWithMetadata()
        normalizedModels = [...new Set(discoveredModels.map(model => model.id))]
        modelMetadata = discoveredModels.map(model => {
          const capabilities = adapter.capabilities(model.id)
          return {
            ...capabilities,
            ...(model.displayName ? { displayName: model.displayName } : {}),
            ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
            ...(model.outputLimit === undefined ? {} : { outputLimit: model.outputLimit }),
            ...(model.pricing ? { pricing: model.pricing } : {}),
            pricingStatus: model.pricingStatus
          }
        })
      } else {
        const models = client.listModels ? await client.listModels() : []
        normalizedModels = [...new Set(models.filter(model => typeof model === 'string' && model.trim()).map(model => model.trim()))]
        const metadataModels = [...new Set([...normalizedModels, settings.chatModel])]
        modelMetadata = metadataModels.map(model => adapter.capabilities(model))
      }
    } catch (error) {
      this.log('warn', 'provider is online but model discovery failed', error instanceof Error ? error.message : String(error))
    }
    return {
      connection: 'online',
      models: normalizedModels,
      modelMetadata
    }
  }

  private async getProviderStatus(settings: GhostSettings, forceRefresh = false): Promise<ProviderStatus> {
    const key = providerStatusKey(settings, Boolean(this.providerApiKey?.(settings.provider)))
    const cached = this.providerStatusCache
    if (!forceRefresh && cached?.key === key && this.clock.now() - cached.checkedAt < GhostViewProvider.providerStatusCacheTtlMs) {
      return cached
    }
    if (this.providerStatusRequest?.key === key) {
      return this.providerStatusRequest.promise
    }

    const promise: Promise<ProviderStatus> = this.readProviderStatus(settings).catch(error => {
      this.log('warn', 'provider health check failed', error instanceof Error ? error.message : String(error))
      return { connection: 'offline' as const, models: [], modelMetadata: [] }
    })
    this.providerStatusRequest = { key, promise }
    try {
      const result = await promise
      this.providerStatusCache = { ...result, key, checkedAt: this.clock.now() }
      this.stateStore.notify('provider')
      return result
    } finally {
      if (this.providerStatusRequest?.promise === promise) {
        this.providerStatusRequest = undefined
      }
    }
  }

  private getWorkspaceContext(): WorkspaceContextSnapshot {
    if (this.workspaceContextCache) {
      return this.workspaceContextCache
    }

    const editor = vscode.window.activeTextEditor
    const activeFile = editor
      ? {
          name: editor.document.fileName.split(/[\\/]/).pop() ?? editor.document.fileName,
          path: editor.document.uri.fsPath,
          languageId: editor.document.languageId,
          hasSelection: !editor.selection.isEmpty
        }
      : undefined
    const openFiles = vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => {
      const input = tab.input
      if (input && typeof input === 'object' && 'uri' in input && input.uri instanceof vscode.Uri) {
        const folder = vscode.workspace.getWorkspaceFolder(input.uri)
        const rootLabel = folder?.name ?? folder?.uri.fsPath
        return rootLabel ? rootLabel + ': ' + tab.label : tab.label
      }
      return tab.label
    }))
    const snapshot: WorkspaceContextSnapshot = {
      workspaceName: vscode.workspace.name ?? 'Untitled workspace',
      folders: vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [],
      ...(activeFile ? { activeFile } : {}),
      openFiles
    }
    this.workspaceContextCache = snapshot
    return snapshot
  }

  private effectiveAutoAcceptScope(): GhostAutoAcceptScope {
    if (this.sessionAutoAcceptActive) {
      return 'session'
    }
    if (this.settings.autoAcceptScope === 'session') {
      return 'confirm'
    }
    if (this.oneEditConsumed && this.settings.autoAcceptScope === 'one-edit') {
      return 'confirm'
    }
    return this.settings.autoAcceptScope
  }

  private async resetPersistedSessionAutoAccept(): Promise<void> {
    if (this.settings.autoAcceptScope !== 'session') {
      return
    }
    await ghostConfig.update('autoAcceptScope', 'confirm')
    await ghostConfig.update('fileEditApproval', legacyFileEditApprovalMirror('confirm'))
  }

  private async revertOneEditAutoAccept(): Promise<void> {
    if (this.settings.autoAcceptScope !== 'one-edit') {
      return
    }
    await ghostConfig.update('autoAcceptScope', 'confirm')
    await ghostConfig.update('fileEditApproval', legacyFileEditApprovalMirror('confirm'))
  }

  private async sendControlsState(forceProviderRefresh = false, pollOnly = false): Promise<void> {
    const generation = ++this.controlsStateGeneration
    const settings = this.settings
    const previousProviderStatus = this.providerStatusCache
    const providerStatus = await this.getProviderStatus(settings, forceProviderRefresh)
    if (this.disposed || generation !== this.controlsStateGeneration) {
      return
    }

    const connection: 'online' | 'offline' = providerStatus.connection
    this.scheduleProviderStatusPoll(settings)
    const providerStatusChanged = !previousProviderStatus
      || previousProviderStatus.connection !== providerStatus.connection
      || JSON.stringify(previousProviderStatus.models) !== JSON.stringify(providerStatus.models)
      || JSON.stringify(previousProviderStatus.modelMetadata) !== JSON.stringify(providerStatus.modelMetadata)
    if (pollOnly && !providerStatusChanged) {
      return
    }
    let models = providerStatus.models
    if (models.length === 0 && settings.provider !== 'opencode') {
      models = [settings.chatModel]
    }
    const modelMetadata = providerStatus.modelMetadata.map(toGhostModelMetadata)

    const workspaceContext = this.getWorkspaceContext()
    const allowedTools = GHOST_TOOL_NAMES.filter(tool => !(settings.toolDenylist ?? []).includes(tool))

    this.postMessage({
      source: 'ghost-extension',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'controls-state',
      settings: {
        provider: settings.provider,
        chatModel: settings.chatModel,
        autocompleteModel: settings.autocompleteModel,
        modelProfile: settings.modelProfile,
        modelAliases: settings.modelAliases,
        modelProfiles: settings.modelProfiles,
        maxContextTokens: settings.maxContextTokens,
        temperature: settings.temperature,
        topP: settings.topP,
        topK: settings.topK,
        minP: settings.minP,
        presencePenalty: settings.presencePenalty,
        repeatPenalty: settings.repeatPenalty,
        responseLength: settings.responseLength,
        mode: settings.mode,
        autoAcceptScope: this.effectiveAutoAcceptScope(),
        enableInlineCompletions: settings.enableInlineCompletions,
        enableConversationPersistence: settings.enableConversationPersistence,
        ollamaUrl: settings.ollamaUrl,
        mlxUrl: settings.mlxUrl,
        openaiUrl: resolveOpenAiProfileEndpoint(settings.openaiProfile, settings.openaiUrl),
        openaiProfile: settings.openaiProfile,
        openaiApiVersion: settings.openaiApiVersion,
        openaiCustomModelsPath: settings.openaiCustomModelsPath,
        openaiCustomChatPath: settings.openaiCustomChatPath,
        openaiCustomRequestTemplate: settings.openaiCustomRequestTemplate,
        openaiCustomResponseFormat: settings.openaiCustomResponseFormat,
        openaiApiKeyHeader: settings.openaiApiKeyHeader,
        openaiApiKeyPrefix: settings.openaiApiKeyPrefix,
        openaiOrganizationHeader: settings.openaiOrganizationHeader,
        openaiOrganization: settings.openaiOrganization,
        openaiProjectHeader: settings.openaiProjectHeader,
        openaiProject: settings.openaiProject,
        openaiProxy: settings.openaiProxy,
        openaiNoProxy: settings.openaiNoProxy,
        openaiTlsRejectUnauthorized: settings.openaiTlsRejectUnauthorized,
        openaiTlsCaFile: settings.openaiTlsCaFile,
        openaiTlsCertFile: settings.openaiTlsCertFile,
        openaiTlsKeyFile: settings.openaiTlsKeyFile,
        openCodeUrl: settings.openCodeUrl,
        openCodeUsername: settings.openCodeUsername,
        openCodeAgent: settings.openCodeAgent,
        openCodeSessionReuse: settings.openCodeSessionReuse,
        toolAllowlist: settings.toolAllowlist ?? [...GHOST_TOOL_NAMES],
        toolAsklist: settings.toolAsklist ?? [],
        toolDenylist: settings.toolDenylist ?? [],
        terminalEnvironmentAllowlist: settings.terminalEnvironmentAllowlist,
        terminalEnvironmentAsklist: settings.terminalEnvironmentAsklist,
        enableDebugLogging: settings.enableDebugLogging,
        logLevel: effectiveGhostLogLevel(settings.logLevel, settings.enableDebugLogging),
        networkAccess: isExternalEndpoint(settings.provider === 'opencode' ? settings.openCodeUrl : settings.provider === 'mlx-vlm' ? settings.mlxUrl : settings.provider === 'openai-compatible' ? resolveOpenAiProfileEndpoint(settings.openaiProfile, settings.openaiUrl) : settings.ollamaUrl) ? 'external' : 'local'
      },
      models,
      modelMetadata,
      connection,
      firstRunSetupComplete: this.globalState?.get<boolean>(GhostViewProvider.firstRunSetupCompleteKey) === true,
      context: workspaceContext,
      tools: allowedTools
    })
  }

  private scheduleProviderStatusPoll(settings: GhostSettings): void {
    const pollKey = providerStatusKey(settings, Boolean(this.providerApiKey?.(settings.provider)))
    if (this.providerStatusPollKey !== pollKey) {
      this.stopProviderStatusPoll()
      this.providerStatusPollKey = pollKey
    }
    if (this.providerStatusPollTimer !== undefined) {
      return
    }
    this.providerStatusPollTimer = setTimeout(() => {
      this.providerStatusPollTimer = undefined
      if (this.disposed || this.providerStatusPollKey !== pollKey) {
        return
      }
      void this.sendControlsState(true, true)
    }, GhostViewProvider.providerStatusPollIntervalMs)
  }

  private stopProviderStatusPoll(): void {
    if (this.providerStatusPollTimer !== undefined) {
      clearTimeout(this.providerStatusPollTimer)
      this.providerStatusPollTimer = undefined
    }
    this.providerStatusPollKey = undefined
  }

  private async testProvider(): Promise<void> {
    const settings = this.settings
    const providerStatus = await this.getProviderStatus(settings, true)
    if (providerStatus.connection === 'online') {
      await vscode.window.showInformationMessage(`${settings.provider} provider is reachable.`)
    } else {
      await vscode.window.showErrorMessage(`${settings.provider} provider is not reachable.`)
    }
    await this.sendControlsState()
  }

  private async updateSettings(update: GhostSettingsUpdate): Promise<void> {
    const target = update.workspaceOnly ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    const settingsBeforeUpdate = this.settings
    const sameStringList = (left: string[], right: string[] | undefined): boolean => {
      const rightSet = new Set(right ?? [])
      return left.length === rightSet.size && left.every(item => rightSet.has(item))
    }
    const updatePermissionList = async (
      setting: 'toolAllowlist' | 'toolAsklist' | 'toolDenylist' | 'terminalEnvironmentAllowlist' | 'terminalEnvironmentAsklist',
      value: string[],
      previousValue: string[] | undefined
    ): Promise<void> => {
      if (sameStringList(value, previousValue)) {
        return
      }
      await ghostConfig.update(setting, value, target)
      if (target === vscode.ConfigurationTarget.Global) {
        await ghostConfig.clear(setting, vscode.ConfigurationTarget.Workspace)
      }
    }
    if (typeof update.ollamaUrl === 'string' && update.ollamaUrl.trim()) {
      await ghostConfig.update('ollamaUrl', update.ollamaUrl.trim(), target)
    }
    if (typeof update.mlxUrl === 'string' && update.mlxUrl.trim()) {
      await ghostConfig.update('mlxUrl', update.mlxUrl.trim(), target)
    }
    if (typeof update.openaiUrl === 'string' && update.openaiUrl.trim()) {
      await ghostConfig.update('openaiUrl', update.openaiUrl.trim(), target)
    }
    if (typeof update.openCodeUrl === 'string' && update.openCodeUrl.trim()) {
      await ghostConfig.update('openCodeUrl', update.openCodeUrl.trim(), target)
    }
    if (typeof update.openCodeUsername === 'string' && update.openCodeUsername.trim()) {
      await ghostConfig.update('openCodeUsername', update.openCodeUsername.trim(), target)
    }
    if (typeof update.openCodeAgent === 'string') {
      await ghostConfig.update('openCodeAgent', update.openCodeAgent.trim(), target)
    }
    if (update.openCodeSessionReuse === 'workspace' || update.openCodeSessionReuse === 'new') {
      await ghostConfig.update('openCodeSessionReuse', update.openCodeSessionReuse, target)
    }
    if (typeof update.openaiProfile === 'string') {
      await ghostConfig.update('openaiProfile', update.openaiProfile, target)
    }
    if (typeof update.openaiApiVersion === 'string' && update.openaiApiVersion.trim()) {
      await ghostConfig.update('openaiApiVersion', update.openaiApiVersion.trim(), target)
    }
    const customHttpSettings = [
      'openaiCustomModelsPath',
      'openaiCustomChatPath',
      'openaiCustomRequestTemplate'
    ] as const
    for (const setting of customHttpSettings) {
      const value = update[setting]
      if (typeof value === 'string') {
        await ghostConfig.update(setting, value, target)
      }
    }
    if (update.openaiCustomResponseFormat) {
      await ghostConfig.update('openaiCustomResponseFormat', update.openaiCustomResponseFormat, target)
    }
    const openAiTextSettings = [
      'openaiApiKeyHeader',
      'openaiApiKeyPrefix',
      'openaiOrganizationHeader',
      'openaiOrganization',
      'openaiProjectHeader',
      'openaiProject',
      'openaiProxy',
      'openaiNoProxy',
      'openaiTlsCaFile',
      'openaiTlsCertFile',
      'openaiTlsKeyFile'
    ] as const
    for (const setting of openAiTextSettings) {
      const value = update[setting]
      if (typeof value === 'string') {
        await ghostConfig.update(setting, value.trim(), target)
      }
    }
    if (typeof update.openaiTlsRejectUnauthorized === 'boolean') {
      await ghostConfig.update('openaiTlsRejectUnauthorized', update.openaiTlsRejectUnauthorized, target)
    }
    if (Array.isArray(update.toolAllowlist)) {
      await updatePermissionList('toolAllowlist', update.toolAllowlist, settingsBeforeUpdate.toolAllowlist)
    }
    if (Array.isArray(update.toolAsklist)) {
      await updatePermissionList('toolAsklist', update.toolAsklist, settingsBeforeUpdate.toolAsklist)
    }
    if (Array.isArray(update.toolDenylist)) {
      await updatePermissionList('toolDenylist', update.toolDenylist, settingsBeforeUpdate.toolDenylist)
    }
    if (Array.isArray(update.terminalEnvironmentAllowlist)) {
      await updatePermissionList(
        'terminalEnvironmentAllowlist',
        update.terminalEnvironmentAllowlist,
        settingsBeforeUpdate.terminalEnvironmentAllowlist
      )
    }
    if (Array.isArray(update.terminalEnvironmentAsklist)) {
      await updatePermissionList(
        'terminalEnvironmentAsklist',
        update.terminalEnvironmentAsklist,
        settingsBeforeUpdate.terminalEnvironmentAsklist
      )
    }
    if (update.provider) {
      await ghostConfig.update('provider', update.provider, target)
    }
    if (typeof update.chatModel === 'string' && update.chatModel.trim()) {
      await ghostConfig.update('chatModel', update.chatModel.trim(), target)
    }
    if (typeof update.autocompleteModel === 'string' && update.autocompleteModel.trim()) {
      await ghostConfig.update('autocompleteModel', update.autocompleteModel.trim(), target)
    }
    if (typeof update.modelProfile === 'string') {
      await ghostConfig.update('modelProfile', update.modelProfile.trim(), target)
    }
    if (update.modelAliases && typeof update.modelAliases === 'object') {
      await ghostConfig.update('modelAliases', update.modelAliases, target)
    }
    if (update.modelProfiles && typeof update.modelProfiles === 'object') {
      await ghostConfig.update('modelProfiles', update.modelProfiles, target)
    }
    if (typeof update.maxContextTokens === 'number' && Number.isFinite(update.maxContextTokens)) {
      await ghostConfig.update('maxContextTokens', Math.max(1, Math.floor(update.maxContextTokens)), target)
    }
    if (typeof update.temperature === 'number' && Number.isFinite(update.temperature)) {
      await ghostConfig.update('temperature', Math.min(2, Math.max(0, update.temperature)), target)
    }
    if (typeof update.topP === 'number' && Number.isFinite(update.topP)) {
      await ghostConfig.update('topP', Math.min(1, Math.max(0, update.topP)), target)
    }
    if (typeof update.topK === 'number' && Number.isFinite(update.topK)) {
      await ghostConfig.update('topK', Math.max(0, Math.floor(update.topK)), target)
    }
    if (typeof update.minP === 'number' && Number.isFinite(update.minP)) {
      await ghostConfig.update('minP', Math.min(1, Math.max(0, update.minP)), target)
    }
    if (typeof update.presencePenalty === 'number' && Number.isFinite(update.presencePenalty)) {
      await ghostConfig.update('presencePenalty', Math.min(2, Math.max(-2, update.presencePenalty)), target)
    }
    if (typeof update.repeatPenalty === 'number' && Number.isFinite(update.repeatPenalty)) {
      await ghostConfig.update('repeatPenalty', Math.min(3, Math.max(0, update.repeatPenalty)), target)
    }
    if (update.responseLength) {
      await ghostConfig.update('responseLength', update.responseLength, target)
    }
    if (update.mode) {
      await ghostConfig.update('mode', update.mode, target)
    }
    if (typeof update.enableInlineCompletions === 'boolean') {
      await ghostConfig.update('enableInlineCompletions', update.enableInlineCompletions, target)
    }
    if (update.autoAcceptScope) {
      if (update.autoAcceptScope !== 'confirm' && this.effectiveAutoAcceptScope() !== update.autoAcceptScope) {
        const choice = await vscode.window.showWarningMessage(
          `Auto-accept can change workspace files without asking. Scope: ${update.autoAcceptScope}. Terminal and other dangerous tools still require approval.`,
          { modal: true },
          'Enable auto-accept'
        )
        if (choice !== 'Enable auto-accept') {
          await this.sendControlsState()
          return
        }
      }
      this.sessionAutoAcceptActive = update.autoAcceptScope === 'session'
      this.oneEditConsumed = false
      const persistedScope = update.autoAcceptScope === 'session' ? 'confirm' : update.autoAcceptScope
      await ghostConfig.update('autoAcceptScope', persistedScope, target)
      await ghostConfig.update('fileEditApproval', legacyFileEditApprovalMirror(persistedScope), target)
    } else if (update.fileEditApproval) {
      const scope = update.fileEditApproval === 'auto' ? 'request' : update.fileEditApproval
      this.sessionAutoAcceptActive = scope === 'session'
      this.oneEditConsumed = false
      const persistedScope = scope === 'session' ? 'confirm' : scope
      await ghostConfig.update('autoAcceptScope', persistedScope, target)
      await ghostConfig.update('fileEditApproval', legacyFileEditApprovalMirror(persistedScope), target)
    }
    if (typeof update.enableConversationPersistence === 'boolean') {
      await ghostConfig.update('enableConversationPersistence', update.enableConversationPersistence, target)
      if (!update.enableConversationPersistence) {
        await this.clearPersistedState()
      }
    }
    if (typeof update.enableDebugLogging === 'boolean') {
      await ghostConfig.update('enableDebugLogging', update.enableDebugLogging, target)
    }
    if (update.logLevel) {
      await ghostConfig.update('logLevel', update.logLevel, target)
      await ghostConfig.update('enableDebugLogging', update.logLevel === 'debug', target)
    }
    await this.sendControlsState()
  }

  private async pickFiles(): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      canSelectFiles: true,
      openLabel: 'Attach to Ghost'
    })
    if (!files) {
      return
    }
    this.postMessage({
      source: 'ghost-extension',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'file-picked',
      attachments: files.map(file => ({ name: file.path.split(/[\\/]/).pop() ?? file.fsPath, path: file.fsPath }))
    })
  }

  async export(state?: GhostPersistedState): Promise<void> {
    const settings = this.settings
    const defaultUri = vscode.workspace.workspaceFolders?.[0]
      ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'ghost-export.json')
      : undefined
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      saveLabel: 'Export Ghost',
      filters: { JSON: ['json'] }
    })

    if (!target) {
      return
    }

    const exportState = state ?? await this.readPersistedState()
    const exportData = createGhostExportData(settings, exportState)
    await atomicWriteFile(target, Buffer.from(JSON.stringify(exportData, null, 2), 'utf8'))
    await vscode.window.showInformationMessage(`Ghost interface exported to ${target.fsPath}.`)
  }

  dispose(): void {
    this.stopProviderStatusPoll()
    this.webviewLifecycle.dispose()
    this.cancelRequests()
    for (const request of this.requests.values()) {
      request.cancellation.dispose()
    }
    this.requestOrchestrator.clear()
    this.pendingApprovals.clear()
    this.pendingProviderPermissionApprovals.clear()
    this.approvalRaceGuard.clear()
    for (const staged of this.stagedEdits.values()) {
      void this.restoreStagedEdit(staged)
    }
    this.stateStore.clearTransientState()
    this.stateStore.dispose()
    vscode.Disposable.from(...this.disposables).dispose()
    this.disposables.length = 0
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = decodeGhostWebviewMessage(value)
    if (!message) {
      return
    }

    switch (message.type) {
      case 'ready':
        this.negotiatedProtocolVersion = negotiateGhostProtocolVersion(message.supportedVersions ?? [message.version]) ?? GHOST_WEBVIEW_PROTOCOL_VERSION
        this.postMessage({
          source: 'ghost-extension',
          version: GHOST_WEBVIEW_PROTOCOL_VERSION,
          type: 'protocol-negotiated',
          negotiatedVersion: this.negotiatedProtocolVersion,
          supportedVersions: [...GHOST_SUPPORTED_PROTOCOL_VERSIONS]
        })
        await this.sendPersistedState()
        this.postState()
        await this.sendControlsState()
        return
      case 'reset':
        await this.reset()
        return
      case 'clear':
        this.clear()
        return
      case 'export':
        await this.export(message.state)
        return
      case 'import':
        await this.importState()
        return
      case 'persist-state':
        try {
          await this.persistState(message.state)
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Unknown storage error'
          this.log('error', 'conversation persistence failed', detail)
          await vscode.window.showWarningMessage(`Ghost could not save conversation history: ${detail}`)
        }
        return
      case 'check-status':
        await vscode.commands.executeCommand('ghost.checkProviderStatus')
        return
      case 'test-provider':
        await this.testProvider()
        return
      case 'set-provider-api-key':
        await vscode.commands.executeCommand('ghost.setProviderApiKey')
        return
      case 'complete-first-run':
        await this.globalState?.update(GhostViewProvider.firstRunSetupCompleteKey, true)
        return
      case 'submit':
        await this.submit(message.requestId, message.conversationId, message.prompt, message.options, message.attachments)
        return
      case 'continue':
        await this.continueRequest(message.requestId, message.conversationId, message.resume, message.options)
        return
      case 'cancel':
        this.cancel(message.requestId, message.conversationId)
        return
      case 'disable-auto-accept':
        this.disableAutoAccept(message.requestId, message.conversationId)
        return
      case 'retry-tool':
        await this.retryFailedTool(message.requestId, message.conversationId, message.toolCallId, {
          name: message.tool as LocalToolName,
          arguments: message.arguments
        })
        return
      case 'approve-all-files':
        this.approveAllPendingFiles(message.requestId, message.conversationId)
        return
      case 'approve-tool':
        this.decideToolApproval(message.requestId, message.conversationId, message.toolCallId, {
          decision: message.decision,
          selectedHunkIndexes: message.selectedHunkIndexes
        })
        return
      case 'reject-tool':
        this.decideToolApproval(message.requestId, message.conversationId, message.toolCallId, { decision: 'reject' })
        return
      case 'cancel-tool':
        this.cancel(message.requestId, message.conversationId)
        return
      case 'edit-tool':
        await this.editToolArguments(message.requestId, message.conversationId, message.toolCallId, message.arguments)
        return
      case 'restore-tool':
        await this.restoreTool(message.requestId, message.conversationId, message.toolCallId)
        return
      case 'open-file':
        await this.openFile(message.path, message.line)
        return
      case 'load-controls':
        await this.sendControlsState()
        return
      case 'refresh-models':
        await this.sendControlsState(true)
        return
      case 'update-settings':
        await this.updateSettings(message.settings)
        return
      case 'pick-file':
        await this.pickFiles()
        return
      case 'select-model':
        await this.updateSettings({ chatModel: message.model })
        return
      case 'retry':
      case 'regenerate':
      case 'edit':
      case 'attach':
      case 'remove-context':
        return
    }
  }

  private postState(): void {
    const detail = this.status === 'ready'
      ? 'Local interface ready'
      : 'Ollama is offline'
    this.postMessage({
      source: 'ghost-extension',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'state',
      status: this.status,
      detail
    })
  }

  private postMessage(message: GhostExtensionMessage): void {
    if (this.disposed) {
      return
    }
    if (!this.view && !this.messenger) {
      if (['request-started', 'thinking', 'text-delta', 'code-delta', 'tool-requested', 'tool-result', 'warning', 'error', 'request-completed'].includes(message.type)) {
        return
      }
      this.pendingMessages.push(message)
      return
    }

    const safeMessage = redactSensitiveValue(message) as GhostExtensionMessage
    const outbound = { ...safeMessage, version: this.negotiatedProtocolVersion }
    if (this.messenger) {
      void this.messenger.postMessage(outbound)
      return
    }
    void this.view?.webview.postMessage(outbound)
  }

  private createMessage(type: 'reset' | 'clear'): GhostExtensionMessage {
    return {
      source: 'ghost-extension',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type,
      action: 'explicit-user-command'
    }
  }
}
