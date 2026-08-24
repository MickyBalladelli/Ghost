import { nativeFetch } from './nativeFetch'
import type { FetchLike, GhostRequestInit } from './httpTypes'
import type { ChatRequestOptions, ChatStreamEvent } from './chatTypes'
import { buildOpenAiChatBody } from './providerRequestBuilders'
import { buildOpenAiAuthenticationHeaders, createOpenAiRequestAgent, OpenAiTransportSettings } from './openAiTransport'
import { joinEndpoint, normalizeEndpoint } from './endpoint'
import { providerHttpError, streamWithTimeout } from './providerRequest'
import { ProviderHttpTransport } from './providerTransport'
import { GHOST_POLICY } from '../ghostPolicy'
import type { ProviderClient, ProviderModelMetadata, ModelPricing } from './providerAdapter'
import { parseOpenAiCompletionPayload, streamOpenAiEvents } from './openAiStream'

export const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1'

export interface OpenRouterRoutingSettings {
  allowFallbacks: boolean
  requireParameters: boolean
  dataCollection: 'allow' | 'deny'
  providerOrder: string[]
}

interface OpenRouterReasoningSettings {
  effort?: string
  enabled?: boolean
}

export interface OpenRouterClientSettings {
  url: string
  referer: string
  title: string
  routing: OpenRouterRoutingSettings
  transport: OpenAiTransportSettings
}

interface OpenRouterModelRecord {
  id?: string
  name?: string
  context_length?: number
  max_completion_tokens?: number
  architecture?: {
    modality?: string
    input_modalities?: string[]
    output_modalities?: string[]
  }
  pricing?: {
    prompt?: string | number
    completion?: string | number
    cache_read?: string | number
    cache_write?: string | number
  }
  top_provider?: {
    context_length?: number
    max_completion_tokens?: number
  }
  supported_parameters?: string[]
  reasoning?: {
    supported_efforts?: string[] | null
    default_effort?: string
    default_enabled?: boolean
    mandatory?: boolean
    supports_max_tokens?: boolean
  }
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModelRecord[]
}

const finitePositive = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

const tokenPrice = (value: unknown): number | undefined => {
  const price = finitePositive(value)
  return price === undefined ? undefined : price * 1_000_000
}

const supported = (parameters: Set<string>, ...names: string[]): boolean => names.some(name => parameters.has(name))

const modelPricing = (value: OpenRouterModelRecord['pricing']): { pricing?: ModelPricing; pricingStatus: 'free' | 'paid' | 'unknown' } => {
  const input = tokenPrice(value?.prompt)
  const output = tokenPrice(value?.completion)
  const cacheRead = tokenPrice(value?.cache_read)
  const cacheWrite = tokenPrice(value?.cache_write)
  const values = [input, output, cacheRead, cacheWrite].filter((item): item is number => item !== undefined)
  if (values.length === 0) return { pricingStatus: 'unknown' }
  return {
    pricing: {
      ...(input === undefined ? {} : { input }),
      ...(output === undefined ? {} : { output }),
      ...(cacheRead === undefined ? {} : { cacheRead }),
      ...(cacheWrite === undefined ? {} : { cacheWrite })
    },
    pricingStatus: values.some(item => item > 0) ? 'paid' : 'free'
  }
}

