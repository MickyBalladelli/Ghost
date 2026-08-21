import { nativeFetch } from './nativeFetch'
import type { FetchLike, GhostRequestInit, RequestAgent } from './httpTypes'
import { requestWithRetry, type ProviderRequestOptions } from './providerRequest'
import { GhostClock, systemClock } from '../runtimeDependencies'

export interface ProviderTransportDiagnostics {
  endpoint: string
  startedAt: number
  completedAt: number
  durationMs: number
  attempts: number
  status?: number
  ok?: boolean
  error?: string
}

export interface ProviderTransportOptions extends ProviderRequestOptions {
  agent?: RequestAgent
}

export type ProviderAgentFactory = (endpoint: string) => RequestAgent | undefined

export class ProviderHttpTransport {
  private lastDiagnostics?: ProviderTransportDiagnostics
  private readonly agents = new Map<string, RequestAgent>()

  constructor(
    private readonly request: FetchLike = nativeFetch,
    private readonly agentFactory?: ProviderAgentFactory
  ) {}

  dispose(): void {
    for (const agent of this.agents.values()) {
      if (typeof agent === 'object' && agent !== null && 'destroy' in agent && typeof agent.destroy === 'function') {
        agent.destroy()
      }
    }
    this.agents.clear()
    this.lastDiagnostics = undefined
  }

  private agentFor(endpoint: string, init: GhostRequestInit, options: ProviderTransportOptions): RequestAgent | undefined {
    if (options.agent) {
      return options.agent
    }
    if (init.agent) {
      return init.agent
    }
    const existing = this.agents.get(endpoint)
    if (existing) {
      return existing
    }
    const created = this.agentFactory?.(endpoint)
    if (created) {
      this.agents.set(endpoint, created)
    }
    return created
  }

  async requestWithDiagnostics(
    endpoint: string,
    init: GhostRequestInit = {},
    options: ProviderTransportOptions = {}
  ): Promise<Response> {
    const clock: GhostClock = options.clock ?? systemClock
    const startedAt = clock.now()
    let attempts = 0
    const requestOptions: ProviderRequestOptions = {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
      clock
    }

    try {
      const response = await requestWithRetry(
        signal => {
          attempts += 1
          const agent = this.agentFor(endpoint, init, options)
          return this.request(endpoint, {
            ...init,
            ...(agent ? { agent } : {}),
            signal
          })
        },
        requestOptions
      )
      const completedAt = clock.now()
      this.lastDiagnostics = {
        endpoint,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        attempts,
        status: response.status,
        ok: response.ok
      }
      return response
    } catch (error) {
      const completedAt = clock.now()
      this.lastDiagnostics = {
        endpoint,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        attempts,
        error: error instanceof Error ? error.message : String(error)
      }
      throw error
    }
  }

  getLastDiagnostics(): ProviderTransportDiagnostics | undefined {
    return this.lastDiagnostics
  }
}
