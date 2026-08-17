import * as vscode from 'vscode'

import { registerFileTools } from './fileTools'
import { registerTerminalTools } from './terminalTools'
import { registerSearchTool } from './searchTool'

export function registerLanguageModelTools(context: vscode.ExtensionContext): void {
  registerFileTools(context)
  registerSearchTool(context)
  registerTerminalTools(context)
}