export function parseOpenRouterModels(payload: unknown): ProviderModelMetadata[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const data = (payload as OpenRouterModelsResponse).data
  if (!Array.isArray(data)) return []
  return data.flatMap(model => {
    const id = typeof model.id === 'string' ? model.id.trim() : ''
    if (!id) return []
    const parameters = new Set((model.supported_parameters ?? []).filter(item => typeof item === 'string').map(item => item.toLowerCase()))
    const inputModalities = model.architecture?.input_modalities ?? []
    const modality = model.architecture?.modality ?? ''
    const pricing = modelPricing(model.pricing)
    const contextWindow = finitePositive(model.context_length) ?? finitePositive(model.top_provider?.context_length)
    const outputLimit = finitePositive(model.max_completion_tokens) ?? finitePositive(model.top_provider?.max_completion_tokens)
    return [{
      id,
      ...(typeof model.name === 'string' && model.name.trim() ? { displayName: model.name.trim() } : {}),
      ...(contextWindow === undefined ? {} : { contextWindow: Math.floor(contextWindow) }),
      ...(outputLimit === undefined ? {} : { outputLimit: Math.floor(outputLimit) }),
      supportsTools: supported(parameters, 'tools', 'tool_choice'),
      supportsJsonMode: supported(parameters, 'response_format', 'structured_outputs'),
      supportsVision: inputModalities.some(item => item.toLowerCase() === 'image') || /image|vision/i.test(modality),
      supportsFIM: false,
      supportsStreaming: true,
      supportsSampling: {
        temperature: supported(parameters, 'temperature'),
        topP: supported(parameters, 'top_p'),
        topK: supported(parameters, 'top_k'),
        minP: supported(parameters, 'min_p'),
        presencePenalty: supported(parameters, 'presence_penalty'),
        repeatPenalty: supported(parameters, 'repetition_penalty', 'repeat_penalty')
      },
      pricing: pricing.pricing,
      pricingStatus: pricing.pricingStatus,
      ...(model.reasoning && typeof model.reasoning === 'object' ? {
        reasoning: {
          ...(Array.isArray(model.reasoning.supported_efforts) ? { supportedEfforts: model.reasoning.supported_efforts.filter(item => typeof item === 'string') } : {}),
          ...(typeof model.reasoning.default_effort === 'string' ? { defaultEffort: model.reasoning.default_effort } : {}),
          ...(typeof model.reasoning.default_enabled === 'boolean' ? { defaultEnabled: model.reasoning.default_enabled } : {}),
          ...(typeof model.reasoning.mandatory === 'boolean' ? { mandatory: model.reasoning.mandatory } : {}),
          ...(typeof model.reasoning.supports_max_tokens === 'boolean' ? { supportsMaxTokens: model.reasoning.supports_max_tokens } : {})
        }
      } : {})
    }]
  })
}

export function normalizeOpenRouterProviderOrder(values: readonly unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)))]
}

export function buildOpenRouterChatBody(options: ChatRequestOptions, routing: OpenRouterRoutingSettings, outputLimit?: number, reasoning?: OpenRouterReasoningSettings): Record<string, unknown> {
  const maxTokens = options.generation?.maxTokens
  const boundedMaxTokens = outputLimit === undefined || maxTokens === undefined
    ? maxTokens
    : Math.min(maxTokens, outputLimit)
  const body = buildOpenAiChatBody({
    ...options,
    generation: {
      ...options.generation,
      ...(boundedMaxTokens === undefined ? {} : { maxTokens: boundedMaxTokens })
    }
  }, options.messages, true)
  const providerOrder = normalizeOpenRouterProviderOrder(routing.providerOrder)
  const provider = {
    allow_fallbacks: routing.allowFallbacks,
    require_parameters: routing.requireParameters,
    data_collection: routing.dataCollection === 'deny' ? 'deny' : 'allow',
    ...(providerOrder.length > 0 ? { order: providerOrder } : {})
  }
  return { ...body, ...(reasoning ? { reasoning } : {}), provider }
}

function mandatoryReasoningSettings(metadata: ProviderModelMetadata | undefined): OpenRouterReasoningSettings | undefined {
  if (metadata?.reasoning?.mandatory !== true) return undefined
  const supportedEfforts = metadata.reasoning.supportedEfforts ?? []
  if (supportedEfforts.includes('low')) return { effort: 'low' }
  if (metadata.reasoning.defaultEffort) return { effort: metadata.reasoning.defaultEffort }
  return { enabled: true }
}

export class OpenRouterClient implements ProviderClient {
  private readonly baseUrl: string
  private readonly transport: ProviderHttpTransport
  private readonly metadata = new Map<string, ProviderModelMetadata>()

  constructor(
    private readonly settings: OpenRouterClientSettings,
    private readonly apiKeyProvider: () => string | undefined,
    private readonly request: FetchLike = nativeFetch
  ) {
    this.baseUrl = normalizeEndpoint(settings.url || DEFAULT_OPENROUTER_URL)
    this.transport = new ProviderHttpTransport(request, endpoint => createOpenAiRequestAgent(endpoint, settings.transport))
  }

