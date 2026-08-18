import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { TextDecoder } from 'node:util'
import fetch, { type RequestInit, type Response } from 'node-fetch'
import { GenerationSettings } from './generationSettings'
import { buildMlxChatBody } from './providerRequestBuilders'
import { hasEndpointSuffix, joinEndpoint, normalizeEndpoint } from './endpoint'
import { providerHttpError, requestWithRetry } from './providerRequest'

export const DEFAULT_MLX_URL = 'http://localhost:8000'

export type MlxRole = 'system' | 'user' | 'assistant'
export type MlxImageDetail = 'auto' | 'low' | 'high'

export interface MlxTextContent {
  type: 'text'
  text: string
}

export interface MlxImageContent {
  type: 'image_url'
  image_url: {
    url: string
    detail?: MlxImageDetail
  }
}

export type MlxMessageContent = string | Array<MlxTextContent | MlxImageContent>

export interface MlxMessage {
  role: MlxRole
  content: MlxMessageContent
}

export interface MlxToolDefinition {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface MlxResponseFormat {
  type: 'text' | 'json_object' | 'json_schema'
  json_schema?: {
    name: string
    description?: string
    strict?: boolean
    schema: Record<string, unknown>
  }
}

export type MlxStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; name?: string; arguments?: string; done?: boolean }

export interface MlxVisionImage {
  data?: string | Uint8Array
  path?: string
  url?: string
  mimeType?: string
  detail?: MlxImageDetail
}

export interface MlxChatOptions {
  model: string
  messages: MlxMessage[]
  generation?: GenerationSettings
  tools?: MlxToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required'
  responseFormat?: MlxResponseFormat
  signal?: AbortSignal
}

interface MlxModelsResponse {
  data?: Array<{ id?: string }>
}

interface MlxStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null }
    message?: { content?: string | null }
    text?: string | null
  }>
}

type FetchLike = typeof fetch

const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

export function normalizeMlxApiUrl(baseUrl = DEFAULT_MLX_URL): string {
  const normalized = normalizeEndpoint(baseUrl)
  return hasEndpointSuffix(normalized, 'v1') ? normalized : joinEndpoint(normalized, 'v1')
}

export function inferImageMimeType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

export function toImageDataUrl(data: string | Uint8Array, mimeType = 'image/png'): string {
  if (typeof data === 'string') {
    if (data.startsWith('data:') || data.startsWith('http://') || data.startsWith('https://')) {
      return data
    }

    return `data:${mimeType};base64,${Buffer.from(data).toString('base64')}`
  }

  return `data:${mimeType};base64,${Buffer.from(data).toString('base64')}`
}

export async function imageFileToDataUrl(filePath: string, mimeType = inferImageMimeType(filePath)): Promise<string> {
  const image = await readFile(filePath)
  return toImageDataUrl(image, mimeType)
}

export async function createVisionMessage(text: string, images: MlxVisionImage[] = []): Promise<MlxMessage> {
  const content: Array<MlxTextContent | MlxImageContent> = [{ type: 'text', text }]

  for (const image of images) {
    let url = image.url

    if (!url && image.path) {
      url = await imageFileToDataUrl(image.path, image.mimeType)
    }

    if (!url && image.data !== undefined) {
      url = toImageDataUrl(image.data, image.mimeType)
    }

    if (!url) {
      throw new Error('MLX vision image needs a url, path, or data value')
    }

    content.push({
      type: 'image_url',
      image_url: {
        url,
        ...(image.detail ? { detail: image.detail } : {})
      }
    })
  }

  return { role: 'user', content }
}

async function throwForHttpError(response: Response): Promise<void> {
  if (response.ok) {
    return
  }
  throw await providerHttpError(response)
}

function extractChunkText(chunk: MlxStreamChunk): string {
  const choice = chunk.choices?.[0]
  return choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? ''
}

export async function* streamSseTokens(body: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffer = ''
  const decoder = new TextDecoder('utf-8', { fatal: true })

  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    try {
      buffer += decoder.decode(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, { stream: true })
    } catch {
      return
    }
    buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const data = event
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')

      if (!data || data === '[DONE]') {
        continue
      }

      let parsed: MlxStreamChunk

      try {
        parsed = JSON.parse(data) as MlxStreamChunk
      } catch {
        continue
      }

      const text = extractChunkText(parsed)

      if (text) {
        yield text
      }
    }
  }

  try {
    buffer += decoder.decode()
  } catch {
    return
  }

  const data = buffer
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')

  if (data && data !== '[DONE]') {
    try {
      const text = extractChunkText(JSON.parse(data) as MlxStreamChunk)

      if (text) {
        yield text
      }
    } catch {
      // The server may close with an incomplete SSE event.
    }
  }
}

export class MlxClient {
  private readonly apiUrl: string
  private readonly request: FetchLike
  private readonly apiKeyProvider?: () => string | undefined

  constructor(baseUrl = DEFAULT_MLX_URL, request: FetchLike = fetch, apiKeyProvider?: () => string | undefined) {
    this.apiUrl = normalizeMlxApiUrl(baseUrl)
    this.request = request
    this.apiKeyProvider = apiKeyProvider
  }

  private authorizationHeaders(): Record<string, string> {
    const apiKey = this.apiKeyProvider?.()
    return apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  }

  async checkHealth(timeoutMs = 3000): Promise<boolean> {
    try {
      const endpoint = joinEndpoint(this.apiUrl, 'models')
      const response = await requestWithRetry(
        signal => this.request(endpoint, {
          method: 'GET',
          headers: this.authorizationHeaders(),
          signal
        }),
        { timeoutMs }
      )

      return response.ok
    } catch {
      return false
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const endpoint = joinEndpoint(this.apiUrl, 'models')
    const response = await requestWithRetry(
      requestSignal => this.request(endpoint, {
        method: 'GET',
        headers: this.authorizationHeaders(),
        signal: requestSignal
      }),
      { signal, timeoutMs: 30000 }
    )
    await throwForHttpError(response)

    const payload = await response.json() as MlxModelsResponse
    return payload.data?.flatMap(model => model.id ? [model.id] : []) ?? []
  }

  async *streamChatCompletion(options: MlxChatOptions): AsyncGenerator<string> {
    const body = JSON.stringify(buildMlxChatBody(options))
    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        ...this.authorizationHeaders()
      },
      body,
      signal: options.signal
    }
    const endpoint = joinEndpoint(this.apiUrl, 'chat/completions')
    const response = await this.request(endpoint, requestOptions)
    await throwForHttpError(response)

    if (!response.body) {
      throw new Error('MLX server returned an empty streaming response')
    }

    yield* streamSseTokens(response.body)
  }
}

export async function checkHealth(baseUrl = DEFAULT_MLX_URL, timeoutMs = 3000): Promise<boolean> {
  return new MlxClient(baseUrl).checkHealth(timeoutMs)
}

export async function listModels(baseUrl = DEFAULT_MLX_URL, signal?: AbortSignal): Promise<string[]> {
  return new MlxClient(baseUrl).listModels(signal)
}

export async function* streamChatCompletion(options: MlxChatOptions, baseUrl = DEFAULT_MLX_URL): AsyncGenerator<string> {
  yield* new MlxClient(baseUrl).streamChatCompletion(options)
}
