import { GHOST_POLICY } from '../ghostPolicy'

export const MIN_TOOL_CALL_TOKENS = GHOST_POLICY.agent.minToolCallTokens
export const MAX_TOOL_OUTPUT_RESERVE = 4096
export const MAX_TOOL_ROUNDS = GHOST_POLICY.agent.maxToolRounds

export function scaledToolOutputReserve(maxContextTokens: number): number {
  return Math.min(MAX_TOOL_OUTPUT_RESERVE, Math.max(MIN_TOOL_CALL_TOKENS, Math.floor(maxContextTokens * 0.25)))
}

export function outputTokenBudget(
  requestedOutputTokens: number | undefined,
  toolsEnabled: boolean,
  maxContextTokens = 8192
): number | undefined {
  return toolsEnabled
    ? Math.max(requestedOutputTokens ?? 0, scaledToolOutputReserve(maxContextTokens))
    : requestedOutputTokens
}

export function hasReachedToolCallLimit(toolCallCount: number): boolean {
  return toolCallCount >= MAX_TOOL_ROUNDS
}
