type GhostProtocolClientApi = {
  protocolVersion: number
  supportedProtocolVersions: readonly number[]
  setNegotiatedVersion: (version: number) => void
  isSupportedVersion: (version: unknown) => version is number
  createId: (prefix: string) => string
  post: (vscodeApi: { postMessage: (message: unknown) => void }, type: string, details?: Record<string, unknown>) => void
}

const protocolVersion = 2
const supportedProtocolVersions = [1, protocolVersion] as const
let negotiatedVersion = protocolVersion

const ghostProtocolClient: GhostProtocolClientApi = {
  protocolVersion,
  supportedProtocolVersions,
  setNegotiatedVersion: version => {
    if (supportedProtocolVersions.includes(version as typeof supportedProtocolVersions[number])) {
      negotiatedVersion = version
    }
  },
  isSupportedVersion: (version): version is number => typeof version === 'number' && supportedProtocolVersions.includes(version as typeof supportedProtocolVersions[number]),
  createId: prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  post: (vscodeApi, type, details = {}) => {
    vscodeApi.postMessage({
      source: 'ghost-webview',
      version: negotiatedVersion,
      type,
      ...(type === 'ready' ? { supportedVersions: [...supportedProtocolVersions] } : {}),
      ...details
    })
  }
}

const ghostProtocolGlobal = globalThis as typeof globalThis & { GhostProtocolClient: GhostProtocolClientApi }
ghostProtocolGlobal.GhostProtocolClient = ghostProtocolClient
