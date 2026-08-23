import { GHOST_PERSISTENCE_SCHEMA_VERSION, GhostPersistedState } from './ghostProtocol'
import { GHOST_POLICY } from '../ghostPolicy'

export const MAX_GHOST_PROMPT_HISTORY = GHOST_POLICY.persistence.maxPromptHistory

export function normalizePromptHistory(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, MAX_GHOST_PROMPT_HISTORY)
}

export function addPromptToHistory(history: readonly string[], prompt: string): string[] {
  const normalized = prompt.trim()

  if (!normalized) {
    return normalizePromptHistory(history)
  }

  return [normalized, ...history.filter(item => item !== normalized)].slice(0, MAX_GHOST_PROMPT_HISTORY)
}

export function migratePersistedState(value: unknown): GhostPersistedState {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION,
    workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : undefined,
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
