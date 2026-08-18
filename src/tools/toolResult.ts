export type ToolResultStatus = 'success' | 'no-op' | 'blocked' | 'denied' | 'cancelled' | 'failed'

export interface ToolResult {
  status: ToolResultStatus
  text: string
  exitCode?: number
  changedFiles: string[]
  bytes: number
  truncated: boolean
  warnings: string[]
  retryable: boolean
}

export interface ToolResultOverrides {
  status?: ToolResultStatus
  exitCode?: number
  changedFiles?: string[]
  bytes?: number
  truncated?: boolean
  warnings?: string[]
  retryable?: boolean
}

const outputWasTruncated = (text: string): boolean =>
  /(?:output|result|file|directory)\s+(?:was\s+)?truncated|output exceeded|showing the tail|\[.*truncated.*\]/i.test(text)

const outputWarnings = (text: string): string[] => text
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => /^(?:warning|warn(?:ing)?\s*:)/i.test(line))

const inferStatus = (text: string): ToolResultStatus => {
  if (/^Tool call cancelled\b/i.test(text)) return 'cancelled'
  if (/^User denied\b/i.test(text)) return 'denied'
  if (/\bblocked\b|not allowed/i.test(text) && !/^Tool error:/i.test(text)) return 'blocked'
  if (/no changes needed/i.test(text)) return 'no-op'
  if (/^(?:Tool error:|File changed externally|The accepted edit changed|Edit expected)/i.test(text)) return 'failed'
  return 'success'
}

const inferRetryable = (status: ToolResultStatus, text: string): boolean => {
  if (status === 'denied' || status === 'blocked' || status === 'no-op') return false
  if (status === 'cancelled') return true
  if (status === 'failed') return !/outside the workspace|binary files are not supported|non-utf-8/i.test(text)
  return false
}

const inferExitCode = (text: string): number | undefined => {
  const match = text.match(/\[Exit code:\s*(-?\d+)\]/i)
  return match ? Number(match[1]) : undefined
}

export const createToolResult = (text: string, overrides: ToolResultOverrides = {}): ToolResult => {
  const status = overrides.status ?? inferStatus(text)
  const warnings = [...new Set([...(overrides.warnings ?? []), ...outputWarnings(text)])]
  return {
    status,
    text,
    ...(overrides.exitCode !== undefined ? { exitCode: overrides.exitCode } : inferExitCode(text) !== undefined ? { exitCode: inferExitCode(text) } : {}),
    changedFiles: [...new Set(overrides.changedFiles ?? [])],
    bytes: overrides.bytes ?? Buffer.byteLength(text, 'utf8'),
    truncated: overrides.truncated ?? outputWasTruncated(text),
    warnings,
    retryable: overrides.retryable ?? inferRetryable(status, text)
  }
}

export const createToolErrorResult = (error: unknown, overrides: ToolResultOverrides = {}): ToolResult => {
  const message = error instanceof Error ? error.message : String(error)
  return createToolResult(`Tool error: ${message}`, {
    ...overrides,
    status: 'failed',
    retryable: overrides.retryable ?? true
  })
}

export const replaceToolResultText = (result: ToolResult, text: string, overrides: ToolResultOverrides = {}): ToolResult =>
  createToolResult(text, {
    ...result,
    ...overrides,
    status: overrides.status ?? result.status,
    changedFiles: overrides.changedFiles ?? result.changedFiles,
    warnings: overrides.warnings ?? result.warnings,
    truncated: overrides.truncated ?? result.truncated,
    retryable: overrides.retryable ?? result.retryable
  })
