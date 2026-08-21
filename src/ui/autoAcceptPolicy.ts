import type { GhostAutoAcceptScope } from './ghostProtocol'

export interface AutoAcceptToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface AutoAcceptFileEditState {
  scope: GhostAutoAcceptScope
  autoAcceptDisabled?: boolean
  autoAcceptFilePath?: string
  oneEditConsumed?: boolean
  sessionActive?: boolean
  resolveFilePath?: (filePath: string) => string
}

export interface AutoAcceptFileEditDecision {
  accepted: boolean
  nextAutoAcceptFilePath?: string
  consumeOneEdit?: boolean
}

export function shouldAutoAcceptFileEdit(
  state: AutoAcceptFileEditState,
  call: AutoAcceptToolCall
): AutoAcceptFileEditDecision {
  if (state.scope === 'confirm' || state.autoAcceptDisabled) {
    return { accepted: false }
  }
  if (state.scope === 'one-edit') {
    if (state.oneEditConsumed) {
      return { accepted: false }
    }
    return { accepted: true, consumeOneEdit: true }
  }
  if (state.scope === 'session') {
    return { accepted: state.sessionActive === true }
  }
  if (state.scope === 'request' || state.scope === 'workspace' || state.scope === 'always') {
    return { accepted: true }
  }
  if (call.name === 'ghost_apply_transaction' || typeof call.arguments.path !== 'string') {
    return { accepted: false }
  }
  const filePath = resolvedAutoAcceptPath(state, call.arguments.path)
  if (!state.autoAcceptFilePath) {
    return { accepted: true, nextAutoAcceptFilePath: filePath }
  }
  return { accepted: state.autoAcceptFilePath === filePath }
}

function resolvedAutoAcceptPath(state: AutoAcceptFileEditState, filePath: string): string {
  if (!state.resolveFilePath) {
    return filePath
  }
  try {
    return state.resolveFilePath(filePath)
  } catch {
    return filePath
  }
}
