import * as vscode from 'vscode'

import { registerFileTools } from './fileTools'
import { registerTerminalTools } from './terminalTools'
import { registerSearchTool } from './searchTool'
import { registerDiagnosticsTool } from './diagnosticsTool'

export function registerLanguageModelTools(context: vscode.ExtensionContext): void {
  registerFileTools(context)
  registerSearchTool(context)
  registerDiagnosticsTool(context)
  registerTerminalTools(context)
}
