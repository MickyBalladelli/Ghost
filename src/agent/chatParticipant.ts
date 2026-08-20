import * as vscode from 'vscode'
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
import { auditTerminalCommand } from '../tools/terminalTools'
import { resolveWorkspacePath } from '../tools/workspacePath'
import { classifyLocalToolResponse, LocalToolCall, LocalToolCallStreamAssembler, parseNativeLocalToolCall } from './toolCallParser'
import { GHOST_NATIVE_TOOL_DEFINITIONS, JSON_OBJECT_RESPONSE_FORMAT } from './nativeTooling'
import { validateLocalToolCall } from './toolSchema'
import type { GhostStopReason } from '../ui/ghostState'
import { GHOST_RETRY_POLICIES } from './retryPolicy'
import { createProfiledProviderClient } from '../services/profiledProviderClient'
import { resolveModelSettings } from '../services/modelProfiles'
import type { GhostModelRole } from '../services/modelProfiles'
import { profileProtocol } from '../services/profiledProviderClient'
import { GHOST_POLICY } from '../ghostPolicy'
import { createToolErrorResult, replaceToolResultText, ToolResult } from '../tools/toolResult'
import { limitToolResultText } from '../tools/toolResultLimits'
import { EditRecord, FileEditState, getEditLoopReason } from './editLoopGuard'
import { hasReachedToolCallLimit, MAX_TOOL_ROUNDS, MIN_TOOL_CALL_TOKENS, outputTokenBudget } from './budgetPolicy'

const CHAT_PARTICIPANT_ID = 'ghost.agent'
const DEFAULT_TEMPERATURE = 0.3

const SYSTEM_PROMPT = [
  'You are Ghost, a private local coding assistant.',
  'Use the supplied editor and workspace context when it helps answer the user.',
  'Be concise. Put code in fenced Markdown blocks with the correct language when useful.',
  'Do not claim to have changed files or run commands unless a tool actually did it.',
  'When a tool is needed, output only one JSON object in this exact shape: {"tool":"tool_name","arguments":{...}}.',
  'Tool JSON must be valid JSON: escape every quote inside a string and encode line breaks as \\n. Never put raw multiline text inside a JSON string.',
  'When using a tool, do not explain the plan first; emit the tool call as the complete response. Keep each ghost_apply_edit hunk small: do not put an entire large component into one replacement. Include oldText, oldHash, beforeContext, or afterContext in every hunk so line numbers are checked against nearby file content. Split large work into several focused tool calls and inspect the file between them.',
  'Never use ghost_run_terminal_command to create, replace, or edit files. Do not use cat >, tee, heredocs, redirection, sed -i, or scripts that write files. If a file tool fails, inspect the tool result and retry with ghost_read_file, ghost_apply_edit, ghost_write_file, or ghost_apply_transaction.',
  'Every file or directory tool call must include a non-empty path inside the current workspace. Always use a path relative to the workspace root when possible, such as src/app.ts. Never copy an absolute path from another workspace, invent a directory, omit path, or use a path outside the workspace. Before writing or editing, read the target file first when it exists. For large files, use ghost_read_file with startLine and endLine and read every relevant chunk before editing.',
  'Available tools: ghost_read_file({"path":"src/file.ts or absolute workspace path","allowSpecialFile":false,"mode":"head|tail|lines|bytes|symbol|matches","lineCount":200,"startLine":1,"endLine":400,"startByte":0,"endByte":12000,"symbol":"Name","match":"text","caseSensitive":true,"maxMatches":100}), ghost_search_workspace({"query":"text","path":"optional relative or absolute workspace path","glob":"optional glob","maxResults":100}), ghost_write_file({"path":"src/file.ts or absolute workspace path","content":"full text"}), ghost_apply_edit({"path":"src/file.ts or absolute workspace path","hunks":[{"startLine":1,"endLine":1,"replacement":"new text","oldText":"existing text","beforeContext":"nearby line before","afterContext":"nearby line after"}]}), ghost_apply_transaction({"edits":[{"path":"src/one.ts or absolute workspace path","content":"full text"},{"path":"src/two.ts or absolute workspace path","hunks":[{"startLine":1,"endLine":1,"replacement":"new text","oldText":"existing text"}]}]}), ghost_run_terminal_command({"command":"bash or PowerShell command","cwd":"optional relative or absolute workspace path"}), ghost_list_directory({"path":"src or absolute workspace path","recursive":true,"pageSize":100,"maxDepth":3,"cursor":"0"}).',
  'Diagnostics tool: ghost_get_diagnostics({"path":"optional relative or absolute workspace file path","severity":"error|warning|information|hint","maxResults":100}) reads compiler and Problems-panel diagnostics. Omit path for the active file or workspace.',
  'Read source rule: ghost_read_file needs source:"editor" for an open unsaved buffer or source:"disk" for the saved file. If the file is dirty and source is omitted, the tool pauses and asks you to choose. Never edit a file while its editor buffer has unsaved changes; ask the user to save or discard them first.',
  'Git tool: ghost_git_context({"operation":"status|diff|stagedDiff|branch|history","path":"optional relative or absolute workspace file path","maxEntries":100}) reads non-ignored workspace Git status, selected-file diffs, branch, or selected-file history. Use a path for diff, stagedDiff, and history when no active file is selected.',
  'Task plan tool: ghost_update_task_plan({"steps":[{"id":"step-1","title":"Do the work","checked":false}],"currentStep":"step-1","blockedReason":"optional","completionEvidence":["optional"]}) persists a bounded plan in the conversation. Use it for multi-step work and update checked steps as work finishes.',
  'After a successful file edit, verify the result once if needed. If the requested change is complete, stop and provide the final answer. Do not keep rewriting the same file or undoing and reapplying changes.'
].join(' ')

