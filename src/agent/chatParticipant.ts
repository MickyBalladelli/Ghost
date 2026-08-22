import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { TextDecoder } from 'node:util'

import { LocalToolExecutor } from '../tools/localToolExecutor'
import { redactSensitiveText, redactSensitiveValue } from '../privacy/redact'
import { GhostConfig, GhostProvider, ghostConfig } from '../config'
import { LlmFactory } from '../services/llmFactory'
import { createVisionMessage, MlxClient } from '../services/mlxClient'
import { ChatMessage, ChatResponseFormat, ChatStreamEvent, ChatVisionImage } from '../services/chatTypes'
import { OllamaClient } from '../services/ollamaClient'
import { GhostStatusBar } from '../ui/statusBar'
import { parseGhostEdit } from '../tools/editWorkflow'
import type { GhostEditHunk } from '../tools/editWorkflow'
import { parseFileTransaction } from '../tools/transactionWorkflow'
import { auditTerminalCommand } from '../tools/terminalAudit'
import { resolveWorkspacePath } from '../tools/workspacePath'
import { classifyLocalToolResponse, LocalToolCall, LocalToolCallStreamAssembler, parseNativeLocalToolCall } from './toolCallParser'
import { GHOST_NATIVE_TOOL_DEFINITIONS, JSON_OBJECT_RESPONSE_FORMAT } from './nativeTooling'
import { validateLocalToolCall } from './toolSchema'
import type { GhostStopReason } from '../ui/ghostState'
import { GHOST_RETRY_POLICIES } from './retryPolicy'
import { isFailedToolOutcome, getInspectionPathRecoveryKey, shouldRetryInspectionPath, shouldStopAgentForToolFailure } from './toolFailurePolicy'
import { createProfiledProviderClient } from '../services/profiledProviderClient'
import { resolveModelSettings } from '../services/modelProfiles'
import type { GhostModelRole } from '../services/modelProfiles'
import { profileProtocol } from '../services/profiledProviderClient'
import { GHOST_POLICY } from '../ghostPolicy'
import { createToolErrorResult, replaceToolResultText, ToolResult } from '../tools/toolResult'
import { limitToolResultText } from '../tools/toolResultLimits'
import { EditRecord, FileEditState, getEditLoopReason } from './editLoopGuard'
import { argumentsWithCanonicalPath, canonicalizeEditPath, getCanonicalEditPath, getCanonicalEditPaths } from './editPaths'
import { hasReachedToolCallLimit, MAX_TOOL_ROUNDS, outputTokenBudget } from './budgetPolicy'
import { parseTaskPlanMarker } from './taskPlan'
import { describesWorkspaceChange, isLikelyConversationalPrompt } from './workspaceChangeIntent'
import { buildAgentSystemPrompt, JSON_TOOL_PARSE_FAILURE_REMINDER } from './systemPrompt'
import { shouldUseNativeToolCalling } from './nativeToolSupport'
import { OpenCodeClient, OpenCodePermissionRequest, openCodeSessionStorageKey } from '../services/openCodeClient'
import type { GhostStorage } from '../runtimeDependencies'
import { isFileEditTool, requiresToolApproval } from '../ui/toolPermissionPolicy'

const CHAT_PARTICIPANT_ID = 'ghost.agent'
const DEFAULT_TEMPERATURE = 0.3

const REQUEST_BUDGET_LIMITS = GHOST_POLICY.agent.requestBudget

interface EditCost {
  changedLines: number
  changedBytes: number
}

interface RequestBudget {
  startedAt: number
  timeMs: number
  files: Set<string>
  changedLines: number
  changedBytes: number
  commands: number
  modelTokens: number
}

interface ContextBudgetResult {
  messages: ChatMessage[]
  inputTokens: number
  compacted: boolean
  omittedTokens: number
}

type ContextTokenizer = (text: string) => number

const tokenizeContext: ContextTokenizer = (text: string): number => {
  const tokens = text.match(/[A-Za-z0-9_]+|[^A-Za-z0-9_\s]/g)
  return tokens?.length ?? 0
}

const estimateMessageTokens = (message: ChatMessage, tokenizer: ContextTokenizer): number => {
  if (typeof message.content === 'string') {
    return tokenizer(message.content)
  }
  return message.content.reduce((total, part) => total + (part.type === 'text' ? tokenizer(part.text) : 256), 0)
}

const compactText = (
  text: string,
  maxTokens: number,
  marker = '[Context compacted by Ghost]',
  tokenizer: ContextTokenizer = tokenizeContext
): string => {
  if (tokenizer(text) <= maxTokens) {
    return text
  }
  const markerTokenCount = Math.max(1, tokenizer(marker))
  const markerText = markerTokenCount <= maxTokens
    ? marker
    : marker.slice(0, Math.max(1, Math.floor(marker.length * maxTokens / markerTokenCount)))
  const buildCandidate = (retainedCharacters: number): string => {
    const headCharacters = Math.floor(retainedCharacters * 0.55)
    const tailCharacters = Math.max(0, retainedCharacters - headCharacters)
    const tail = tailCharacters > 0 ? text.slice(-tailCharacters) : ''
    return `${text.slice(0, headCharacters)}\n\n${markerText}\n\n${tail}`
  }
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (tokenizer(buildCandidate(middle)) <= maxTokens) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return buildCandidate(low)
}

const contextSectionPriority = (section: string): number => {
  if (/^User request:/i.test(section)) return 100
  if (/^Active file:/i.test(section)) return 95
  if (/^Diagnostics:/i.test(section)) return 93
  if (/^Changed files:/i.test(section)) return 90
  if (/diff|error|failed|verification|changed externally/i.test(section)) return 90
  if (/^User-mentioned files:/i.test(section)) return 88
  if (/^Additional prompt context:/i.test(section)) return 85
  if (/^Attached file:/i.test(section)) return 75
  if (/@workspace|^Workspace:/i.test(section)) return 50
  return 60
}

