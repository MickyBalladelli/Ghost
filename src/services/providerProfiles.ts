export type OpenAiProfileId =
  | 'generic'
  | 'anthropic'
  | 'gemini'
  | 'azure-openai'
  | 'lm-studio'
  | 'llama-cpp'
  | 'vllm'
  | 'litellm'

export type ProviderWireProtocol = 'openai-chat' | 'anthropic' | 'gemini'

export interface OpenAiProviderProfile {
  id: OpenAiProfileId
  label: string
  description: string
  protocol: ProviderWireProtocol
  defaultEndpoint: string
  supportsFim: boolean
}

export const DEFAULT_OPENAI_ENDPOINT = 'http://localhost:8001/v1'

export const OPENAI_PROVIDER_PROFILES: Readonly<Record<OpenAiProfileId, OpenAiProviderProfile>> = {
  generic: {
    id: 'generic',
    label: 'OpenAI-compatible',
    description: 'OpenAI chat completions or responses API',
    protocol: 'openai-chat',
    defaultEndpoint: DEFAULT_OPENAI_ENDPOINT,
    supportsFim: true
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Anthropic Messages API',
    protocol: 'anthropic',
    defaultEndpoint: 'https://api.anthropic.com',
    supportsFim: false
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    description: 'Google Generative Language API',
    protocol: 'gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    supportsFim: false
  },
  'azure-openai': {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    description: 'Azure OpenAI chat completions API',
    protocol: 'openai-chat',
    defaultEndpoint: '',
    supportsFim: false
  },
  'lm-studio': {
    id: 'lm-studio',
    label: 'LM Studio',
    description: 'LM Studio OpenAI-compatible server',
    protocol: 'openai-chat',
    defaultEndpoint: 'http://localhost:1234/v1',
    supportsFim: false
  },
  'llama-cpp': {
    id: 'llama-cpp',
    label: 'llama.cpp',
    description: 'llama-server OpenAI-compatible endpoint',
    protocol: 'openai-chat',
    defaultEndpoint: 'http://localhost:8080/v1',
    supportsFim: false
  },
  vllm: {
    id: 'vllm',
    label: 'vLLM',
    description: 'vLLM OpenAI-compatible server',
    protocol: 'openai-chat',
    defaultEndpoint: 'http://localhost:8000/v1',
    supportsFim: false
  },
  litellm: {
    id: 'litellm',
    label: 'LiteLLM',
    description: 'LiteLLM proxy OpenAI-compatible endpoint',
    protocol: 'openai-chat',
    defaultEndpoint: 'http://localhost:4000/v1',
    supportsFim: false
  }
}

export function getOpenAiProfile(value: string | undefined): OpenAiProviderProfile {
  if (value && value in OPENAI_PROVIDER_PROFILES) {
    return OPENAI_PROVIDER_PROFILES[value as OpenAiProfileId]
  }
  return OPENAI_PROVIDER_PROFILES.generic
}

export function resolveOpenAiProfileEndpoint(profileId: string | undefined, configuredEndpoint: string): string {
  const profile = getOpenAiProfile(profileId)
  const configured = configuredEndpoint.trim().replace(/\/+$/, '')
  if (configured && configured !== DEFAULT_OPENAI_ENDPOINT.replace(/\/+$/, '')) {
    return configured
  }
  return profile.defaultEndpoint
}

export function isFimCompatibleProfile(profileId: string | undefined): boolean {
  return getOpenAiProfile(profileId).supportsFim
}

export function openAiProfileIds(): OpenAiProfileId[] {
  return Object.keys(OPENAI_PROVIDER_PROFILES) as OpenAiProfileId[]
}
