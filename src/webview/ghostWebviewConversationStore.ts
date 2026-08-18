type GhostConversationStoreApi = {
  persistenceSchemaVersion: number
  defaultPromptHistoryLimit: number
  maxPromptHistoryLimit: number
  createConversation: () => unknown
  normalizePromptHistory: (value: unknown, limit?: number) => string[]
  addPromptToHistory: (history: readonly string[], prompt: string, limit?: number) => string[]
}

const ghostConversationStore: GhostConversationStoreApi = {
  persistenceSchemaVersion: 2,
  defaultPromptHistoryLimit: 100,
  maxPromptHistoryLimit: 500,
  createConversation: () => {
    const timestamp = Date.now()
    return {
      id: `conversation-${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
      title: 'New conversation',
      messages: [],
      draft: '',
      promptHistory: [],
      createdAt: timestamp,
      updatedAt: timestamp
    }
  },
  normalizePromptHistory: (value, limit = 100) => (
    Array.isArray(value)
      ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, Math.min(500, Math.max(1, Math.floor(limit))))
      : []
  ),
  addPromptToHistory: (history, prompt, limit = 100) => {
    const normalized = prompt.trim()
    if (!normalized) {
      return ghostConversationStore.normalizePromptHistory(history, limit)
    }
    return [normalized, ...history.filter(item => item !== normalized)]
      .slice(0, Math.min(500, Math.max(1, Math.floor(limit))))
  }
}

const ghostGlobal = globalThis as typeof globalThis & { GhostConversationStore: GhostConversationStoreApi }
ghostGlobal.GhostConversationStore = ghostConversationStore
