import { ChatRequestOptions, ChatStreamEvent } from './chatTypes'
import { ProviderHttpError, ProviderTimeoutError } from './providerRequest'
import type { FimCompletionOptions } from './fim'

export type ProviderId = 'ollama' | 'mlx-vlm' | 'openai-compatible'
export type ProviderNativeApi = 'ollama' | 'openai-chat-completions' | 'mlx-chat-completions'
export type ProviderErrorCode = 'cancelled' | 'timeout' | 'network' | 'rate-limit' | 'auth' | 'invalid-request' | 'http' | 'unknown'

export interface ModelCapabilityRecord {
  model: string
  provider: ProviderId
  contextWindow: number
  outputLimit: number
  nativeApi: ProviderNativeApi
  supportsTools: boolean
  supportsJsonMode: boolean
  supportsVision: boolean
  supportsFIM: boolean
  supportsStreaming: boolean
  supportsSampling: {
    temperature: boolean
    topP: boolean
    topK: boolean
    minP: boolean
    presencePenalty: boolean
    repeatPenalty: boolean
  }
}

export interface ProviderErrorOptions {
  provider: ProviderId
  code: ProviderErrorCode
  retryable: boolean
  status?: number
  retryAfterMs?: number
  cause?: unknown
}

export class ProviderError extends Error {
  readonly provider: ProviderId
  readonly code: ProviderErrorCode
  readonly retryable: boolean
  readonly status?: number
  readonly retryAfterMs?: number

  constructor(message: string, options: ProviderErrorOptions) {
    super(message)
    this.name = 'ProviderError'
    this.provider = options.provider
    this.code = options.code
    this.retryable = options.retryable
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    if (options.cause !== undefined) {
      this.cause = options.cause
    }
  }
}

export interface ProviderClient {
  checkHealth(timeoutMs?: number): Promise<boolean>
  listModels?(signal?: AbortSignal): Promise<string[]>
  streamChatCompletion(options: ChatRequestOptions): AsyncGenerator<string>
  streamChatEvents?(options: ChatRequestOptions): AsyncGenerator<ChatStreamEvent>
  fetchFimCompletion?(options: FimCompletionOptions): Promise<string>
}

export interface ProviderAdapter {
  readonly provider: ProviderId
  capabilities(model?: string): ModelCapabilityRecord
  chat(options: ChatRequestOptions): Promise<string>
  stream(options: ChatRequestOptions): AsyncGenerator<string>
  streamEvents(options: ChatRequestOptions): AsyncGenerator<ChatStreamEvent>
  fim(options: FimCompletionOptions): Promise<string>
  listModels(signal?: AbortSignal): Promise<string[]>
  health(timeoutMs?: number, signal?: AbortSignal): Promise<boolean>
  normalizeError(error: unknown): ProviderError
}

type CapabilityDefaults = Omit<ModelCapabilityRecord, 'model' | 'provider'>

