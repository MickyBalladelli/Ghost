import * as vscode from 'vscode'

import { registerFileTools } from './fileTools'
import { registerTerminalTools } from './terminalTools'
import { registerSearchTool } from './searchTool'
import { registerDiagnosticsTool } from './diagnosticsTool'
import { registerGitContextTool } from './gitContextTool'
import { registerTaskPlanTool } from '../agent/taskPlan'

export function registerLanguageModelTools(context: vscode.ExtensionContext): void {
  registerFileTools(context)
  registerSearchTool(context)
  registerDiagnosticsTool(context)
  registerGitContextTool(context)
  registerTaskPlanTool(context)
  registerTerminalTools(context)
}
