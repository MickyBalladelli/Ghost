import * as vscode from 'vscode'

import { resolveWorkspacePath } from './workspacePath'
import { GHOST_POLICY } from '../ghostPolicy'

export interface DiagnosticsInput {
  path?: string
  severity?: 'error' | 'warning' | 'information' | 'hint'
  maxResults?: number
}

interface DiagnosticRecord {
  path: string
  severity: 'error' | 'warning' | 'information' | 'hint'
  message: string
  source?: string
  code?: string
  range: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }
}

const MAX_RESULTS = GHOST_POLICY.diagnostics.maxResults

function textResult(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)])
}

function severityName(severity: vscode.DiagnosticSeverity): DiagnosticRecord['severity'] {
  if (severity === vscode.DiagnosticSeverity.Error) return 'error'
  if (severity === vscode.DiagnosticSeverity.Warning) return 'warning'
  if (severity === vscode.DiagnosticSeverity.Information) return 'information'
  return 'hint'
}

function diagnosticCode(code: vscode.Diagnostic['code']): string | undefined {
  if (code === undefined) {
    return undefined
  }
  if (typeof code === 'object' && code !== null && 'value' in code) {
    return String(code.value)
  }
  return String(code)
}

function isWorkspaceUri(uri: vscode.Uri): boolean {
  return vscode.workspace.getWorkspaceFolder(uri) !== undefined
}

function formatDiagnostic(uri: vscode.Uri, diagnostic: vscode.Diagnostic): DiagnosticRecord {
  const record: DiagnosticRecord = {
    path: uri.fsPath,
    severity: severityName(diagnostic.severity),
    message: diagnostic.message,
    range: {
      startLine: diagnostic.range.start.line + 1,
      startColumn: diagnostic.range.start.character + 1,
      endLine: diagnostic.range.end.line + 1,
      endColumn: diagnostic.range.end.character + 1
    }
  }
  if (diagnostic.source) {
    record.source = diagnostic.source
  }
  const code = diagnosticCode(diagnostic.code)
  if (code) {
    record.code = code
  }
  return record
}

export class DiagnosticsTool implements vscode.LanguageModelTool<DiagnosticsInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<DiagnosticsInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) {
      throw new Error('Diagnostics request cancelled')
    }

    const input = options.input
    let selectedUri: vscode.Uri | undefined
    let scope = 'workspace'
    if (input.path?.trim()) {
      selectedUri = resolveWorkspacePath(input.path)
      scope = selectedUri.fsPath
    } else {
      const activeUri = vscode.window.activeTextEditor?.document.uri
      if (activeUri && isWorkspaceUri(activeUri)) {
        selectedUri = activeUri
        scope = `active file: ${activeUri.fsPath}`
      }
    }

    const maximum = Math.min(input.maxResults ?? 200, MAX_RESULTS)
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Error('maxResults must be a positive integer')
    }

    const severityFilter = input.severity
    const diagnostics: DiagnosticRecord[] = []
    let totalVisible = 0
    const sources = selectedUri
      ? [[selectedUri, vscode.languages.getDiagnostics(selectedUri)] as const]
      : vscode.languages.getDiagnostics().filter(([uri]) => isWorkspaceUri(uri))

    for (const [uri, fileDiagnostics] of sources) {
      for (const diagnostic of fileDiagnostics) {
        if (severityFilter && severityName(diagnostic.severity) !== severityFilter) {
          continue
        }
        totalVisible += 1
        if (diagnostics.length < maximum) {
          diagnostics.push(formatDiagnostic(uri, diagnostic))
        }
      }
    }

    const result = {
      scope,
      diagnostics,
      total: totalVisible,
      truncated: totalVisible > diagnostics.length,
      continuation: totalVisible > diagnostics.length
        ? `Increase maxResults up to ${MAX_RESULTS} or inspect a specific file with path.`
        : undefined
    }
    return textResult(JSON.stringify(result, null, 2))
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<DiagnosticsInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: options.input.path ? `Reading diagnostics for ${options.input.path}` : 'Reading workspace diagnostics'
    }
  }
}

export function registerDiagnosticsTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.lm.registerTool('ghost_get_diagnostics', new DiagnosticsTool()))
}