const compactInitialContext = (text: string, maxTokens: number, tokenizer: ContextTokenizer): string => {
  const sections = text.split(/\n\n(?=[A-Za-z@])/)
  if (sections.length <= 1) {
    return compactText(text, maxTokens, '[Context compacted by Ghost]', tokenizer)
  }
  const selected: Array<{ text: string; index: number }> = []
  let remaining = Math.max(256, maxTokens)
  const ranked = sections
    .map((section, index) => ({ section, index, priority: contextSectionPriority(section) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
  for (const item of ranked) {
    if (remaining <= 0) break
    const sectionTokens = tokenizer(item.section)
    const allowedTokens = Math.min(sectionTokens, remaining)
    if (allowedTokens < 32 && selected.length > 0) continue
    selected.push({
      text: sectionTokens > allowedTokens
        ? compactText(item.section, allowedTokens, '[File context compacted by Ghost]', tokenizer)
        : item.section,
      index: item.index
    })
    remaining -= Math.min(sectionTokens, allowedTokens)
  }
  return selected
    .sort((left, right) => left.index - right.index)
    .map(item => item.text)
    .join('\n\n')
}

const compactHistoryMessage = (message: ChatMessage, maxTokens: number, tokenizer: ContextTokenizer): ChatMessage => {
  if (typeof message.content !== 'string') {
    return message
  }
  const marker = /tool result|diff|error|failed|verification/i.test(message.content)
    ? '[Older tool result compacted by Ghost]'
    : '[Older model turn compacted by Ghost]'
  return { ...message, content: compactText(message.content, maxTokens, marker, tokenizer) }
}

export class ContextBudgetManager {
  private readonly inputTokenBudget: number
  private readonly tokenizer: ContextTokenizer

  constructor(
    maxContextTokens: number,
    requestedOutputTokens: number | undefined,
    toolsEnabled: boolean,
    tokenizer: ContextTokenizer = tokenizeContext
  ) {
    const outputReserve = outputTokenBudget(requestedOutputTokens, toolsEnabled, maxContextTokens) ?? 512
    this.inputTokenBudget = Math.max(256, Math.floor(maxContextTokens) - outputReserve)
    this.tokenizer = tokenizer
  }

  prepare(messages: ChatMessage[]): ContextBudgetResult {
    const originalTokens = messages.reduce((total, message) => total + estimateMessageTokens(message, this.tokenizer), 0)
    if (originalTokens <= this.inputTokenBudget) {
      return { messages, inputTokens: originalTokens, compacted: false, omittedTokens: 0 }
    }

    const system = messages[0]
    const initial = messages[1]
    const history = messages.slice(2)
    const systemTokens = system ? estimateMessageTokens(system, this.tokenizer) : 0
    const initialBudget = Math.max(512, Math.floor((this.inputTokenBudget - systemTokens) * 0.65))
    const compactedInitial = initial && typeof initial.content === 'string'
      ? { ...initial, content: compactInitialContext(initial.content, initialBudget, this.tokenizer) }
      : initial
    const selected: ChatMessage[] = [
      ...(system ? [system] : []),
      ...(compactedInitial ? [compactedInitial] : [])
    ]
    let remaining = this.inputTokenBudget - selected.reduce((total, message) => total + estimateMessageTokens(message, this.tokenizer), 0)
    const chosenHistory: ChatMessage[] = []
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (remaining <= 0) break
      const original = history[index]
      const isRecent = history.length - index <= 4
      const candidate = isRecent
        ? original
        : compactHistoryMessage(original, Math.min(768, Math.max(128, Math.floor(remaining / 2))), this.tokenizer)
      const candidateTokens = estimateMessageTokens(candidate, this.tokenizer)
      if (candidateTokens > remaining) {
        const compacted = compactHistoryMessage(candidate, remaining, this.tokenizer)
        const compactedTokens = estimateMessageTokens(compacted, this.tokenizer)
        if (compactedTokens > remaining || compactedTokens < 8) continue
        chosenHistory.unshift(compacted)
        remaining -= compactedTokens
        continue
      }
      chosenHistory.unshift(candidate)
      remaining -= candidateTokens
    }
    selected.push(...chosenHistory)
    const inputTokens = selected.reduce((total, message) => total + estimateMessageTokens(message, this.tokenizer), 0)
    return {
      messages: selected,
      inputTokens,
      compacted: true,
      omittedTokens: Math.max(0, originalTokens - inputTokens)
    }
  }
}

function summarizeToolResult(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 600 ? `${compact.slice(0, 600)}…` : compact
}

function isProviderConnectivityFailure(value: string): boolean {
  return /abort|connection refused|connection reset|econn|enotfound|etimedout|fetch failed|network|socket|timed out|timeout|502|503|504|temporarily unavailable|offline/i.test(value)
}

function hasPendingWorkspaceTask(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false
  }
  const latestGhostReply = /(?:^|\n\n)Ghost:\n([\s\S]*)$/i.exec(value)?.[1] ?? ''
  return /\b(?:would you like me to|want me to|shall i|should i|ready to apply|ready to proceed|tell me to proceed)\b/i.test(latestGhostReply)
    && describesWorkspaceChange(latestGhostReply)
}

function isStaleEditConflict(value: string): boolean {
  return /old text does not match|content hash does not match|preceding context does not match|following context does not match|file changed externally|edit expected different file content|refresh and rebase/i.test(value)
}

function finishAfterSuccessfulWorkspaceChange(
  response: vscode.ChatResponseStream,
  successfulWorkspaceChange: boolean,
  taskPlanRequiresExecution: boolean
): boolean {
  if (!successfulWorkspaceChange || taskPlanRequiresExecution) {
    return false
  }
  response.progress('Workspace change already applied. Ignoring invalid follow-up tool arguments.')
  response.markdown('Workspace change applied successfully. The model sent invalid follow-up tool arguments, so Ghost stopped safely after the completed edit.')
  return true
}

function resolveEditFilePath(filePath: string): string {
  return resolveWorkspacePath(filePath).fsPath
}

function readFileCacheFingerprint(filePath: string): string {
  try {
    const uri = resolveWorkspacePath(filePath)
    const document = vscode.workspace.textDocuments.find(item => item.uri.fsPath === uri.fsPath)
    const stats = fs.existsSync(uri.fsPath) ? fs.statSync(uri.fsPath) : undefined
    return JSON.stringify({
      editorVersion: document?.version,
      dirty: document?.isDirty,
      mtimeMs: stats?.mtimeMs,
      size: stats?.size
    })
  } catch {
    return 'unknown'
  }
}

function readToolCallSignature(call: LocalToolCall): string | undefined {
  if (call.name !== 'ghost_read_file' || typeof call.arguments.path !== 'string') {
    return undefined
  }

  const filePath = canonicalizeEditPath(call.arguments.path, resolveEditFilePath)
  const options = Object.keys(call.arguments)
    .filter(key => key !== 'path')
    .sort()
    .map(key => [key, call.arguments[key]])

  return JSON.stringify([filePath, options, readFileCacheFingerprint(filePath)])
}

function getEditPath(call: LocalToolCall): string | undefined {
  return getCanonicalEditPath(call, resolveEditFilePath)
}

function getEditPaths(call: LocalToolCall): string[] {
  return getCanonicalEditPaths(call, resolveEditFilePath)
}

function getEditRecord(call: LocalToolCall): EditRecord | undefined {
  const path = getEditPath(call)
  if (!path) {
    return undefined
  }

  if (call.name === 'ghost_write_file') {
    const content = typeof call.arguments.content === 'string' ? call.arguments.content : ''
    return {
      signature: `${call.name}:${path}:${JSON.stringify(argumentsWithCanonicalPath(call, path))}`,
      fingerprint: `${call.name}:${path}:${content}`,
      ranges: [],
      hunks: []
    }
  }

  try {
    const edit = parseGhostEdit(call.arguments)
    const shape = edit.hunks.map(hunk => ({
      startLine: hunk.startLine,
      endLine: hunk.endLine,
      replacement: hunk.replacement
    }))
    return {
      signature: `${call.name}:${path}:${JSON.stringify(argumentsWithCanonicalPath(call, path))}`,
      fingerprint: `${call.name}:${path}:${JSON.stringify(shape)}`,
      ranges: edit.hunks.map(hunk => ({ startLine: hunk.startLine, endLine: hunk.endLine })),
      hunks: edit.hunks
    }
  } catch {
    return undefined
  }
}

function getEditCost(call: LocalToolCall, selectedHunkIndexes?: number[]): EditCost | undefined {
  if (call.name === 'ghost_apply_transaction') {
    try {
      const transaction = parseFileTransaction(call.arguments)
      return transaction.edits.reduce((cost, edit) => {
        if (edit.content !== undefined) {
          return {
            changedLines: cost.changedLines + Math.max(1, edit.content.split('\n').length),
            changedBytes: cost.changedBytes + Math.max(1, Buffer.byteLength(edit.content, 'utf8'))
          }
        }
        return edit.hunks?.reduce((hunkCost, hunk) => ({
          changedLines: hunkCost.changedLines + Math.max(1, hunk.endLine - hunk.startLine + 1, hunk.replacement.split('\n').length),
          changedBytes: hunkCost.changedBytes + Math.max(1, Buffer.byteLength(hunk.oldText ?? '', 'utf8'), Buffer.byteLength(hunk.replacement, 'utf8'))
        }), cost) ?? cost
      }, { changedLines: 0, changedBytes: 0 })
    } catch {
      return undefined
    }
  }
  if (call.name === 'ghost_write_file') {
    const content = typeof call.arguments.content === 'string' ? call.arguments.content : ''
    return {
      changedLines: Math.max(1, content.split('\n').length),
      changedBytes: Math.max(1, Buffer.byteLength(content, 'utf8'))
    }
  }
  if (call.name !== 'ghost_apply_edit') {
    return undefined
  }

  try {
    const edit = parseGhostEdit(call.arguments)
    const selected = selectedHunkIndexes ? new Set(selectedHunkIndexes) : undefined
    return edit.hunks.reduce((cost, hunk, index) => {
      if (selected && !selected.has(index)) {
        return cost
      }
      const replacementLines = hunk.replacement.split('\n').length
      const oldLines = hunk.oldText?.split('\n').length ?? hunk.endLine - hunk.startLine + 1
      const oldBytes = hunk.oldText ? Buffer.byteLength(hunk.oldText, 'utf8') : 0
      const replacementBytes = Buffer.byteLength(hunk.replacement, 'utf8')
      return {
        changedLines: cost.changedLines + Math.max(1, oldLines, replacementLines),
        changedBytes: cost.changedBytes + Math.max(1, oldBytes, replacementBytes)
      }
    }, { changedLines: 0, changedBytes: 0 })
  } catch {
    return undefined
  }
}

function getBudgetStopReason(budget: RequestBudget, call?: LocalToolCall, selectedHunkIndexes?: number[]): string | undefined {
  const elapsedMs = Date.now() - budget.startedAt
  if (elapsedMs >= budget.timeMs) {
    return `time (${Math.ceil(elapsedMs / 60000)} minutes used of ${budget.timeMs / 60000})`
  }
  if (budget.modelTokens >= REQUEST_BUDGET_LIMITS.modelTokens) {
    return `model tokens (${budget.modelTokens} used of ${REQUEST_BUDGET_LIMITS.modelTokens})`
  }
  if (!call) {
    return undefined
  }
  if (call.name === 'ghost_run_terminal_command' && budget.commands >= REQUEST_BUDGET_LIMITS.commands) {
    return `commands (${budget.commands} used of ${REQUEST_BUDGET_LIMITS.commands})`
  }
  const paths = getEditPaths(call)
  const cost = getEditCost(call, selectedHunkIndexes)
  if (paths.length === 0 || !cost) {
    return undefined
  }
  const newFiles = paths.filter(path => !budget.files.has(path)).length
  if (budget.files.size + newFiles > REQUEST_BUDGET_LIMITS.files) {
    return `files (${budget.files.size} used of ${REQUEST_BUDGET_LIMITS.files})`
  }
  if (budget.changedLines + cost.changedLines > REQUEST_BUDGET_LIMITS.changedLines) {
    return `changed lines (${budget.changedLines + cost.changedLines} requested of ${REQUEST_BUDGET_LIMITS.changedLines})`
  }
  if (budget.changedBytes + cost.changedBytes > REQUEST_BUDGET_LIMITS.changedBytes) {
    return `changed bytes (${budget.changedBytes + cost.changedBytes} requested of ${REQUEST_BUDGET_LIMITS.changedBytes})`
  }
  return undefined
}

function stopForBudget(response: vscode.ChatResponseStream, reason: string, onStop?: GhostRequestOptions['onStop']): void {
  const message = `Ghost stopped because the request budget was reached: ${reason}. Review the partial changes and retry with a smaller request.`
  onStop?.('budget-limit', message)
  response.markdown(message)
}

async function continueAfterBudget(
  budget: RequestBudget,
  reason: string,
  response: vscode.ChatResponseStream,
  requestOptions: GhostRequestOptions
): Promise<boolean> {
  const shouldContinue = requestOptions.confirmBudgetContinue
    ? await requestOptions.confirmBudgetContinue(reason)
    : await vscode.window.showWarningMessage(
        `Ghost reached a request budget limit: ${reason}. Continue working?`,
        { modal: true, detail: 'Choose Continue to start a fresh budget window, or Stop to end this request.' },
        'Continue',
        'Stop'
      ) === 'Continue'
  if (!shouldContinue) {
    stopForBudget(response, reason, requestOptions.onStop)
    return false
  }
  budget.startedAt = Date.now()
  budget.files.clear()
  budget.changedLines = 0
  budget.changedBytes = 0
  budget.commands = 0
  budget.modelTokens = 0
  response.progress('Request budget renewed. Continuing work.')
  return true
}

function noToolRecoveryMessage(state: ReturnType<typeof classifyLocalToolResponse>['state'], retries: number): string {
  const reason = state === 'unknown-tool'
    ? 'the model named a tool Ghost does not have'
    : state === 'truncated-json'
      ? 'the model returned incomplete tool JSON'
      : state === 'malformed-json'
        ? 'the model returned invalid tool JSON'
        : 'the model described an edit without calling a workspace tool'
  return `Ghost could not complete the requested edit because ${reason} after ${retries} retries. No workspace change was made. Use Retry to send the request again, or Regenerate for a fresh model response.`
}

function getToolArgumentError(call: LocalToolCall): string | undefined {
  const schemaError = validateLocalToolCall(call)
  if (schemaError) {
    return `Tool call rejected: ${schemaError} Retry with one JSON tool call correcting that field.`
  }
  if (call.name === 'ghost_run_terminal_command') {
    const command = call.arguments.command as string
    const audit = auditTerminalCommand(command)
    if (audit.blocked) {
      return `${audit.blockReason} Retry with one ghost_read_file, ghost_apply_edit, or ghost_write_file call. Use ghost_run_terminal_command only for inspection, builds, tests, or commands explicitly requested by the user.`
    }
  }
  return undefined
}

function getPathRecoveryKey(call: LocalToolCall, result: string): string | undefined {
  return getInspectionPathRecoveryKey(call.name, result, call.arguments.path)
}

export interface ChatParticipantOptions {
  configuration?: GhostConfig
  llmFactory?: LlmFactory
  toolExecutor?: LocalToolExecutor
  statusBar?: GhostStatusBar
  providerApiKey?: (provider: GhostProvider) => string | undefined
  approveTool?: (call: LocalToolCall, requestKey: string) => Promise<GhostToolApproval>
  openCodeSessionStorage?: GhostStorage
}

export interface GhostContextSelection {
  workspace?: boolean
  folders?: boolean
  activeFile?: boolean
  selection?: boolean
  openFiles?: boolean
  tools?: boolean
}

export interface GhostRequestOptions {
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
  seed?: number
  stopSequences?: string[]
  contextWindow?: number
  grammar?: string
  maxContextTokens?: number
  maxTokens?: number
  mode?: 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
  context?: GhostContextSelection
  workspaceRoot?: string
  additionalContext?: string
  showReasoning?: boolean
  customSystemInstructions?: string
  jsonMode?: boolean
  responseFormat?: ChatResponseFormat
  images?: ChatVisionImage[]
  approveTool?: (call: LocalToolCall) => Promise<GhostToolApproval>
  confirmContinue?: (toolCallCount: number) => Promise<boolean>
  confirmBudgetContinue?: (reason: string) => Promise<boolean>
  onStop?: (reason: GhostStopReason, message: string) => void
}

export interface GhostToolApproval {
  decision: 'once' | 'file' | 'request' | 'session' | 'workspace' | 'always' | 'reject'
  arguments?: Record<string, unknown>
  expectedContent?: string
  expectedFileExists?: boolean
  expectedFiles?: Record<string, { exists: boolean; content: string }>
  alreadyApplied?: boolean
  appliedContent?: string
  selectedHunkIndexes?: number[]
  reason?: string
}

interface EditorContext {
  text: string
  filePath: string
  languageId: string
}

function createCancellationSignal(token: vscode.CancellationToken): {
  signal: AbortSignal
  dispose: () => void
} {
  const controller = new AbortController()
  const subscription = token.onCancellationRequested(() => controller.abort())

  if (token.isCancellationRequested) {
    controller.abort()
  }

  return {
    signal: controller.signal,
    dispose: () => subscription.dispose()
  }
}

export function truncateContext(text: string, maxTokens: number): string {
  const maxCharacters = Math.max(1000, maxTokens * 4)

  if (text.length <= maxCharacters) {
    return text
  }

  return `${text.slice(0, maxCharacters)}\n\n[Context truncated by Ghost]`
}

function getActiveEditorContext(maxContextTokens: number, includeSelection: boolean): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor

  if (!editor) {
    return undefined
  }

  const document = editor.document
  const selectedText = includeSelection ? document.getText(editor.selection) : ''
  const text = selectedText || document.getText()

  return {
    text: truncateContext(text, maxContextTokens),
    filePath: document.uri.fsPath,
    languageId: document.languageId
  }
}

