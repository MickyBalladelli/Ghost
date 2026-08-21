import { nativeFetch } from './nativeFetch'
import type { FetchLike, GhostRequestInit } from './httpTypes'
import { TextDecoder } from 'node:util'

import { ChatMessage, ChatRequestOptions, ChatStreamEvent } from './chatTypes'
import { GenerationSettings } from './generationSettings'
import {
  buildOllamaChatBody,
  buildOllamaFimBody,
  buildOpenAiChatBody,
  buildOpenAiFimBody,
  buildOpenAiResponsesBody
} from './providerRequestBuilders'
import { OpenAiStreamMode, streamOpenAiEvents } from './openAiStream'
import { buildOpenAiAuthenticationHeaders, createKeepAliveAgent, createOpenAiRequestAgent, OpenAiTransportSettings } from './openAiTransport'
import { hasEndpointSuffix, joinEndpoint, normalizeEndpoint, removeEndpointSuffix } from './endpoint'
import { providerHttpError, streamWithTimeout } from './providerRequest'
import { ProviderHttpTransport } from './providerTransport'
import type { FimCompletionOptions } from './fim'
import { GHOST_POLICY } from '../ghostPolicy'
import { ollamaModelReportsTools } from './ollamaToolMetadata'

export type { FimCompletionOptions } from './fim'

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

export type OllamaApiMode = 'auto' | 'ollama' | 'openai-compatible'
export type OpenAiApiMode = 'auto' | 'chat-completions' | 'responses'

export interface OllamaChatOptions extends ChatRequestOptions {
  systemPrompt?: string
  stream?: boolean
  mode?: OllamaApiMode
  openAiMode?: OpenAiApiMode
  apiKey?: string
  openAiTransport?: OpenAiTransportSettings
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
    message?: {
      content?: string | null
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
    }
  }>
}

interface OpenAiResponsesResponse {
  output_text?: string
  output?: Array<{
    type?: string
    name?: string
    arguments?: string
    content?: Array<{ type?: string; text?: string }>
  }>
}

interface OllamaCompletionResponse {
  response?: string | null
  text?: string | null
  content?: string | null
  message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string | Record<string, unknown> } }> } | string
}

interface OllamaStreamChunk extends OllamaCompletionResponse {
  done?: boolean
}

function normalizeBaseUrl(baseUrl: string): string {
  return normalizeEndpoint(baseUrl)
}

function isExplicitOpenAiUrl(baseUrl: string): boolean {
  return hasEndpointSuffix(baseUrl, 'v1')
}

function getOpenAiBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  return isExplicitOpenAiUrl(normalized) ? normalized : joinEndpoint(normalized, 'v1')
}

function getOllamaBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  return isExplicitOpenAiUrl(normalized) ? removeEndpointSuffix(normalized, 'v1') : normalized
}

function addSystemPrompt(messages: ChatMessage[], systemPrompt?: string): ChatMessage[] {
  if (!systemPrompt) {
    return messages
  }

  return [{ role: 'system', content: systemPrompt }, ...messages]
}

function isFallbackStatus(status: number): boolean {
  return status === 404 || status === 405
}

async function httpError(response: Response): Promise<Error> {
  return providerHttpError(response)
}

function extractOpenAiText(payload: OpenAiCompletionResponse): string {
  const choice = payload.choices?.[0]
  const tool = choice?.message?.tool_calls?.[0]?.function
  if (tool?.name) {
    return `{"tool":${JSON.stringify(tool.name)},"arguments":${tool.arguments?.trim() || '{}'}}`
  }
  return choice?.text ?? choice?.message?.content ?? ''
}

function extractOpenAiResponsesText(payload: OpenAiResponsesResponse): string {
  const functionCall = payload.output?.find(item => item.type === 'function_call')
  if (functionCall?.name) {
    return `{"tool":${JSON.stringify(functionCall.name)},"arguments":${functionCall.arguments?.trim() || '{}'}}`
  }
  if (payload.output_text) return payload.output_text
  return payload.output?.flatMap(item => item.content ?? []).find(item => item.type === 'output_text')?.text ?? ''
}

