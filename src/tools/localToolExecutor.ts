import * as vscode from 'vscode'

import { LocalToolCall } from '../agent/toolCallParser'
import {
  ListDirectoryInput,
  ListDirectoryTool,
  ReadFileInput,
  ReadFileTool,
  WriteFileInput,
  WriteFileTool
} from './fileTools'
import { RunTerminalCommandInput, RunTerminalCommandTool } from './terminalTools'
import { applyGhostEdit, parseGhostEdit, summarizeGhostEdit } from './editWorkflow'
import { resolveWorkspacePath } from './workspacePath'

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
    : call.name === 'ghost_run_terminal_command'
      ? 'command'
      : undefined
  if (!requiredArgument) {
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

async function readCurrentFile(filePath: string): Promise<string> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(resolveWorkspacePath(filePath))).toString('utf8')
  } catch {
    return ''
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
  private readonly writeFileTool = new WriteFileTool()
  private readonly listDirectoryTool = new ListDirectoryTool()
  private readonly terminalTool = new RunTerminalCommandTool()

  async execute(call: LocalToolCall, token: vscode.CancellationToken, options: { approved?: boolean; expectedContent?: string; selectedHunkIndexes?: number[] } = {}): Promise<string> {
    if (token.isCancellationRequested) {
      return 'Tool call cancelled by the user.'
    }

    const missingArgument = getMissingRequiredArgument(call)
    if (missingArgument) {
      return missingArgument
    }

    switch (call.name) {
      case 'ghost_read_file': {
        const input: ReadFileInput = { path: requiredString(call.arguments, 'path') }
        return resultText(await this.readFileTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
      case 'ghost_list_directory': {
        const input: ListDirectoryInput = {
          path: requiredString(call.arguments, 'path'),
          recursive: call.arguments.recursive === true
        }
        return resultText(await this.listDirectoryTool.invoke({ input, toolInvocationToken: undefined }, token))
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

        if (options.expectedContent !== undefined) {
          const current = await readCurrentFile(input.path)
          if (current !== options.expectedContent) {
            throw new Error('File changed externally since the edit was proposed')
          }
        }

        return resultText(await this.writeFileTool.invoke({ input, toolInvocationToken: undefined }, token))
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
        const current = await readCurrentFile(edit.path)
        if (options.expectedContent !== undefined && current !== options.expectedContent) {
          throw new Error('File changed externally since the edit was proposed')
        }
        if (edit.expectedContent !== undefined && current !== edit.expectedContent) {
          throw new Error('Edit expected different file content')
        }
        const selectedHunks = options.selectedHunkIndexes ? new Set(options.selectedHunkIndexes) : undefined
        const updated = applyGhostEdit(current, edit, selectedHunks)
        await vscode.workspace.fs.writeFile(resolveWorkspacePath(edit.path), Buffer.from(updated, 'utf8'))
        return `${summarizeGhostEdit(edit)}\nApplied successfully.`
      }
      case 'ghost_run_terminal_command': {
        const input: RunTerminalCommandInput = {
          command: requiredString(call.arguments, 'command'),
          cwd: typeof call.arguments.cwd === 'string' ? call.arguments.cwd : undefined
        }
        const allowed = options.approved ?? await confirmAction(
          'Allow Ghost to run a terminal command?',
          input.cwd ? `${input.command}\n\nWorking directory: ${input.cwd}` : input.command
        )

        if (!allowed) {
          return 'User denied the terminal command.'
        }

        return resultText(await this.terminalTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
    }
  }
}
