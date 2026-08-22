import type { GhostSettings } from '../config'
import type { ModelCapabilityRecord } from '../services/providerAdapter'
import type { GhostModelMetadata } from './ghostProtocol'

export interface ProviderStatus {
  connection: 'online' | 'offline'
  models: string[]
  modelMetadata: ModelCapabilityRecord[]
}

export interface ProviderStatusCache extends ProviderStatus {
  key: string
  checkedAt: number
}

export const providerStatusKey = (settings: GhostSettings, apiKeyConfigured: boolean): string => JSON.stringify({
  provider: settings.provider,
  ollamaUrl: settings.ollamaUrl,
  mlxUrl: settings.mlxUrl,
  openaiUrl: settings.openaiUrl,
  openaiProfile: settings.openaiProfile,
  openaiApiVersion: settings.openaiApiVersion,
  openaiCustomModelsPath: settings.openaiCustomModelsPath,
  openaiApiKeyHeader: settings.openaiApiKeyHeader,
  openaiApiKeyPrefix: settings.openaiApiKeyPrefix,
  openaiOrganizationHeader: settings.openaiOrganizationHeader,
  openaiOrganization: settings.openaiOrganization,
  openaiProjectHeader: settings.openaiProjectHeader,
  openaiProject: settings.openaiProject,
  openaiProxy: settings.openaiProxy,
  openaiNoProxy: settings.openaiNoProxy,
  openaiTlsRejectUnauthorized: settings.openaiTlsRejectUnauthorized,
  openaiTlsCaFile: settings.openaiTlsCaFile,
  openaiTlsCertFile: settings.openaiTlsCertFile,
  openaiTlsKeyFile: settings.openaiTlsKeyFile,
  openCodeUrl: settings.openCodeUrl,
  openCodeUsername: settings.openCodeUsername,
  openCodeAgent: settings.openCodeAgent,
  openCodeSessionReuse: settings.openCodeSessionReuse,
  apiKeyConfigured
})

export const toGhostModelMetadata = (capability: ModelCapabilityRecord): GhostModelMetadata => {
  const capabilities = [
    capability.supportsStreaming ? 'streaming' : '',
    capability.supportsVision ? 'vision' : '',
    capability.supportsTools ? 'native tools' : '',
    capability.supportsJsonMode ? 'JSON mode' : '',
    capability.supportsFIM ? 'FIM' : ''
  ].filter(Boolean)
  return {
    id: capability.model,
    label: capability.model,
    provider: capability.provider,
    contextWindow: capability.contextWindow,
    outputLimit: capability.outputLimit,
    nativeApi: capability.nativeApi,
    supportsTools: capability.supportsTools,
    supportsJsonMode: capability.supportsJsonMode,
    supportsVision: capability.supportsVision,
    supportsFIM: capability.supportsFIM,
    supportsStreaming: capability.supportsStreaming,
    supportsSampling: capability.supportsSampling,
    capabilities
  }
}