const COMPLETION_RECORD_INSTRUCTION = 'Completion tool: ghost_record_completion({"changedFiles":[],"checksRun":[],"failures":[],"remainingWork":[]}) records the final structured completion record for workspace work. Call it before the final answer when you changed files, ran checks, or have remaining work. List only checks actually run and work actually changed.'

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
    const outputReserve = outputTokenBudget(requestedOutputTokens, toolsEnabled) ?? 512
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

function describesWorkspaceChange(value: string): boolean {
  return /\b(?:fix|edit|change|update|implement|create|write|remove|delete|add|replace|apply|modify|wire|refactor)\b/i.test(value)
}

function isLikelyConversationalPrompt(value: string): boolean {
  const prompt = value.trim()
  if (!prompt || prompt.length > 240 || describesWorkspaceChange(prompt)) {
    return false
  }
  return !/\b(?:file|folder|workspace|project|repository|repo|code|bug|error|test|diagnostic|terminal|command|run|inspect|read|search|find|list|tool|function|class|module|api|extension)\b/i.test(prompt)
}

function isStaleEditConflict(value: string): boolean {
  return /old text does not match|content hash does not match|preceding context does not match|following context does not match|file changed externally|edit expected different file content|refresh and rebase/i.test(value)
}

function isFileEditTool(name: LocalToolCall['name']): boolean {
  return name === 'ghost_write_file' || name === 'ghost_apply_edit' || name === 'ghost_apply_transaction'
}

function readToolCallSignature(call: LocalToolCall): string | undefined {
  if (call.name !== 'ghost_read_file' || typeof call.arguments.path !== 'string') {
    return undefined
  }

  let filePath = call.arguments.path
  try {
    filePath = resolveWorkspacePath(filePath).fsPath
  } catch {
    // Validation already reports invalid paths. Keep a fallback key for safety.
  }

  const options = Object.keys(call.arguments)
    .filter(key => key !== 'path')
    .sort()
    .map(key => [key, call.arguments[key]])

  return JSON.stringify([filePath, options])
}

function getEditPath(call: LocalToolCall): string | undefined {
  return isFileEditTool(call.name) && typeof call.arguments.path === 'string'
    ? call.arguments.path
    : undefined
}

function getEditPaths(call: LocalToolCall): string[] {
  if (call.name !== 'ghost_apply_transaction') {
    const path = getEditPath(call)
    return path ? [path] : []
  }
  try {
    return parseFileTransaction(call.arguments).edits.map(edit => edit.path)
  } catch {
    return []
  }
}

