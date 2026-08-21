import type { ToolResultStatus } from '../tools/toolResult'

export const INSPECTION_TOOL_NAMES = [
  'ghost_read_file',
  'ghost_search_workspace',
  'ghost_get_diagnostics',
  'ghost_git_context',
  'ghost_list_directory'
] as const

const FAILED_TOOL_TEXT = /^(?:Tool error:|User denied|Tool call cancelled|File changed externally|The accepted edit changed|Edit expected)/

export function isInspectionTool(toolName: string): boolean {
  return (INSPECTION_TOOL_NAMES as readonly string[]).includes(toolName)
}

export function isFailedToolOutcome(status: ToolResultStatus, text: string): boolean {
  return status === 'failed'
    || status === 'denied'
    || status === 'blocked'
    || status === 'cancelled'
    || FAILED_TOOL_TEXT.test(text)
}

export function shouldStopAgentForToolFailure(toolName: string, status: ToolResultStatus, text: string): boolean {
  if (!isFailedToolOutcome(status, text)) {
    return false
  }
  if (status === 'cancelled' || /^Tool call cancelled/.test(text)) {
    return true
  }
  if (status === 'denied' || status === 'blocked' || /^User denied/.test(text)) {
    return true
  }
  return !isInspectionTool(toolName)
}
