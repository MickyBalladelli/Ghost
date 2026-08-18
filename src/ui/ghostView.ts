import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'

import { createChatParticipantHandler, GhostRequestOptions, GhostToolApproval } from '../agent/chatParticipant'
import { LocalToolExecutor } from '../tools/localToolExecutor'
import { auditTerminalCommand, formatTerminalAudit } from '../tools/terminalTools'
import type { LocalToolCall, LocalToolName } from '../agent/toolCallParser'
import { GHOST_TOOL_NAMES, ghostConfig, getGhostSettings, GhostAutoAcceptScope, GhostProvider } from '../config'
import { MlxClient } from '../services/mlxClient'
import { OllamaClient } from '../services/ollamaClient'
import { createProfiledProviderClient } from '../services/profiledProviderClient'
import { resolveOpenAiProfileEndpoint } from '../services/providerProfiles'
import { resolveWorkspacePath } from '../tools/workspacePath'
import { applyGhostEdit, parseGhostEdit } from '../tools/editWorkflow'
import { atomicWriteFile } from '../tools/atomicFile'
import { readWorkspaceFile, sameWorkspaceFile, WorkspaceFileSnapshot } from '../tools/workspaceFile'
import { parseFileTransaction, prepareFileTransaction } from '../tools/transactionWorkflow'
import { isExternalEndpoint, redactSensitiveText, redactSensitiveValue } from '../privacy/redact'
import {
  GHOST_WEBVIEW_PROTOCOL_VERSION,
  GHOST_PERSISTENCE_SCHEMA_VERSION,
  GhostAttachment,
  GhostContinuation,
  GhostExtensionMessage,
  GhostPersistedState,
  GhostRequestEvent,
  GhostSettingsUpdate,
  GhostStreamEvent,
  GhostToolArguments,
  GhostToolDiffPreview,
  GhostViewStatus,
  GhostWebviewRequestOptions,
  decodeGhostWebviewMessage
} from './ghostProtocol'
import type { GhostRequestStatus, GhostStopReason } from './ghostState'
import { getRequestStatusForEvent } from './requestState'
import { migratePersistedState, normalizePromptHistory } from './persistenceModel'
import { parseTaskPlanMarker } from '../agent/taskPlan'
import { CompletionRecord, parseCompletionRecordMarker } from '../agent/completionRecord'
import { awaitCancellable } from '../tools/cancellation'
import { GHOST_RETRY_POLICIES, retryDelay } from '../agent/retryPolicy'

interface GhostRequestState {
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
  outputTokens: number
  eventLog: GhostRequestEvent[]
  completionRecord?: CompletionRecord
  autoAcceptFilePath?: string
  pendingTool?: { toolCallId: string; name: string }
}

interface PendingToolApproval {
  requestId: string
  conversationId: string
  toolCallId: string
  call: LocalToolCall
  expectedContent?: string
  expectedFileExists?: boolean
  expectedFiles?: Record<string, WorkspaceFileSnapshot>
  resolve: (approval: GhostToolApproval) => void
}

interface RecoveryRecord {
  requestId: string
  conversationId: string
  toolCallId: string
  files: Array<{ path: string; before: WorkspaceFileSnapshot; after: WorkspaceFileSnapshot }>
  applied: boolean
}

interface FailedToolRetry {
  requestId: string
  conversationId: string
  call: LocalToolCall
}

interface StagedEdit {
  requestId: string
  conversationId: string
  toolCallId: string
  call: LocalToolCall
  uri: vscode.Uri
  before: string
  after: string
}

interface StoredWorkspaceState {
  schemaVersion: number
  conversations?: unknown[]
  activeConversationId?: string
}

interface StoredGlobalState {
  schemaVersion: number
  promptHistory?: string[]
  presets?: unknown[]
  showReasoning?: boolean
  preferences?: Record<string, unknown>
}

const isStoredRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

