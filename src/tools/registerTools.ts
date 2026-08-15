import * as vscode from 'vscode'

import { registerFileTools } from './fileTools'
import { registerTerminalTools } from './terminalTools'

export function registerLanguageModelTools(context: vscode.ExtensionContext): void {
  registerFileTools(context)
  registerTerminalTools(context)
}
