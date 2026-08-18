import type { GhostPersistedState } from './ghostProtocol'
import { GHOST_POLICY } from '../ghostPolicy'

export interface StoredWorkspaceState {
  schemaVersion: number
  conversations?: unknown[]
  activeConversationId?: string
}

export interface StoredGlobalState {
  schemaVersion: number
  promptHistory?: string[]
  presets?: unknown[]
  showReasoning?: boolean
  preferences?: Record<string, unknown>
}

const MAX_PERSISTED_STRING_CHARS = GHOST_POLICY.persistence.maxStringCharacters
const MAX_PERSISTED_STATE_BYTES = GHOST_POLICY.persistence.maxStateBytes

export const isStoredRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const truncatePersistedString = (value: string): string => {
  if (value.length <= MAX_PERSISTED_STRING_CHARS) {
    return value
  }
  const marker = '\n[Older content omitted from persistence]\n'
  const available = Math.max(0, MAX_PERSISTED_STRING_CHARS - marker.length)
  const head = Math.floor(available * 0.7)
  return `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`
}

const compactPersistedValue = (value: unknown, key = ''): unknown => {
  if (typeof value === 'string') {
    return truncatePersistedString(value)
  }
  if (Array.isArray(value)) {
    const limit = key === 'conversations'
      ? 24
      : key === 'messages'
        ? 120
        : key === 'parts'
          ? 40
          : key === 'eventLog'
            ? 100
            : key === 'presets'
              ? 50
              : undefined
    const items = limit === undefined ? value : value.slice(-limit)
    return items.map(item => compactPersistedValue(item))
  }
  if (isStoredRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      compactPersistedValue(entryValue, entryKey)
    ]))
  }
  return value
}

export const compactPersistedState = (state: GhostPersistedState): GhostPersistedState => {
  const compacted = compactPersistedValue(state) as GhostPersistedState
  if (JSON.stringify(compacted).length <= MAX_PERSISTED_STATE_BYTES || !Array.isArray(compacted.conversations)) {
    return compacted
  }
  compacted.conversations = compacted.conversations.slice(-8).map(conversation => {
    if (!isStoredRecord(conversation) || !Array.isArray(conversation.messages)) {
      return conversation
    }
    return {
      ...conversation,
      messages: conversation.messages.slice(-40)
    }
  })
  return compacted
}
