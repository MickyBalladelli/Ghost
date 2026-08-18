type GhostProtocolClientApi = {
  createId: (prefix: string) => string
  post: (vscodeApi: { postMessage: (message: unknown) => void }, type: string, details?: Record<string, unknown>) => void
}

const ghostProtocolClient: GhostProtocolClientApi = {
  createId: prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  post: (vscodeApi, type, details = {}) => {
    vscodeApi.postMessage({
      source: 'ghost-webview',
      version: 1,
      type,
      ...details
    })
  }
}

const ghostProtocolGlobal = globalThis as typeof globalThis & { GhostProtocolClient: GhostProtocolClientApi }
ghostProtocolGlobal.GhostProtocolClient = ghostProtocolClient
