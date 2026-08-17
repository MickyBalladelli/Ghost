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
import { auditTerminalCommand, formatTerminalAudit, RunTerminalCommandInput, RunTerminalCommandTool } from './terminalTools'
import { applyGhostEdit, parseGhostEdit, summarizeGhostEdit } from './editWorkflow'
import { resolveWorkspacePath } from './workspacePath'
import { atomicWriteFile } from './atomicFile'
import { readWorkspaceFile, sameWorkspaceFile, verifyWorkspaceFile, WorkspaceFileSnapshot } from './workspaceFile'
import { applyFileTransaction, FileTransactionInput, parseFileTransaction, summarizeFileTransaction } from './transactionWorkflow'

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
  return `Tool call rejected: ${call.name} requires a non-empty '${requiredArgument}'. Retry with one JSON tool call using the absolute path from the workspace context.`
}

function resultText(result: vscode.LanguageModelToolResult): string {
  return result.content
    .filter(part => part instanceof vscode.LanguageModelTextPart)
    .map(part => (part as vscode.LanguageModelTextPart).value)
    .join('\n')
}

async function readCurrentFile(filePath: string): Promise<WorkspaceFileSnapshot> {
  return readWorkspaceFile(resolveWorkspacePath(filePath))
}

function expectedSnapshot(options: { expectedContent?: string; expectedFileExists?: boolean }): WorkspaceFileSnapshot | undefined {
  if (options.expectedContent === undefined && options.expectedFileExists === undefined) {
    return undefined
  }
  return {
    exists: options.expectedFileExists ?? true,
    content: options.expectedContent ?? ''
  }
}

function assertCurrentSnapshot(current: WorkspaceFileSnapshot, expected: WorkspaceFileSnapshot | undefined): void {
  if (expected && !sameWorkspaceFile(current, expected)) {
    throw new Error('File changed externally. Refresh and rebase the edit before retrying.')
  }
}

async function confirmAction(title: string, message: string): Promise<boolean> {
  const selection = await vscode.window.showWarningMessage(
    title,
    { modal: true, detail: message },
    ALLOW_ACTION
  )

  return selection === ALLOW_ACTION
}

export class LocalToolExecutor {
  private readonly readFileTool = new ReadFileTool()
  private readonly listDirectoryTool = new ListDirectoryTool()
  private readonly terminalTool = new RunTerminalCommandTool()
  private readonly searchTool = new SearchWorkspaceTool()

  async execute(call: LocalToolCall, token: vscode.CancellationToken, options: { approved?: boolean; expectedContent?: string; expectedFileExists?: boolean; expectedFiles?: Record<string, WorkspaceFileSnapshot>; alreadyApplied?: boolean; appliedContent?: string; selectedHunkIndexes?: number[] } = {}): Promise<string> {
    if (token.isCancellationRequested) {
      return 'Tool call cancelled by the user.'
    }

    const missingArgument = getMissingRequiredArgument(call)
    if (missingArgument) {
      return missingArgument
    }

    switch (call.name) {
      case 'ghost_read_file': {
        const input: ReadFileInput = {
          path: requiredString(call.arguments, 'path'),
          ...(typeof call.arguments.startLine === 'number' ? { startLine: call.arguments.startLine } : {}),
          ...(typeof call.arguments.endLine === 'number' ? { endLine: call.arguments.endLine } : {})
        }
        return resultText(await this.readFileTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
      case 'ghost_list_directory': {
        const input: ListDirectoryInput = {
          path: requiredString(call.arguments, 'path'),
          recursive: call.arguments.recursive === true
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
      case 'ghost_write_file': {
        const input: WriteFileInput = {
          path: requiredString(call.arguments, 'path'),
          content: typeof call.arguments.content === 'string' ? call.arguments.content : ''
        }
        const allowed = options.approved ?? await confirmAction(
          'Allow Ghost to write a file?',
          `Replace the complete contents of ${input.path}?`
        )

        if (!allowed) {
          return 'User denied the file write.'
        }

        if (options.alreadyApplied) {
          const current = await readCurrentFile(input.path)
          if (!current.exists || (options.appliedContent !== undefined && current.content !== options.appliedContent)) {
            throw new Error('The accepted edit changed before Ghost could finish the request')
          }
          return `${input.path}: file already updated.\nApplied successfully.\nVerification: passed (accepted content read back).`
        }

        const expected = expectedSnapshot(options)
        const current = await readCurrentFile(input.path)
        assertCurrentSnapshot(current, expected)
        if (current.content === input.content && current.exists) {
          return `${input.path}: no changes needed.`
        }

        await atomicWriteFile(resolveWorkspacePath(input.path), Buffer.from(input.content, 'utf8'), expected ?? current)
        await verifyWorkspaceFile(resolveWorkspacePath(input.path), { exists: true, content: input.content })
        return `${input.path}: wrote ${input.content.length} characters.\nVerification: passed (readback matched).`
      }
      case 'ghost_apply_edit': {
        const edit = parseGhostEdit(call.arguments)
        const allowed = options.approved ?? await confirmAction(
          'Allow Ghost to apply an edit?',
          summarizeGhostEdit(edit)
        )
        if (!allowed) {
          return 'User denied the file edit.'
        }

        if (options.alreadyApplied) {
          const current = await readCurrentFile(edit.path)
          if (!current.exists || (options.appliedContent !== undefined && current.content !== options.appliedContent)) {
            throw new Error('The accepted edit changed before Ghost could finish the request')
          }
          return `${summarizeGhostEdit(edit)}\nApplied successfully.\nVerification: passed (accepted content read back).`
        }

        const expected = expectedSnapshot(options)
        const current = await readCurrentFile(edit.path)
        assertCurrentSnapshot(current, expected)
        if (edit.expectedContent !== undefined && current.content !== edit.expectedContent) {
          throw new Error('Edit expected different file content')
        }
        const selectedHunks = options.selectedHunkIndexes ? new Set(options.selectedHunkIndexes) : undefined
        const updated = applyGhostEdit(current.content, edit, selectedHunks)
        if (updated === current.content) {
          return `${summarizeGhostEdit(edit)}\nNo changes needed.`
        }
        await atomicWriteFile(resolveWorkspacePath(edit.path), Buffer.from(updated, 'utf8'), expected ?? current)
        await verifyWorkspaceFile(resolveWorkspacePath(edit.path), { exists: true, content: updated })
        return `${summarizeGhostEdit(edit)}\nApplied successfully.\nVerification: passed (readback matched).`
      }
      case 'ghost_apply_transaction': {
        const transactionInput: FileTransactionInput = parseFileTransaction(call.arguments)
        const allowed = options.approved ?? await confirmAction(
          'Allow Ghost to apply a file transaction?',
          `Apply and verify ${transactionInput.edits.length} files together?`
        )
        if (!allowed) {
          return 'User denied the file transaction.'
        }
        const applied = await applyFileTransaction(transactionInput, options.expectedFiles)
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
          `${formatTerminalAudit(audit)}\n\n${input.cwd ? `Working directory: ${input.cwd}` : 'Working directory: the workspace'}\n\n${input.command}`
        )

        if (!allowed) {
          return 'User denied the terminal command.'
        }

        return resultText(await this.terminalTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
    }
  }
}
