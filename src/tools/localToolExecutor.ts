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

const ALLOW_ACTION = 'Allow'

function requiredString(input: Record<string, unknown>, name: string): string {
  const value = input[name]

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Tool argument '${name}' must be a non-empty string`)
  }

  return value
}

function resultText(result: vscode.LanguageModelToolResult): string {
  return result.content
    .filter(part => part instanceof vscode.LanguageModelTextPart)
    .map(part => (part as vscode.LanguageModelTextPart).value)
    .join('\n')
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

  async execute(call: LocalToolCall, token: vscode.CancellationToken, options: { approved?: boolean } = {}): Promise<string> {
    if (token.isCancellationRequested) {
      return 'Tool call cancelled by the user.'
    }

    switch (call.name) {
      case 'ghostpilot_read_file': {
        const input: ReadFileInput = { path: requiredString(call.arguments, 'path') }
        return resultText(await this.readFileTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
      case 'ghostpilot_list_directory': {
        const input: ListDirectoryInput = {
          path: requiredString(call.arguments, 'path'),
          recursive: call.arguments.recursive === true
        }
        return resultText(await this.listDirectoryTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
      case 'ghostpilot_write_file': {
        const input: WriteFileInput = {
          path: requiredString(call.arguments, 'path'),
          content: typeof call.arguments.content === 'string' ? call.arguments.content : ''
        }
        const allowed = options.approved ?? await confirmAction(
          'Allow GhostPilot to write a file?',
          `Replace the complete contents of ${input.path}?`
        )

        if (!allowed) {
          return 'User denied the file write.'
        }

        return resultText(await this.writeFileTool.invoke({ input, toolInvocationToken: undefined }, token))
      }
      case 'ghostpilot_run_terminal_command': {
        const input: RunTerminalCommandInput = {
          command: requiredString(call.arguments, 'command'),
          cwd: typeof call.arguments.cwd === 'string' ? call.arguments.cwd : undefined
        }
        const allowed = options.approved ?? await confirmAction(
          'Allow GhostPilot to run a terminal command?',
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