function getEditRecord(call: LocalToolCall): EditRecord | undefined {
  const path = getEditPath(call)
  if (!path) {
    return undefined
  }

  if (call.name === 'ghost_write_file') {
    const content = typeof call.arguments.content === 'string' ? call.arguments.content : ''
    return {
      signature: `${call.name}:${path}:${JSON.stringify(call.arguments)}`,
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
      signature: `${call.name}:${path}:${JSON.stringify(call.arguments)}`,
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

const PATH_RECOVERY_TOOLS = new Set([
  'ghost_read_file',
  'ghost_search_workspace',
  'ghost_get_diagnostics',
  'ghost_git_context',
  'ghost_list_directory'
])

function getPathRecoveryKey(call: LocalToolCall, result: string): string | undefined {
  if (!PATH_RECOVERY_TOOLS.has(call.name)) {
    return undefined
  }
  const pathValue = call.arguments.path
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    return undefined
  }
  if (!/enoent|not found|does not exist|inside the current workspace|not a directory|no such file|no such directory/i.test(result)) {
    return undefined
  }
  return `${call.name}:${pathValue}`
}

export interface ChatParticipantOptions {
  configuration?: GhostConfig
  llmFactory?: LlmFactory
  toolExecutor?: LocalToolExecutor
  statusBar?: GhostStatusBar
  providerApiKey?: (provider: GhostProvider) => string | undefined
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
      )
    },
    {
      configuration: vscode.workspace.getConfiguration('ghost')
    }
  )
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
    const requestOptions = getRequestOptions(request)
    const conversationalPrompt = isLikelyConversationalPrompt(request.prompt)
    const contextOptions = conversationalPrompt
      ? {
          ...requestOptions,
          context: {
            workspace: false,
            folders: false,
            activeFile: false,
            selection: false,
            openFiles: false,
            tools: false
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
    if (images.length > 0) {
      const resolved = await llmFactory.resolve(modelSettings.provider)
      const capability = resolved.adapter.capabilities(modelSettings.model)
      if (!capability.supportsVision) {
        const message = `The selected ${modelSettings.provider} model does not support image input. Remove the image attachment or choose a vision-capable model.`
        requestOptions.onStop?.('invalid-model-response', message)
        response.markdown(message)
        return
      }
    }
    const contextPrompt = await buildContextPrompt(request, effectiveSettings, token, contextOptions, detail => response.progress(detail))

    if (token.isCancellationRequested) {
      return
    }

    const toolsEnabled = requestOptions.context?.tools !== false
    const requestToolsEnabled = toolsEnabled && !conversationalPrompt
    const nativeToolCalling = requestToolsEnabled && (
      modelSettings.provider === 'ollama' ||
      (modelSettings.provider === 'openai-compatible' && profileProtocol(settings.openaiProfile) === 'openai-chat')
    )
    const workspaceChangeRequested = describesWorkspaceChange(request.prompt)
    const completionRecordEnabled = workspaceChangeRequested || requestOptions.mode === 'edit'
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
    const baseSystemPrompt = !requestToolsEnabled
      ? 'You are Ghost, a private local coding assistant. Do not use tools. Be concise and use fenced Markdown code blocks when useful.'
      : `${SYSTEM_PROMPT}${completionRecordEnabled ? ` ${COMPLETION_RECORD_INSTRUCTION}` : ''}${workflowInstruction}`
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
    const outputTokens = outputTokenBudget(modelSettings.maxTokens, requestToolsEnabled)
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

        if (token.isCancellationRequested || (turn.streamed && (successfulWorkspaceChange || !workspaceChangeRequested))) {
          return
        }

        const generated = turn.generated || (turn.streamed ? turn.streamedText ?? '' : '')

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
          const expectsWorkspaceTool = requestToolsEnabled && (malformedToolCall || (!successfulWorkspaceChange && (workspaceChangeRequested || describesWorkspaceChange(generated))))
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
                ? 'Your previous response used an unknown tool name. Use one of the available Ghost tools and emit exactly one valid JSON tool call now.'
                : parsedResponse.state === 'truncated-json'
                  ? 'Your previous tool call was truncated. Emit exactly one complete valid JSON tool call now. Do not repeat a large replacement.'
                  : parsedResponse.state === 'malformed-json'
                    ? 'Your previous tool call was malformed JSON. Emit exactly one complete valid JSON tool call now.'
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

        const editFailed = toolOutcome.status === 'failed' || toolOutcome.status === 'denied' || toolOutcome.status === 'blocked' || toolOutcome.status === 'cancelled' || /^Tool error:|^User denied|^Tool call cancelled|^File changed externally|^The accepted edit changed|^Edit expected/.test(toolResult)
        const editNoOp = /no changes needed/i.test(toolResult)
        if (editPaths.length > 0 && isStaleEditConflict(toolResult) && staleEditRetries < GHOST_RETRY_POLICIES.staleEdit.maxRetries) {
          staleEditRetries += 1
          for (const path of editPaths) {
            staleEditRecoveryPaths.add(path)
          }
          completedReadCalls.clear()
          response.progress('Edit was stale. Asking Ghost to refresh the file and rebase the change.')
          messages.push({
            role: 'assistant',
            content: generated
          }, {
            role: 'user',
            content: `Tool result for ${toolCall.name}:\n${toolResult}\nThe edit is stale. Do not retry the same hunk. Use ghost_read_file on the current file, then create a fresh small ghost_apply_edit with new oldText, oldHash, beforeContext, or afterContext. Preserve the user’s existing changes.`
          })
          continue
        }

        response.progress(`Tool result: ${toolCall.name}: ${summarizeToolResult(toolResult)}`)

        const pathRecoveryKey = getPathRecoveryKey(toolCall, toolResult)
        if (pathRecoveryKey) {
          const retries = pathRecoveryRetries.get(pathRecoveryKey) ?? 0
          if (retries < 2) {
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
        }

        messages.push(
          { role: 'assistant', content: generated },
          { role: 'user', content: `Tool result for ${toolCall.name}:\n${toolResult}` }
        )

        if (editFailed) {
          requestOptions.onStop?.('failed-tool', toolResult)
          response.markdown(`Ghost stopped because a tool failed: ${summarizeToolResult(toolResult)} Review the arguments and retry.`)
          return
        }
        if (editPath && editNoOp) {
          if (editPaths.some(path => staleEditRecoveryPaths.has(path))) {
            response.markdown(`The requested change is already present in ${editPaths.join(', ')}. Keeping the current file.`)
            return
          }
          const message = `Ghost stopped because it found no changes to apply to ${editPath}. Review the file and retry with a more specific request.`
          requestOptions.onStop?.('failed-tool', message)
          response.markdown(message)
          return
        }
        if (editPath && editState && editRecord && editSignature && !editFailed) {
          editState.signatures.add(editSignature)
          editState.history.push(editRecord)
          fileEditStates.set(editPath, editState)
        }
        if (editPaths.length > 0 && !editFailed && !editNoOp) {
          completedReadCalls.clear()
          successfulWorkspaceChange = true
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
