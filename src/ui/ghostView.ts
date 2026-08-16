import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'

import { createChatParticipantHandler, GhostRequestOptions, GhostToolApproval } from '../agent/chatParticipant'
import type { LocalToolCall } from '../agent/toolCallParser'
import { GHOST_TOOL_NAMES, ghostConfig, getGhostSettings } from '../config'
import { MlxClient } from '../services/mlxClient'
import { OllamaClient } from '../services/ollamaClient'
import { resolveWorkspacePath } from '../tools/workspacePath'
import { applyGhostEdit, parseGhostEdit } from '../tools/editWorkflow'
import { isExternalEndpoint, redactSensitiveText } from '../privacy/redact'
import {
  GHOST_WEBVIEW_PROTOCOL_VERSION,
  GHOST_PERSISTENCE_SCHEMA_VERSION,
  GhostAttachment,
  GhostExtensionMessage,
  GhostPersistedState,
  GhostSettingsUpdate,
  GhostStreamEvent,
  GhostToolArguments,
  GhostToolDiffPreview,
  GhostViewStatus,
  GhostWebviewRequestOptions,
  isGhostWebviewMessage
} from './ghostProtocol'
import type { GhostRequestStatus } from './ghostState'
import { getRequestStatusForEvent } from './requestState'
import { migratePersistedState, normalizePromptHistory } from './persistenceModel'

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
  model: string
  outputTokens: number
  pendingTool?: { toolCallId: string; name: string }
}

interface PendingToolApproval {
  requestId: string
  conversationId: string
  toolCallId: string
  call: LocalToolCall
  expectedContent?: string
  resolve: (approval: GhostToolApproval) => void
}

interface RecoveryRecord {
  requestId: string
  conversationId: string
  toolCallId: string
  path: string
  before: string
  after: string
  applied: boolean
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
  private static readonly requestTimeoutMs = 120_000
  private static readonly maxProviderAttempts = 3

  private view: vscode.WebviewView | undefined
  private readonly disposables: vscode.Disposable[] = []
  private readonly requests = new Map<string, GhostRequestState>()
  private readonly completedRequests = new Set<string>()
  private readonly pendingApprovals = new Map<string, PendingToolApproval>()
  private readonly recoveryRecords = new Map<string, RecoveryRecord>()
  private readonly sessionApprovedTools = new Set<string>()
  private readonly globalState?: vscode.Memento
  private readonly workspaceState?: vscode.Memento
  private static readonly globalStateKey = 'ghost.global.v2'
  private static readonly workspaceStateKey = 'ghost.workspace.v2'
  private pendingMessages: GhostExtensionMessage[] = []
  private status: GhostViewStatus = 'ready'
  private disposed = false

  private readonly chatHandler: vscode.ChatRequestHandler