function extractOllamaText(payload: OllamaCompletionResponse): string {
  if (typeof payload.response === 'string') return payload.response
  if (typeof payload.text === 'string') return payload.text
  if (typeof payload.content === 'string') return payload.content
  return typeof payload.message === 'string' ? payload.message : payload.message?.content ?? ''
}

function extractOllamaToolCall(payload: OllamaCompletionResponse): ChatStreamEvent | undefined {
  if (!payload.message || typeof payload.message === 'string') return undefined
  const tool = payload.message.tool_calls?.[0]?.function
  if (!tool?.name) return undefined
  return {
    type: 'tool-call',
    name: tool.name,
    arguments: typeof tool.arguments === 'string' ? tool.arguments : JSON.stringify(tool.arguments ?? {}),
    done: payload.message.tool_calls !== undefined
  }
}

export async function* streamOllamaEvents(body: AsyncIterable<Buffer | string>): AsyncGenerator<ChatStreamEvent> {
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
      if (!line.trim()) continue
      let parsed: OllamaStreamChunk
      try {
        parsed = JSON.parse(line) as OllamaStreamChunk
      } catch {
        continue
      }
      const toolCall = extractOllamaToolCall(parsed)
      if (toolCall) {
        yield toolCall
      } else {
        const text = extractOllamaText(parsed)
        if (text) yield { type: 'text', text }
      }
      if (parsed.done) return
    }
  }

  try {
    buffer += decoder.decode()
  } catch {
    return
  }
  if (!buffer.trim()) return
  try {
    const parsed = JSON.parse(buffer) as OllamaStreamChunk
    const toolCall = extractOllamaToolCall(parsed)
    if (toolCall) yield toolCall
    else {
      const text = extractOllamaText(parsed)
      if (text) yield { type: 'text', text }
    }
  } catch {
    // The server may close with an incomplete JSON line.
  }
}

export async function* streamOllamaJson(body: AsyncIterable<Buffer | string>): AsyncGenerator<string> {
  let toolName = ''
  let toolOpen = false
  for await (const event of streamOllamaEvents(body)) {
    if (event.type === 'text') {
      yield event.text
      continue
    }
    if (event.name) toolName = event.name
    if (!toolOpen && toolName) {
      yield `{"tool":${JSON.stringify(toolName)},"arguments":`
      toolOpen = true
    }
    if (event.arguments) yield event.arguments
    if (event.done && toolOpen) {
      yield '}'
      toolOpen = false
    }
  }
  if (toolOpen) yield '}'
}

export function buildFimPrompt(prefix: string, suffix: string): string {
  return `<PRE>${prefix}<SUF>${suffix}<MID>`
}

export class OllamaClient {
  private readonly baseUrl: string
  private readonly transport: ProviderHttpTransport
  private readonly mode: OllamaApiMode
  private readonly apiKeyProvider?: () => string | undefined
  private readonly openAiTransport?: OpenAiTransportSettings
  private readonly toolSupportCache = new Map<string, boolean>()

  constructor(
    baseUrl = DEFAULT_OLLAMA_URL,
    mode: OllamaApiMode = 'auto',
    request: FetchLike = nativeFetch,
    apiKeyProvider?: () => string | undefined,
    openAiTransport?: OpenAiTransportSettings
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.mode = mode
    this.apiKeyProvider = apiKeyProvider
    this.openAiTransport = openAiTransport
    this.transport = new ProviderHttpTransport(
      request,
      endpoint => this.openAiTransport ? createOpenAiRequestAgent(endpoint, this.openAiTransport) : createKeepAliveAgent(endpoint)
    )
  }

  dispose(): void {
    this.transport.dispose()
  }

  private authorizationHeaders(apiKey = this.apiKeyProvider?.()): Record<string, string> {
    return buildOpenAiAuthenticationHeaders(apiKey, this.openAiTransport ?? {
      apiKeyHeader: 'Authorization',
      apiKeyPrefix: 'Bearer',
      organizationHeader: 'OpenAI-Organization',
      organization: '',
      projectHeader: 'OpenAI-Project',
      project: ''
    })
  }