function getWorkspaceContext(includeOpenFiles: boolean, includeFolders: boolean, selectedWorkspaceRoot?: string): string {
  const workspaceName = vscode.workspace.name ?? 'untitled workspace'
  const workspaceFolders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? []
  const selectedRoot = selectedWorkspaceRoot && workspaceFolders.includes(selectedWorkspaceRoot)
    ? selectedWorkspaceRoot
    : undefined
  const openTabs = includeOpenFiles
    ? vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => tab.label))
    : []
  const terminals = vscode.window.terminals.map(terminal => terminal.name)

  return [
    `Workspace: ${workspaceName}`,
    `Workspace folders: ${includeFolders && workspaceFolders.length > 0 ? workspaceFolders.join(', ') : 'none'}`,
    `Selected workspace root: ${selectedRoot ?? 'all roots'}`,
    `Open tabs: ${openTabs.length > 0 ? openTabs.join(', ') : 'none'}`,
    `Open terminals: ${terminals.length > 0 ? terminals.join(', ') : 'none'}`,
    'Terminal output: unavailable unless captured by an extension-owned terminal.'
  ].join('\n')
}

function getWorkspaceQuery(prompt: string): string[] {
  const match = /@workspace\b([^\n]*)/i.exec(prompt)

  if (!match?.[1]) {
    return []
  }

  return match[1]
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9._/-]{1,}/g)
    ?.slice(0, 5) ?? []
}

function escapeGlobToken(token: string): string {
  return token.replace(/[\\*?[\]{}]/g, '\\$&')
}

function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0)
}

function decodeText(bytes: Uint8Array): string | undefined {
  if (isBinary(bytes)) {
    return undefined
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

function getReferenceUri(value: unknown): { uri: vscode.Uri; range?: vscode.Range } | undefined {
  if (value instanceof vscode.Uri) {
    return { uri: value }
  }

  if (value && typeof value === 'object' && 'uri' in value) {
    const location = value as vscode.Location
    return { uri: location.uri, range: location.range }
  }

  if (typeof value === 'string' && value.startsWith('file://')) {
    return { uri: vscode.Uri.parse(value) }
  }

  return undefined
}

async function readTextFile(uri: vscode.Uri, range?: vscode.Range): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri)
    const text = decodeText(bytes)

    if (text === undefined) {
      return undefined
    }

    if (!range) {
      return text
    }

    return text
      .split(/\r?\n/)
      .slice(range.start.line, range.end.line + 1)
      .join('\n')
  } catch {
    return undefined
  }
}

function getDiagnosticsContext(maxContextTokens: number): string {
  const activeUri = vscode.window.activeTextEditor?.document.uri.toString()
  const diagnostics = vscode.languages.getDiagnostics()
    .flatMap(([uri, entries]) => entries
      .filter(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error || diagnostic.severity === vscode.DiagnosticSeverity.Warning)
      .map(diagnostic => ({
        uri,
        diagnostic,
        active: uri.toString() === activeUri
      })))
    .sort((left, right) => Number(right.active) - Number(left.active) || left.uri.fsPath.localeCompare(right.uri.fsPath))
    .slice(0, 40)

  if (diagnostics.length === 0) {
    return ''
  }

  const lines = diagnostics.map(({ uri, diagnostic }) => {
    const severity = diagnostic.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning'
    const line = diagnostic.range.start.line + 1
    return severity + ' ' + uri.fsPath + ':' + line + ': ' + diagnostic.message
  })
  return redactSensitiveText(truncateContext('Diagnostics:\n' + lines.join('\n'), maxContextTokens))
}

function getChangedFilesContext(maxContextTokens: number): string {
  const activeUri = vscode.window.activeTextEditor?.document.uri.toString()
  const documents = vscode.workspace.textDocuments
    .filter(document => document.isDirty && document.uri.toString() !== activeUri)
    .slice(0, 8)
  if (documents.length === 0) {
    return ''
  }

  const perFileTokens = Math.max(256, Math.floor(maxContextTokens / documents.length))
  const sections = documents.map(document => (
    'File: ' + document.uri.fsPath + '\n\n' + truncateContext(document.getText(), perFileTokens)
  ))
  return redactSensitiveText('Changed files:\n\n' + sections.join('\n\n'))
}

