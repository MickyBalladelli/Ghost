export interface RetryPolicy {
  maxRetries: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitterRatio?: number
}

export const GHOST_RETRY_POLICIES = {
  providerConnectivity: { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 8000, jitterRatio: 0.25 },
  emptyProvider: { maxRetries: 2 },
  missingTool: { maxRetries: 2 },
  invalidToolArguments: { maxRetries: 2 },
  splitEdit: { maxRetries: 1 },
  staleEdit: { maxRetries: 3 },
  failedTool: { maxRetries: 2 }
} as const satisfies Record<string, RetryPolicy>

export function retryDelay(policy: RetryPolicy, retryIndex: number): number {
  const base = Math.min(policy.maxDelayMs ?? policy.baseDelayMs ?? 0, (policy.baseDelayMs ?? 0) * (2 ** Math.max(0, retryIndex)))
  const jitter = (policy.jitterRatio ?? 0) * base
  return Math.max(0, Math.round(base + (Math.random() * 2 - 1) * jitter))
}
