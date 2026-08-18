import type { OpenAiTransportSettings } from './openAiTransport'
import type { GenerationSettings } from './generationSettings'

export type FimProviderMode = 'auto' | 'ollama' | 'openai-compatible'

export interface FimCompletionOptions {
  model: string
  prefix: string
  suffix: string
  generation?: GenerationSettings
  signal?: AbortSignal
  mode?: FimProviderMode
  apiKey?: string
  openAiTransport?: OpenAiTransportSettings
}