function getPromptPathMentions(prompt: string): string[] {
  const mentions = new Set<string>()
  const pattern = /(?:^|[\s("' ])([A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)+|[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+)(?=$|[\s"'),;:])/g
  for (const match of prompt.matchAll(pattern)) {
    const value = match[1].replace(/\\/g, '/')
    if (!value.startsWith('.') && !value.startsWith('http')) {
      mentions.add(value)
    }
  }
  return [...mentions].slice(0, 8)
}

async function getMentionedFileContext(
  prompt: string,
  maxContextTokens: number,
  token: vscode.CancellationToken,
  excludedPaths: Set<string> = new Set()
): Promise<string> {
  const mentions = getPromptPathMentions(prompt)
  if (mentions.length === 0) {
    return ''
  }

  const files = new Map<string, vscode.Uri>()
  for (const mention of mentions) {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (token.isCancellationRequested) {
        return ''
      }
      const pattern = new vscode.RelativePattern(folder, escapeGlobToken(mention))
      const matches = await vscode.workspace.findFiles(pattern, '**/{node_modules,.git,out,dist}/**', 3, token)
      for (const match of matches) {
        if (!excludedPaths.has(match.fsPath)) {
          files.set(match.toString(), match)
        }
      }
    }
  }

  const selected = [...files.values()].slice(0, 8)
  if (selected.length === 0) {
    return ''
  }
  const perFileTokens = Math.max(256, Math.floor(maxContextTokens / selected.length))
  const sections: string[] = []
  for (const file of selected) {
    const text = await readTextFile(file)
    if (text !== undefined) {
      sections.push('File: ' + file.fsPath + '\n\n' + truncateContext(text, perFileTokens))
    }
  }
  return sections.length > 0
    ? redactSensitiveText('User-mentioned files:\n\n' + sections.join('\n\n'))
    : ''
}

async function findWorkspaceFiles(query: string, token: vscode.CancellationToken): Promise<vscode.Uri[]> {
  const folders = vscode.workspace.workspaceFolders ?? []
  const tokens = getWorkspaceQuery(query)
  const matches = new Map<string, vscode.Uri>()

  for (const folder of folders) {
    for (const searchToken of tokens) {
      if (token.isCancellationRequested) {
        return []
      }

      const pattern = new vscode.RelativePattern(folder, `**/*${escapeGlobToken(searchToken)}*`)
      const uris = await vscode.workspace.findFiles(pattern, '**/{node_modules,.git,out,dist}/**', 8)

      for (const uri of uris) {
        matches.set(uri.toString(), uri)
      }
    }
  }

  return [...matches.values()].slice(0, 12)
}

async function getWorkspaceSearchContext(
  prompt: string,
  maxContextTokens: number,
  token: vscode.CancellationToken
): Promise<string> {
  const query = getWorkspaceQuery(prompt)

  if (query.length === 0) {
    return ''
  }

  const files = await findWorkspaceFiles(prompt, token)
  const maxFileCharacters = Math.max(1000, Math.floor((maxContextTokens * 4) / Math.max(files.length, 1)))
  const sections: string[] = []

  for (const file of files) {
    const text = await readTextFile(file)

    if (text === undefined) {
      continue
    }

    sections.push(`File: ${file.fsPath}\n\n${truncateContext(text, Math.floor(maxFileCharacters / 4))}`)
  }

  return sections.length > 0
    ? `@workspace matches for ${query.join(', ')}:\n\n${sections.join('\n\n')}`
    : `@workspace found no readable files matching: ${query.join(', ')}`
}

async function getReferenceContext(
  request: vscode.ChatRequest,
  maxContextTokens: number,
  token: vscode.CancellationToken
): Promise<string> {
  if (request.references.length === 0) {
    return ''
  }

  const maxFileCharacters = Math.max(1000, Math.floor((maxContextTokens * 4) / request.references.length))
  const sections: string[] = []

  for (const reference of request.references) {
    if (token.isCancellationRequested) {
      return ''
    }

    const location = getReferenceUri(reference.value)

    if (location) {
      const text = await readTextFile(location.uri, location.range)

      if (text !== undefined) {
        sections.push(`Attached file: ${location.uri.fsPath}\n\n${truncateContext(text, Math.floor(maxFileCharacters / 4))}`)
        continue
      }
    }

    const label = typeof reference.value === 'string'
      ? reference.value
      : reference.modelDescription ?? reference.id
    sections.push(`Chat reference: ${label}`)
  }

  return redactSensitiveText(sections.join('\n\n'))
}

async function buildContextPrompt(
  request: vscode.ChatRequest,
  settings: ReturnType<GhostConfig['getSettings']>,
  token: vscode.CancellationToken,
  options: GhostRequestOptions = {},
  onProgress?: (detail: string) => void
): Promise<string> {
  const context = options.context ?? {}
  onProgress?.('Context: collecting prompt context')
  const editor = context.activeFile === false
    ? undefined
    : getActiveEditorContext(settings.maxContextTokens, context.selection !== false)
  if (editor) {
    onProgress?.('Context: reading active file')
  }
  const sections = [`User request:\n${request.prompt.trim()}`]

  if (editor) {
    const selectedLabel = vscode.window.activeTextEditor?.selection.isEmpty ? 'File content' : 'Selected text'
    sections.push(
      `Active file: ${editor.filePath}\nLanguage: ${editor.languageId}\n${selectedLabel}:\n\n\`\`\`${editor.languageId}\n${editor.text}\n\`\`\``
    )
  }

  onProgress?.('Context: preparing diagnostics and changed files')
  const diagnostics = getDiagnosticsContext(settings.maxContextTokens)
  if (diagnostics) {
    sections.push(diagnostics)
  }
  const changedFiles = getChangedFilesContext(settings.maxContextTokens)
  if (changedFiles) {
    sections.push(changedFiles)
  }

  onProgress?.('Context: preparing attachments')
  const references = await getReferenceContext(request, settings.maxContextTokens, token)
  if (references) {
    sections.push(references)
  }

  if (context.workspace !== false) {
    onProgress?.('Context: preparing workspace context')
    const mentionedFiles = await getMentionedFileContext(
      request.prompt,
      settings.maxContextTokens,
      token,
      editor ? new Set([editor.filePath]) : new Set()
    )
    if (mentionedFiles) {
      sections.push(mentionedFiles)
    }
    sections.push(getWorkspaceContext(context.openFiles !== false, context.folders !== false, options.workspaceRoot))
  }

  let workspaceSearch = ''
  if (context.workspace !== false) {
    onProgress?.('Context: searching workspace')
    workspaceSearch = await getWorkspaceSearchContext(request.prompt, settings.maxContextTokens, token)
  }

  if (workspaceSearch) {
    sections.push(workspaceSearch)
  }

  if (options.mode) {
    sections.unshift(`Workflow mode: ${options.mode}`)
  }

  if (options.additionalContext?.trim()) {
    sections.push(`Additional prompt context:\n${options.additionalContext.trim()}`)
  }

  return sections.join('\n\n')
}

function getRequestOptions(request: vscode.ChatRequest): GhostRequestOptions {
  const value = (request as vscode.ChatRequest & { ghost?: GhostRequestOptions }).ghost
  return value ?? {}
}

function createDefaultLlmFactory(configuration: GhostConfig, providerApiKey?: (provider: GhostProvider) => string | undefined): LlmFactory {
  const settings = configuration.getSettings()

  return new LlmFactory(
    {
      ollamaClient: new OllamaClient(settings.ollamaUrl, 'ollama', undefined, () => providerApiKey?.('ollama')),
      mlxClient: new MlxClient(settings.mlxUrl, undefined, () => providerApiKey?.('mlx-vlm')),
      openaiCompatibleClient: createProfiledProviderClient(
        settings,
        () => providerApiKey?.('openai-compatible')
      ),
      openCodeClient: new OpenCodeClient(settings.openCodeUrl, {
        username: settings.openCodeUsername,
        password: () => providerApiKey?.('opencode')
      })
    },
    {
      configuration: vscode.workspace.getConfiguration('ghost')
    }
  )
}

function openCodeWorkspaceDirectory(requestedRoot?: string): string | undefined {
  const folders = vscode.workspace.workspaceFolders?.map(folder => path.resolve(folder.uri.fsPath)) ?? []
  if (requestedRoot) {
    const resolved = path.resolve(requestedRoot)
    if (folders.includes(resolved)) return resolved
  }
  const activeFolder = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    : undefined
  return activeFolder?.uri.fsPath ?? folders[0]
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function openCodePermissionTool(permission: OpenCodePermissionRequest): string {
  const type = `${permission.type} ${permission.title}`.toLowerCase()
  if (/\b(?:edit|write|patch|replace)\b/.test(type)) return 'ghost_apply_edit'
  if (/\b(?:bash|shell|terminal|command)\b/.test(type)) return 'ghost_run_terminal_command'
  if (/\b(?:grep|search)\b/.test(type)) return 'ghost_search_workspace'
  if (/\b(?:glob|list)\b/.test(type)) return 'ghost_list_directory'
  if (/\bread\b/.test(type)) return 'ghost_read_file'
  if (/\bgit\b/.test(type)) return 'ghost_git_context'
  return `opencode:${permission.type}`
}

function permissionMetadataPath(permission: OpenCodePermissionRequest): string | undefined {
  for (const key of ['path', 'file', 'filename', 'filepath', 'filePath', 'directory', 'cwd', 'workdir', 'workingDirectory']) {
    const value = permission.metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

async function approveOpenCodePermission(
  permission: OpenCodePermissionRequest,
  settings: ReturnType<GhostConfig['getSettings']>,
  directory: string,
  requestApprovals: Set<string>,
  mode: GhostRequestOptions['mode']
): Promise<'once' | 'reject'> {
  const toolName = openCodePermissionTool(permission)
  const denylist = settings.toolDenylist ?? []
  const allowlist = settings.toolAllowlist ?? []
  const asklist = settings.toolAsklist ?? []
  if (denylist.includes(toolName)) return 'reject'

  const permissionPatterns = Array.isArray(permission.pattern) ? permission.pattern : permission.pattern ? [permission.pattern] : []
  const candidatePaths = [permissionMetadataPath(permission)]
  if (isFileEditTool(toolName)) candidatePaths.push(...permissionPatterns)
  for (const candidatePath of candidatePaths) {
    if (!candidatePath) continue
    const resolved = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(directory, candidatePath)
    if (!isInsideDirectory(resolved, directory)) return 'reject'
  }
  if (/external[_ -]?directory/i.test(permission.type)) return 'reject'
  if (mode !== 'edit' && mode !== 'agent' && (isFileEditTool(toolName) || toolName === 'ghost_run_terminal_command')) return 'reject'
  if (toolName === 'ghost_run_terminal_command') {
    const metadataCommand = typeof permission.metadata.command === 'string'
      ? permission.metadata.command
      : typeof permission.metadata.cmd === 'string'
        ? permission.metadata.cmd
        : undefined
    const commands = [metadataCommand, ...permissionPatterns].filter((command): command is string => Boolean(command))
    if (commands.some(command => auditTerminalCommand(command).blocked)) return 'reject'
  }
  if (requestApprovals.has(toolName)) return 'once'

  const asksByPolicy = !allowlist.includes(toolName) || asklist.includes(toolName)
  const fileEdit = isFileEditTool(toolName)
  const autoAcceptedEdit = fileEdit
    && !asksByPolicy
    && (settings.autoAcceptScope === 'request' || settings.autoAcceptScope === 'workspace' || settings.autoAcceptScope === 'always')
  if ((!requiresToolApproval(toolName) && !asksByPolicy) || autoAcceptedEdit) return 'once'

  const metadata = redactSensitiveText(JSON.stringify(permission.metadata, null, 2)).slice(0, 2000)
  const selection = await vscode.window.showWarningMessage(
    permission.title,
    {
      modal: true,
      detail: `${permission.type}${permission.pattern ? `\nPattern: ${Array.isArray(permission.pattern) ? permission.pattern.join(', ') : permission.pattern}` : ''}${metadata && metadata !== '{}' ? `\n\n${metadata}` : ''}`
    },
    'Allow once',
    'Allow for request',
    'Reject'
  )
  if (selection === 'Allow for request') {
    requestApprovals.add(toolName)
    return 'once'
  }
  return selection === 'Allow once' ? 'once' : 'reject'
}

async function runOpenCodeRequest(
  client: OpenCodeClient,
  contextPrompt: string,
  requestOptions: GhostRequestOptions,
  settings: ReturnType<GhostConfig['getSettings']>,
  model: string,
  response: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  statusBar: GhostStatusBar | undefined,
  storage: GhostStorage | undefined
): Promise<void> {
  const directory = openCodeWorkspaceDirectory(requestOptions.workspaceRoot)
  if (!directory) {
    const message = 'OpenCode needs an open workspace folder.'
    requestOptions.onStop?.('invalid-model-response', message)
    response.markdown(message)
    return
  }
  const key = openCodeSessionStorageKey(directory)
  const sessionId = settings.openCodeSessionReuse === 'workspace' ? storage?.get<string>(key) : undefined
  const mutatingMode = requestOptions.mode === 'edit' || requestOptions.mode === 'agent'
  const dirtyFiles = vscode.workspace.textDocuments
    .filter(document => document.isDirty && document.uri.scheme === 'file' && isInsideDirectory(document.uri.fsPath, directory))
    .map(document => vscode.workspace.asRelativePath(document.uri, false))
  if (dirtyFiles.length > 0 && mutatingMode) {
    const message = `Save or revert dirty editor files before OpenCode runs: ${dirtyFiles.join(', ')}`
    requestOptions.onStop?.('approval-rejected', message)
    response.markdown(message)
    return
  }
  const cancellation = createCancellationSignal(token)
  const requestApprovals = new Set<string>()
  let finalStatus: 'ready' | 'offline' = 'ready'
  statusBar?.setStatus('generating')
  try {
    const system = [
      `You are OpenCode running behind the Ghost VS Code extension. Work only inside ${directory}.`,
      requestOptions.customSystemInstructions?.trim() ?? '',
      'Never access paths outside this workspace. Do not weaken or bypass permission rules.',
      mutatingMode
        ? 'Complete the requested workspace task and report the actual result.'
        : 'Answer and inspect only. Do not modify files or run shell commands.'
    ].filter(Boolean).join('\n')
    const result = await client.run({
      prompt: redactSensitiveText(contextPrompt),
      directory,
      sessionId,
      title: `Ghost · ${vscode.workspace.name ?? path.basename(directory)}`,
      model,
      agent: settings.openCodeAgent,
      system: redactSensitiveText(system),
      timeoutMs: Math.max(1, Math.floor(settings.providerRequestTimeoutMinutes)) * 60 * 1000,
      signal: cancellation.signal,
      onText: delta => response.markdown(redactSensitiveText(delta)),
      onProgress: detail => response.progress(redactSensitiveText(detail)),
      onPermission: permission => approveOpenCodePermission(permission, settings, directory, requestApprovals, requestOptions.mode)
    })
    if (settings.openCodeSessionReuse === 'workspace') await storage?.update(key, result.sessionId)
    const outsideFiles = result.changedFiles
      .map(file => path.isAbsolute(file) ? file : path.resolve(directory, file))
      .filter(file => !isInsideDirectory(file, directory))
    if (outsideFiles.length > 0) {
      const message = `OpenCode reported changes outside the workspace: ${outsideFiles.join(', ')}`
      requestOptions.onStop?.('failed-tool', message)
      response.markdown(`\n\n${message}`)
      return
    }
    if (!result.text.trim()) {
      response.markdown(result.changedFiles.length > 0
        ? `OpenCode completed the request. Changed: ${result.changedFiles.join(', ')}`
        : 'OpenCode completed the request without a text response.')
    }
    if (result.changedFiles.length > 0) response.progress(`OpenCode changed ${result.changedFiles.join(', ')}`)
  } catch (error) {
    if (token.isCancellationRequested) return
    const message = redactSensitiveText(error instanceof Error ? error.message : String(error))
    requestOptions.onStop?.('provider-failure', message)
    response.markdown(`Ghost OpenCode request failed: ${message}`)
    finalStatus = isProviderConnectivityFailure(message) ? 'offline' : 'ready'
    return
  } finally {
    cancellation.dispose()
    statusBar?.setStatus(finalStatus)
  }
}

function findStreamedToolCallStart(text: string): number | undefined {
  const matches = [
    /<tool_call>/i.exec(text),
    /\{\s*["'](?:tool|tool_call|toolCall|function|name|tool_name)["']\s*:/i.exec(text)
  ].filter((match): match is RegExpExecArray => match !== null)

  return matches.length ? Math.min(...matches.map(match => match.index)) : undefined
}

async function streamModelTurn(
  llmFactory: LlmFactory,
  options: Parameters<LlmFactory['streamChatEvents']>[0],
  response: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  showReasoning = false,
  bufferForToolCall = false
): Promise<{ generated: string; streamed: boolean; streamedText?: string; modelTokens: number; splitSuggested: boolean; visibleText: boolean; toolCall?: LocalToolCall }> {
  let generated = ''
  let streamedText = ''
  let bufferedVisibleText = ''
  let modelCharacters = 0
  let visibleCharacters = 0
  let decided = false
  let bufferingToolCall = false
  const toolCallAssembler = new LocalToolCallStreamAssembler()
  let toolCallProbe = ''
  let hidingReasoning = false
  let hiddenReasoningNotified = false
  let nativeToolName = ''
  let nativeToolArguments = ''

  const nativeToolResult = (event: ChatStreamEvent): LocalToolCall | undefined => {
    if (event.type !== 'tool-call') return undefined
    if (event.name) nativeToolName = event.name
    if (event.arguments) nativeToolArguments += event.arguments
    if (!event.done || !nativeToolName) return undefined
    return parseNativeLocalToolCall(nativeToolName, nativeToolArguments)
  }

  const emitVisibleChunk = (chunk: string): void => {
    const emitMarkdown = (value: string): void => {
      if (value.trim()) {
        visibleCharacters += value.trim().length
      }
      streamedText += value
      if (bufferForToolCall) {
        bufferedVisibleText += value
      } else {
        response.markdown(value)
      }
    }
    if (showReasoning) {
      emitMarkdown(chunk)
      return
    }
    let remaining = chunk
    while (remaining) {
      if (hidingReasoning) {
        const closing = remaining.search(/<\/(?:think|analysis)>/i)
        if (closing < 0) {
          return
        }
        remaining = remaining.slice(closing).replace(/^<\/(?:think|analysis)>/i, '')
        hidingReasoning = false
        continue
      }
      const opening = remaining.search(/<(?:think|analysis)>/i)
      if (opening < 0) {
        emitMarkdown(remaining)
        return
      }
      const visible = remaining.slice(0, opening)
      if (visible) {
        emitMarkdown(visible)
      }
      if (!hiddenReasoningNotified) {
        response.progress('Safe progress: provider reasoning hidden')
        hiddenReasoningNotified = true
      }
      remaining = remaining.slice(opening).replace(/^<(?:think|analysis)>/i, '')
      hidingReasoning = true
    }
  }

  for await (const event of llmFactory.streamChatEvents(options)) {
    const nativeToolCall = nativeToolResult(event)
    if (nativeToolCall) {
      return {
        generated: JSON.stringify({ tool: nativeToolCall.name, arguments: nativeToolCall.arguments }),
        streamed: false,
        modelTokens: Math.ceil(modelCharacters / 4),
        splitSuggested: false,
        visibleText: visibleCharacters > 0,
        toolCall: nativeToolCall
      }
    }
    if (event.type !== 'text') continue
    const chunk = event.text
    modelCharacters += chunk.length
    if (token.isCancellationRequested) {
      return { generated: '', streamed: false, modelTokens: Math.ceil(modelCharacters / 4), splitSuggested: false, visibleText: visibleCharacters > 0 }
    }

    if (bufferingToolCall) {
      const update = toolCallAssembler.append(chunk)
      if (update.complete || update.overflowed || update.splitSuggested) {
        return {
          generated: toolCallAssembler.getText(),
          streamed: false,
          modelTokens: Math.ceil(modelCharacters / 4),
          splitSuggested: update.splitSuggested,
          visibleText: visibleCharacters > 0
        }
      }
      continue
    }

    if (decided && !bufferingToolCall) {
      const combined = toolCallProbe + chunk
      const toolCallStart = findStreamedToolCallStart(combined)
      if (toolCallStart === undefined) {
        emitVisibleChunk(chunk)
        toolCallProbe = combined.slice(-512)
        continue
      }

      const chunkStart = Math.max(0, toolCallStart - toolCallProbe.length)
      if (chunkStart > 0) {
        emitVisibleChunk(chunk.slice(0, chunkStart))
      }
      bufferingToolCall = true
      const update = toolCallAssembler.append(combined.slice(toolCallStart))
      if (update.complete || update.overflowed || update.splitSuggested) {
        return {
          generated: toolCallAssembler.getText(),
          streamed: false,
          modelTokens: Math.ceil(modelCharacters / 4),
          splitSuggested: update.splitSuggested,
          visibleText: visibleCharacters > 0
        }
      }
      continue
    }

    generated += chunk

    if (!decided) {
      const firstContent = generated.trimStart()
      const toolCallStart = findStreamedToolCallStart(generated)

      if (toolCallStart !== undefined) {
        decided = true
        bufferingToolCall = true
        const explanatoryPrefix = generated.slice(0, toolCallStart)
        if (explanatoryPrefix.trim()) {
          emitVisibleChunk(explanatoryPrefix)
        }
        const update = toolCallAssembler.append(generated.slice(toolCallStart))
        toolCallProbe = ''
        generated = ''
        if (update.complete || update.overflowed || update.splitSuggested) {
          return {
            generated: toolCallAssembler.getText(),
            streamed: false,
            modelTokens: Math.ceil(modelCharacters / 4),
            splitSuggested: update.splitSuggested,
            visibleText: visibleCharacters > 0
          }
        }
      } else if (firstContent.startsWith('{') || firstContent.startsWith('<tool_call>')) {
        decided = true
        bufferingToolCall = true
        const update = toolCallAssembler.append(generated)
        generated = ''
        if (update.complete || update.overflowed || update.splitSuggested) {
          return {
            generated: toolCallAssembler.getText(),
            streamed: false,
            modelTokens: Math.ceil(modelCharacters / 4),
            splitSuggested: update.splitSuggested,
            visibleText: visibleCharacters > 0
          }
        }
      } else if (firstContent) {
        decided = true
        emitVisibleChunk(generated)
        toolCallProbe = generated.slice(-512)
        generated = ''
      }
    }
  }

  const completedNativeToolCall = nativeToolName
    ? parseNativeLocalToolCall(nativeToolName, nativeToolArguments)
    : undefined
  if (bufferForToolCall && !bufferingToolCall && bufferedVisibleText) {
    response.markdown(bufferedVisibleText)
  }
  return {
    generated: completedNativeToolCall
      ? JSON.stringify({ tool: completedNativeToolCall.name, arguments: completedNativeToolCall.arguments })
      : bufferingToolCall ? toolCallAssembler.getText() : generated.trim(),
    streamed: completedNativeToolCall ? false : decided && !bufferingToolCall,
    ...(streamedText ? { streamedText } : {}),
    modelTokens: Math.ceil(modelCharacters / 4),
    splitSuggested: false,
    visibleText: visibleCharacters > 0 || generated.trim().length > 0,
    ...(completedNativeToolCall ? { toolCall: completedNativeToolCall } : {})
  }
}

export function createChatParticipantHandler(
  options: ChatParticipantOptions = {}
): vscode.ChatRequestHandler {
  const configuration = options.configuration ?? ghostConfig
  const llmFactory = options.llmFactory ?? createDefaultLlmFactory(configuration, options.providerApiKey)
  const toolExecutor = options.toolExecutor ?? new LocalToolExecutor()
  const statusBar = options.statusBar

  return async (request, _context, response, token) => {
    if (!request.prompt.trim()) {
      response.markdown('Ask me a coding question.')
      return
    }

    if (token.isCancellationRequested) {
      return
    }

    const requestStartedAt = Date.now()
    const settings = configuration.getSettings()
    const providerRequestTimeoutMinutes = Number.isFinite(settings.providerRequestTimeoutMinutes)
      ? Math.max(1, Math.floor(settings.providerRequestTimeoutMinutes))
      : 30
    const nativeRequestKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const incomingOptions = getRequestOptions(request)
    const requestOptions: GhostRequestOptions = {
      ...incomingOptions,
      approveTool: incomingOptions.approveTool ?? (
        options.approveTool
          ? call => options.approveTool!(call, nativeRequestKey)
          : undefined
      )
    }
    const conversationalPrompt = isLikelyConversationalPrompt(request.prompt)
    const pendingWorkspaceTask = hasPendingWorkspaceTask(requestOptions.additionalContext)
    const keepWorkspaceTools = pendingWorkspaceTask || requestOptions.mode === 'agent'
    const contextOptions = conversationalPrompt && !pendingWorkspaceTask
      ? {
          ...requestOptions,
          context: {
            workspace: false,
            folders: false,
            activeFile: false,
            selection: false,
            openFiles: false,
            tools: keepWorkspaceTools
          }
        }
      : requestOptions
    const modelRole = requestOptions.modelRole ?? (requestOptions.mode === 'agent' ? 'agent' : 'chat')
    const modelSettings = resolveModelSettings(settings, modelRole, requestOptions.modelProfile, {
      provider: requestOptions.provider,
      model: requestOptions.model,
      temperature: requestOptions.temperature,
      topP: requestOptions.topP,
      topK: requestOptions.topK,
      minP: requestOptions.minP,
      presencePenalty: requestOptions.presencePenalty,
      repeatPenalty: requestOptions.repeatPenalty,
      seed: requestOptions.seed,
      stopSequences: requestOptions.stopSequences,
      contextWindow: requestOptions.contextWindow,
      grammar: requestOptions.grammar,
      maxContextTokens: requestOptions.maxContextTokens,
      maxTokens: requestOptions.maxTokens
    })
    const effectiveSettings = {
      ...settings,
      maxContextTokens: modelSettings.maxContextTokens
    }
    const images = requestOptions.images ?? []
    const resolved = await llmFactory.resolve(modelSettings.provider)
    if (images.length > 0) {
      const capability = resolved.adapter.capabilities(modelSettings.model)
      if (!capability.supportsVision) {
        const message = `The selected ${modelSettings.provider} model does not support image input. Remove the image attachment or choose a vision-capable model.`
        requestOptions.onStop?.('invalid-model-response', message)
        response.markdown(message)
        return
      }
    }
    const effectiveContextOptions = modelSettings.provider === 'opencode'
      ? {
          ...contextOptions,
          context: {
            ...contextOptions.context,
            workspace: false,
            folders: false,
            openFiles: false,
            tools: false
          }
        }
      : contextOptions
    const contextPrompt = await buildContextPrompt(request, effectiveSettings, token, effectiveContextOptions, detail => response.progress(detail))

    if (token.isCancellationRequested) {
      return
    }

    if (modelSettings.provider === 'opencode') {
      if (!(resolved.client instanceof OpenCodeClient)) {
        const message = 'Ghost could not initialize the OpenCode client.'
        requestOptions.onStop?.('provider-failure', message)
        response.markdown(message)
        return
      }
      await runOpenCodeRequest(
        resolved.client,
        contextPrompt,
        requestOptions,
        settings,
        modelSettings.model,
        response,
        token,
        statusBar,
        options.openCodeSessionStorage
      )
      return
    }

    const toolsEnabled = requestOptions.context?.tools !== false
    const requestToolsEnabled = toolsEnabled && (!conversationalPrompt || keepWorkspaceTools)
    const ollamaReportsTools = modelSettings.provider === 'ollama' && typeof resolved.client.modelSupportsTools === 'function'
      ? await resolved.client.modelSupportsTools(modelSettings.model)
      : false
    const nativeToolCalling = shouldUseNativeToolCalling({
      toolsEnabled: requestToolsEnabled,
      provider: modelSettings.provider,
      openaiProtocol: profileProtocol(settings.openaiProfile),
      ollamaReportsTools
    })
    const workspaceChangeRequested = describesWorkspaceChange(request.prompt) || pendingWorkspaceTask
    const completionRecordEnabled = workspaceChangeRequested
    if (!toolsEnabled && workspaceChangeRequested) {
      response.markdown('I cannot edit workspace files because Available tools are disabled. Enable Available tools in the Context panel, then retry.')
      return
    }
    const workflowInstruction = requestOptions.mode === 'agent'
      ? '\n\nAgent mode is active. When the user asks you to implement, fix, edit, or change code, do the work in the workspace. Inspect files with tools, use ghost_apply_edit or ghost_write_file to make changes, and use ghost_run_terminal_command only for requested or useful verification. Never use the terminal to create or edit files. Do not only describe a hypothetical solution. Start with a tool call when a workspace change is needed, then continue until the task is complete.'
      : requestOptions.mode === 'edit'
        ? '\n\nEdit mode is active. When the user asks for a code change, inspect the relevant files and propose the actual workspace edit with ghost_apply_edit or ghost_write_file. Do not only describe what could be changed.'
        : workspaceChangeRequested
          ? '\n\nThe user directly requested a workspace change. Use tools to inspect and edit the real files. Do not answer with a plan. Start with ghost_read_file, then use ghost_apply_edit or ghost_write_file.'
          : ''
    const baseSystemPrompt = buildAgentSystemPrompt({
      toolsEnabled: requestToolsEnabled,
      nativeTools: nativeToolCalling,
      completionRecordEnabled,
      workflowInstruction
    })
    const systemPrompt = requestOptions.customSystemInstructions?.trim()
      ? `${baseSystemPrompt}\n\nUser-provided system instructions:\n${requestOptions.customSystemInstructions.trim().slice(0, 8000)}`
      : baseSystemPrompt
    const userMessage = images.length > 0
      ? await createVisionMessage(contextPrompt, images)
      : { role: 'user' as const, content: contextPrompt }
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      userMessage
    ]
    const outputTokens = outputTokenBudget(modelSettings.maxTokens, requestToolsEnabled, effectiveSettings.maxContextTokens)
    const contextBudget = new ContextBudgetManager(effectiveSettings.maxContextTokens, outputTokens, requestToolsEnabled)
    let contextCompactionReported = false
    const cancellation = createCancellationSignal(token)
    let finalStatus: 'ready' | 'offline' = 'ready'
    statusBar?.setStatus('generating')

    try {
      response.progress('Preparing model request')
      let toolCallCount = 0
      let missingToolRetries = 0
      let invalidToolRetries = 0
      const pathRecoveryRetries = new Map<string, number>()
      let emptyResponseRetries = 0
      let staleEditRetries = 0
      const staleEditRecoveryPaths = new Set<string>()
      let successfulWorkspaceChange = false
      let taskPlanRequiresExecution = false
      let unfinishedPlanAfterChangeCount = 0
      let emptyProviderRetries = 0
      let splitEditRetries = 0
      const fileEditStates = new Map<string, FileEditState>()
      const completedReadCalls = new Map<string, string>()
      const budget: RequestBudget = {
        startedAt: requestStartedAt,
        timeMs: Math.max(1, Math.floor(settings.requestTimeLimitMinutes)) * 60 * 1000,
        files: new Set<string>(),
        changedLines: 0,
        changedBytes: 0,
        commands: 0,
        modelTokens: 0
      }
      while (true) {
        const beforeModelBudget = getBudgetStopReason(budget)
        if (beforeModelBudget) {
          if (await continueAfterBudget(budget, beforeModelBudget, response, requestOptions)) {
            continue
          }
          return
        }
        const preparedContext = contextBudget.prepare(messages)
        if (preparedContext.compacted && !contextCompactionReported) {
          contextCompactionReported = true
          response.progress(`Context compacted to ${preparedContext.inputTokens} tokens; omitted about ${preparedContext.omittedTokens} tokens to keep the request within budget. Current request, files, diffs, and errors kept.`)
        }
        const turn = await streamModelTurn(
          llmFactory,
          {
            provider: modelSettings.provider,
            model: modelSettings.model,
            messages: redactSensitiveValue(preparedContext.messages),
            timeoutMs: providerRequestTimeoutMinutes * 60 * 1000,
            generation: {
              temperature: Math.min(2, Math.max(0, modelSettings.temperature ?? DEFAULT_TEMPERATURE)),
              topP: Math.min(1, Math.max(0, modelSettings.topP)),
              topK: Math.max(0, Math.floor(modelSettings.topK)),
              minP: Math.min(1, Math.max(0, modelSettings.minP)),
              presencePenalty: Math.min(2, Math.max(-2, modelSettings.presencePenalty)),
              repeatPenalty: Math.min(3, Math.max(0, modelSettings.repeatPenalty)),
              ...(modelSettings.seed === undefined ? {} : { seed: modelSettings.seed }),
              ...(modelSettings.stopSequences.length ? { stop: modelSettings.stopSequences } : {}),
              ...(modelSettings.contextWindow === undefined ? {} : { contextWindow: modelSettings.contextWindow }),
              ...(modelSettings.grammar ? { grammar: modelSettings.grammar } : {}),
              maxTokens: outputTokens
            },
            ...(requestToolsEnabled && nativeToolCalling
              ? {
                  tools: completionRecordEnabled
                    ? GHOST_NATIVE_TOOL_DEFINITIONS
                    : GHOST_NATIVE_TOOL_DEFINITIONS.filter(tool => tool.function.name !== 'ghost_record_completion'),
                  toolChoice: 'auto' as const
                }
              : {}),
            ...(requestOptions.responseFormat
              ? { responseFormat: requestOptions.responseFormat }
              : (requestOptions.jsonMode ?? settings.jsonMode) && !nativeToolCalling
                ? { responseFormat: JSON_OBJECT_RESPONSE_FORMAT }
                : {}),
            signal: cancellation.signal
          },
          response,
          token,
          requestOptions.showReasoning === true,
          requestToolsEnabled
        )

        budget.modelTokens += turn.modelTokens
        const afterModelBudget = getBudgetStopReason(budget)
        if (afterModelBudget) {
          if (await continueAfterBudget(budget, afterModelBudget, response, requestOptions)) {
            continue
          }
          return
        }

        const generated = turn.generated || (turn.streamed ? turn.streamedText ?? '' : '')
        if (token.isCancellationRequested) {
          return
        }
        if (turn.streamed && !taskPlanRequiresExecution && !turn.toolCall) {
          const streamedParse = classifyLocalToolResponse(generated)
          const finalNonToolAnswer = !streamedParse.call
            && streamedParse.state !== 'malformed-json'
            && streamedParse.state !== 'truncated-json'
            && streamedParse.state !== 'unknown-tool'
          if (finalNonToolAnswer && (successfulWorkspaceChange || !workspaceChangeRequested)) {
            return
          }
        }

        if (turn.splitSuggested) {
          if (splitEditRetries < GHOST_RETRY_POLICIES.splitEdit.maxRetries) {
            splitEditRetries += 1
            response.progress('Tool call approached the safe output limit. Asking Ghost to split the edit into smaller pieces.')
            messages.push(
              { role: 'assistant', content: generated },
              {
                role: 'user',
                content: 'Your previous tool call was too large and was stopped before execution. Do not repeat the large JSON or emit partial JSON. Split the work into safe pieces: use one ghost_apply_edit call with a few focused hunks for one file, or handle one file at a time. Read the current file first, preserve existing changes, and emit exactly one complete valid JSON tool call now.'
              }
            )
            continue
          }
          const message = 'Ghost stopped because the edit tool call was too large. Retry with smaller hunks or one file at a time.'
          requestOptions.onStop?.('invalid-model-response', message)
          response.markdown(message)
          return
        }

        if (!generated) {
          if (emptyProviderRetries < GHOST_RETRY_POLICIES.emptyProvider.maxRetries) {
            emptyProviderRetries += 1
            response.progress(`Provider returned no content. Retrying (${emptyProviderRetries}/${GHOST_RETRY_POLICIES.emptyProvider.maxRetries})...`)
            messages.push(
              { role: 'assistant', content: '[empty provider response]' },
              { role: 'user', content: 'The previous response was empty. Continue the requested task now. If a workspace file is involved, inspect it with ghost_read_file and then use the correct workspace tool. Emit exactly one complete valid JSON tool call, or give a concise answer if no tool is needed.' }
            )
            continue
          }
          const message = `The provider returned no content after ${GHOST_RETRY_POLICIES.emptyProvider.maxRetries} retries. Check the model response or connection, then retry.`
          requestOptions.onStop?.('invalid-model-response', message)
          response.progress('Provider returned an empty response')
          response.markdown(message)
          return
        }

        const parsedResponse = classifyLocalToolResponse(generated)
        const toolCall = turn.toolCall ?? parsedResponse.call

        if (!toolCall) {
          if (!turn.visibleText && !workspaceChangeRequested && emptyResponseRetries < 1) {
            emptyResponseRetries += 1
            response.progress('The model returned no visible text. Asking for a plain answer.')
            messages.push(
              { role: 'assistant', content: generated },
              { role: 'user', content: 'Your previous turn returned no visible text. Reply with a concise plain-text answer to the user. Do not call a tool because this request does not require workspace work.' }
            )
            continue
          }
          if (!turn.visibleText) {
            response.markdown('The model returned no visible text. Retry the request.')
            return
          }
          const malformedToolCall = parsedResponse.state === 'malformed-json' || parsedResponse.state === 'truncated-json' || parsedResponse.state === 'unknown-tool'
          const expectsWorkspaceTool = requestToolsEnabled && (malformedToolCall || taskPlanRequiresExecution || (!successfulWorkspaceChange && (workspaceChangeRequested || describesWorkspaceChange(generated))))
          if (expectsWorkspaceTool && missingToolRetries < GHOST_RETRY_POLICIES.missingTool.maxRetries) {
            missingToolRetries += 1
            const retryMessage = parsedResponse.state === 'unknown-tool'
              ? 'The model named an unknown tool. Asking it to use an available tool.'
              : parsedResponse.state === 'truncated-json'
                ? 'The model returned truncated tool JSON. Asking it to emit a complete call.'
                : parsedResponse.state === 'malformed-json'
                  ? 'The model returned malformed tool JSON. Asking it to emit valid JSON.'
                  : 'The model described a workspace change without calling a tool. Asking it to perform the change.'
            response.progress(retryMessage)
            messages.push(
              { role: 'assistant', content: generated },
              { role: 'user', content: parsedResponse.state === 'unknown-tool'
                ? `Your previous response used an unknown tool name. Use one of the available Ghost tools. ${JSON_TOOL_PARSE_FAILURE_REMINDER}`
                : parsedResponse.state === 'truncated-json'
                  ? `Your previous tool call was truncated. Do not repeat a large replacement. ${JSON_TOOL_PARSE_FAILURE_REMINDER}`
                  : parsedResponse.state === 'malformed-json'
                    ? `Your previous tool call was malformed JSON. ${JSON_TOOL_PARSE_FAILURE_REMINDER}`
                    : 'You described a workspace change but did not call a tool. Do not explain the plan. Inspect the target with ghost_read_file, then make the change with ghost_apply_edit or ghost_write_file. Emit exactly one valid JSON tool call now.' }
            )
            continue
          }
          if (expectsWorkspaceTool) {
            const message = noToolRecoveryMessage(parsedResponse.state, missingToolRetries)
            requestOptions.onStop?.('invalid-model-response', message)
          }
          response.markdown(redactSensitiveText(generated))
          return
        }

        if (hasReachedToolCallLimit(toolCallCount)) {
          const shouldContinue = requestOptions.confirmContinue
            ? await requestOptions.confirmContinue(toolCallCount)
            : await vscode.window.showWarningMessage(
                `Ghost reached ${MAX_TOOL_ROUNDS} tool calls. Continue working?`,
                { modal: true, detail: 'Choose Continue to allow another batch of tool calls, or Stop to end this request.' },
                'Continue',
                'Stop'
              ) === 'Continue'
          if (!shouldContinue) {
            const message = 'Ghost stopped after reaching the tool-call limit.'
            requestOptions.onStop?.('budget-limit', message)
            response.markdown(message)
            return
          }
          toolCallCount = 0
        }
        toolCallCount += 1

        const beforeApprovalBudget = getBudgetStopReason(budget, toolCall)
        if (beforeApprovalBudget) {
          if (!await continueAfterBudget(budget, beforeApprovalBudget, response, requestOptions)) {
            return
          }
        }

        const toolArgumentError = getToolArgumentError(toolCall)
        if (toolArgumentError) {
          if (finishAfterSuccessfulWorkspaceChange(response, successfulWorkspaceChange, taskPlanRequiresExecution)) {
            return
          }
          invalidToolRetries += 1
          response.progress(`Invalid tool call: ${toolArgumentError}`)
          if (invalidToolRetries > GHOST_RETRY_POLICIES.invalidToolArguments.maxRetries) {
            const message = 'The model kept returning invalid tool arguments after retries.'
            requestOptions.onStop?.('invalid-model-response', message)
            response.markdown(message)
            return
          }
          messages.push(
            { role: 'assistant', content: generated },
            { role: 'user', content: `Tool result for ${toolCall.name}:\n${toolArgumentError}` }
          )
          continue
        }

        const readSignature = readToolCallSignature(toolCall)
        const cachedReadResult = readSignature ? completedReadCalls.get(readSignature) : undefined
        if (cachedReadResult !== undefined) {
          response.progress('Reusing the previous file read')
          messages.push(
            { role: 'assistant', content: generated },
            { role: 'user', content: `Tool result for ${toolCall.name}:\nThe exact file range was already read earlier in this request. Reusing the previous result. Do not request the same range again unless the file changes.\n\n${cachedReadResult}` }
          )
          continue
        }

        response.progress(`Running ${toolCall.name}`)
        const approval = requestOptions.approveTool
          ? await requestOptions.approveTool(toolCall)
          : { decision: 'once' as const }
        if (token.isCancellationRequested) {
          return
        }
        if (approval.arguments) {
          toolCall.arguments = approval.arguments
        }
        const approvedToolArgumentError = getToolArgumentError(toolCall)
        if (approvedToolArgumentError) {
          if (finishAfterSuccessfulWorkspaceChange(response, successfulWorkspaceChange, taskPlanRequiresExecution)) {
            return
          }
          invalidToolRetries += 1
          response.progress(`Invalid tool call: ${approvedToolArgumentError}`)
          if (invalidToolRetries > GHOST_RETRY_POLICIES.invalidToolArguments.maxRetries) {
            const message = 'The model kept returning invalid tool arguments after retries.'
            requestOptions.onStop?.('invalid-model-response', message)
            response.markdown(message)
            return
          }
          messages.push(
            { role: 'assistant', content: generated },
            { role: 'user', content: `Tool result for ${toolCall.name}:\n${approvedToolArgumentError}` }
          )
          continue
        }
        const editPaths = getEditPaths(toolCall)
        const editPath = editPaths.length === 1 ? editPaths[0] : undefined
        const editRecord = getEditRecord(toolCall)
        const editSignature = editRecord?.signature
        const editState = editPath
          ? fileEditStates.get(editPath) ?? { signatures: new Set<string>(), history: [] }
          : undefined
        if (editPath && editState && editSignature && editState.signatures.has(editSignature)) {
          const message = `Ghost stopped because it tried to apply the same edit to ${editPath} again. Review the file and retry with a more specific request.`
          requestOptions.onStop?.('invalid-model-response', message)
          response.markdown(message)
          return
        }
        if (editPath && editState && editRecord) {
          const loopReason = getEditLoopReason(editState, editRecord)
          if (loopReason) {
            const message = `Ghost stopped because it detected ${loopReason} on ${editPath}. Review the file and retry with a more specific request.`
            requestOptions.onStop?.('invalid-model-response', message)
            response.markdown(message)
            return
          }
        }
        if (approval.decision === 'reject') {
          const rejection = approval.reason ?? 'User rejected this tool call.'
          response.progress(`Tool result: ${toolCall.name}: ${rejection}`)
          requestOptions.onStop?.('approval-rejected', rejection)
          messages.push(
            { role: 'assistant', content: generated },
            { role: 'user', content: `Tool result for ${toolCall.name}:\n${rejection}` }
          )
          return
        }
        const afterApprovalBudget = getBudgetStopReason(budget, toolCall, approval.selectedHunkIndexes)
        if (afterApprovalBudget) {
          if (!await continueAfterBudget(budget, afterApprovalBudget, response, requestOptions)) {
            return
          }
        }
        if (toolCall.name === 'ghost_run_terminal_command') {
          budget.commands += 1
        }
        let toolOutcome: ToolResult

        try {
          toolOutcome = await toolExecutor.execute(toolCall, token, {
            approved: Boolean(requestOptions.approveTool),
            expectedContent: approval.expectedContent,
            expectedFileExists: approval.expectedFileExists,
            expectedFiles: approval.expectedFiles,
            alreadyApplied: approval.alreadyApplied,
            appliedContent: approval.appliedContent,
            selectedHunkIndexes: approval.selectedHunkIndexes
          })
        } catch (error) {
          toolOutcome = createToolErrorResult(error)
        }

        if (token.isCancellationRequested) {
          return
        }

        const limitedToolResult = limitToolResultText(toolCall.name, toolOutcome.text)
        if (limitedToolResult !== toolOutcome.text) {
          toolOutcome = replaceToolResultText(toolOutcome, limitedToolResult, { truncated: true })
        }
        const toolResult = toolOutcome.text
        const updatedTaskPlan = parseTaskPlanMarker(toolResult)
        if (updatedTaskPlan) {
          taskPlanRequiresExecution = updatedTaskPlan.steps.some(step => !step.checked)
          if (taskPlanRequiresExecution && successfulWorkspaceChange) {
            unfinishedPlanAfterChangeCount += 1
          } else if (!taskPlanRequiresExecution) {
            unfinishedPlanAfterChangeCount = 0
          }
          if (unfinishedPlanAfterChangeCount >= 2) {
            response.progress('The model repeated the same unfinished task plan without making progress.')
            response.markdown('Workspace changes are already applied. Ghost stopped the repeated task-plan loop safely.')
            return
          }
        }

        const editFailed = isFailedToolOutcome(toolOutcome.status, toolResult)
        const editNoOp = /no changes needed/i.test(toolResult)
        if (editPaths.length > 0 && isStaleEditConflict(toolResult) && staleEditRetries < GHOST_RETRY_POLICIES.staleEdit.maxRetries) {
          staleEditRetries += 1
          for (const path of editPaths) {
            staleEditRecoveryPaths.add(path)
          }
          completedReadCalls.clear()
          response.progress(`Tool result: ${toolCall.name}: ${toolResult}`)
          response.progress('Edit was stale. Asking Ghost to read the current file and create a fresh edit from its exact contents.')
          messages.push({
            role: 'assistant',
            content: generated
          }, {
            role: 'user',
            content: `Tool result for ${toolCall.name}:\n${toolResult}\nThe edit is stale. Do not repeat the previous edit JSON. First call ghost_read_file for the same path with the current file range. Then use the exact text returned by that read to create a fresh small ghost_apply_edit. Recalculate startLine, endLine, oldText, oldHash, beforeContext, and afterContext from the fresh read. Preserve the user’s existing changes.`
          })
          continue
        }

        response.progress(`Tool result: ${toolCall.name}: ${summarizeToolResult(toolResult)}`)

        const pathRecoveryKey = getPathRecoveryKey(toolCall, toolResult)
        if (pathRecoveryKey) {
          const retries = pathRecoveryRetries.get(pathRecoveryKey) ?? 0
          if (shouldRetryInspectionPath(retries, GHOST_RETRY_POLICIES.failedTool.maxRetries)) {
            pathRecoveryRetries.set(pathRecoveryKey, retries + 1)
            response.progress('The workspace path was not found. Asking Ghost to retry with a workspace-relative path.')
            messages.push(
              { role: 'assistant', content: generated },
              {
                role: 'user',
                content: `Tool result for ${toolCall.name}:\n${toolResult}\nRetry this workspace operation now with a path relative to the current workspace, such as TODO.md or src/file.ts. Do not reuse an absolute path from another workspace or invent a directory name.`
              }
            )
            continue
          }
          response.progress('The workspace path was still not found. Continuing so Ghost can list the tree or try another path.')
        }

        messages.push(
          { role: 'assistant', content: generated },
          { role: 'user', content: `Tool result for ${toolCall.name}:\n${toolResult}` }
        )

        if (shouldStopAgentForToolFailure(toolCall.name, toolOutcome.status, toolResult)) {
          requestOptions.onStop?.('failed-tool', toolResult)
          response.markdown(`Ghost stopped because a tool failed: ${summarizeToolResult(toolResult)} Review the arguments and retry.`)
          return
        }
        invalidToolRetries = 0
        if (editPath && editNoOp) {
          completedReadCalls.clear()
          successfulWorkspaceChange = true
          unfinishedPlanAfterChangeCount = 0
          if (editState && editRecord && editSignature) {
            editState.signatures.add(editSignature)
            editState.history.push(editRecord)
            fileEditStates.set(editPath, editState)
          }
          continue
        }
        if (editPath && editState && editRecord && editSignature && !editFailed) {
          editState.signatures.add(editSignature)
          editState.history.push(editRecord)
          fileEditStates.set(editPath, editState)
        }
        if (editPaths.length > 0 && !editFailed && !editNoOp) {
          completedReadCalls.clear()
          successfulWorkspaceChange = true
          unfinishedPlanAfterChangeCount = 0
          const cost = getEditCost(toolCall, approval.selectedHunkIndexes)
          if (cost) {
            for (const path of editPaths) {
              budget.files.add(path)
            }
            budget.changedLines += cost.changedLines
            budget.changedBytes += cost.changedBytes
          }
        }
        if (readSignature && !editFailed) {
          completedReadCalls.set(readSignature, toolResult)
        }
      }

    } catch (error) {
      if (!token.isCancellationRequested) {
        const message = redactSensitiveText(error instanceof Error ? error.message : 'Unknown local model error')
        const connectivityFailure = isProviderConnectivityFailure(message)
        finalStatus = connectivityFailure ? 'offline' : 'ready'
        response.markdown(connectivityFailure
          ? `Ghost could not reach the local model: ${message}`
          : `Ghost request failed: ${message}`)
      }
    } finally {
      cancellation.dispose()
      statusBar?.setStatus(finalStatus)
    }
  }
}

export function createChatParticipant(options: ChatParticipantOptions = {}): vscode.ChatParticipant {
  const participant = vscode.chat.createChatParticipant(
    CHAT_PARTICIPANT_ID,
    createChatParticipantHandler(options)
  )
  participant.iconPath = new vscode.ThemeIcon('hubot')
  return participant
}
