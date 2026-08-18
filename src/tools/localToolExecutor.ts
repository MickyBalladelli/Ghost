import * as vscode from 'vscode'

import { LocalToolCall } from '../agent/toolCallParser'
import {
  ListDirectoryInput,
  ListDirectoryTool,
  ReadFileInput,
  ReadFileTool,
  WriteFileInput,
} from './fileTools'
import { SearchWorkspaceInput, SearchWorkspaceTool } from './searchTool'
import { DiagnosticsInput, DiagnosticsTool } from './diagnosticsTool'
import { GitContextInput, GitContextTool } from './gitContextTool'
import { TaskPlanInput, TaskPlanTool } from '../agent/taskPlan'
import { CompletionRecordInput, CompletionRecordTool } from '../agent/completionRecord'
import { auditTerminalCommand, formatTerminalAudit, RunTerminalCommandInput, RunTerminalCommandTool } from './terminalTools'
import { parseGhostEdit, summarizeGhostEdit } from './editWorkflow'
import { assertExpectedWorkspaceSnapshot, assertFileMutationAllowed, applyWorkspaceFileChange, createWorkspaceEditChange, createWorkspaceFileChange, expectedWorkspaceSnapshot, readFileMutation } from './fileMutationWorkflow'
import { WorkspaceFileSnapshot } from './workspaceFile'
import { applyFileTransaction, FileTransactionInput, parseFileTransaction, summarizeFileTransaction } from './transactionWorkflow'
import { awaitCancellable } from './cancellation'
import { validateLocalToolCall } from '../agent/toolSchema'
import { createToolErrorResult, createToolResult, ToolResult } from './toolResult'

const ALLOW_ACTION = 'Allow'

