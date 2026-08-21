import type { LocalToolCall } from '../agent/toolCallParser'
import { parseFileTransaction } from '../tools/transactionWorkflow'
import { resolveWorkspacePath } from '../tools/workspacePath'

export {
  shouldAutoAcceptFileEdit
} from './autoAcceptPolicy'
export type {
  AutoAcceptFileEditDecision,
  AutoAcceptFileEditState,
  AutoAcceptToolCall
} from './autoAcceptPolicy'

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

