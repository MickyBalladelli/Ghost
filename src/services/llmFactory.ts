import * as vscode from 'vscode'

import { DEFAULT_MLX_URL, MlxChatOptions, MlxClient, MlxStreamEvent } from './mlxClient'
import { createProviderAdapter, ProviderAdapter, ProviderClient, ProviderId } from './providerAdapter'
import type { FimCompletionOptions } from './fim'

export type GhostProvider = ProviderId

export type LlmClient = ProviderClient

export interface LlmProviderClients {
  ollamaClient: LlmClient
  mlxClient?: LlmClient
  openaiCompatibleClient?: LlmClient
}

export interface ResolvedLlmClient {
  provider: GhostProvider
  client: LlmClient
  adapter: ProviderAdapter
}

export interface LlmFactoryOptions {
  configuration?: vscode.WorkspaceConfiguration
  mlxDetectionTimeoutMs?: number
}

const MLX_SWITCH_ACTION = 'Switch to MLX VLM'
const KEEP_PROVIDER_ACTION = 'Keep Current Provider'

function isProvider(value: string): value is GhostProvider {
  return value === 'ollama' || value === 'mlx-vlm' || value === 'openai-compatible'
}

export class LlmFactory {
  private readonly configuration: vscode.WorkspaceConfiguration
  private readonly mlxDetectionTimeoutMs: number
  private readonly clients: LlmProviderClients
  private readonly adapters = new Map<GhostProvider, ProviderAdapter>()
  private mlxDetectionComplete = false

  constructor(clients: LlmProviderClients, options: LlmFactoryOptions = {}) {
    this.clients = clients
    this.configuration = options.configuration ?? vscode.workspace.getConfiguration('ghost')
    this.mlxDetectionTimeoutMs = options.mlxDetectionTimeoutMs ?? 1500
  }

  getConfiguredProvider(): GhostProvider {
    const configuredProvider = this.configuration.get<string>('provider', 'ollama')
    return configuredProvider && isProvider(configuredProvider) ? configuredProvider : 'ollama'
  }

  async resolve(providerOverride?: GhostProvider): Promise<ResolvedLlmClient> {
    const provider = providerOverride ?? this.getConfiguredProvider()

    if (!providerOverride && provider !== 'mlx-vlm' && !this.mlxDetectionComplete) {
      this.mlxDetectionComplete = true
      await this.suggestMlxProvider()
    }

    const client = this.getClient(provider)
    return {
      provider,
      client,
      adapter: this.getAdapter(provider, client)
    }
  }

  async *streamChatCompletion(options: MlxChatOptions & { provider?: GhostProvider }): AsyncGenerator<string> {
    const resolved = await this.resolve(options.provider)
    const model = await this.selectAvailableModel(resolved.adapter, options.model, options.signal)
    yield* resolved.adapter.stream({ ...options, model })
  }

  async *streamChatEvents(options: MlxChatOptions & { provider?: GhostProvider }): AsyncGenerator<MlxStreamEvent> {
    const resolved = await this.resolve(options.provider)
    const model = await this.selectAvailableModel(resolved.adapter, options.model, options.signal)
    yield* resolved.adapter.streamEvents({ ...options, model })
  }

  async fetchFimCompletion(options: FimCompletionOptions & { provider?: GhostProvider }): Promise<string> {
    const resolved = await this.resolve(options.provider)
    if (!resolved.adapter.capabilities(options.model).supportsFIM) {
      throw new Error(`Provider ${resolved.provider} does not support fill-in-the-middle completion`)
    }
    const model = await this.selectAvailableModel(resolved.adapter, options.model, options.signal)
    return resolved.adapter.fim({ ...options, model })
  }

  resetMlxDetection(): void {
    this.mlxDetectionComplete = false
  }

  private getMlxClient(): LlmClient {
    if (this.clients.mlxClient) {
      return this.clients.mlxClient
    }

    const mlxUrl = this.configuration.get<string>('mlxUrl', DEFAULT_MLX_URL)
    return new MlxClient(mlxUrl)
  }

  private getClient(provider: GhostProvider): LlmClient {
    if (provider === 'ollama') {
      return this.clients.ollamaClient
    }

    if (provider === 'mlx-vlm') {
      return this.getMlxClient()
    }

    if (!this.clients.openaiCompatibleClient) {
      throw new Error('No OpenAI-compatible Ghost client has been configured')
    }

    return this.clients.openaiCompatibleClient
  }

  private getAdapter(provider: GhostProvider, client: LlmClient): ProviderAdapter {
    const existing = this.adapters.get(provider)
    if (existing) return existing
    const adapter = createProviderAdapter(provider, client)
    this.adapters.set(provider, adapter)
    return adapter
  }

  private async selectAvailableModel(client: ProviderAdapter, configuredModel: string, signal?: AbortSignal): Promise<string> {
    if (!configuredModel.trim()) {
      return configuredModel
    }

    try {
      const models = await client.listModels(signal)

      if (models.length === 0 || models.includes(configuredModel)) {
        return configuredModel
      }

      return models[0]
    } catch {
      return configuredModel
    }
  }

  private async suggestMlxProvider(): Promise<boolean> {
    const mlxClient = this.getMlxClient()
    const isAvailable = await this.getAdapter('mlx-vlm', mlxClient).health(this.mlxDetectionTimeoutMs)

    if (!isAvailable) {
      return false
    }

    const mlxUrl = this.configuration.get<string>('mlxUrl', DEFAULT_MLX_URL)
    const selection = await vscode.window.showInformationMessage(
      `MLX VLM server detected at ${mlxUrl}. Switch Ghost to MLX VLM?`,
      MLX_SWITCH_ACTION,
      KEEP_PROVIDER_ACTION
    )

    if (selection !== MLX_SWITCH_ACTION) {
      return true
    }

    await this.configuration.update('provider', 'mlx-vlm', vscode.ConfigurationTarget.Global)
    return true
  }
}

export function createLlmFactory(clients: LlmProviderClients, options?: LlmFactoryOptions): LlmFactory {
  return new LlmFactory(clients, options)
}
