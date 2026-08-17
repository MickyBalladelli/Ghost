import fetch, { type RequestInit, type Response } from 'node-fetch'
import { TextDecoder } from 'node:util'

import {
  MlxChatOptions,
  MlxMessage,
  MlxMessageContent,
  streamSseTokens
} from './mlxClient'

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

export type OllamaApiMode = 'auto' | 'ollama' | 'openai-compatible'

export interface OllamaChatOptions extends MlxChatOptions {
  systemPrompt?: string
  stream?: boolean
  mode?: OllamaApiMode
  apiKey?: string
}

export interface FimCompletionOptions {
  model: string
  prefix: string
  suffix: string
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  repeatPenalty?: number
  maxTokens?: number
  signal?: AbortSignal
  mode?: OllamaApiMode
  apiKey?: string
}

interface OpenAiModelsResponse {
  data?: Array<{ id?: string }>
}

interface OllamaModelsResponse {
  models?: Array<{ name?: string }>
}

interface OpenAiCompletionResponse {
  choices?: Array<{
    text?: string | null
    message?: { content?: string | null }
  }>
}

interface OllamaCompletionResponse {
  response?: string | null
  message?: { content?: string | null }
}

interface OllamaStreamChunk extends OllamaCompletionResponse {
  done?: boolean
}

type FetchLike = typeof fetch

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function isExplicitOpenAiUrl(baseUrl: string): boolean {
  return normalizeBaseUrl(baseUrl).endsWith('/v1')
}

function getOpenAiBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  return isExplicitOpenAiUrl(normalized) ? normalized : `${normalized}/v1`
}

function getOllamaBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  return isExplicitOpenAiUrl(normalized) ? normalized.slice(0, -3) : normalized
}

function withTimeout(timeoutMs: number): AbortSignal {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true })
  return controller.signal
}

function addSystemPrompt(messages: MlxMessage[], systemPrompt?: string): MlxMessage[] {
  if (!systemPrompt) {
    return messages
  }

  return [{ role: 'system', content: systemPrompt }, ...messages]
}

function dataUrlToBase64(url: string): string | undefined {
  if (!url.startsWith('data:')) {
    return undefined
  }

  const separator = url.indexOf(',')

  if (separator < 0) {
    return undefined
  }

  return url.slice(separator + 1)
}

function textFromContent(content: MlxMessageContent): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('')
}

function imagesFromContent(content: MlxMessageContent): string[] {
  if (typeof content === 'string') {
    return []
  }

  return content
    .filter(part => part.type === 'image_url')
    .flatMap(part => {
      const image = dataUrlToBase64(part.image_url.url)
      return image ? [image] : []
    })
}

function toOllamaMessages(messages: MlxMessage[]): Array<{ role: string; content: string; images?: string[] }> {
  return messages.map(message => {
    const images = imagesFromContent(message.content)
    const nativeMessage: { role: string; content: string; images?: string[] } = {
      role: message.role,
      content: textFromContent(message.content)
    }

    if (images.length > 0) {
      nativeMessage.images = images
    }

    return nativeMessage
  })
}

function isFallbackStatus(status: number): boolean {
  return status === 404 || status === 405
}

async function httpError(response: Response): Promise<Error> {
  const detail = await response.text()
  const suffix = detail ? `: ${detail.slice(0, 300)}` : ''
  return new Error(`Local model server returned ${response.status} ${response.statusText}${suffix}`)
}

function extractOpenAiText(payload: OpenAiCompletionResponse): string {
  const choice = payload.choices?.[0]
  return choice?.text ?? choice?.message?.content ?? ''
}

function extractOllamaText(payload: OllamaCompletionResponse): string {
  return payload.response ?? payload.message?.content ?? ''
}

export async function* streamOllamaJson(body: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffer = ''
  const decoder = new TextDecoder('utf-8', { fatal: true })

  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    try {
      buffer += decoder.decode(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, { stream: true })
    } catch {
      return
    }
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) {
        continue
      }

      let parsed: OllamaStreamChunk

      try {
        parsed = JSON.parse(line) as OllamaStreamChunk
      } catch {
        continue
      }

      const text = extractOllamaText(parsed)

      if (text) {
        yield text
      }

      if (parsed.done) {
        return
      }
    }
  }

  try {
    buffer += decoder.decode()
  } catch {
    return
  }

  if (buffer.trim()) {
    try {
      const text = extractOllamaText(JSON.parse(buffer) as OllamaStreamChunk)

      if (text) {
        yield text
      }
    } catch {
      // The server may close with an incomplete JSON line.
    }
  }
}

export function buildFimPrompt(prefix: string, suffix: string): string {
  return `<PRE>${prefix}<SUF>${suffix}<MID>`
}

