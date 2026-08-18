import type { GhostSettings } from '../config'
import { GHOST_PERSISTENCE_SCHEMA_VERSION } from './ghostProtocol'
import type { GhostPersistedState } from './ghostProtocol'
import { isStoredRecord } from './ghostPersistence'

export const parseGhostImportState = (parsed: unknown): GhostPersistedState => {
  const candidate = isStoredRecord(parsed) && isStoredRecord(parsed.state) ? parsed.state : parsed
  if (!isStoredRecord(candidate) || !Array.isArray(candidate.conversations)) {
    throw new Error('The file does not contain Ghost conversations.')
  }
  return {
    schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION,
    conversations: candidate.conversations,
    activeConversationId: typeof candidate.activeConversationId === 'string' ? candidate.activeConversationId : undefined,
    promptHistory: Array.isArray(candidate.promptHistory) ? candidate.promptHistory.filter(item => typeof item === 'string') : [],
    presets: Array.isArray(candidate.presets) ? candidate.presets : [],
    showReasoning: candidate.showReasoning === true,
    preferences: isStoredRecord(candidate.preferences) ? candidate.preferences : {}
  }
}

export const createGhostExportData = (settings: GhostSettings, state: GhostPersistedState) => ({
  version: GHOST_PERSISTENCE_SCHEMA_VERSION,
  exportedAt: new Date().toISOString(),
  provider: settings.provider,
  chatModel: settings.chatModel,
  state
})