function requiredString(input: Record<string, unknown>, name: string): string {
  const value = input[name]

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Tool argument '${name}' must be a non-empty string`)
  }

  return value
}

function getMissingRequiredArgument(call: LocalToolCall): string | undefined {
  const pathTools = new Set(['ghost_read_file', 'ghost_write_file', 'ghost_apply_edit', 'ghost_list_directory'])
  const requiredArgument = pathTools.has(call.name)
    ? 'path'
    : call.name === 'ghost_apply_transaction'
      ? 'edits'
    : call.name === 'ghost_search_workspace'
      ? 'query'
    : call.name === 'ghost_run_terminal_command'
      ? 'command'
      : undefined
  if (!requiredArgument) {
    return undefined
  }
  if (requiredArgument === 'edits' && Array.isArray(call.arguments.edits) && call.arguments.edits.length > 1) {
    return undefined
  }
  if (typeof call.arguments[requiredArgument] === 'string' && call.arguments[requiredArgument].trim()) {
    return undefined
  }
  return `Tool call rejected: ${call.name} requires a non-empty '${requiredArgument}'. Retry with one JSON tool call using a workspace-relative or absolute path inside the workspace.`
}

function changedFilesForCall(call: LocalToolCall): string[] {
  if (call.name === 'ghost_write_file' || call.name === 'ghost_apply_edit') {
    return typeof call.arguments.path === 'string' ? [call.arguments.path] : []
  }
  if (call.name === 'ghost_apply_transaction' && Array.isArray(call.arguments.edits)) {
    return call.arguments.edits
      .map(edit => edit && typeof edit === 'object' && typeof (edit as { path?: unknown }).path === 'string' ? (edit as { path: string }).path : undefined)
      .filter((path): path is string => Boolean(path))
  }
  return []
}

function resultText(result: vscode.LanguageModelToolResult): string {
  return result.content
    .filter(part => part instanceof vscode.LanguageModelTextPart)
    .map(part => (part as vscode.LanguageModelTextPart).value)
    .join('\n')
}

async function readCurrentFile(filePath: string, token: vscode.CancellationToken): Promise<WorkspaceFileSnapshot> {
  return (await readFileMutation(filePath, token)).snapshot
}

async function confirmAction(title: string, message: string, token: vscode.CancellationToken): Promise<boolean> {
  if (token.isCancellationRequested) return false
  const selection = await awaitCancellable(vscode.window.showWarningMessage(
    title,
    { modal: true, detail: message },
    ALLOW_ACTION
  ), token).catch(() => undefined)

  return selection === ALLOW_ACTION
}

export class LocalToolExecutor {
  private readonly readFileTool = new ReadFileTool()
  private readonly listDirectoryTool = new ListDirectoryTool()
  private readonly terminalTool = new RunTerminalCommandTool()
  private readonly searchTool = new SearchWorkspaceTool()
  private readonly diagnosticsTool = new DiagnosticsTool()
  private readonly gitContextTool = new GitContextTool()
  private readonly taskPlanTool = new TaskPlanTool()
  private readonly completionRecordTool = new CompletionRecordTool()

  async execute(call: LocalToolCall, token: vscode.CancellationToken, options: { approved?: boolean; expectedContent?: string; expectedFileExists?: boolean; expectedFiles?: Record<string, WorkspaceFileSnapshot>; alreadyApplied?: boolean; appliedContent?: string; selectedHunkIndexes?: number[] } = {}): Promise<ToolResult> {
    const changedFiles = changedFilesForCall(call)
    return awaitCancellable(this.executeInternal(call, token, options), token)
      .then(text => {
        const result = createToolResult(text, { changedFiles })
        return result.status === 'success' ? result : { ...result, changedFiles: [] }
      })
      .catch(error => token.isCancellationRequested
        ? createToolResult('Tool call cancelled by the user.', { status: 'cancelled', retryable: true })
        : createToolErrorResult(error))
  }

  private async executeInternal(call: LocalToolCall, token: vscode.CancellationToken, options: { approved?: boolean; expectedContent?: string; expectedFileExists?: boolean; expectedFiles?: Record<string, WorkspaceFileSnapshot>; alreadyApplied?: boolean; appliedContent?: string; selectedHunkIndexes?: number[] } = {}): Promise<string> {
    if (token.isCancellationRequested) {
      return 'Tool call cancelled by the user.'
    }

    const validationError = validateLocalToolCall(call)
    if (validationError) {
      return `Tool call rejected: ${validationError} Retry with one JSON tool call correcting that field.`
    }

    const missingArgument = getMissingRequiredArgument(call)
    if (missingArgument) {
      return missingArgument
    }

    switch (call.name) {
      case 'ghost_read_file': {
        const input: ReadFileInput = {
          path: requiredString(call.arguments, 'path'),
          ...(typeof call.arguments.source === 'string' ? { source: call.arguments.source as ReadFileInput['source'] } : {}),
          ...(call.arguments.allowSpecialFile === true ? { allowSpecialFile: true } : {}),
          ...(typeof call.arguments.mode === 'string' ? { mode: call.arguments.mode as ReadFileInput['mode'] } : {}),
          ...(typeof call.arguments.startLine === 'number' ? { startLine: call.arguments.startLine } : {}),
          ...(typeof call.arguments.endLine === 'number' ? { endLine: call.arguments.endLine } : {}),
          ...(typeof call.arguments.lineCount === 'number' ? { lineCount: call.arguments.lineCount } : {}),
          ...(typeof call.arguments.startByte === 'number' ? { startByte: call.arguments.startByte } : {}),
          ...(typeof call.arguments.endByte === 'number' ? { endByte: call.arguments.endByte } : {}),
          ...(typeof call.arguments.symbol === 'string' ? { symbol: call.arguments.symbol } : {}),
          ...(typeof call.arguments.match === 'string' ? { match: call.arguments.match } : {}),
          ...(typeof call.arguments.caseSensitive === 'boolean' ? { caseSensitive: call.arguments.caseSensitive } : {}),
          ...(typeof call.arguments.maxMatches === 'number' ? { maxMatches: call.arguments.maxMatches } : {})
        }
        return resultText(await this.readFileTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
      case 'ghost_list_directory': {
        const input: ListDirectoryInput = {
          path: requiredString(call.arguments, 'path'),
          recursive: call.arguments.recursive === true,
          ...(typeof call.arguments.cursor === 'string' ? { cursor: call.arguments.cursor } : {}),
          ...(typeof call.arguments.pageSize === 'number' ? { pageSize: call.arguments.pageSize } : {}),
          ...(typeof call.arguments.maxDepth === 'number' ? { maxDepth: call.arguments.maxDepth } : {})
        }
        return resultText(await this.listDirectoryTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
      case 'ghost_search_workspace': {
        const input: SearchWorkspaceInput = {
          query: requiredString(call.arguments, 'query'),
          ...(typeof call.arguments.path === 'string' ? { path: call.arguments.path } : {}),
          ...(typeof call.arguments.glob === 'string' ? { glob: call.arguments.glob } : {}),
          ...(typeof call.arguments.caseSensitive === 'boolean' ? { caseSensitive: call.arguments.caseSensitive } : {}),
          ...(typeof call.arguments.maxResults === 'number' ? { maxResults: call.arguments.maxResults } : {})
        }
        return resultText(await this.searchTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
      case 'ghost_get_diagnostics': {
        const input: DiagnosticsInput = {
          ...(typeof call.arguments.path === 'string' ? { path: call.arguments.path } : {}),
          ...(typeof call.arguments.severity === 'string' ? { severity: call.arguments.severity as DiagnosticsInput['severity'] } : {}),
          ...(typeof call.arguments.maxResults === 'number' ? { maxResults: call.arguments.maxResults } : {})
        }
        return resultText(await this.diagnosticsTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
      case 'ghost_git_context': {
        const input: GitContextInput = {
          operation: typeof call.arguments.operation === 'string' ? call.arguments.operation as GitContextInput['operation'] : 'status',
          ...(typeof call.arguments.path === 'string' ? { path: call.arguments.path } : {}),
          ...(typeof call.arguments.maxEntries === 'number' ? { maxEntries: call.arguments.maxEntries } : {})
        }
        return resultText(await this.gitContextTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
      case 'ghost_update_task_plan': {
        return resultText(await this.taskPlanTool.invoke({ input: call.arguments as unknown as TaskPlanInput, toolInvocationToken: undefined }, token))
      }
      case 'ghost_record_completion': {
        return resultText(await this.completionRecordTool.invoke({ input: call.arguments as unknown as CompletionRecordInput, toolInvocationToken: undefined }, token))
      }
      case 'ghost_write_file': {
        const input: WriteFileInput = {
          path: requiredString(call.arguments, 'path'),
          content: typeof call.arguments.content === 'string' ? call.arguments.content : ''
        }
        assertFileMutationAllowed([input.path])
        const allowed = options.approved ?? await confirmAction(
          'Allow Ghost to write a file?',
          `Replace the complete contents of ${input.path}?`,
          token
        )

        if (!allowed) {
          return 'User denied the file write.'
        }

        if (options.alreadyApplied) {
          const current = await readCurrentFile(input.path, token)
          if (!current.exists || (options.appliedContent !== undefined && current.content !== options.appliedContent)) {
            throw new Error('The accepted edit changed before Ghost could finish the request')
          }
          return `${input.path}: file already updated.\nApplied successfully.\nVerification: passed (accepted content read back).`
        }

        const expected = expectedWorkspaceSnapshot(options)
        const { uri, snapshot: current } = await readFileMutation(input.path, token)
        assertExpectedWorkspaceSnapshot(current, expected)
        const change = createWorkspaceFileChange(current, input.content)
        if (!change.changed) {
          return `${input.path}: no changes needed.`
        }

        await applyWorkspaceFileChange(uri, change, expected ?? current, token)
        return `${input.path}: wrote ${input.content.length} characters.\nVerification: passed (readback matched).`
      }
      case 'ghost_apply_edit': {
        const edit = parseGhostEdit(call.arguments)
        assertFileMutationAllowed([edit.path])
        const allowed = options.approved ?? await confirmAction(
          'Allow Ghost to apply an edit?',
          summarizeGhostEdit(edit),
          token
        )
        if (!allowed) {
          return 'User denied the file edit.'
        }

        if (options.alreadyApplied) {
          const current = await readCurrentFile(edit.path, token)
          if (!current.exists || (options.appliedContent !== undefined && current.content !== options.appliedContent)) {
            throw new Error('The accepted edit changed before Ghost could finish the request')
          }
          return `${summarizeGhostEdit(edit)}\nApplied successfully.\nVerification: passed (accepted content read back).`
        }

        const expected = expectedWorkspaceSnapshot(options)
        const { uri, snapshot: current } = await readFileMutation(edit.path, token)
        assertExpectedWorkspaceSnapshot(current, expected)
        const selectedHunks = options.selectedHunkIndexes ? new Set(options.selectedHunkIndexes) : undefined
        const change = createWorkspaceEditChange(current, edit, selectedHunks)
        if (!change.changed) {
          return `${summarizeGhostEdit(edit)}\nNo changes needed.`
        }
        await applyWorkspaceFileChange(uri, change, expected ?? current, token)
        return `${summarizeGhostEdit(edit)}\nApplied successfully.\nVerification: passed (readback matched).`
      }
      case 'ghost_apply_transaction': {
        const transactionInput: FileTransactionInput = parseFileTransaction(call.arguments)
        assertFileMutationAllowed(transactionInput.edits.map(edit => edit.path))
        const allowed = options.approved ?? await confirmAction(
          'Allow Ghost to apply a file transaction?',
          `Apply and verify ${transactionInput.edits.length} files together?`,
          token
        )
        if (!allowed) {
          return 'User denied the file transaction.'
        }
        const applied = await applyFileTransaction(transactionInput, options.expectedFiles, token)
        return `${summarizeFileTransaction(applied)}\nApplied and verified as one transaction.`
      }
      case 'ghost_run_terminal_command': {
        const input: RunTerminalCommandInput = {
          command: requiredString(call.arguments, 'command'),
          cwd: typeof call.arguments.cwd === 'string' ? call.arguments.cwd : undefined
        }
        const audit = auditTerminalCommand(input.command)
        if (audit.blocked) {
          return formatTerminalAudit(audit)
        }
        const allowed = options.approved ?? await confirmAction(
          'Allow Ghost to run a terminal command?',
          `${formatTerminalAudit(audit)}\n\n${input.cwd ? `Working directory: ${input.cwd}` : 'Working directory: the workspace'}\n\n${input.command}`,
          token
        )

        if (!allowed) {
          return 'User denied the terminal command.'
        }

        return resultText(await this.terminalTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
    }
  }
}