  dispose(): void {
    this.transport.dispose()
    this.metadata.clear()
  }

  async checkHealth(timeoutMs = 3000): Promise<boolean> {
    try {
      const endpoint = joinEndpoint(this.baseUrl, 'models')
      const response = await this.transport.requestWithDiagnostics(endpoint, this.requestInit(endpoint, { method: 'GET' }), { timeoutMs })
      return response.ok
    } catch {
      return false
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const models = await this.listModelsWithMetadata(signal)
    return models.map(model => model.id)
  }

  async listModelsWithMetadata(signal?: AbortSignal): Promise<ProviderModelMetadata[]> {
    const endpoint = joinEndpoint(this.baseUrl, 'models')
    const response = await this.transport.requestWithDiagnostics(endpoint, this.requestInit(endpoint, { method: 'GET' }), {
      signal,
      timeoutMs: GHOST_POLICY.provider.requestTimeoutMs
    })
    if (!response.ok) throw await providerHttpError(response)
    const models = parseOpenRouterModels(await response.json())
    this.metadata.clear()
    for (const model of models) this.metadata.set(model.id, model)
    return models
  }

  async modelSupportsTools(model: string, signal?: AbortSignal): Promise<boolean> {
    if (!this.metadata.has(model)) {
      try {
        await this.listModelsWithMetadata(signal)
      } catch {
        return false
      }
    }
    return this.metadata.get(model)?.supportsTools === true
  }

  async *streamChatCompletion(options: ChatRequestOptions): AsyncGenerator<string> {
    for await (const event of this.streamChatEvents(options)) {
      if (event.type === 'text') yield event.text
      else if (event.name) yield `{"tool":${JSON.stringify(event.name)},"arguments":${event.arguments?.trim() || '{}'}}`
    }
  }

  async *streamChatEvents(options: ChatRequestOptions): AsyncGenerator<ChatStreamEvent> {
    const endpoint = joinEndpoint(this.baseUrl, 'chat/completions')
    const metadata = this.metadata.get(options.model)
    const body = buildOpenRouterChatBody(options, this.settings.routing, metadata?.outputLimit, mandatoryReasoningSettings(metadata))
    const response = await this.transport.requestWithDiagnostics(endpoint, this.requestInit(endpoint, {
      method: 'POST',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }), { signal: options.signal, timeoutMs: options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs })
    if (!response.ok) throw await providerHttpError(response)
    if (!response.body) throw new Error('OpenRouter returned an empty streaming response')
    let emitted = false
    for await (const event of streamOpenAiEvents(streamWithTimeout(response.body, options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs), 'chat-completions')) {
      emitted = true
      yield event
    }
    if (emitted) return

    const fallbackResponse = await this.transport.requestWithDiagnostics(endpoint, this.requestInit(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, stream: false })
    }), { signal: options.signal, timeoutMs: options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs })
    if (!fallbackResponse.ok) throw await providerHttpError(fallbackResponse)
    const events = parseOpenAiCompletionPayload(await fallbackResponse.json())
    if (events.length === 0) throw new Error('OpenRouter returned no text or tool call in its completion response')
    for (const event of events) yield event
  }

  private requestInit(endpoint: string, init: GhostRequestInit): GhostRequestInit {
    const apiKey = this.apiKeyProvider()?.trim()
    if (!apiKey) {
      throw new Error('OpenRouter API key is not configured. Select OpenRouter and run “Ghost: Set Provider API Key”.')
    }
    const referer = this.settings.referer.trim()
    const title = this.settings.title.trim()
    return {
      ...init,
      headers: {
        ...buildOpenAiAuthenticationHeaders(apiKey, {
          apiKeyHeader: 'Authorization',
          apiKeyPrefix: 'Bearer',
          organizationHeader: '',
          organization: '',
          projectHeader: '',
          project: ''
        }),
        ...(referer && !/[\r\n]/.test(referer) ? { 'HTTP-Referer': referer } : {}),
        ...(title && !/[\r\n]/.test(title) ? { 'X-OpenRouter-Title': title } : {}),
        ...init.headers
      },
      agent: createOpenAiRequestAgent(endpoint, this.settings.transport)
    }
  }
}
