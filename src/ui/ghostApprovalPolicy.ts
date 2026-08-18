import type { GhostAutoAcceptScope } from '../config'
import type { LocalToolCall } from '../agent/toolCallParser'
import { parseFileTransaction } from '../tools/transactionWorkflow'
import { resolveWorkspacePath } from '../tools/workspacePath'

export const requiresToolApproval = (toolName: string): boolean => (
  toolName === 'ghost_write_file' ||
  toolName === 'ghost_apply_edit' ||
  toolName === 'ghost_apply_transaction' ||
  toolName === 'ghost_run_terminal_command'
)

export const isConversationStateTool = (toolName: string): boolean => (
  toolName === 'ghost_update_task_plan' || toolName === 'ghost_record_completion'
)

export const isFileEditTool = (toolName: string): boolean => (
  toolName === 'ghost_write_file' || toolName === 'ghost_apply_edit' || toolName === 'ghost_apply_transaction'
)

export const getFileEditPaths = (call: LocalToolCall): string[] => {
  try {
    const paths = call.name === 'ghost_apply_transaction'
      ? parseFileTransaction(call.arguments).edits.map(edit => edit.path)
      : typeof call.arguments.path === 'string' ? [call.arguments.path] : []
    return [...new Set(paths.map(filePath => resolveWorkspacePath(filePath).fsPath))]
  } catch {
    return []
  }
}

export const shouldAutoAcceptFileEdit = (
  scope: GhostAutoAcceptScope,
  autoAcceptDisabled: boolean,
  autoAcceptFilePath: string | undefined,
  call: LocalToolCall
): { accepted: boolean; nextAutoAcceptFilePath?: string } => {
  if (scope === 'confirm' || autoAcceptDisabled) {
    return { accepted: false }
  }
  if (scope === 'one-edit' || scope === 'request' || scope === 'session' || scope === 'workspace' || scope === 'always') {
    return { accepted: true }
  }
  if (call.name === 'ghost_apply_transaction' || typeof call.arguments.path !== 'string') {
    return { accepted: false }
  }
  if (!autoAcceptFilePath) {
    return { accepted: true, nextAutoAcceptFilePath: call.arguments.path }
  }
  return { accepted: autoAcceptFilePath === call.arguments.path }
}
