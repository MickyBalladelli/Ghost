import { shouldAutoAcceptFileEdit } from './autoAcceptPolicy'
import type { AutoAcceptFileEditState, AutoAcceptToolCall } from './autoAcceptPolicy'

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

export interface ToolPermissionState {
  allowlist?: string[]
  asklist?: string[]
  denylist?: string[]
  autoAccept: AutoAcceptFileEditState
  sessionApprovedFileEdits?: boolean
  workspaceApprovedFileEdits?: boolean
  persistentApprovedFileEdits?: boolean
  sessionApprovedTool?: boolean
  persistentApprovedTool?: boolean
  requestApprovedFileEdits?: boolean
  requestApprovedThisFile?: boolean
}

export interface ToolPermissionDecision {
  blockedByPolicy: boolean
  asksByPolicy: boolean
  autoAcceptedFileEdit: boolean
  consumeOneEdit?: boolean
  nextAutoAcceptFilePath?: string
  needsInteractiveApproval: boolean
}

export function resolveToolPermission(
  toolName: string,
  state: ToolPermissionState,
  call: AutoAcceptToolCall
): ToolPermissionDecision {
  const conversationState = isConversationStateTool(toolName)
  const allowedTools = state.allowlist
  const asksByPolicy = !conversationState && (
    (allowedTools !== undefined && !allowedTools.includes(toolName))
    || (state.asklist ?? []).includes(toolName)
  )
  const blockedByPolicy = !conversationState && (state.denylist ?? []).includes(toolName)
  const fileEditTool = isFileEditTool(toolName)
  const autoAcceptDecision = shouldAutoAcceptFileEdit(state.autoAccept, call)
  const autoAcceptedFileEdit = fileEditTool && !blockedByPolicy && !asksByPolicy && autoAcceptDecision.accepted
  const requiresApproval = (requiresToolApproval(toolName) || asksByPolicy) && !blockedByPolicy && !autoAcceptedFileEdit
  const alreadyApproved = fileEditTool
    ? Boolean(
      state.requestApprovedFileEdits
      || state.requestApprovedThisFile
      || state.sessionApprovedFileEdits
      || state.workspaceApprovedFileEdits
      || state.persistentApprovedFileEdits
    )
    : Boolean(state.sessionApprovedTool || state.persistentApprovedTool)
  return {
    blockedByPolicy,
    asksByPolicy,
    autoAcceptedFileEdit,
    consumeOneEdit: autoAcceptDecision.consumeOneEdit,
    nextAutoAcceptFilePath: autoAcceptDecision.nextAutoAcceptFilePath,
    needsInteractiveApproval: requiresApproval && !alreadyApproved
  }
}
