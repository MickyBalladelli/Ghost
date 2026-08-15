import { GHOSTPILOT_PERSISTENCE_SCHEMA_VERSION, GhostPilotPersistedState } from './ghostPilotProtocol'

export const MAX_GHOSTPILOT_PROMPT_HISTORY = 100

export function normalizePromptHistory(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, MAX_GHOSTPILOT_PROMPT_HISTORY)
}

export function addPromptToHistory(history: readonly string[], prompt: string): string[] {
  const normalized = prompt.trim()

  if (!normalized) {
    return normalizePromptHistory(history)
  }

  return [normalized, ...history.filter(item => item !== normalized)].slice(0, MAX_GHOSTPILOT_PROMPT_HISTORY)
}

export function migratePersistedState(value: unknown): GhostPilotPersistedState {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    schemaVersion: GHOSTPILOT_PERSISTENCE_SCHEMA_VERSION,
    conversations: Array.isArray(record.conversations) ? record.conversations : [],
    activeConversationId: typeof record.activeConversationId === 'string' ? record.activeConversationId : undefined,
    promptHistory: normalizePromptHistory(record.promptHistory),
    presets: Array.isArray(record.presets) ? record.presets : [],
    showReasoning: record.showReasoning === true,
    preferences: record.preferences && typeof record.preferences === 'object' && !Array.isArray(record.preferences)
      ? record.preferences as Record<string, unknown>
      : {}
  }
}
