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

export {
  deniedToolMessage,
  isConversationStateTool,
  isFileEditTool,
  requiresToolApproval,
  resolveLanguageModelToolPermission,
  resolveToolPermission
} from './toolPermissionPolicy'
export type {
  ToolPermissionDecision,
  ToolPermissionState
} from './toolPermissionPolicy'

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

