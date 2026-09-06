import { TextDecoder } from 'node:util'

import { nativeFetch } from './nativeFetch'
import type { FetchLike } from './httpTypes'
import type { ChatMessage, ChatRequestOptions } from './chatTypes'
import type { ProviderClient } from './providerAdapter'
import { createKeepAliveAgent, createOpenAiRequestAgent } from './openAiTransport'
import type { OpenAiTransportSettings } from './openAiTransport'
import { joinEndpoint, normalizeEndpoint } from './endpoint'
import { providerHttpError, streamWithTimeout } from './providerRequest'
import { ProviderHttpTransport } from './providerTransport'
import { GHOST_POLICY } from '../ghostPolicy'

interface GeminiModel {
  name?: string
  supportedGenerationMethods?: string[]
}

interface GeminiModelsResponse {
  models?: GeminiModel[]
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}

interface GeminiPart {
  text?: string
  inlineData?: {
    mimeType: string
    data: string
  }
}

function textFromContent(content: ChatMessage['content']): string {
  return typeof content === 'string'
    ? content
    : content.filter(part => part.type === 'text').map(part => part.text).join('')
}

function dataUrlPart(url: string): GeminiPart | undefined {
  const match = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s.exec(url)
  if (!match) return undefined
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2]
    }
  }
}

function partsFromContent(content: ChatMessage['content']): GeminiPart[] {
  if (typeof content === 'string') return [{ text: content }]
  return content.flatMap(part => {
    if (part.type === 'text') return [{ text: part.text }]
    const image = dataUrlPart(part.image_url.url)
    return image ? [image] : []
  })
}

function systemText(messages: ChatMessage[]): string | undefined {
  const value = messages
    .filter(message => message.role === 'system')
    .map(message => textFromContent(message.content))
    .join('\n\n')
    .trim()
  return value || undefined
}

function nonSystemMessages(messages: ChatMessage[]): ChatMessage[] {
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

async function* streamSseJson<T>(body: AsyncIterable<Buffer | string>, parse: (payload: T) => string | undefined): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of body) {
    buffer += decoder.decode(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, { stream: true })
    const parsed = parseDataLines(buffer)
    buffer = parsed.remaining
    for (const data of parsed.data) {
      if (!data) continue
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
    if (!data) continue
    try {
      const text = parse(JSON.parse(data) as T)
      if (text) yield text
    } catch {
      // The provider may close with an incomplete event.
    }
  }
}

function modelId(model: string): string {
  return model.trim().replace(/^models\//, '')
}

export const DEFAULT_GEMINI_URL = 'https://generativelanguage.googleapis.com'

export class GeminiClient implements ProviderClient {
  private readonly baseUrl: string
  private readonly transport: ProviderHttpTransport

  constructor(
    baseUrl = DEFAULT_GEMINI_URL,
    private readonly apiKeyProvider: () => string | undefined,
    transportOrRequest?: OpenAiTransportSettings | FetchLike,
    request: FetchLike = nativeFetch
  ) {
    this.baseUrl = normalizeEndpoint(baseUrl)
    const transport = typeof transportOrRequest === 'function' ? undefined : transportOrRequest
    const fetch = typeof transportOrRequest === 'function' ? transportOrRequest : request
    this.transport = new ProviderHttpTransport(fetch, target => transport ? createOpenAiRequestAgent(target, transport) : createKeepAliveAgent(target))
  }

  dispose(): void {
    this.transport.dispose()
  }

  async checkHealth(timeoutMs = 3000): Promise<boolean> {
    try {
      const response = await this.transport.requestWithDiagnostics(
        joinEndpoint(this.baseUrl, 'v1beta/models'),
        { method: 'GET', headers: this.headers() },
        { timeoutMs }
      )
      return response.ok
    } catch {
      return false
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const endpoint = joinEndpoint(this.baseUrl, 'v1beta/models')
    const response = await this.transport.requestWithDiagnostics(
      endpoint,
      { method: 'GET', headers: this.headers() },
      { signal, timeoutMs: GHOST_POLICY.provider.requestTimeoutMs }
    )
    if (!response.ok) throw await providerHttpError(response)
    const payload = await response.json() as GeminiModelsResponse
    return payload.models?.flatMap(model => {
      if (!model.name || model.supportedGenerationMethods && !model.supportedGenerationMethods.includes('generateContent')) {
        return []
      }
      return [modelId(model.name)]
    }) ?? []
  }

  async *streamChatCompletion(options: ChatRequestOptions): AsyncGenerator<string> {
    const endpoint = joinEndpoint(this.baseUrl, `v1beta/models/${encodeURIComponent(modelId(options.model))}:streamGenerateContent?alt=sse`)
    const generation = options.generation
    const response = await this.transport.requestWithDiagnostics(endpoint, {
      method: 'POST',
      headers: { ...this.headers(), accept: 'text/event-stream', 'content-type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        ...(systemText(options.messages) ? { systemInstruction: { parts: [{ text: systemText(options.messages) }] } } : {}),
        contents: nonSystemMessages(options.messages).map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: partsFromContent(message.content).length > 0 ? partsFromContent(message.content) : [{ text: '' }]
        })),
        generationConfig: {
          ...(generation?.temperature === undefined ? {} : { temperature: generation.temperature }),
          ...(generation?.topP === undefined ? {} : { topP: generation.topP }),
          ...(generation?.topK === undefined ? {} : { topK: generation.topK }),
          ...(generation?.maxTokens === undefined ? {} : { maxOutputTokens: generation.maxTokens }),
          ...(generation?.stop?.length ? { stopSequences: generation.stop } : {}),
          ...(generation?.seed === undefined ? {} : { seed: generation.seed }),
          ...(options.responseFormat?.type === 'json_object' ? { responseMimeType: 'application/json' } : {})
        }
      })
    }, { signal: options.signal, timeoutMs: options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs })
    if (!response.ok) throw await providerHttpError(response)
    if (!response.body) throw new Error('Gemini returned an empty streaming response')
    yield* streamSseJson<GeminiResponse>(
      streamWithTimeout(response.body, options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs),
      payload => payload.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('')
    )
  }

  private headers(): Record<string, string> {
    const apiKey = this.apiKeyProvider()
    return apiKey ? { 'x-goog-api-key': apiKey } : {}
  }
}