export class OllamaClient {
  private readonly baseUrl: string
  private readonly request: FetchLike
  private readonly mode: OllamaApiMode
  private readonly apiKeyProvider?: () => string | undefined

  constructor(baseUrl = DEFAULT_OLLAMA_URL, mode: OllamaApiMode = 'auto', request: FetchLike = fetch, apiKeyProvider?: () => string | undefined) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.mode = mode
    this.request = request
    this.apiKeyProvider = apiKeyProvider
  }

  private authorizationHeaders(apiKey = this.apiKeyProvider?.()): Record<string, string> {
    return apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  }

  async checkHealth(timeoutMs = 3000): Promise<boolean> {
    const endpoints = this.getHealthEndpoints()

    for (const endpoint of endpoints) {
      try {
        const response = await this.request(endpoint, {
          method: 'GET',
          headers: this.authorizationHeaders(),
          signal: withTimeout(timeoutMs)
        })

        if (response.ok) {
          return true
        }
      } catch {
        // Try the next compatible endpoint.
      }
    }

    return false
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    let lastError: Error | undefined

    for (const endpoint of this.getModelEndpoints()) {
      try {
        const response = await this.request(endpoint, { method: 'GET', headers: this.authorizationHeaders(), signal })

        if (!response.ok) {
          lastError = await httpError(response)

          if (isFallbackStatus(response.status)) {
            continue
          }

          throw lastError
        }

        if (endpoint.includes('/api/tags')) {
          const payload = await response.json() as OllamaModelsResponse
          return payload.models?.flatMap(model => model.name ? [model.name] : []) ?? []
        }

        const payload = await response.json() as OpenAiModelsResponse
        return payload.data?.flatMap(model => model.id ? [model.id] : []) ?? []
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }

    throw lastError ?? new Error('No local model server endpoint is available')
  }

  async *streamChatCompletion(options: OllamaChatOptions): AsyncGenerator<string> {
    const messages = addSystemPrompt(options.messages, options.systemPrompt)
    const stream = options.stream ?? true
    const mode = options.mode ?? this.mode
    const attempts = this.getChatAttempts(mode)
    let lastError: Error | undefined

    for (const attempt of attempts) {
      const response = await this.request(attempt.endpoint, this.getChatRequest(attempt.kind, options, messages, stream))

      if (!response.ok) {
        lastError = await httpError(response)

        if (attempts.length > 1 && isFallbackStatus(response.status)) {
          continue
        }

        throw lastError
      }

      if (!stream) {
        const payload = await response.json()
        const text = attempt.kind === 'ollama'
          ? extractOllamaText(payload as OllamaCompletionResponse)
          : extractOpenAiText(payload as OpenAiCompletionResponse)

        if (text) {
          yield text
        }

        return
      }

      if (!response.body) {
        throw new Error('Local model server returned an empty streaming response')
      }

      if (attempt.kind === 'ollama') {
        yield* streamOllamaJson(response.body)
      } else {
        yield* streamSseTokens(response.body)
      }

      return
    }

    throw lastError ?? new Error('No compatible chat endpoint is available')
  }

  async fetchFimCompletion(options: FimCompletionOptions): Promise<string> {
    const prompt = buildFimPrompt(options.prefix, options.suffix)
    const mode = options.mode ?? this.mode
    const attempts = this.getCompletionAttempts(mode)
    let lastError: Error | undefined

    for (const attempt of attempts) {
      const response = await this.request(
        attempt.endpoint,
        this.getCompletionRequest(attempt.kind, options, prompt)
      )

      if (!response.ok) {
        lastError = await httpError(response)

        if (attempts.length > 1 && isFallbackStatus(response.status)) {
          continue
        }

        throw lastError
      }

      const payload = await response.json()
      return attempt.kind === 'ollama'
        ? extractOllamaText(payload as OllamaCompletionResponse)
        : extractOpenAiText(payload as OpenAiCompletionResponse)
    }

    throw lastError ?? new Error('No compatible completion endpoint is available')
  }

  private getHealthEndpoints(): string[] {
    if (this.mode === 'ollama') {
      const baseUrl = getOllamaBaseUrl(this.baseUrl)
      return [`${baseUrl}/api/tags`, baseUrl]
    }

    if (this.mode === 'openai-compatible' || isExplicitOpenAiUrl(this.baseUrl)) {
      return [`${getOpenAiBaseUrl(this.baseUrl)}/models`]
    }

    return [
      `${getOpenAiBaseUrl(this.baseUrl)}/models`,
      `${getOllamaBaseUrl(this.baseUrl)}/api/tags`
    ]
  }

  private getModelEndpoints(): string[] {
    if (this.mode === 'ollama') {
      return [`${getOllamaBaseUrl(this.baseUrl)}/api/tags`]
    }
    return this.getHealthEndpoints()
  }

  private getChatAttempts(mode: OllamaApiMode): Array<{ kind: 'ollama' | 'openai'; endpoint: string }> {
    if (mode === 'ollama') {
      return [{ kind: 'ollama', endpoint: `${getOllamaBaseUrl(this.baseUrl)}/api/chat` }]
    }

    const openAiAttempt = { kind: 'openai' as const, endpoint: `${getOpenAiBaseUrl(this.baseUrl)}/chat/completions` }

    if (mode === 'openai-compatible' || isExplicitOpenAiUrl(this.baseUrl)) {
      return [openAiAttempt]
    }

    return [openAiAttempt, { kind: 'ollama', endpoint: `${getOllamaBaseUrl(this.baseUrl)}/api/chat` }]
  }

  private getChatRequest(
    kind: 'ollama' | 'openai',
    options: OllamaChatOptions,
    messages: MlxMessage[],
    stream: boolean
  ): RequestInit {
    if (kind === 'ollama') {
      return {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.authorizationHeaders(options.apiKey) },
        signal: options.signal,
        body: JSON.stringify({
          model: options.model,
          messages: toOllamaMessages(messages),
          stream,
          options: {
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
            ...(options.topP === undefined ? {} : { top_p: options.topP }),
            ...(options.topK === undefined ? {} : { top_k: options.topK }),
            ...(options.minP === undefined ? {} : { min_p: options.minP }),
            ...(options.presencePenalty === undefined ? {} : { presence_penalty: options.presencePenalty }),
            ...(options.repeatPenalty === undefined ? {} : { repeat_penalty: options.repeatPenalty }),
            ...(options.maxTokens === undefined ? {} : { num_predict: options.maxTokens })
          }
        })
      }
    }

    return {
      method: 'POST',
      headers: {
        accept: stream ? 'text/event-stream' : 'application/json',
        'content-type': 'application/json',
        ...this.authorizationHeaders(options.apiKey)
      },
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        messages,
        stream,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.topP === undefined ? {} : { top_p: options.topP }),
        ...(options.presencePenalty === undefined ? {} : { presence_penalty: options.presencePenalty }),
        ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens })
      })
    }
  }

  private getCompletionAttempts(mode: OllamaApiMode): Array<{ kind: 'ollama' | 'openai'; endpoint: string }> {
    if (mode === 'ollama') {
      return [{ kind: 'ollama', endpoint: `${getOllamaBaseUrl(this.baseUrl)}/api/generate` }]
    }

    const openAiAttempt = { kind: 'openai' as const, endpoint: `${getOpenAiBaseUrl(this.baseUrl)}/completions` }

    if (mode === 'openai-compatible' || isExplicitOpenAiUrl(this.baseUrl)) {
      return [openAiAttempt]
    }

    return [openAiAttempt, { kind: 'ollama', endpoint: `${getOllamaBaseUrl(this.baseUrl)}/api/generate` }]
  }

  private getCompletionRequest(
    kind: 'ollama' | 'openai',
    options: FimCompletionOptions,
    prompt: string
  ): RequestInit {
    if (kind === 'ollama') {
      return {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.authorizationHeaders(options.apiKey) },
        signal: options.signal,
        body: JSON.stringify({
          model: options.model,
          prompt,
          stream: false,
          options: {
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
            ...(options.topP === undefined ? {} : { top_p: options.topP }),
            ...(options.topK === undefined ? {} : { top_k: options.topK }),
            ...(options.minP === undefined ? {} : { min_p: options.minP }),
            ...(options.presencePenalty === undefined ? {} : { presence_penalty: options.presencePenalty }),
            ...(options.repeatPenalty === undefined ? {} : { repeat_penalty: options.repeatPenalty }),
            ...(options.maxTokens === undefined ? {} : { num_predict: options.maxTokens })
          }
        })
      }
    }

    return {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...this.authorizationHeaders(options.apiKey)
      },
      signal: options.signal,
      body: JSON.stringify({
        model: options.model,
        prompt,
        stream: false,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.topP === undefined ? {} : { top_p: options.topP }),
        ...(options.presencePenalty === undefined ? {} : { presence_penalty: options.presencePenalty }),
        ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens })
      })
    }
  }
}

export async function checkHealth(baseUrl = DEFAULT_OLLAMA_URL): Promise<boolean> {
  return new OllamaClient(baseUrl).checkHealth()
}

export async function listModels(baseUrl = DEFAULT_OLLAMA_URL, signal?: AbortSignal): Promise<string[]> {
  return new OllamaClient(baseUrl).listModels(signal)
}

export async function fetchFimCompletion(
  baseUrl: string,
  options: FimCompletionOptions
): Promise<string> {
  return new OllamaClient(baseUrl).fetchFimCompletion(options)
}