export class GhostViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'ghost.chat'
  private static readonly requestTimeoutMs = 2 * 60 * 60 * 1000

  private view: vscode.WebviewView | undefined
  private readonly disposables: vscode.Disposable[] = []
  private readonly requests = new Map<string, GhostRequestState>()
  private readonly completedRequests = new Set<string>()
  private readonly pendingApprovals = new Map<string, PendingToolApproval>()
  private readonly stagedEdits = new Map<string, StagedEdit>()
  private readonly stagedEditChanges = new vscode.EventEmitter<void>()
  private readonly recoveryRecords = new Map<string, RecoveryRecord>()
  private readonly failedToolRetries = new Map<string, FailedToolRetry>()
  private readonly sessionApprovedTools = new Set<string>()
  private sessionApprovedFileEdits = false
  private readonly globalState?: vscode.Memento
  private readonly workspaceState?: vscode.Memento
  private readonly providerApiKey?: (provider: GhostProvider) => string | undefined
  private static readonly globalStateKey = 'ghost.global.v2'
  private static readonly workspaceStateKey = 'ghost.workspace.v2'
  private pendingMessages: GhostExtensionMessage[] = []
  private status: GhostViewStatus = 'ready'
  private disposed = false
  private controlsStateGeneration = 0

  private readonly chatHandler: vscode.ChatRequestHandler

  private debugLog(message: string, details?: unknown): void {
    if (!getGhostSettings().enableDebugLogging) {
      return
    }
    console.debug(JSON.stringify({ scope: 'Ghost', message, details: details === undefined ? undefined : redactSensitiveText(JSON.stringify(details)) }))
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    options: { chatHandler?: vscode.ChatRequestHandler; globalState?: vscode.Memento; workspaceState?: vscode.Memento; providerApiKey?: (provider: GhostProvider) => string | undefined } = {}
  ) {
    this.globalState = options.globalState
    this.workspaceState = options.workspaceState
    this.providerApiKey = options.providerApiKey
    this.chatHandler = options.chatHandler ?? createChatParticipantHandler()
    this.debugLog('view provider created')
    this.disposables.push(ghostConfig.onDidChange(() => {
      void this.sendControlsState()
    }), this.stagedEditChanges)
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
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out'), this.extensionUri]
    }
    webviewView.webview.html = this.getHtml(webviewView.webview)

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message)),
      webviewView.onDidDispose(() => {
        this.cancelRequests()
        if (this.view === webviewView) {
          this.view = undefined
        }
      })
    )

    const pendingMessages = this.pendingMessages
    this.pendingMessages = []
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
    this.debugLog('request started', { requestId, conversationId, promptLength: prompt.length })

    const cancellation = new vscode.CancellationTokenSource()
    const request: GhostRequestState = {
      cancellation,
      conversationId,
      sequence: 0,
      codeMode: false,
      status: 'preparing',
      attempt: 0,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      timedOut: false,
      model: options.model?.trim() || getGhostSettings().chatModel,
      outputTokens: 0,
      eventLog: []
    }
    this.requests.set(requestId, request)
    this.postStreamEvent(requestId, request, {
      type: 'request-started'
    })

    let pendingTool: { toolCallId: string; name: string } | undefined
    const response = {
      markdown: (delta: string) => {
        if (pendingTool) {
          this.markRecoveryApplied(pendingTool.toolCallId, `${pendingTool.name} completed`)
          this.failedToolRetries.delete(pendingTool.toolCallId)
          this.postStreamEvent(requestId, request, {
            type: 'tool-result',
            tool: pendingTool.name,
            detail: `${pendingTool.name} completed`,
            toolCallId: pendingTool.toolCallId,
            resultStatus: 'completed',
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
          request.pendingTool = pendingTool
          return
        }
        if (progress.startsWith('Tool result:')) {
          const result = /^Tool result:\s*([^:]+):\s*(.*)$/s.exec(progress)
          if (pendingTool && result) {
            this.markRecoveryApplied(pendingTool.toolCallId, result[2])
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
            const resultStatus = /rejected|denied/i.test(result[2])
              ? 'rejected'
              : /error|failed|cancelled/i.test(result[2])
                ? 'failed'
                : 'completed'
            if (resultStatus === 'completed') {
              this.failedToolRetries.delete(pendingTool.toolCallId)
            }
            this.postStreamEvent(requestId, request, {
              type: 'tool-result',
              tool: pendingTool.name,
              toolCallId: pendingTool.toolCallId,
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
      if (!attachment.path) {
        return []
      }
      const uri = vscode.Uri.file(attachment.path)
      return vscode.workspace.getWorkspaceFolder(uri)
        ? [{ value: uri, id: attachment.name, modelDescription: attachment.name }]
        : []
    })
    const droppedContext = safeAttachments
      .filter(attachment => attachment.content)
      .map(attachment => `Dropped attachment: ${attachment.name}\n\n${attachment.content}`)
      .join('\n\n')
    const requestOptions: GhostRequestOptions = {
      ...options,
      additionalContext: [continuationContext, droppedContext].filter(Boolean).join('\n\n') || undefined,
      approveTool: call => this.requestToolApproval(requestId, request, call),
      confirmContinue: toolCallCount => this.confirmToolLimit(requestId, request, toolCallCount),
      onStop: (reason, message) => {
        if (request.stopReason) {
          return
        }
        request.stopReason = reason
        request.stopMessage = redactSensitiveText(message)
        request.status = reason === 'cancelled' ? 'cancelled' : 'failed'
      }
    }

    const timeout = setTimeout(() => {
      if (!this.requests.has(requestId)) {
        return
      }
      request.timedOut = true
      request.stopReason = 'timeout'
      request.stopMessage = 'The provider did not respond before the request timeout.'
      request.status = 'failed'
      request.cancellation.cancel()
      this.postStreamEvent(requestId, request, {
        type: 'warning',
        message: 'Ghost timed out. You can retry this request.'
      })
      this.postStreamEvent(requestId, request, {
        type: 'error',
        message: request.stopMessage,
        stopReason: request.stopReason
      })
    }, GhostViewProvider.requestTimeoutMs)

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
        request.lastActivityAt = Date.now()
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
      const message = redactSensitiveText(error instanceof Error ? error.message : 'Ghost request failed')
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
        this.debugLog('request failed', message)
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
      this.resolvePendingApprovals(requestId, { decision: 'reject' })
      this.requests.delete(requestId)
      this.completedRequests.add(requestId)
      if (this.completedRequests.size > 100) {
        const oldest = this.completedRequests.values().next().value
        if (oldest) {
          this.completedRequests.delete(oldest)
        }
      }
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
    return `tool-${Date.now()}-${randomBytes(6).toString('hex')}`
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
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      timedOut: false,
      model: getGhostSettings().chatModel,
      outputTokens: 0,
      eventLog: []
    }
    this.requests.set(requestId, request)
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
      const detail = redactSensitiveText(result).slice(0, 16000)
      const failed = /^Tool error:|^User denied|^Tool call cancelled|^File changed externally|^The accepted edit changed|^Edit expected|no changes needed/i.test(detail)
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
      this.resolvePendingApprovals(requestId, { decision: 'reject' })
      this.requests.delete(requestId)
      this.completedRequests.add(requestId)
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

  private requiresToolApproval(toolName: string): boolean {
    return toolName === 'ghost_write_file' || toolName === 'ghost_apply_edit' || toolName === 'ghost_apply_transaction' || toolName === 'ghost_run_terminal_command'
  }

  private isConversationStateTool(toolName: string): boolean {
    return toolName === 'ghost_update_task_plan' || toolName === 'ghost_record_completion'
  }

  private isFileEditTool(toolName: string): boolean {
    return toolName === 'ghost_write_file' || toolName === 'ghost_apply_edit' || toolName === 'ghost_apply_transaction'
  }

  private async getDiffPreview(call: LocalToolCall, approvalContext: Pick<StagedEdit, 'requestId' | 'conversationId' | 'toolCallId'>): Promise<GhostToolDiffPreview | undefined> {
    if (call.name === 'ghost_apply_transaction') {
      try {
        const prepared = await prepareFileTransaction(parseFileTransaction(call.arguments))
        const limit = 20000
        const before = prepared.map(file => `--- ${file.path}\n${file.before.content}`).join('\n\n')
        const after = prepared.map(file => `+++ ${file.path}\n${file.after}`).join('\n\n')
        return {
          path: `${prepared.length} files`,
          before: before.slice(0, limit),
          after: after.slice(0, limit),
          truncated: before.length > limit || after.length > limit
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
        before: before.slice(0, limit),
        after: after.slice(0, limit),
        truncated: before.length > limit || after.length > limit,
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
              after
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
      if (document.getText() !== staged.after) {
        throw new Error('The source file changed while Ghost was waiting for edit approval.')
      }
      const current = await readWorkspaceFile(staged.uri)
      if (!sameWorkspaceFile(current, { exists: true, content: staged.before })) {
        throw new Error('File changed externally while Ghost was waiting for edit approval. Refresh and rebase the edit before retrying.')
      }
      const edit = new vscode.WorkspaceEdit()
      edit.replace(staged.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), staged.before)
      if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error('Ghost could not restore the source file.')
      }
      await document.save()
      const restored = await readWorkspaceFile(staged.uri)
      if (!sameWorkspaceFile(restored, { exists: true, content: staged.before })) {
        throw new Error('Ghost could not verify the restored source file.')
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

  private shouldAutoAcceptFileEdit(
    scope: GhostAutoAcceptScope,
    request: GhostRequestState,
    call: LocalToolCall
  ): boolean {
    if (scope === 'confirm') {
      return false
    }
    if (scope === 'one-edit' || scope === 'request' || scope === 'session' || scope === 'workspace' || scope === 'always') {
      return true
    }
    if (call.name === 'ghost_apply_transaction' || typeof call.arguments.path !== 'string') {
      return false
    }
    if (!request.autoAcceptFilePath) {
      request.autoAcceptFilePath = call.arguments.path
      return true
    }
    return request.autoAcceptFilePath === call.arguments.path
  }

  private async requestToolApproval(
    requestId: string,
    request: GhostRequestState,
    call: LocalToolCall
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
      return { decision: 'reject', reason }
    }

    const terminalAudit = call.name === 'ghost_run_terminal_command' && typeof call.arguments.command === 'string'
      ? auditTerminalCommand(call.arguments.command)
      : undefined
    if (terminalAudit?.blocked) {
      const pending = { toolCallId: this.createToolCallId(), name: call.name }
      request.pendingTool = pending
      this.failedToolRetries.set(pending.toolCallId, { requestId, conversationId: request.conversationId, call })
      const reason = formatTerminalAudit(terminalAudit)
      this.postStreamEvent(requestId, request, {
        type: 'tool-requested',
        tool: call.name,
        toolCallId: pending.toolCallId,
        arguments: call.arguments,
        requiresApproval: false,
        detail: reason,
        phase: 'tool'
      })
      return { decision: 'reject', reason }
    }

    const pending = request.pendingTool?.name === call.name
      ? request.pendingTool
      : { toolCallId: this.createToolCallId(), name: call.name }
    request.pendingTool = pending
    this.failedToolRetries.set(pending.toolCallId, { requestId, conversationId: request.conversationId, call })
    const settings = getGhostSettings()
    const allowedTools = settings.toolAllowlist ?? [...GHOST_TOOL_NAMES]
    const askedTools = settings.toolAsklist ?? []
    const deniedTools = settings.toolDenylist ?? []
    const asksByPolicy = !this.isConversationStateTool(call.name) && (!allowedTools.includes(call.name) || askedTools.includes(call.name))
    const blockedByPolicy = !this.isConversationStateTool(call.name) && deniedTools.includes(call.name)
    const isFileEditTool = this.isFileEditTool(call.name)
    const unsavedEditorWarning = isFileEditTool && !blockedByPolicy ? this.getUnsavedEditorWarning(call) : undefined
    if (unsavedEditorWarning) {
      this.postStreamEvent(requestId, request, {
        type: 'tool-requested',
        tool: call.name,
        toolCallId: pending.toolCallId,
        arguments: call.arguments as GhostToolArguments,
        requiresApproval: false,
        detail: unsavedEditorWarning,
        phase: 'tool'
      })
      return { decision: 'reject', reason: unsavedEditorWarning }
    }
    const autoAcceptedFileEdit = isFileEditTool && !blockedByPolicy && !asksByPolicy && this.shouldAutoAcceptFileEdit(settings.autoAcceptScope, request, call)
    const requiresApproval = (this.requiresToolApproval(call.name) || asksByPolicy) && !blockedByPolicy && !autoAcceptedFileEdit
    const argumentsPayload = call.arguments as GhostToolArguments
    const needsInteractiveApproval = requiresApproval && (isFileEditTool
      ? !this.sessionApprovedFileEdits
      : !this.sessionApprovedTools.has(call.name))
    const diffPreview = needsInteractiveApproval
      ? await this.getDiffPreview(call, {
          requestId,
          conversationId: request.conversationId,
          toolCallId: pending.toolCallId
        })
      : undefined
    if (request.cancellation.token.isCancellationRequested) {
      return { decision: 'reject', reason: 'The request was cancelled.' }
    }
    const expectedFiles = isFileEditTool && !blockedByPolicy
      ? await this.getExpectedFileSnapshots(call)
      : undefined
    if (request.cancellation.token.isCancellationRequested) {
      return { decision: 'reject', reason: 'The request was cancelled.' }
    }
    if (isFileEditTool && !blockedByPolicy && !expectedFiles) {
      return { decision: 'reject', reason: 'Ghost could not read the file safely. Refresh the file and retry.' }
    }
    const expectedSnapshot = typeof call.arguments.path === 'string' && expectedFiles
      ? expectedFiles[resolveWorkspacePath(call.arguments.path).fsPath]
      : undefined
    const expectedContent = expectedSnapshot?.content
    const expectedFileExists = expectedSnapshot?.exists
    this.postStreamEvent(requestId, request, {
      type: 'tool-requested',
      tool: call.name,
      toolCallId: pending.toolCallId,
      arguments: argumentsPayload,
      requiresApproval,
      ...(diffPreview ? { diffPreview } : {}),
      detail: blockedByPolicy
        ? 'Blocked by workspace tool policy'
        : terminalAudit ? formatTerminalAudit(terminalAudit)
        : autoAcceptedFileEdit ? 'Auto-accepting file edit'
        : requiresApproval ? 'Waiting for approval' : 'Running safe workspace tool',
      phase: 'tool'
    })

    if (blockedByPolicy) {
      return { decision: 'reject', reason: 'Tool blocked by workspace policy.' }
    }
    if (!needsInteractiveApproval) {
      await this.rememberRecovery(requestId, request.conversationId, pending.toolCallId, call, expectedSnapshot, expectedFiles)
      return { decision: 'once', expectedContent, expectedFileExists, expectedFiles }
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
    })
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
      pending.resolve(approval)
    }
  }

  private decideToolApproval(
    requestId: string,
    conversationId: string,
    toolCallId: string,
    approval: GhostToolApproval
  ): void {
    const pending = this.pendingApprovals.get(toolCallId)
    if (!pending || pending.requestId !== requestId || pending.conversationId !== conversationId) {
      return
    }
    if (approval.decision === 'session') {
      if (this.isFileEditTool(pending.call.name)) {
        this.sessionApprovedFileEdits = true
      } else {
        this.sessionApprovedTools.add(pending.call.name)
      }
    }
    if (this.isFileEditTool(pending.call.name)) {
      const staged = this.stagedEdits.get(toolCallId)
      if (staged) {
        if (approval.decision === 'reject') {
          void this.rejectStagedEdit(toolCallId)
          return
        }
        if (approval.selectedHunkIndexes) {
          void this.restoreStagedEdit(staged).then(() => this.verifyExternalEdit(pending, approval)).catch(error => {
            pending.resolve({ decision: 'reject', reason: error instanceof Error ? error.message : 'Ghost could not prepare the selected hunks.' })
          })
          return
        }
        void this.acceptStagedApproval(pending, staged, approval)
        return
      }
      void this.verifyExternalEdit(pending, approval)
      return
    }
    this.pendingApprovals.delete(toolCallId)
    pending.resolve(approval)
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
      pending.resolve({ decision: 'reject', reason: error instanceof Error ? error.message : 'Ghost could not accept the edit.' })
    }
  }

  private async saveStagedEdit(staged: StagedEdit): Promise<void> {
    const document = await vscode.workspace.openTextDocument(staged.uri)
    if (document.getText() !== staged.after) {
      throw new Error('The source file changed while Ghost was waiting for edit approval.')
    }

    const beforeSave = await readWorkspaceFile(staged.uri)
    if (!sameWorkspaceFile(beforeSave, { exists: true, content: staged.before })) {
      throw new Error('File changed externally while Ghost was waiting for edit approval. Refresh and rebase the edit before retrying.')
    }

    await document.save()
    const savedContent = await readWorkspaceFile(staged.uri)
    if (!sameWorkspaceFile(savedContent, { exists: true, content: staged.after })) {
      if (!sameWorkspaceFile(savedContent, beforeSave)) {
        throw new Error('File changed externally while Ghost was being saved. Refresh and rebase the edit before retrying.')
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
    const expectedFiles = this.isFileEditTool(pending.call.name)
      ? await this.getExpectedFileSnapshots(pending.call)
      : undefined
    if (this.isFileEditTool(pending.call.name) && !expectedFiles) {
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

  private postStreamEvent(
    requestId: string,
    request: GhostRequestState,
    event: { type: GhostStreamEvent['type']; [key: string]: unknown }
  ): void {
    const timestamp = Date.now()
    request.lastActivityAt = timestamp
    request.status = getRequestStatusForEvent(event, request.status)
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
      elapsedMs: Date.now() - request.startedAt,
      model: request.model,
      tokenCount: request.outputTokens,
      startedAt: request.startedAt,
      ...(request.outputTokens > 0
        ? { tokensPerSecond: request.outputTokens / Math.max((Date.now() - request.startedAt) / 1000, 0.001) }
        : {}),
      ...redactSensitiveValue(Object.fromEntries(Object.entries(event).map(([key, value]) => [key, typeof value === 'string' ? redactSensitiveText(value) : value]))),
      ...(event.type === 'request-completed' && request.completionRecord ? { completionRecord: request.completionRecord } : {}),
      ...(event.type === 'request-completed' ? { eventLog: request.eventLog } : {})
    } as GhostStreamEvent)
  }

  private persistenceEnabled(): boolean {
    return getGhostSettings().enableConversationPersistence
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
    return JSON.parse(JSON.stringify(state, (_key, value) => typeof value === 'string' ? redactSensitiveText(value) : value)) as GhostPersistedState
  }

  private async sendPersistedState(): Promise<void> {
    const state = this.persistenceEnabled()
      ? await this.readPersistedState()
      : { schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION, conversations: [], promptHistory: [], presets: [], showReasoning: false, preferences: {} }
    this.postMessage({
      source: 'ghost-extension',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'persisted-state',
      state
    })
  }

  private async persistState(state: GhostPersistedState): Promise<void> {
    if (!this.globalState || !this.workspaceState) {
      return
    }
    if (!this.persistenceEnabled()) {
      await this.globalState.update(GhostViewProvider.globalStateKey, undefined)
      await this.workspaceState.update(GhostViewProvider.workspaceStateKey, undefined)
      return
    }
    const safeState = JSON.parse(JSON.stringify(state, (_key, value) => typeof value === 'string' ? redactSensitiveText(value) : value)) as GhostPersistedState
    await this.globalState.update(GhostViewProvider.globalStateKey, {
      schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION,
      promptHistory: normalizePromptHistory(safeState.promptHistory),
      presets: safeState.presets ?? [],
      showReasoning: safeState.showReasoning === true,
      preferences: safeState.preferences ?? {}
    } satisfies StoredGlobalState)
    await this.workspaceState.update(GhostViewProvider.workspaceStateKey, {
      schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION,
      conversations: safeState.conversations ?? [],
      activeConversationId: safeState.activeConversationId
    } satisfies StoredWorkspaceState)
  }

  private async clearPersistedState(): Promise<void> {
    await Promise.all([
      this.globalState?.update(GhostViewProvider.globalStateKey, undefined),
      this.workspaceState?.update(GhostViewProvider.workspaceStateKey, undefined)
    ])
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
      const candidate = isStoredRecord(parsed) && isStoredRecord(parsed.state) ? parsed.state : parsed
      if (!isStoredRecord(candidate) || !Array.isArray(candidate.conversations)) {
        throw new Error('The file does not contain Ghost conversations.')
      }
      const state: GhostPersistedState = {
        schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION,
        conversations: candidate.conversations,
        activeConversationId: typeof candidate.activeConversationId === 'string' ? candidate.activeConversationId : undefined,
        promptHistory: Array.isArray(candidate.promptHistory) ? candidate.promptHistory.filter(item => typeof item === 'string') : [],
        presets: Array.isArray(candidate.presets) ? candidate.presets : [],
        showReasoning: candidate.showReasoning === true,
        preferences: isStoredRecord(candidate.preferences) ? candidate.preferences : {}
      }
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

  private async sendControlsState(): Promise<void> {
    const generation = ++this.controlsStateGeneration
    const settings = getGhostSettings()
    let models: string[] = []
    let connection: 'online' | 'offline' | 'unknown' = 'unknown'

    try {
      const client = settings.provider === 'mlx-vlm'
        ? new MlxClient(settings.mlxUrl, undefined, () => this.providerApiKey?.('mlx-vlm'))
        : settings.provider === 'openai-compatible'
          ? createProfiledProviderClient(settings, () => this.providerApiKey?.('openai-compatible'))
          : new OllamaClient(settings.ollamaUrl, 'ollama', undefined, () => this.providerApiKey?.('ollama'))
      const online = await client.checkHealth(3000)
      if (this.disposed || generation !== this.controlsStateGeneration) {
        return
      }
      connection = online ? 'online' : 'offline'
      if (online) {
        try {
          models = client.listModels ? await client.listModels() : []
        } catch (error) {
          this.debugLog('provider is online but model discovery failed', error instanceof Error ? error.message : String(error))
        }
      }
    } catch {
      if (this.disposed || generation !== this.controlsStateGeneration) {
        return
      }
      connection = 'offline'
    }

    if (this.disposed || generation !== this.controlsStateGeneration) {
      return
    }

    if (models.length === 0) {
      models = [settings.chatModel]
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
    const openFiles = vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => tab.label))
    const folders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? []
    const allowedTools = GHOST_TOOL_NAMES.filter(tool => !(settings.toolDenylist ?? []).includes(tool))

    this.postMessage({
      source: 'ghost-extension',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'controls-state',
      settings: {
        provider: settings.provider,
        chatModel: settings.chatModel,
        autocompleteModel: settings.autocompleteModel,
        maxContextTokens: settings.maxContextTokens,
        temperature: settings.temperature,
        topP: settings.topP,
        topK: settings.topK,
        minP: settings.minP,
        presencePenalty: settings.presencePenalty,
        repeatPenalty: settings.repeatPenalty,
        responseLength: settings.responseLength,
        mode: settings.mode,
        autoAcceptScope: settings.autoAcceptScope,
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
        toolAllowlist: settings.toolAllowlist ?? [...GHOST_TOOL_NAMES],
        toolAsklist: settings.toolAsklist ?? [],
        toolDenylist: settings.toolDenylist ?? [],
        terminalEnvironmentAllowlist: settings.terminalEnvironmentAllowlist,
        terminalEnvironmentAsklist: settings.terminalEnvironmentAsklist,
        enableDebugLogging: settings.enableDebugLogging,
        networkAccess: isExternalEndpoint(settings.provider === 'mlx-vlm' ? settings.mlxUrl : settings.provider === 'openai-compatible' ? resolveOpenAiProfileEndpoint(settings.openaiProfile, settings.openaiUrl) : settings.ollamaUrl) ? 'external' : 'local'
      },
      models,
      connection,
      context: {
        workspaceName: vscode.workspace.name ?? 'Untitled workspace',
        folders,
        ...(activeFile ? { activeFile } : {}),
        openFiles
      },
      tools: allowedTools
    })
  }

  private async testProvider(): Promise<void> {
    const settings = getGhostSettings()
      const client = settings.provider === 'mlx-vlm'
      ? new MlxClient(settings.mlxUrl, undefined, () => this.providerApiKey?.('mlx-vlm'))
      : settings.provider === 'openai-compatible'
        ? createProfiledProviderClient(settings, () => this.providerApiKey?.('openai-compatible'))
        : new OllamaClient(settings.ollamaUrl, 'ollama', undefined, () => this.providerApiKey?.('ollama'))
    const online = await client.checkHealth(3000)
    if (online) {
      await vscode.window.showInformationMessage(`${settings.provider} provider is reachable.`)
    } else {
      await vscode.window.showErrorMessage(`${settings.provider} provider is not reachable.`)
    }
    await this.sendControlsState()
  }

  private async updateSettings(update: GhostSettingsUpdate): Promise<void> {
    const target = update.workspaceOnly ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    if (typeof update.ollamaUrl === 'string' && update.ollamaUrl.trim()) {
      await ghostConfig.update('ollamaUrl', update.ollamaUrl.trim(), target)
    }
    if (typeof update.mlxUrl === 'string' && update.mlxUrl.trim()) {
      await ghostConfig.update('mlxUrl', update.mlxUrl.trim(), target)
    }
    if (typeof update.openaiUrl === 'string' && update.openaiUrl.trim()) {
      await ghostConfig.update('openaiUrl', update.openaiUrl.trim(), target)
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
      await ghostConfig.update('toolAllowlist', update.toolAllowlist, target)
    }
    if (Array.isArray(update.toolAsklist)) {
      await ghostConfig.update('toolAsklist', update.toolAsklist, target)
    }
    if (Array.isArray(update.toolDenylist)) {
      await ghostConfig.update('toolDenylist', update.toolDenylist, target)
    }
    if (Array.isArray(update.terminalEnvironmentAllowlist)) {
      await ghostConfig.update('terminalEnvironmentAllowlist', update.terminalEnvironmentAllowlist, target)
    }
    if (Array.isArray(update.terminalEnvironmentAsklist)) {
      await ghostConfig.update('terminalEnvironmentAsklist', update.terminalEnvironmentAsklist, target)
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
    if (update.autoAcceptScope) {
      if (update.autoAcceptScope !== 'confirm' && getGhostSettings().autoAcceptScope !== update.autoAcceptScope) {
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
      await ghostConfig.update('autoAcceptScope', update.autoAcceptScope, target)
      await ghostConfig.update('fileEditApproval', update.autoAcceptScope === 'confirm' ? 'confirm' : 'auto', target)
    } else if (update.fileEditApproval) {
      await ghostConfig.update('fileEditApproval', update.fileEditApproval, target)
      await ghostConfig.update('autoAcceptScope', update.fileEditApproval === 'auto' ? 'always' : 'confirm', target)
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
    const settings = getGhostSettings()
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
    const exportData = {
      version: GHOST_PERSISTENCE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      provider: settings.provider,
      chatModel: settings.chatModel,
      state: exportState
    }
    await atomicWriteFile(target, Buffer.from(JSON.stringify(exportData, null, 2), 'utf8'))
    await vscode.window.showInformationMessage(`Ghost interface exported to ${target.fsPath}.`)
  }

  dispose(): void {
    this.disposed = true
    this.cancelRequests()
    for (const request of this.requests.values()) {
      request.cancellation.dispose()
    }
    this.requests.clear()
    this.pendingApprovals.clear()
    for (const staged of this.stagedEdits.values()) {
      void this.restoreStagedEdit(staged)
    }
    this.stagedEdits.clear()
    this.recoveryRecords.clear()
    this.failedToolRetries.clear()
    this.sessionApprovedTools.clear()
    this.sessionApprovedFileEdits = false
    vscode.Disposable.from(...this.disposables).dispose()
    this.disposables.length = 0
    this.view = undefined
    this.pendingMessages = []
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = decodeGhostWebviewMessage(value)
    if (!message) {
      return
    }

    switch (message.type) {
      case 'ready':
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
        await this.persistState(message.state)
        return
      case 'check-status':
        await vscode.commands.executeCommand('ghost.checkOllamaStatus')
        return
      case 'test-provider':
        await this.testProvider()
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
      case 'retry-tool':
        await this.retryFailedTool(message.requestId, message.conversationId, message.toolCallId, {
          name: message.tool as LocalToolName,
          arguments: message.arguments
        })
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
      case 'refresh-models':
        await this.sendControlsState()
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
    if (!this.view) {
      if (['request-started', 'thinking', 'text-delta', 'code-delta', 'tool-requested', 'tool-result', 'warning', 'error', 'request-completed'].includes(message.type)) {
        return
      }
      this.pendingMessages.push(message)
      return
    }

    void this.view.webview.postMessage(redactSensitiveValue(message))
  }

  private createMessage(type: 'reset' | 'clear'): GhostExtensionMessage {
    return {
      source: 'ghost-extension',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64')
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'ghostWebview.js')
    )
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'icon.png')
    )
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      "connect-src 'none'"
    ].join('; ')

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ghost</title>
    <style nonce="${nonce}">
      :root {
        color-scheme: light dark;
        --ghost-accent: var(--vscode-textLink-foreground, #3794ff);
        --ghost-border: var(--vscode-panel-border, var(--vscode-widget-border, transparent));
        --ghost-surface: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      }

      * {
        box-sizing: border-box;
      }

      body {
        height: 100%;
        margin: 0;
        min-width: 220px;
        overflow: hidden;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
      }

      button {
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        border: 1px solid transparent;
        border-radius: 2px;
        cursor: pointer;
        font: inherit;
        padding: 5px 10px;
      }

      button:hover {
        background: var(--vscode-button-hoverBackground);
      }

      button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      #save-preset.pressed {
        background: var(--vscode-button-secondaryBackground, var(--vscode-button-hoverBackground));
        border-color: var(--vscode-focusBorder);
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.25);
        transform: translateY(1px);
      }

      .app {
        display: flex;
        height: 100vh;
        flex-direction: column;
        min-height: 0;
      }

      .header {
        align-items: flex-start;
        border-bottom: 1px solid var(--ghost-border);
        display: flex;
        gap: 10px;
        justify-content: space-between;
        padding: 12px;
      }

      .brand {
        align-items: center;
        display: flex;
        gap: 8px;
      }

      .brand-mark {
        display: inline-flex;
        height: 24px;
        position: relative;
        width: 24px;
      }

      .ghost-face {
        --ghost-eye-x: 0px;
        --ghost-eye-y: 0px;
        overflow: hidden;
      }

      .ghost-face img {
        display: block;
        height: 100%;
        position: absolute;
        width: 100%;
      }

      .ghost-eye {
        background: #fff;
        border-radius: 50%;
        height: 23%;
        overflow: hidden;
        position: absolute;
        top: 30%;
        width: 23%;
      }

      .ghost-eye-left {
        left: 29.5%;
      }

      .ghost-eye-right {
        left: 64%;
      }

      .ghost-pupil {
        background: #0d468e;
        border-radius: 50%;
        height: 46%;
        left: 50%;
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%) translate(var(--ghost-eye-x), var(--ghost-eye-y));
        width: 46%;
      }

      .title {
        font-weight: 600;
      }

      .subtitle {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
        margin-top: 2px;
      }

      .status {
        align-items: center;
        color: var(--vscode-descriptionForeground);
        display: flex;
        font-size: 0.85em;
        gap: 5px;
        white-space: nowrap;
      }

      .status-dot {
        background: var(--vscode-testing-iconPassed, #73c991);
        border-radius: 50%;
        height: 7px;
        width: 7px;
      }

      .status.offline .status-dot {
        background: var(--vscode-testing-iconFailed, #f14c4c);
      }

      .content {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 16px;
        justify-content: center;
        padding: 24px 16px;
      }

      .empty-state {
        background: var(--ghost-surface);
        border: 1px solid var(--ghost-border);
        border-radius: 6px;
        padding: 18px;
        text-align: center;
      }

      .empty-state h1 {
        font-size: 1.1em;
        margin: 0 0 8px;
      }

      .empty-state p {
        color: var(--vscode-descriptionForeground);
        line-height: 1.45;
        margin: 0;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: center;
      }

      .secondary {
        background: transparent;
        border-color: var(--ghost-border);
        color: var(--vscode-foreground);
      }

      .footer {
        border-top: 1px solid var(--ghost-border);
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        padding: 8px 12px;
      }

      .control-strip {
        align-items: center;
        border-bottom: 1px solid var(--ghost-border);
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 7px 10px;
      }

      .control-label {
        color: var(--vscode-descriptionForeground);
        font-size: 0.78em;
      }

      select,
      input[type='text'],
      input[type='search'],
      input[type='number'],
      textarea {
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, var(--ghost-border));
        border-radius: 2px;
        color: var(--vscode-input-foreground);
        font: inherit;
      }

      .control-strip select {
        max-width: 150px;
        min-width: 0;
        padding: 3px 5px;
      }

      .connection-indicator {
        align-items: center;
        color: var(--vscode-descriptionForeground);
        display: flex;
        font-size: 0.78em;
        gap: 4px;
        margin-left: auto;
        white-space: nowrap;
      }

      .connection-indicator .status-dot {
        background: var(--vscode-descriptionForeground);
      }

      .connection-indicator.online .status-dot {
        background: var(--vscode-testing-iconPassed, #73c991);
      }

      .connection-indicator.offline .status-dot {
        background: var(--vscode-testing-iconFailed, #f14c4c);
      }

      .connection-indicator.external .status-dot {
        background: var(--vscode-editorWarning-foreground, #cca700);
      }

      .control-button,
      .context-button {
        background: transparent;
        border: 1px solid var(--ghost-border);
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        padding: 3px 7px;
      }

      .control-button:hover,
      .context-button:hover {
        color: var(--vscode-foreground);
      }

      .settings-button {
        min-height: 28px;
        min-width: 32px;
        padding: 3px 6px;
      }

      .ui-icon {
        display: block;
        height: 18px;
        width: 18px;
      }

      .settings-button .ui-icon {
        height: 20px;
        width: 20px;
      }

      .history-button .ui-icon {
        height: 18px;
        width: 18px;
      }

      .context-row {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        min-height: 22px;
      }

      .context-chips {
        display: flex;
        flex: 1 1 120px;
        flex-wrap: wrap;
        gap: 2px;
        min-width: 0;
      }

      .attachment-list {
        display: flex;
        flex: 1;
        flex-wrap: wrap;
        gap: 4px;
        min-width: 0;
      }

      .context-row .context-button {
        flex: 0 0 auto;
        font-size: 0.72em;
        padding: 2px 5px;
      }

      .context-chip,
      .attachment-chip {
        background: var(--vscode-input-background, transparent);
        border: 1px solid var(--ghost-border);
        border-radius: 4px;
        color: var(--vscode-descriptionForeground);
        font-size: 0.75em;
        max-width: 180px;
        overflow: hidden;
        padding: 3px 7px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .context-chip {
        cursor: pointer;
        font-size: 0.7em;
        padding: 2px 5px;
      }

      .context-chip:hover {
        background: var(--vscode-toolbar-hoverBackground);
        border-color: var(--vscode-focusBorder);
        color: var(--vscode-foreground);
      }

      .context-chip:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 1px;
      }

      .attachment-chip {
        background: var(--vscode-badge-background);
        border: 0;
        border-radius: 10px;
        color: var(--vscode-badge-foreground);
      }

      .context-chip.removed {
        background: transparent;
        border: 1px dashed var(--ghost-border);
        color: var(--vscode-descriptionForeground);
      }

      .context-chip[data-tooltip] {
        overflow: visible;
        position: relative;
      }

      .context-chip[data-tooltip]::after {
        background: var(--vscode-quickInput-background, var(--ghost-surface));
        border: 1px solid var(--ghost-border);
        border-radius: 4px;
        bottom: calc(100% + 7px);
        box-shadow: 0 4px 12px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.25));
        color: var(--vscode-foreground);
        content: attr(data-tooltip);
        left: 0;
        max-width: min(360px, calc(100vw - 32px));
        opacity: 0;
        padding: 8px 10px;
        pointer-events: none;
        position: absolute;
        text-align: left;
        transform: translateY(3px);
        transition: opacity 120ms ease, transform 120ms ease;
        visibility: hidden;
        white-space: pre-line;
        width: max-content;
        z-index: 6;
      }

      .context-chip[data-tooltip]:hover::after,
      .context-chip[data-tooltip]:focus-visible::after {
        opacity: 1;
        transform: translateY(0);
        visibility: visible;
      }

      .attachment-list:empty {
        display: none;
      }

      .attachment-list {
        margin: 4px 0;
      }

      .attachment-chip {
        align-items: center;
        display: inline-flex;
        gap: 4px;
      }

      .attachment-chip button {
        background: transparent;
        border: 0;
        color: inherit;
        padding: 0;
      }

      .prompt-wrap {
        position: relative;
      }

      .mention-menu {
        background: var(--vscode-quickInput-background, var(--ghost-surface));
        border: 1px solid var(--ghost-border);
        border-radius: 3px;
        bottom: calc(100% + 4px);
        box-shadow: 0 4px 12px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.25));
        left: 0;
        max-height: 180px;
        overflow: auto;
        position: absolute;
        width: min(100%, 300px);
        z-index: 2;
      }

      .mention-option,
      .history-item {
        background: transparent;
        border: 0;
        color: var(--vscode-foreground);
        display: block;
        overflow: hidden;
        padding: 7px 9px;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
      }

      .mention-option:hover,
      .history-item:hover {
        background: var(--vscode-list-hoverBackground);
      }

      .modal-backdrop {
        align-items: center;
        background: var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
        display: flex;
        inset: 0;
        justify-content: center;
        overflow-y: auto;
        padding: 16px;
        position: fixed;
        z-index: 5;
      }

      .modal-backdrop[hidden] {
        display: none;
      }

      .modal {
        background: var(--vscode-quickInput-background, var(--ghost-surface));
        border: 1px solid var(--ghost-border);
        border-radius: 5px;
        box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
        max-height: calc(100vh - 32px);
        max-height: calc(100dvh - 32px);
        max-width: 460px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 14px;
        width: 100%;
      }

      .modal-scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }

      .modal-header,
      .modal-footer,
      .modal-subheader,
      .preset-row {
        align-items: center;
        display: flex;
        gap: 8px;
        justify-content: space-between;
      }

      .modal-header h2,
      .modal-subheader h3 {
        font-size: 1em;
        margin: 0;
      }

      .modal-footer {
        background: var(--vscode-quickInput-background, var(--ghost-surface));
        bottom: 0;
        flex-shrink: 0;
        justify-content: flex-end;
        padding-top: 10px;
        position: sticky;
      }

      .settings-grid {
        display: grid;
        gap: 8px;
        grid-template-columns: 1fr 1fr;
        margin: 16px 0;
      }

      .settings-grid label {
        align-self: center;
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
      }

      .settings-checkbox {
        align-items: center;
        display: flex;
        gap: 6px;
        grid-column: 1 / -1;
      }

      .settings-grid input,
      .settings-grid select,
      .settings-grid textarea,
      .preset-section input,
      .preset-section textarea,
      #history-search {
        padding: 5px 7px;
        width: 100%;
      }

      .settings-checkbox input {
        width: auto;
      }

      .settings-help {
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        grid-column: 1 / -1;
        margin: -4px 0 2px;
      }

      .permission-action-button {
        background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
        border: 1px solid var(--vscode-button-border, var(--ghost-border));
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
        font-weight: 500;
        justify-self: start;
        margin-bottom: 8px;
      }

      .permission-action-button:hover {
        background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
      }

      .permission-row {
        align-items: center;
        border-bottom: 1px solid var(--vscode-panel-border);
        display: grid;
        gap: 12px;
        grid-template-columns: minmax(0, 1fr) auto;
        margin-bottom: 8px;
        padding: 8px 0;
      }

      .permission-details {
        min-width: 0;
      }

      .permission-details strong,
      .permission-details small {
        display: block;
        overflow-wrap: anywhere;
      }

      .permission-options {
        align-items: center;
        display: flex;
        gap: 10px;
        white-space: nowrap;
      }

      .permission-choice {
        align-items: center;
        display: flex;
        gap: 4px;
      }

      .permission-choice input {
        margin: 0;
      }

      .compact-layout .message {
        margin-bottom: 8px;
      }

      .compact-layout .message.user,
      .compact-layout .message-body {
        padding-bottom: 5px;
        padding-top: 5px;
      }

      .preset-section {
        border-top: 1px solid var(--ghost-border);
        padding-top: 12px;
      }

      .preset-section > * {
        margin-bottom: 8px;
      }

      .preset-row select {
        flex: 1;
      }

      .modal-description {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        line-height: 1.4;
      }

      .context-preview,
      .history-list {
        margin: 12px 0;
      }

      .context-preview-item {
        align-items: center;
        border-bottom: 1px solid var(--ghost-border);
        display: flex;
        gap: 8px;
        padding: 8px 0;
      }

      .context-preview-item span {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .context-preview-item small {
        color: var(--vscode-descriptionForeground);
      }

      .tools-preview {
        border-top: 1px solid var(--ghost-border);
        margin-top: 12px;
        padding-top: 12px;
      }

      .tools-preview h3 {
        font-size: 0.9em;
        margin: 0 0 8px;
      }

      .tools-preview ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .tools-preview li {
        border-bottom: 1px solid var(--ghost-border);
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 8px 0;
      }

      .tools-preview li:last-child {
        border-bottom: 0;
      }

      .tools-preview small {
        color: var(--vscode-descriptionForeground);
      }

      .history-list {
        max-height: 260px;
        overflow: auto;
      }

      .history-item {
        border-bottom: 1px solid var(--ghost-border);
      }

      .composer.dragging {
        border-color: var(--vscode-focusBorder);
        outline: 1px dashed var(--vscode-focusBorder);
      }

      .header-actions,
      .composer-footer,
      .status-footer,
      .message-header,
      .message-actions,
      .code-header,
      .conversation-item {
        align-items: center;
        display: flex;
      }

      .header-actions {
        gap: 4px;
      }

      .icon-button {
        align-items: center;
        background: transparent;
        border-color: transparent;
        color: var(--vscode-descriptionForeground);
        display: inline-flex;
        justify-content: center;
        min-height: 26px;
        min-width: 26px;
        padding: 2px 6px;
      }

      .icon-button:hover,
      .conversation-action:hover {
        background: var(--vscode-toolbar-hoverBackground);
        color: var(--vscode-foreground);
      }

      .danger-button {
        color: var(--vscode-testing-iconFailed, #f14c4c);
      }

      .danger-button:hover {
        background: color-mix(in srgb, var(--vscode-testing-iconFailed, #f14c4c) 18%, transparent);
        color: var(--vscode-testing-iconFailed, #f14c4c);
      }

      .chat-layout {
        display: flex;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      .conversation-item {
        border-radius: 3px;
        gap: 2px;
        margin-bottom: 2px;
        min-width: 0;
      }

      .conversation-item.active {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
      }

      .conversation-select {
        background: transparent;
        border: 0;
        color: inherit;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        padding: 7px 5px 7px 8px;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .conversation-select:hover {
        background: transparent;
      }

      .conversation-meta {
        color: var(--vscode-descriptionForeground);
        font-size: 0.75em;
        margin-right: 4px;
        white-space: nowrap;
      }

      .conversation-actions {
        display: flex;
        opacity: 0;
      }

      .conversation-item:hover .conversation-actions,
      .conversation-item:focus-within .conversation-actions {
        opacity: 1;
      }

      .conversation-action {
        background: transparent;
        border: 0;
        color: var(--vscode-descriptionForeground);
        padding: 4px;
      }

      .chat-main {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
      }

      .messages {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 16px 12px;
        scroll-behavior: smooth;
      }

      .state-card {
        background: var(--ghost-surface);
        border: 1px solid var(--ghost-border);
        border-radius: 6px;
        margin: auto;
        max-width: 420px;
        padding: 24px 18px;
        text-align: center;
      }

      .state-icon {
        color: var(--ghost-accent);
        font-size: 24px;
        font-weight: 700;
        margin-bottom: 8px;
      }

      .state-card h1 {
        font-size: 1.1em;
        margin: 0 0 8px;
      }

      .state-card p {
        color: var(--vscode-descriptionForeground);
        line-height: 1.45;
        margin: 6px 0;
      }

      .state-help {
        font-size: 0.9em;
      }

      .message {
        margin: 0 auto 18px;
        max-width: 780px;
      }

      .message.user {
        background: var(--vscode-textBlockQuote-background, var(--ghost-surface));
        border-left: 2px solid var(--ghost-accent);
        border-radius: 3px;
        padding: 10px 12px;
      }

      .message-header {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        justify-content: space-between;
        margin-bottom: 6px;
      }

      .message-header strong {
        color: var(--vscode-foreground);
      }

      .message-state {
        font-style: italic;
      }

      .message-body {
        line-height: 1.5;
        overflow-wrap: anywhere;
      }

      .message-response-stats {
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        margin-top: 8px;
      }

      .message-part-summary {
        display: grid;
        gap: 4px;
        margin-top: 8px;
      }

      .progress-details {
        background: var(--vscode-textBlockQuote-background, var(--ghost-surface));
        border-left: 2px solid var(--ghost-accent);
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        padding: 4px 7px;
      }

      .progress-details summary {
        cursor: pointer;
        font-weight: 600;
      }

      .progress-details .message-progress {
        border-left: 0;
        padding-left: 0;
      }

      .message-progress {
        background: var(--vscode-textBlockQuote-background, var(--ghost-surface));
        border-left: 2px solid var(--ghost-accent);
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        padding: 4px 7px;
      }

      .tool-progress {
        border-left-color: var(--vscode-charts-yellow, #cca700);
      }

      .tool-progress.tool-success {
        border-left-color: var(--vscode-testing-iconPassed, #73c991);
        color: var(--vscode-testing-iconPassed, #73c991);
      }

      .tool-progress.tool-failure {
        border-left-color: var(--vscode-editorWarning-foreground, #cca700);
        color: var(--vscode-editorWarning-foreground, #cca700);
      }

      .tool-status-icon {
        display: inline-block;
        font-weight: 700;
        margin-right: 4px;
      }

      .tool-details {
        margin-top: 5px;
      }

      .tool-details summary {
        cursor: pointer;
      }

      .tool-details pre {
        max-height: 180px;
        overflow: auto;
        white-space: pre-wrap;
      }

      .tool-approval-actions,
      .tool-result-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 6px;
      }

      .tool-approval-actions button,
      .tool-result-actions button {
        font-size: 0.85em;
        padding: 3px 6px;
      }

      .warning-progress {
        border-left-color: var(--vscode-editorWarning-foreground, #cca700);
      }

      .error-progress {
        border-left-color: var(--vscode-errorForeground);
        color: var(--vscode-errorForeground);
      }

      .message-body p,
      .message-body h1,
      .message-body h2,
      .message-body h3,
      .message-body ul,
      .message-body table {
        margin: 0 0 10px;
      }

      .message-body p:last-child,
      .message-body ul:last-child,
      .message-body table:last-child {
        margin-bottom: 0;
      }

      .message-body h1,
      .message-body h2,
      .message-body h3 {
        font-size: 1.1em;
      }

      .message-body a {
        color: var(--vscode-textLink-foreground);
      }

      .message-body code {
        background: var(--vscode-textCodeBlock-background);
        border-radius: 3px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.92em;
        padding: 1px 4px;
      }

      .code-block {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--ghost-border);
        border-radius: 4px;
        margin: 10px 0;
        overflow: hidden;
      }

      .code-header {
        background: var(--vscode-editorWidget-background);
        border-bottom: 1px solid var(--ghost-border);
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        justify-content: space-between;
        padding: 4px 8px;
      }

      .code-copy {
        background: transparent;
        border: 0;
        color: var(--vscode-textLink-foreground);
        padding: 2px 4px;
      }

      .code-block pre {
        margin: 0;
        overflow: auto;
        padding: 10px;
      }

      .code-block pre code {
        background: transparent;
        padding: 0;
        white-space: pre;
      }

      .code-comment {
        color: var(--vscode-charts-green, #6a9955);
      }

      .code-string {
        color: var(--vscode-debugTokenExpression-string, #ce9178);
      }

      .code-number {
        color: var(--vscode-debugTokenExpression-number, #b5cea8);
      }

      .code-keyword {
        color: var(--vscode-debugTokenExpression-name, #569cd6);
      }

      .message-actions {
        gap: 6px;
        margin-top: 8px;
        opacity: 0;
      }

      .message:hover .message-actions,
      .message:focus-within .message-actions,
      .message.error .message-actions {
        opacity: 1;
      }

      .message-action {
        background: transparent;
        border: 0;
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        padding: 2px 4px;
      }

      .message-action:hover {
        color: var(--vscode-textLink-foreground);
      }

      .message.error .message-body {
        color: var(--vscode-errorForeground);
      }

      .composer {
        border: 1px solid var(--ghost-border);
        border-radius: 4px;
        isolation: isolate;
        margin: 0 12px 8px;
        padding: 8px;
        position: relative;
      }

      .composer::before {
        background: conic-gradient(
          from var(--ghost-border-angle),
          #ff5f6d 0deg,
          #ffc371 55deg,
          #64f38c 110deg,
          #4facfe 165deg,
          #c471ed 220deg,
          #ff5f6d 275deg,
          var(--vscode-foreground) 330deg,
          var(--vscode-foreground) 345deg,
          #ff5f6d 360deg
        );
        border-radius: inherit;
        content: '';
        inset: -1px;
        mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        mask-composite: exclude;
        opacity: 0;
        padding: 1px;
        pointer-events: none;
        position: absolute;
        -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
        -webkit-mask-composite: xor;
        z-index: -1;
      }

      .composer.busy {
        border-color: transparent;
      }

      .composer.busy::before {
        animation: ghost-border-blip 2.2s linear infinite;
        opacity: 1;
      }

      .composer:focus-within {
        border-color: var(--vscode-focusBorder);
      }

      .composer textarea {
        background: transparent;
        border: 0;
        color: var(--vscode-input-foreground);
        display: block;
        font: inherit;
        line-height: 1.45;
        max-height: 180px;
        min-height: 24px;
        outline: 0;
        overflow-y: hidden;
        padding: 2px;
        resize: none;
        width: 100%;
      }

      .composer textarea::placeholder {
        color: var(--vscode-input-placeholderForeground);
      }

      .composer-footer {
        color: var(--vscode-descriptionForeground);
        gap: 8px;
        font-size: 0.78em;
        margin-top: 6px;
      }

      .composer-hint {
        flex: 1;
      }

      .composer-count {
        white-space: nowrap;
      }

      .prompt-history-actions {
        display: flex;
        gap: 2px;
      }

      .prompt-history-button {
        font-size: 1em;
        line-height: 1;
        min-width: 22px;
        padding: 2px 5px;
      }

      .stop-button {
        background: transparent;
        border-color: var(--vscode-errorForeground);
        color: var(--vscode-errorForeground);
      }

      .status-footer {
        border-top: 1px solid var(--ghost-border);
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        gap: 6px;
        overflow-wrap: anywhere;
        padding: 7px 12px;
      }

      .status-footer.busy .status-dot {
        background: var(--ghost-accent);
      }

      .thinking-ghost {
        display: none;
        position: relative;
      }

      .thinking-ghost {
        height: 18px;
        width: 18px;
      }

      .status-footer.busy .thinking-ghost {
        animation: ghost-float 1.1s ease-in-out infinite;
        display: inline-block;
        line-height: 1;
      }

      .status-footer.offline .status-dot {
        background: var(--vscode-testing-iconFailed, #f14c4c);
      }

      @property --ghost-border-angle {
        syntax: '<angle>';
        inherits: false;
        initial-value: 0deg;
      }

      @keyframes ghost-border-blip {
        to {
          --ghost-border-angle: 360deg;
        }
      }

      @keyframes ghost-float {
        0%,
        100% {
          translate: 0 0;
        }

        50% {
          translate: 0 -3px;
        }
      }

      .screen-reader-only,
      .screen-reader-status {
        height: 1px;
        margin: -1px;
        overflow: hidden;
        position: absolute;
        width: 1px;
        clip: rect(0, 0, 0, 0);
      }

      :focus-visible {
        outline: 2px solid var(--vscode-focusBorder, var(--ghost-accent));
        outline-offset: 2px;
      }

      @media (max-width: 500px) {
        .composer-hint {
          display: none;
        }
      }

      @media (max-width: 360px) {
        .header .subtitle,
        .connection-indicator {
          display: none;
        }
      }

      @media (forced-colors: active) {
        button,
        .empty-state {
          border: 1px solid CanvasText;
        }

        .status-dot {
          background: CanvasText;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 0.01ms !important;
        }

        .ghost-pupil {
          transform: translate(-50%, -50%) !important;
        }
      }
    </style>
  </head>
  <body data-ghost-icon="${iconUri}">
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`
  }
}
