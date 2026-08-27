import { nativeFetch } from './nativeFetch'
import type { FetchLike, GhostRequestInit } from './httpTypes'
import type { ChatRequestOptions, ChatStreamEvent } from './chatTypes'
import { buildOpenAiChatBody } from './providerRequestBuilders'
import { buildOpenAiAuthenticationHeaders, createOpenAiRequestAgent, OpenAiTransportSettings } from './openAiTransport'
import { joinEndpoint, normalizeEndpoint } from './endpoint'
import { ProviderHttpError, providerHttpError, streamWithTimeout } from './providerRequest'
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
  max_tokens?: number
  enabled?: boolean
  exclude?: boolean
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

const isOxAlpha = (model: string): boolean => /^(?:openrouter\/)?stealth\/ox-alpha$/i.test(model.trim())
const OX_ALPHA_MIN_COMPLETION_TOKENS = 8192
const MAX_PROVIDER_RECOVERY_ATTEMPTS = 3

function normalizeOpenRouterApiKey(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
}

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

export function buildOpenRouterChatBody(
  options: ChatRequestOptions,
  routing: OpenRouterRoutingSettings,
  outputLimit?: number,
  reasoning?: OpenRouterReasoningSettings,
  sampling?: ProviderModelMetadata['supportsSampling']
): Record<string, unknown> {
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
  if (sampling?.temperature === false) delete body.temperature
  if (sampling?.topP === false) delete body.top_p
  if (sampling?.presencePenalty === false) delete body.presence_penalty
  const providerOrder = normalizeOpenRouterProviderOrder(routing.providerOrder)
  const provider = {
    allow_fallbacks: routing.allowFallbacks,
    require_parameters: routing.requireParameters,
    data_collection: routing.dataCollection === 'deny' ? 'deny' : 'allow',
    ...(providerOrder.length > 0 ? { order: providerOrder } : {})
  }
  return { ...body, ...(reasoning ? { reasoning } : {}), provider }
}

function mandatoryReasoningSettings(metadata: ProviderModelMetadata | undefined, maxTokens?: number): OpenRouterReasoningSettings | undefined {
  if (metadata?.reasoning?.mandatory !== true) return undefined
  if (metadata.reasoning.supportsMaxTokens === true) {
    const completionTokens = maxTokens === undefined ? 2048 : Math.max(1024, Math.floor(maxTokens))
    return {
      max_tokens: Math.max(1024, Math.floor(completionTokens / 2))
    }
  }
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
        return isOxAlpha(model)
      }
    }
    return this.metadata.get(model)?.supportsTools === true || isOxAlpha(model)
  }

  async *streamChatCompletion(options: ChatRequestOptions): AsyncGenerator<string> {
    for await (const event of this.streamChatEvents(options)) {
      if (event.type === 'text') yield event.text
      else if (event.type === 'tool-call' && event.name) yield `{"tool":${JSON.stringify(event.name)},"arguments":${event.arguments?.trim() || '{}'}}`
    }
  }

  async *streamChatEvents(options: ChatRequestOptions): AsyncGenerator<ChatStreamEvent> {
    const endpoint = joinEndpoint(this.baseUrl, 'chat/completions')
    const metadata = this.metadata.get(options.model)
    const maxTokens = options.generation?.maxTokens
    const reasoning = isOxAlpha(options.model)
      ? { effort: 'low' }
      : mandatoryReasoningSettings(metadata, maxTokens)
    const body = buildOpenRouterChatBody(options, this.settings.routing, metadata?.outputLimit, reasoning, metadata?.supportsSampling)
    if (isOxAlpha(options.model) && typeof body.max_tokens === 'number') {
      body.max_tokens = Math.max(body.max_tokens, OX_ALPHA_MIN_COMPLETION_TOKENS)
    }
    const response = await this.requestChatCompletion(endpoint, {
      method: 'POST',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
    }, body, options.signal, options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs, options.model)
    if (!response.body) throw new Error('OpenRouter returned an empty streaming response')
    let emittedContent = false
    for await (const event of streamOpenAiEvents(streamWithTimeout(response.body, options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs), 'chat-completions')) {
      if (event.type === 'text' && event.text.trim()) {
        emittedContent = true
      } else if (event.type === 'tool-call' && event.name && event.arguments?.trim()) {
        emittedContent = true
      }
      yield event
    }
    if (emittedContent) return

    const fallbackBody = {
      ...body,
      stream: false,
      ...(body.tool_choice === 'required' ? { tool_choice: 'auto' } : {})
    }
    const fallbackResponse = await this.requestChatCompletion(endpoint, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
    }, fallbackBody, options.signal, options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs, options.model)
    const events = parseOpenAiCompletionPayload(await fallbackResponse.json())
    for (const event of events) yield event
  }

  private async requestChatCompletion(
    endpoint: string,
    init: GhostRequestInit,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    model: string
  ): Promise<Response> {
    let requestBody = body
    const ignoredProviders: string[] = []

    for (let attempt = 1; attempt <= MAX_PROVIDER_RECOVERY_ATTEMPTS; attempt += 1) {
      const response = await this.transport.requestWithDiagnostics(endpoint, this.requestInit(endpoint, {
        ...init,
        body: JSON.stringify(requestBody)
      }), { signal, timeoutMs })
      if (response.ok) return response

      const error = await providerHttpError(response)
      if (error.status === 404) {
        const detail = error.message.replace(/^Provider returned HTTP 404:\s*/i, '')
        if (error.providerMessage) {
          const provider = error.providerName ? ` "${error.providerName}"` : ''
          throw new ProviderHttpError(
            `OpenRouter provider${provider} failed: ${error.providerMessage}`,
            error.status,
            error.retryAfterMs,
            {
              errorType: error.errorType,
              providerCode: error.providerCode,
              providerName: error.providerName,
              providerSlug: error.providerSlug,
              providerMessage: error.providerMessage
            },
          )
        }
        throw new ProviderHttpError(
          `OpenRouter could not use model "${model}" (HTTP 404): ${detail}`,
          error.status,
          error.retryAfterMs,
          {
            errorType: error.errorType,
            providerCode: error.providerCode,
            providerName: error.providerName,
            providerSlug: error.providerSlug,
            providerMessage: error.providerMessage
          },
        )
      }
      const canSkipProvider = this.settings.routing.allowFallbacks
        && error.status === 429
        && Boolean(error.providerSlug)
        && !ignoredProviders.includes(error.providerSlug as string)
        && attempt < MAX_PROVIDER_RECOVERY_ATTEMPTS
      if (!canSkipProvider) throw error

      ignoredProviders.push(error.providerSlug as string)
      const provider = requestBody.provider
      if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw error
      const providerRecord = provider as Record<string, unknown>
      const existingIgnored = Array.isArray(providerRecord.ignore)
        ? providerRecord.ignore.filter((value): value is string => typeof value === 'string')
        : []
      requestBody = {
        ...requestBody,
        provider: {
          ...providerRecord,
          ignore: [...new Set([...existingIgnored, ...ignoredProviders])]
        }
      }
    }

    throw new ProviderHttpError('OpenRouter provider recovery failed', 429)
  }

  private requestInit(endpoint: string, init: GhostRequestInit): GhostRequestInit {
    const apiKey = normalizeOpenRouterApiKey(this.apiKeyProvider())
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