  private debugLog(message: string, details?: unknown): void {
    if (!getGhostSettings().enableDebugLogging) {
      return
    }
    console.debug(JSON.stringify({ scope: 'Ghost', message, details: details === undefined ? undefined : redactSensitiveText(JSON.stringify(details)) }))
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    options: { chatHandler?: vscode.ChatRequestHandler; globalState?: vscode.Memento; workspaceState?: vscode.Memento } = {}
  ) {
    this.globalState = options.globalState
    this.workspaceState = options.workspaceState
    this.chatHandler = options.chatHandler ?? createChatParticipantHandler()
    this.debugLog('view provider created')
    this.disposables.push(ghostConfig.onDidChange(() => {
      void this.sendControlsState()
    }))
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out')]
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
    attachments: GhostAttachment[] = []
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
      outputTokens: 0
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
          this.postStreamEvent(requestId, request, {
            type: 'tool-result',
            tool: pendingTool.name,
            detail: `${pendingTool.name} completed`,
            toolCallId: pendingTool.toolCallId,
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
          pendingTool = {
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
            this.postStreamEvent(requestId, request, {
              type: 'tool-result',
              tool: pendingTool.name,
              toolCallId: pendingTool.toolCallId,
              detail: result[2],
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
      additionalContext: droppedContext || undefined,
      approveTool: call => this.requestToolApproval(requestId, request, call)
    }

    const timeout = setTimeout(() => {
      if (!this.requests.has(requestId)) {
        return
      }
      request.timedOut = true
      request.status = 'failed'
      request.cancellation.cancel()
      this.postStreamEvent(requestId, request, {
        type: 'warning',
        message: 'Ghost timed out. You can retry this request.'
      })
      this.postStreamEvent(requestId, request, {
        type: 'error',
        message: 'The provider did not respond before the request timeout.'
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
      for (let attempt = 1; attempt <= GhostViewProvider.maxProviderAttempts; attempt += 1) {
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
          if (cancellation.token.isCancellationRequested || !isRecoverable(error) || attempt >= GhostViewProvider.maxProviderAttempts) {
            throw error
          }
          const delay = 500 * (2 ** (attempt - 1))
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
      this.postStreamEvent(requestId, request, {
        type: 'request-completed',
        phase: 'complete',
        status: request.timedOut
          ? 'failed'
          : cancellation.token.isCancellationRequested
            ? 'cancelled'
            : 'completed'
      })
    } catch (error) {
      if (!cancellation.token.isCancellationRequested || !request.timedOut) {
        const message = redactSensitiveText(error instanceof Error ? error.message : 'Ghost request failed')
        this.debugLog('request failed', message)
        this.postStreamEvent(requestId, request, { type: 'error', phase: 'error', message })
      }
      this.postStreamEvent(requestId, request, {
        type: 'request-completed',
        status: request.timedOut || !cancellation.token.isCancellationRequested ? 'failed' : 'cancelled'
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

  private cancel(requestId: string): void {
    const request = this.requests.get(requestId)
    if (!request) {
      return
    }
    this.resolvePendingApprovals(requestId, { decision: 'reject' })
    request.status = 'cancelled'
    request.cancellation.cancel()
  }

  private cancelRequests(): void {
    for (const requestId of this.requests.keys()) {
      this.cancel(requestId)
    }
  }

  private createToolCallId(): string {
    return `tool-${Date.now()}-${randomBytes(6).toString('hex')}`
  }

  private requiresToolApproval(toolName: string): boolean {
    return toolName === 'ghost_write_file' || toolName === 'ghost_apply_edit' || toolName === 'ghost_run_terminal_command'
  }

  private async getDiffPreview(call: LocalToolCall): Promise<GhostToolDiffPreview | undefined> {
    if ((call.name !== 'ghost_write_file' && call.name !== 'ghost_apply_edit') || typeof call.arguments.path !== 'string') {
      return undefined
    }
    try {
      const uri = resolveWorkspacePath(call.arguments.path)
      let before = ''
      try {
        const bytes = await vscode.workspace.fs.readFile(uri)
        before = Buffer.from(bytes).toString('utf8')
      } catch {
        before = ''
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
        let beforeDocument: vscode.TextDocument
        try {
          beforeDocument = await vscode.workspace.openTextDocument(uri)
        } catch {
          beforeDocument = await vscode.workspace.openTextDocument({ content: before })
        }
        const afterDocument = await vscode.workspace.openTextDocument({ language: beforeDocument.languageId, content: after })
        await vscode.commands.executeCommand('vscode.diff', beforeDocument.uri, afterDocument.uri, `Ghost edit: ${uri.fsPath}`)
      } catch {
        // The inline preview remains available when the diff editor cannot open.
      }
      return preview
    } catch {
      return undefined
    }
  }

  private async getExpectedFileContent(call: LocalToolCall): Promise<string | undefined> {
    if ((call.name !== 'ghost_write_file' && call.name !== 'ghost_apply_edit') || typeof call.arguments.path !== 'string') {
      return undefined
    }
    try {
      const uri = resolveWorkspacePath(call.arguments.path)
      try {
        return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
      } catch {
        return ''
      }
    } catch {
      return undefined
    }
  }

  private async rememberRecovery(
    requestId: string,
    conversationId: string,
    toolCallId: string,
    call: LocalToolCall,
    expectedContent: string | undefined,
    selectedHunkIndexes?: number[]
  ): Promise<void> {
    if ((call.name !== 'ghost_write_file' && call.name !== 'ghost_apply_edit') || typeof call.arguments.path !== 'string') {
      return
    }
    try {
      const uri = resolveWorkspacePath(call.arguments.path)
      let before = expectedContent
      if (before === undefined) {
        try {
          before = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
        } catch {
          before = ''
        }
      }
      const after = call.name === 'ghost_write_file'
        ? typeof call.arguments.content === 'string' ? call.arguments.content : undefined
        : applyGhostEdit(before, parseGhostEdit(call.arguments), selectedHunkIndexes ? new Set(selectedHunkIndexes) : undefined)
      if (after === undefined) {
        return
      }
      this.recoveryRecords.set(toolCallId, {
        requestId,
        conversationId,
        toolCallId,
        path: uri.fsPath,
        before,
        after,
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
      const uri = resolveWorkspacePath(record.path)
      let current = ''
      try {
        current = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
      } catch {
        current = ''
      }
      if (current !== record.after) {
        await vscode.window.showErrorMessage('Ghost cannot restore this file because it changed after the edit.')
        return
      }
      await vscode.workspace.fs.writeFile(uri, Buffer.from(record.before, 'utf8'))
      record.applied = false
      await vscode.window.showInformationMessage(`Restored ${uri.fsPath}.`)
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
    request: GhostRequestState,
    call: LocalToolCall
  ): Promise<GhostToolApproval> {
    const pending = request.pendingTool?.name === call.name
      ? request.pendingTool
      : { toolCallId: this.createToolCallId(), name: call.name }
    request.pendingTool = pending
    const settings = getGhostSettings()
    const allowedTools = settings.toolAllowlist ?? [...GHOST_TOOL_NAMES]
    const deniedTools = settings.toolDenylist ?? []
    const blockedByPolicy = !allowedTools.includes(call.name) || deniedTools.includes(call.name)
    const requiresApproval = this.requiresToolApproval(call.name) && !blockedByPolicy
    const argumentsPayload = call.arguments as GhostToolArguments
    const diffPreview = requiresApproval ? await this.getDiffPreview(call) : undefined
    const expectedContent = requiresApproval ? await this.getExpectedFileContent(call) : undefined
    this.postStreamEvent(requestId, request, {
      type: 'tool-requested',
      tool: call.name,
      toolCallId: pending.toolCallId,
      arguments: argumentsPayload,
      requiresApproval,
      ...(diffPreview ? { diffPreview } : {}),
      detail: blockedByPolicy
        ? 'Blocked by workspace tool policy'
        : requiresApproval ? 'Waiting for approval' : 'Running safe workspace tool',
      phase: 'tool'
    })

    if (blockedByPolicy) {
      return { decision: 'reject', reason: 'Tool blocked by workspace policy.' }
    }
    if (!requiresApproval || this.sessionApprovedTools.has(call.name)) {
      await this.rememberRecovery(requestId, request.conversationId, pending.toolCallId, call, expectedContent)
      return { decision: 'once', expectedContent }
    }

    return new Promise(resolve => {
      this.pendingApprovals.set(pending.toolCallId, {
        requestId,
        conversationId: request.conversationId,
        toolCallId: pending.toolCallId,
        call,
        expectedContent,
        resolve
      })
    })
  }

  private resolvePendingApprovals(requestId: string, approval: GhostToolApproval): void {
    for (const [toolCallId, pending] of this.pendingApprovals) {
      if (pending.requestId !== requestId) {
        continue
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
      this.sessionApprovedTools.add(pending.call.name)
    }
    if (pending.call.name === 'ghost_write_file' || pending.call.name === 'ghost_apply_edit') {
      void this.verifyExternalEdit(pending, approval)
      return
    }
    this.pendingApprovals.delete(toolCallId)
    pending.resolve(approval)
  }

  private async verifyExternalEdit(pending: PendingToolApproval, approval: GhostToolApproval): Promise<void> {
    const expected = pending.expectedContent
    if (expected === undefined || typeof pending.call.arguments.path !== 'string') {
      this.pendingApprovals.delete(pending.toolCallId)
      pending.resolve(approval)
      return
    }
    try {
      const uri = resolveWorkspacePath(pending.call.arguments.path)
      let current = ''
      try {
        current = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
      } catch {
        current = ''
      }
      this.pendingApprovals.delete(pending.toolCallId)
      if (current !== expected) {
        pending.resolve({ decision: 'reject', reason: 'File changed externally since the diff was shown.' })
        return
      }
      await this.rememberRecovery(
        pending.requestId,
        pending.conversationId,
        pending.toolCallId,
        pending.call,
        expected,
        approval.selectedHunkIndexes
      )
      pending.resolve({ ...approval, expectedContent: expected })
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
    pending.call.arguments = argumentsPayload
    pending.expectedContent = await this.getExpectedFileContent(pending.call)
    const request = this.requests.get(requestId)
    if (!request) {
      return
    }
    const diffPreview = await this.getDiffPreview(pending.call)
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

  private postStreamEvent(
    requestId: string,
    request: GhostRequestState,
    event: { type: GhostStreamEvent['type']; [key: string]: unknown }
  ): void {
    request.lastActivityAt = Date.now()
    request.status = getRequestStatusForEvent(event, request.status)
    request.sequence += 1
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
      ...Object.fromEntries(Object.entries(event).map(([key, value]) => [key, typeof value === 'string' ? redactSensitiveText(value) : value]))
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
    const settings = getGhostSettings()
    let models: string[] = []
    let connection: 'online' | 'offline' | 'unknown' = 'unknown'

    try {
      const client = settings.provider === 'mlx-vlm'
        ? new MlxClient(settings.mlxUrl)
        : new OllamaClient(
            settings.provider === 'openai-compatible' ? settings.openaiUrl : settings.ollamaUrl,
            settings.provider === 'openai-compatible' ? 'openai-compatible' : 'auto'
          )
      const online = await client.checkHealth(1500)
      connection = online ? 'online' : 'offline'
      if (online) {
        models = await client.listModels()
      }
    } catch {
      connection = 'offline'
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
    const allowedTools = (settings.toolAllowlist ?? [...GHOST_TOOL_NAMES]).filter(tool => !(settings.toolDenylist ?? []).includes(tool))

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
        responseLength: settings.responseLength,
        mode: settings.mode,
        enableConversationPersistence: settings.enableConversationPersistence,
        ollamaUrl: settings.ollamaUrl,
        mlxUrl: settings.mlxUrl,
        openaiUrl: settings.openaiUrl,
        toolAllowlist: settings.toolAllowlist ?? [...GHOST_TOOL_NAMES],
        toolDenylist: settings.toolDenylist ?? [],
        enableDebugLogging: settings.enableDebugLogging,
        networkAccess: isExternalEndpoint(settings.provider === 'mlx-vlm' ? settings.mlxUrl : settings.provider === 'openai-compatible' ? settings.openaiUrl : settings.ollamaUrl) ? 'external' : 'local'
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
      ? new MlxClient(settings.mlxUrl)
      : new OllamaClient(
          settings.provider === 'openai-compatible' ? settings.openaiUrl : settings.ollamaUrl,
          settings.provider === 'openai-compatible' ? 'openai-compatible' : 'auto'
        )
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
    if (Array.isArray(update.toolAllowlist)) {
      await ghostConfig.update('toolAllowlist', update.toolAllowlist, target)
    }
    if (Array.isArray(update.toolDenylist)) {
      await ghostConfig.update('toolDenylist', update.toolDenylist, target)
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
    if (update.responseLength) {
      await ghostConfig.update('responseLength', update.responseLength, target)
    }
    if (update.mode) {
      await ghostConfig.update('mode', update.mode, target)
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
    await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(exportData, null, 2), 'utf8'))
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
    this.recoveryRecords.clear()
    this.sessionApprovedTools.clear()
    vscode.Disposable.from(...this.disposables).dispose()
    this.disposables.length = 0
    this.view = undefined
    this.pendingMessages = []
  }

  private async handleMessage(value: unknown): Promise<void> {
    if (!isGhostWebviewMessage(value)) {
      return
    }

    switch (value.type) {
      case 'ready':
        await this.sendPersistedState()
        this.postState()
        return
      case 'reset':
        await this.reset()
        return
      case 'clear':
        this.clear()
        return
      case 'export':
        await this.export(value.state)
        return
      case 'import':
        await this.importState()
        return
      case 'persist-state':
        await this.persistState(value.state)
        return
      case 'check-status':
        await vscode.commands.executeCommand('ghost.checkOllamaStatus')
        return
      case 'test-provider':
        await this.testProvider()
        return
      case 'submit':
        await this.submit(value.requestId, value.conversationId, value.prompt, value.options, value.attachments)
        return
      case 'cancel':
        this.cancel(value.requestId)
        return
      case 'approve-tool':
        this.decideToolApproval(value.requestId, value.conversationId, value.toolCallId, {
          decision: value.decision,
          selectedHunkIndexes: value.selectedHunkIndexes
        })
        return
      case 'reject-tool':
        this.decideToolApproval(value.requestId, value.conversationId, value.toolCallId, { decision: 'reject' })
        return
      case 'cancel-tool':
        this.cancel(value.requestId)
        return
      case 'edit-tool':
        await this.editToolArguments(value.requestId, value.conversationId, value.toolCallId, value.arguments)
        return
      case 'restore-tool':
        await this.restoreTool(value.requestId, value.conversationId, value.toolCallId)
        return
      case 'open-file':
        await this.openFile(value.path, value.line)
        return
      case 'load-controls':
      case 'refresh-models':
        await this.sendControlsState()
        return
      case 'update-settings':
        await this.updateSettings(value.settings)
        return
      case 'pick-file':
        await this.pickFiles()
        return
      case 'select-model':
        await this.updateSettings({ chatModel: value.model })
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

    void this.view.webview.postMessage(message)
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
        margin: 0;
        min-width: 220px;
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

      .app {
        display: flex;
        min-height: 100vh;
        flex-direction: column;
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
        color: var(--ghost-accent);
        font-size: 18px;
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

      .context-row {
        align-items: center;
        display: flex;
        gap: 5px;
        min-height: 25px;
      }

      .context-chips,
      .attachment-list {
        display: flex;
        flex: 1;
        flex-wrap: wrap;
        gap: 4px;
        min-width: 0;
      }

      .context-chip,
      .attachment-chip {
        background: var(--vscode-badge-background);
        border: 0;
        border-radius: 10px;
        color: var(--vscode-badge-foreground);
        font-size: 0.75em;
        max-width: 180px;
        overflow: hidden;
        padding: 3px 7px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .context-chip.removed {
        background: transparent;
        border: 1px dashed var(--ghost-border);
        color: var(--vscode-descriptionForeground);
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

      .modal {
        background: var(--vscode-quickInput-background, var(--ghost-surface));
        border: 1px solid var(--ghost-border);
        border-radius: 5px;
        box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
        max-height: calc(100vh - 32px);
        max-height: calc(100dvh - 32px);
        max-width: 460px;
        overflow: auto;
        padding: 14px;
        width: 100%;
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
      .sidebar-header,
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

      .chat-layout {
        display: flex;
        flex: 1;
        min-height: 0;
      }

      .sidebar {
        border-right: 1px solid var(--ghost-border);
        display: flex;
        flex: 0 0 166px;
        flex-direction: column;
        min-width: 0;
      }

      .sidebar-header {
        border-bottom: 1px solid var(--ghost-border);
        justify-content: space-between;
        padding: 8px;
      }

      .sidebar-title {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        font-weight: 600;
        text-transform: uppercase;
      }

      .conversation-list {
        overflow: auto;
        padding: 4px;
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
        margin: 0 12px 8px;
        padding: 8px;
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

      .status-footer.offline .status-dot {
        background: var(--vscode-testing-iconFailed, #f14c4c);
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
        .sidebar {
          flex-basis: 132px;
        }

        .composer-hint {
          display: none;
        }
      }

      @media (max-width: 360px) {
        .sidebar {
          flex-basis: 104px;
        }

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
          scroll-behavior: auto !important;
          transition-duration: 0.01ms !important;
        }
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`
  }
}
