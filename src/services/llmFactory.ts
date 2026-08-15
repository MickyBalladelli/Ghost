import * as vscode from 'vscode'

import { DEFAULT_MLX_URL, MlxChatOptions, MlxClient } from './mlxClient'

export type GhostProvider = 'ollama' | 'mlx-vlm' | 'openai-compatible'

export interface LlmClient {
  checkHealth(timeoutMs?: number): Promise<boolean>
  streamChatCompletion(options: MlxChatOptions): AsyncGenerator<string>
}

export interface LlmProviderClients {
  ollamaClient: LlmClient
  mlxClient?: LlmClient
  openaiCompatibleClient?: LlmClient
}

export interface ResolvedLlmClient {
  provider: GhostProvider
  client: LlmClient
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

  async resolve(): Promise<ResolvedLlmClient> {
    const provider = this.getConfiguredProvider()

    if (provider !== 'mlx-vlm' && !this.mlxDetectionComplete) {
      this.mlxDetectionComplete = true
      await this.suggestMlxProvider()
    }

    return {
      provider,
      client: this.getClient(provider)
    }
  }

  async *streamChatCompletion(options: MlxChatOptions): AsyncGenerator<string> {
    const resolved = await this.resolve()
    yield* resolved.client.streamChatCompletion(options)
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

  private async suggestMlxProvider(): Promise<boolean> {
    const mlxClient = this.getMlxClient()
    const isAvailable = await mlxClient.checkHealth(this.mlxDetectionTimeoutMs)

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
