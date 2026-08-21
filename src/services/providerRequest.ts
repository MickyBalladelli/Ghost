import type { Response } from 'node-fetch'
import { GHOST_POLICY } from '../ghostPolicy'
import { GhostError } from '../ghostErrors'
import { GhostClock, systemClock } from '../runtimeDependencies'

const { requestTimeoutMs: DEFAULT_TIMEOUT_MS, defaultMaxAttempts: DEFAULT_MAX_ATTEMPTS, maxRetryDelayMs: MAX_RETRY_DELAY_MS, retryBaseDelayMs: RETRY_BASE_DELAY_MS } = GHOST_POLICY.provider

export interface ProviderRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxAttempts?: number
  clock?: GhostClock
}

export class ProviderHttpError extends GhostError {
  readonly status: number
  readonly retryAfterMs?: number

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message, { code: 'provider.http', retryable: status === 408 || status === 409 || status === 425 || status === 429 || status >= 500, details: { status, retryAfterMs } })
    this.name = 'ProviderHttpError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export class ProviderTimeoutError extends GhostError {
  constructor(timeoutMs: number) {
    super(`Provider request timed out after ${timeoutMs}ms`, { code: 'provider.timeout', retryable: true, details: { timeoutMs } })
    this.name = 'ProviderTimeoutError'
  }
}

export async function* streamWithTimeout(body: NodeJS.ReadableStream, timeoutMs: number): AsyncGenerator<Buffer | string> {
  const iterator = (body as AsyncIterable<Buffer | string>)[Symbol.asyncIterator]()
  const stream = body as NodeJS.ReadableStream & { destroy?: (error?: Error) => void }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new ProviderTimeoutError(timeoutMs)
      stream.destroy?.(error)
      reject(error)
    }, Math.max(1, timeoutMs))
  })

  try {
    while (true) {
      const result = await Promise.race([iterator.next(), timeout])
      if (result.done) {
        return
      }
      yield result.value
    }
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    await iterator.return?.()
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const message = `${error.name} ${error.message}`.toLowerCase()
  return /abort|econn|enotfound|eai_again|etimedout|socket|network|fetch|reset/.test(message)
}

export function parseRetryAfter(headers: Pick<Headers, 'get'>, clock: GhostClock = systemClock): number | undefined {
  const retryAfter = headers.get('retry-after')?.trim()
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.round(seconds * 1000))
    }
    const timestamp = Date.parse(retryAfter)
    if (Number.isFinite(timestamp)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, timestamp - clock.now()))
    }
  }

  const reset = headers.get('x-ratelimit-reset')?.trim()
  const timestamp = reset ? Number(reset) : NaN
  if (Number.isFinite(timestamp) && timestamp > 0) {
    const milliseconds = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, milliseconds - clock.now()))
  }
  return undefined
}

function retryDelay(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) {
    return retryAfterMs
  }
  return Math.min(MAX_RETRY_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1))
}

function waitForRetry(delayMs: number, signal: AbortSignal | undefined, clock: GhostClock): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const timer = clock.setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)
    const abort = () => {
      clock.clearTimeout(timer)
      cleanup()
      reject(new GhostError('Provider request cancelled during retry backoff', { code: 'provider.cancelled', retryable: false }))
    }
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export async function requestWithRetry(
  request: (signal: AbortSignal) => Promise<Response>,
  options: ProviderRequestOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const clock = options.clock ?? systemClock
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new GhostError('Provider request cancelled', { code: 'provider.cancelled', retryable: false })
    }
    const controller = new AbortController()
    let timedOut = false
    const timeout = clock.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })

    try {
      const response = await request(controller.signal)
      if (!isRetryableStatus(response.status) || attempt >= maxAttempts) {
        return response
      }
      await waitForRetry(retryDelay(attempt, parseRetryAfter(response.headers, clock)), options.signal, clock)
    } catch (error) {
      lastError = timedOut ? new ProviderTimeoutError(timeoutMs) : error
      if (options.signal?.aborted || (!timedOut && !isRetryableNetworkError(error)) || attempt >= maxAttempts) {
        throw lastError
      }
      await waitForRetry(retryDelay(attempt), options.signal, clock)
    } finally {
      clock.clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
    }
  }

  throw lastError ?? new GhostError('Provider request failed', { code: 'provider.unknown', retryable: false })
}

export async function providerHttpError(response: Response): Promise<ProviderHttpError> {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 1000)
  } catch {
    detail = ''
  }
  let message = detail
  try {
    const payload = JSON.parse(detail) as { error?: { message?: string } | string; message?: string }
    const error = typeof payload.error === 'string' ? payload.error : payload.error?.message
    message = error || payload.message || detail
  } catch {
    // Keep the bounded response text.
  }
  const suffix = message ? `: ${message}` : ''
  return new ProviderHttpError(`Provider returned HTTP ${response.status}${suffix}`, response.status, parseRetryAfter(response.headers))
}
