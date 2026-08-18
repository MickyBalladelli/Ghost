import fetch, { type Response } from 'node-fetch'

import type { GhostSettings } from '../config'
import { buildOpenAiChatBody } from './providerRequestBuilders'
import { MlxChatOptions, MlxMessage } from './mlxClient'
import { OllamaClient } from './ollamaClient'
import { createOpenAiRequestAgent, OpenAiTransportSettings } from './openAiTransport'
import { getOpenAiProfile, OpenAiProfileId, ProviderWireProtocol, resolveOpenAiProfileEndpoint } from './providerProfiles'
import { ProviderClient } from './providerAdapter'
import { streamOpenAiTokens } from './openAiStream'

type FetchLike = typeof fetch

interface ModelsResponse {
  data?: Array<{ id?: string }>
  models?: Array<{ name?: string; displayName?: string }>
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
  }>
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

function withTimeout(timeoutMs: number): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  return controller.signal
}

async function httpError(response: Response): Promise<Error> {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 1000)
  } catch {
    detail = ''
  }
  return new Error(`Provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
}

function textFromContent(content: MlxMessage['content']): string {
  return typeof content === 'string'
    ? content
    : content.filter(part => part.type === 'text').map(part => part.text).join('')
}

function systemText(messages: MlxMessage[]): string | undefined {
  const value = messages.filter(message => message.role === 'system').map(message => textFromContent(message.content)).join('\n\n').trim()
  return value || undefined
}

function nonSystemMessages(messages: MlxMessage[]): MlxMessage[] {
  return messages.filter(message => message.role !== 'system')
}

function parseDataLines(buffer: string): { data: string[]; remaining: string } {
  const lines = buffer.split(/\r?\n/)
  const remaining = lines.pop() ?? ''
  return {
    data: lines.flatMap(line => line.startsWith('data:') ? [line.slice(5).trim()] : []),
    remaining
  }
}

async function* streamSseJson<T>(body: NodeJS.ReadableStream, parse: (payload: T) => string | undefined): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const parsed = parseDataLines(buffer)
    buffer = parsed.remaining
    for (const data of parsed.data) {
      if (!data || data === '[DONE]') continue
      try {
        const text = parse(JSON.parse(data) as T)
        if (text) yield text
      } catch {
        // Ignore keep-alive and incomplete provider events.
      }
    }
  }

  buffer += decoder.decode()
  const parsed = parseDataLines(`${buffer}\n`)
  for (const data of parsed.data) {
    if (!data || data === '[DONE]') continue
    try {
      const text = parse(JSON.parse(data) as T)
      if (text) yield text
    } catch {
      // The provider may close with an incomplete event.
    }
  }
}

function generation(options: MlxChatOptions): { temperature?: number; topP?: number; maxTokens: number } {
  return {
    temperature: options.generation?.temperature,
    topP: options.generation?.topP,
    maxTokens: options.generation?.maxTokens ?? 8192
  }
}

function openAiTransport(settings: GhostSettings): OpenAiTransportSettings {
  return {
    apiKeyHeader: settings.openaiApiKeyHeader,
    apiKeyPrefix: settings.openaiApiKeyPrefix,
    organizationHeader: settings.openaiOrganizationHeader,
    organization: settings.openaiOrganization,
    projectHeader: settings.openaiProjectHeader,
    project: settings.openaiProject,
    proxy: settings.openaiProxy,
    noProxy: settings.openaiNoProxy,
    tlsRejectUnauthorized: settings.openaiTlsRejectUnauthorized,
    tlsCaFile: settings.openaiTlsCaFile,
    tlsCertFile: settings.openaiTlsCertFile,
    tlsKeyFile: settings.openaiTlsKeyFile
  }
}

class AnthropicClient implements ProviderClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKeyProvider: () => string | undefined,
    private readonly transport: OpenAiTransportSettings,
    private readonly request: FetchLike = fetch
  ) {}

  async checkHealth(timeoutMs = 3000): Promise<boolean> {
    try {
      const response = await this.request(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: this.headers(),
        signal: withTimeout(timeoutMs),
        agent: createOpenAiRequestAgent(`${this.baseUrl}/v1/models`, this.transport)
      })
      return response.ok
    } catch {
      return false
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const endpoint = `${this.baseUrl}/v1/models`
    const response = await this.request(endpoint, {
      method: 'GET',
      headers: this.headers(),
      signal,
      agent: createOpenAiRequestAgent(endpoint, this.transport)
    })
    if (!response.ok) throw await httpError(response)
    const payload = await response.json() as ModelsResponse
    return payload.data?.flatMap(model => model.id ? [model.id] : []) ?? []
  }

  async *streamChatCompletion(options: MlxChatOptions): AsyncGenerator<string> {
    const endpoint = `${this.baseUrl}/v1/messages`
    const settings = generation(options)
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: { ...this.headers(), accept: 'text/event-stream', 'content-type': 'application/json' },
      signal: options.signal,
      agent: createOpenAiRequestAgent(endpoint, this.transport),
      body: JSON.stringify({
        model: options.model,
        system: systemText(options.messages),
        messages: nonSystemMessages(options.messages).map(message => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: textFromContent(message.content)
        })),
        ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
        ...(settings.topP === undefined ? {} : { top_p: settings.topP }),
        max_tokens: settings.maxTokens,
        stream: true
      })
    })
    if (!response.ok) throw await httpError(response)
    if (!response.body) throw new Error('Anthropic returned an empty streaming response')
    yield* streamSseJson<AnthropicResponse>(response.body, payload => payload.content?.find(item => item.type === 'text')?.text)
  }

  private headers(): Record<string, string> {
    const apiKey = this.apiKeyProvider()
    return {
      'anthropic-version': '2023-06-01',
      ...(apiKey ? { 'x-api-key': apiKey } : {})
    }
  }
}

class GeminiClient implements ProviderClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKeyProvider: () => string | undefined,
    private readonly transport: OpenAiTransportSettings,
    private readonly request: FetchLike = fetch
  ) {}

  async checkHealth(timeoutMs = 3000): Promise<boolean> {
    try {
      const response = await this.request(`${this.baseUrl}/v1beta/models`, {
        method: 'GET',
        headers: this.headers(),
        signal: withTimeout(timeoutMs),
        agent: createOpenAiRequestAgent(`${this.baseUrl}/v1beta/models`, this.transport)
      })
      return response.ok
    } catch {
      return false
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const endpoint = `${this.baseUrl}/v1beta/models`
    const response = await this.request(endpoint, {
      method: 'GET',
      headers: this.headers(),
      signal,
      agent: createOpenAiRequestAgent(endpoint, this.transport)
    })
    if (!response.ok) throw await httpError(response)
    const payload = await response.json() as ModelsResponse
    return payload.models?.flatMap(model => model.name ? [model.name.replace(/^models\//, '')] : []) ?? []
  }

  async *streamChatCompletion(options: MlxChatOptions): AsyncGenerator<string> {
    const endpoint = `${this.baseUrl}/v1beta/models/${encodeURIComponent(options.model)}:streamGenerateContent?alt=sse`
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: { ...this.headers(), accept: 'text/event-stream', 'content-type': 'application/json' },
      signal: options.signal,
      agent: createOpenAiRequestAgent(endpoint, this.transport),
      body: JSON.stringify({
        systemInstruction: systemText(options.messages) ? { parts: [{ text: systemText(options.messages) }] } : undefined,
        contents: nonSystemMessages(options.messages).map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: textFromContent(message.content) }]
        })),
        generationConfig: {
          temperature: generation(options).temperature,
          topP: generation(options).topP,
          maxOutputTokens: generation(options).maxTokens
        }
      })
    })
    if (!response.ok) throw await httpError(response)
    if (!response.body) throw new Error('Gemini returned an empty streaming response')
    yield* streamSseJson<GeminiResponse>(response.body, payload => payload.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join(''))
  }

  private headers(): Record<string, string> {
    const apiKey = this.apiKeyProvider()
    return apiKey ? { 'x-goog-api-key': apiKey } : {}
  }
}

class AzureOpenAiClient implements ProviderClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiVersion: string,
    private readonly apiKeyProvider: () => string | undefined,
    private readonly settings: GhostSettings,
    private readonly request: FetchLike = fetch
  ) {}

  async checkHealth(timeoutMs = 3000): Promise<boolean> {
    const endpoint = `${this.baseUrl}/openai/models?api-version=${encodeURIComponent(this.apiVersion)}`
    try {
      const response = await this.request(endpoint, {
        method: 'GET',
        headers: this.headers(),
        signal: withTimeout(timeoutMs),
        agent: createOpenAiRequestAgent(endpoint, openAiTransport(this.settings))
      })
      return response.ok || response.status === 401 || response.status === 403
    } catch {
      return false
    }
  }

  async listModels(): Promise<string[]> {
    return []
  }

  async *streamChatCompletion(options: MlxChatOptions): AsyncGenerator<string> {
    const endpoint = `${this.baseUrl}/openai/deployments/${encodeURIComponent(options.model)}/chat/completions?api-version=${encodeURIComponent(this.apiVersion)}`
    const response = await this.request(endpoint, {
      method: 'POST',
      headers: { ...this.headers(), accept: 'text/event-stream', 'content-type': 'application/json' },
      signal: options.signal,
      agent: createOpenAiRequestAgent(endpoint, openAiTransport(this.settings)),
      body: JSON.stringify(buildOpenAiChatBody(options, options.messages, true))
    })
    if (!response.ok) throw await httpError(response)
    if (!response.body) throw new Error('Azure OpenAI returned an empty streaming response')
    yield* streamOpenAiTokens(response.body, 'chat-completions')
  }

  private headers(): Record<string, string> {
    const apiKey = this.apiKeyProvider()
    return apiKey ? { 'api-key': apiKey } : {}
  }
}

export function createProfiledProviderClient(
  settings: GhostSettings,
  apiKeyProvider: () => string | undefined
): ProviderClient {
  const profile = getOpenAiProfile(settings.openaiProfile)
  const endpoint = normalizeEndpoint(resolveOpenAiProfileEndpoint(settings.openaiProfile, settings.openaiUrl))
  if (!endpoint) {
    throw new Error('Azure OpenAI needs a resource endpoint in Ghost provider settings')
  }

  if (profile.protocol === 'openai-chat' && profile.id !== 'azure-openai') {
    return new OllamaClient(
      endpoint,
      'openai-compatible',
      undefined,
      apiKeyProvider,
      openAiTransport(settings)
    )
  }
  if (profile.protocol === 'anthropic') {
    return new AnthropicClient(endpoint, apiKeyProvider, openAiTransport(settings))
  }
  if (profile.protocol === 'gemini') {
    return new GeminiClient(endpoint, apiKeyProvider, openAiTransport(settings))
  }
  return new AzureOpenAiClient(endpoint, settings.openaiApiVersion, apiKeyProvider, settings)
}

export function profileProtocol(profileId: OpenAiProfileId | undefined): ProviderWireProtocol {
  return getOpenAiProfile(profileId).protocol
}
