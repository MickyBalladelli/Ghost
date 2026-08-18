type GhostSettingsStoreApi = {
  maxTokensForLength: (length: 'short' | 'balanced' | 'long' | 'unlimited') => number | undefined
  clampPromptRows: (value: number) => number
  clampPromptHistoryLimit: (value: number, fallback: number) => number
}

const ghostSettingsStore: GhostSettingsStoreApi = {
  maxTokensForLength: length => {
    if (length === 'short') return 512
    if (length === 'balanced') return 1024
    if (length === 'long') return 2048
    return undefined
  },
  clampPromptRows: value => Math.min(12, Math.max(1, Math.floor(value))),
  clampPromptHistoryLimit: (value, fallback) => Math.min(500, Math.max(10, Math.floor(value || fallback)))
}

const ghostSettingsGlobal = globalThis as typeof globalThis & { GhostSettingsStore: GhostSettingsStoreApi }
ghostSettingsGlobal.GhostSettingsStore = ghostSettingsStore