const CAPABILITIES: Record<ProviderId, CapabilityDefaults> = {
  ollama: {
    contextWindow: 32768,
    outputLimit: 8192,
    nativeApi: 'ollama',
    supportsTools: true,
    supportsJsonMode: true,
    supportsVision: true,
    supportsFIM: true,
    supportsStreaming: true,
    supportsSampling: { temperature: true, topP: true, topK: true, minP: true, presencePenalty: true, repeatPenalty: true }
  },
  'mlx-vlm': {
    contextWindow: 32768,
    outputLimit: 8192,
    nativeApi: 'mlx-chat-completions',
    supportsTools: false,
    supportsJsonMode: false,
    supportsVision: true,
    supportsFIM: false,
    supportsStreaming: true,
    supportsSampling: { temperature: true, topP: true, topK: false, minP: false, presencePenalty: true, repeatPenalty: false }
  },
  'openai-compatible': {
    contextWindow: 32768,
    outputLimit: 8192,
    nativeApi: 'openai-chat-completions',
    supportsTools: true,
    supportsJsonMode: true,
    supportsVision: false,
    supportsFIM: true,
    supportsStreaming: true,
    supportsSampling: { temperature: true, topP: true, topK: false, minP: false, presencePenalty: true, repeatPenalty: false }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorStatus(message: string): number | undefined {
  const match = /\b(?:returned|status|HTTP)\s+(\d{3})\b/i.exec(message)
  return match ? Number(match[1]) : undefined
}

export function normalizeProviderError(provider: ProviderId, error: unknown): ProviderError {
  if (error instanceof ProviderError && error.provider === provider) {
    return error
  }
  const message = errorMessage(error)
  const status = error instanceof ProviderHttpError ? error.status : errorStatus(message)
  const retryAfterMs = error instanceof ProviderHttpError ? error.retryAfterMs : undefined
  const lowered = message.toLowerCase()
  const cancelled = error instanceof Error && (error.name === 'AbortError' || lowered.includes('cancel'))
  const timeout = error instanceof ProviderTimeoutError || lowered.includes('timeout') || lowered.includes('timed out')
  const network = /network|fetch|connect|socket|econn|enotfound|offline/.test(lowered)
  const code: ProviderErrorCode = cancelled
    ? 'cancelled'
    : timeout
      ? 'timeout'
      : status === 429
        ? 'rate-limit'
        : status === 401 || status === 403
          ? 'auth'
          : status === 400 || status === 422
            ? 'invalid-request'
            : status
              ? 'http'
              : network ? 'network' : 'unknown'
  const retryable = !cancelled && (timeout || network || (status !== undefined && (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)))
  return new ProviderError(message || 'Provider request failed', { provider, code, retryable, status, retryAfterMs, cause: error })
}

export function createProviderAdapter(provider: ProviderId, client: ProviderClient): ProviderAdapter {
  const capabilityDefaults = CAPABILITIES[provider]
  const capabilities = {
    ...capabilityDefaults,
    supportsFIM: capabilityDefaults.supportsFIM && Boolean(client.fetchFimCompletion)
  }
  return {
    provider,
    capabilities: (model = '') => ({ model: model.trim(), provider, ...capabilities }),
    async chat(options) {
      let result = ''
      try {
        for await (const chunk of client.streamChatCompletion(options)) {
          result += chunk
        }
        return result
      } catch (error) {
        throw normalizeProviderError(provider, error)
      }
    },
    async *stream(options) {
      try {
        yield* client.streamChatCompletion(options)
      } catch (error) {
        throw normalizeProviderError(provider, error)
      }
    },
    async *streamEvents(options) {
      try {
        if (client.streamChatEvents) {
          yield* client.streamChatEvents(options)
          return
        }
        for await (const chunk of client.streamChatCompletion(options)) {
          yield { type: 'text', text: chunk }
        }
      } catch (error) {
        throw normalizeProviderError(provider, error)
      }
    },
    async fim(options) {
      if (!client.fetchFimCompletion) {
        throw new ProviderError(`Provider ${provider} does not support fill-in-the-middle completion`, {
          provider,
          code: 'invalid-request',
          retryable: false
        })
      }
      try {
        return await client.fetchFimCompletion(options)
      } catch (error) {
        throw normalizeProviderError(provider, error)
      }
    },
    async listModels(signal) {
      if (!client.listModels) return []
      try {
        return await client.listModels(signal)
      } catch (error) {
        throw normalizeProviderError(provider, error)
      }
    },
    async health(timeoutMs, signal) {
      if (signal?.aborted) return false
      const health = client.checkHealth(timeoutMs).catch(() => false)
      if (!signal) return health
      return await new Promise<boolean>(resolve => {
        let settled = false
        const finish = (value: boolean): void => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        }
        const onAbort = (): void => finish(false)
        signal.addEventListener('abort', onAbort, { once: true })
        void health.then(finish)
      })
    },
    normalizeError: error => normalizeProviderError(provider, error)
  }
}