  private withTransport(endpoint: string, init: GhostRequestInit, useOpenAiTransport = true): GhostRequestInit {
    if (!useOpenAiTransport || !this.openAiTransport) {
      return init
    }
    return {
      ...init,
      agent: createOpenAiRequestAgent(endpoint, this.openAiTransport)
    }
  }

  async checkHealth(timeoutMs = 3000): Promise<boolean> {
    const endpoints = this.getHealthEndpoints()

    for (const endpoint of endpoints) {
      try {
        const response = await this.transport.requestWithDiagnostics(endpoint, this.withTransport(endpoint, {
            method: 'GET',
            headers: this.authorizationHeaders()
          }), { timeoutMs })

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
        const response = await this.transport.requestWithDiagnostics(
          endpoint,
          this.withTransport(endpoint, { method: 'GET', headers: this.authorizationHeaders() }),
          { signal, timeoutMs: GHOST_POLICY.provider.requestTimeoutMs }
        )

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

  async modelSupportsTools(model: string, signal?: AbortSignal): Promise<boolean> {
    const cached = this.toolSupportCache.get(model)
    if (cached !== undefined) {
      return cached
    }

    try {
      const endpoint = joinEndpoint(getOllamaBaseUrl(this.baseUrl), 'api/show')
      const response = await this.transport.requestWithDiagnostics(
        endpoint,
        this.withTransport(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...this.authorizationHeaders() },
          body: JSON.stringify({ name: model })
        }),
        { signal, timeoutMs: 5000 }
      )

      if (!response.ok) {
        this.toolSupportCache.set(model, false)
        return false
      }

      const payload = await response.json() as { capabilities?: string[]; template?: string }
      const supported = ollamaModelReportsTools(payload)
      this.toolSupportCache.set(model, supported)
      return supported
    } catch {
      this.toolSupportCache.set(model, false)
      return false
    }
  }

  async *streamChatCompletion(options: OllamaChatOptions): AsyncGenerator<string> {
    for await (const event of this.streamChatEvents(options)) {
      if (event.type === 'text') yield event.text
      else if (event.name) yield `{"tool":${JSON.stringify(event.name)},"arguments":${event.arguments?.trim() || '{}'}}`
    }
  }

  async *streamChatEvents(options: OllamaChatOptions): AsyncGenerator<ChatStreamEvent> {
    const messages = addSystemPrompt(options.messages, options.systemPrompt)
    const stream = options.stream ?? true
    const mode = options.mode ?? this.mode
    const attempts = this.getChatAttempts(mode, options.openAiMode ?? 'auto')
    let lastError: Error | undefined

    for (const attempt of attempts) {
      const response = await this.transport.requestWithDiagnostics(
        attempt.endpoint,
        this.withTransport(attempt.endpoint, this.getChatRequest(attempt.kind, options, messages, stream), attempt.kind !== 'ollama'),
        { signal: options.signal, timeoutMs: options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs }
      )

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
          : attempt.kind === 'openai-responses'
            ? extractOpenAiResponsesText(payload as OpenAiResponsesResponse)
            : extractOpenAiText(payload as OpenAiCompletionResponse)

        if (text) {
          yield { type: 'text', text }
        }

        return
      }

      if (!response.body) {
        throw new Error('Local model server returned an empty streaming response')
      }

      if (attempt.kind === 'ollama') {
        yield* streamOllamaEvents(streamWithTimeout(response.body, options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs))
      } else {
        const streamMode: OpenAiStreamMode = attempt.kind === 'openai-responses' ? 'responses' : 'chat-completions'
        yield* streamOpenAiEvents(streamWithTimeout(response.body, options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs), streamMode)
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
      const response = await this.transport.requestWithDiagnostics(
        attempt.endpoint,
        this.withTransport(attempt.endpoint, this.getCompletionRequest(attempt.kind, options, prompt), attempt.kind !== 'ollama'),
        { signal: options.signal, timeoutMs: options.timeoutMs ?? GHOST_POLICY.provider.requestTimeoutMs }
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
      return [joinEndpoint(baseUrl, 'api/tags'), baseUrl]
    }

    if (this.mode === 'openai-compatible' || isExplicitOpenAiUrl(this.baseUrl)) {
      return [joinEndpoint(getOpenAiBaseUrl(this.baseUrl), 'models')]
    }

    return [
      joinEndpoint(getOpenAiBaseUrl(this.baseUrl), 'models'),
      joinEndpoint(getOllamaBaseUrl(this.baseUrl), 'api/tags')
    ]
  }

  private getModelEndpoints(): string[] {
    if (this.mode === 'ollama') {
      return [joinEndpoint(getOllamaBaseUrl(this.baseUrl), 'api/tags')]
    }
    return this.getHealthEndpoints()
  }

  private getChatAttempts(mode: OllamaApiMode, openAiMode: OpenAiApiMode): Array<{ kind: 'ollama' | 'openai-chat' | 'openai-responses'; endpoint: string }> {
    if (mode === 'ollama') {
      return [{ kind: 'ollama', endpoint: joinEndpoint(getOllamaBaseUrl(this.baseUrl), 'api/chat') }]
    }

    const chatAttempt = { kind: 'openai-chat' as const, endpoint: joinEndpoint(getOpenAiBaseUrl(this.baseUrl), 'chat/completions') }
    const responsesAttempt = { kind: 'openai-responses' as const, endpoint: joinEndpoint(getOpenAiBaseUrl(this.baseUrl), 'responses') }
    const openAiAttempts = openAiMode === 'responses'
      ? [responsesAttempt]
      : openAiMode === 'chat-completions'
        ? [chatAttempt]
        : [chatAttempt, responsesAttempt]

    if (mode === 'openai-compatible' || isExplicitOpenAiUrl(this.baseUrl)) {
      return openAiAttempts
    }

    return [...openAiAttempts, { kind: 'ollama', endpoint: joinEndpoint(getOllamaBaseUrl(this.baseUrl), 'api/chat') }]
  }

  private getChatRequest(
    kind: 'ollama' | 'openai-chat' | 'openai-responses',
    options: OllamaChatOptions,
    messages: ChatMessage[],
    stream: boolean
  ): GhostRequestInit {
    if (kind === 'ollama') {
      return {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.authorizationHeaders(options.apiKey) },
        signal: options.signal,
        body: JSON.stringify(buildOllamaChatBody(options, messages, stream))
      }
    }

    if (kind === 'openai-responses') {
      return {
        method: 'POST',
        headers: {
          accept: stream ? 'text/event-stream' : 'application/json',
          'content-type': 'application/json',
          ...this.authorizationHeaders(options.apiKey)
        },
        signal: options.signal,
        body: JSON.stringify(buildOpenAiResponsesBody(options, messages))
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
      body: JSON.stringify(buildOpenAiChatBody(options, messages, stream))
    }
  }

  private getCompletionAttempts(mode: OllamaApiMode): Array<{ kind: 'ollama' | 'openai'; endpoint: string }> {
    if (mode === 'ollama') {
      return [{ kind: 'ollama', endpoint: joinEndpoint(getOllamaBaseUrl(this.baseUrl), 'api/generate') }]
    }

    const openAiAttempt = { kind: 'openai' as const, endpoint: joinEndpoint(getOpenAiBaseUrl(this.baseUrl), 'completions') }

    if (mode === 'openai-compatible' || isExplicitOpenAiUrl(this.baseUrl)) {
      return [openAiAttempt]
    }

    return [openAiAttempt, { kind: 'ollama', endpoint: joinEndpoint(getOllamaBaseUrl(this.baseUrl), 'api/generate') }]
  }

  private getCompletionRequest(
    kind: 'ollama' | 'openai',
    options: FimCompletionOptions,
    prompt: string
  ): GhostRequestInit {
    if (kind === 'ollama') {
      return {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.authorizationHeaders(options.apiKey) },
        signal: options.signal,
        body: JSON.stringify(buildOllamaFimBody(options, prompt))
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
      body: JSON.stringify(buildOpenAiFimBody(options, prompt))
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
  return new OllamaClient(baseUrl, 'auto', nativeFetch, undefined, options.openAiTransport).fetchFimCompletion(options)
}
