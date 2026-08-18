import { GHOST_POLICY } from '../ghostPolicy'

export const MIN_TOOL_CALL_TOKENS = GHOST_POLICY.agent.minToolCallTokens
export const MAX_TOOL_ROUNDS = GHOST_POLICY.agent.maxToolRounds

export function outputTokenBudget(requestedOutputTokens: number | undefined, toolsEnabled: boolean): number | undefined {
  return toolsEnabled
    ? Math.max(requestedOutputTokens ?? 0, MIN_TOOL_CALL_TOKENS)
    : requestedOutputTokens
}

export function hasReachedToolCallLimit(toolCallCount: number): boolean {
  return toolCallCount >= MAX_TOOL_ROUNDS
}
