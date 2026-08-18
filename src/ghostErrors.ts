export type GhostErrorCode =
  | 'provider.cancelled'
  | 'provider.timeout'
  | 'provider.network'
  | 'provider.rate-limit'
  | 'provider.auth'
  | 'provider.invalid-request'
  | 'provider.http'
  | 'provider.unknown'
  | 'tool.cancelled'
  | 'tool.invalid-input'
  | 'tool.permission-denied'
  | 'tool.path-invalid'
  | 'tool.conflict'
  | 'tool.execution-failed'
  | 'persistence.invalid-data'
  | 'persistence.read-failed'
  | 'persistence.write-failed'
  | 'approval.rejected'
  | 'approval.conflict'
  | 'approval.failed'
  | 'ui.invalid-message'
  | 'ui.request-failed'
  | 'unknown'

export interface GhostErrorOptions {
  code: GhostErrorCode
  retryable?: boolean
  cause?: unknown
  details?: Record<string, unknown>
}

export class GhostError extends Error {
  readonly ghostCode: GhostErrorCode
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(message: string, options: GhostErrorOptions) {
    super(message)
    this.name = 'GhostError'
    this.ghostCode = options.code
    this.retryable = options.retryable ?? false
    this.details = options.details
    if (options.cause !== undefined) {
      this.cause = options.cause
    }
  }
}

export const isGhostError = (error: unknown): error is GhostError => error instanceof GhostError

export const toGhostError = (
  error: unknown,
  code: GhostErrorCode,
  options: Omit<GhostErrorOptions, 'code' | 'cause'> = {}
): GhostError => {
  if (isGhostError(error)) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  return new GhostError(message, { ...options, code, cause: error })
}

export const ghostErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback
