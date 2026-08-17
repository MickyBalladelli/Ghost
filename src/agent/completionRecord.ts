import * as vscode from 'vscode'

export interface CompletionRecord {
  changedFiles: string[]
  checksRun: string[]
  failures: string[]
  remainingWork: string[]
  recordedAt: number
}

export interface CompletionRecordInput {
  changedFiles: string[]
  checksRun: string[]
  failures: string[]
  remainingWork: string[]
}

export const COMPLETION_RECORD_MARKER = 'Ghost completion record:'

const normalizeList = (value: unknown): string[] => (
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim().slice(0, 2000)))].slice(0, 100)
    : []
)

export function normalizeCompletionRecord(input: CompletionRecordInput): CompletionRecord {
  return {
    changedFiles: normalizeList(input.changedFiles),
    checksRun: normalizeList(input.checksRun),
    failures: normalizeList(input.failures),
    remainingWork: normalizeList(input.remainingWork),
    recordedAt: Date.now()
  }
}

export function parseCompletionRecordMarker(value: string): CompletionRecord | undefined {
  if (!value.startsWith(COMPLETION_RECORD_MARKER)) return undefined
  try {
    const input = JSON.parse(value.slice(COMPLETION_RECORD_MARKER.length).trim()) as CompletionRecordInput
    if (!input || !Array.isArray(input.changedFiles) || !Array.isArray(input.checksRun) || !Array.isArray(input.failures) || !Array.isArray(input.remainingWork)) return undefined
    return normalizeCompletionRecord(input)
  } catch {
    return undefined
  }
}

function textResult(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)])
}

export class CompletionRecordTool implements vscode.LanguageModelTool<CompletionRecordInput> {
  async invoke(options: vscode.LanguageModelToolInvocationOptions<CompletionRecordInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) throw new Error('Completion record cancelled')
    const input = options.input
    if (!input || !Array.isArray(input.changedFiles) || !Array.isArray(input.checksRun) || !Array.isArray(input.failures) || !Array.isArray(input.remainingWork)) {
      throw new Error('Completion record needs changedFiles, checksRun, failures, and remainingWork arrays')
    }
    const record = normalizeCompletionRecord(input)
    return textResult(`${COMPLETION_RECORD_MARKER} ${JSON.stringify(record)}`)
  }

  prepareInvocation(): vscode.PreparedToolInvocation {
    return { invocationMessage: 'Recording completion summary' }
  }
}

export function registerCompletionRecordTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.lm.registerTool('ghost_record_completion', new CompletionRecordTool()))
}
