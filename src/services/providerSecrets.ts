import * as vscode from 'vscode'

import type { GhostProvider } from '../config'

const SECRET_KEYS: Record<GhostProvider, string> = {
  ollama: 'ghost.providerKey.ollama',
  'mlx-vlm': 'ghost.providerKey.mlx-vlm',
  'openai-compatible': 'ghost.providerKey.openai-compatible',
  openrouter: 'ghost.providerKey.openrouter',
  opencode: 'ghost.providerKey.opencode'
}

export class ProviderSecrets implements vscode.Disposable {
  private readonly values = new Map<GhostProvider, string>()

  constructor(private readonly storage: vscode.SecretStorage) {}

  async initialize(): Promise<void> {
    for (const provider of Object.keys(SECRET_KEYS) as GhostProvider[]) {
      const value = await this.storage.get(SECRET_KEYS[provider])
      if (value) {
        this.values.set(provider, value)
      }
    }
  }

  get(provider: GhostProvider): string | undefined {
    return this.values.get(provider)
  }

  async set(provider: GhostProvider, value: string): Promise<void> {
    const normalized = value.trim()
    if (!normalized) {
      await this.clear(provider)
      return
    }
    await this.storage.store(SECRET_KEYS[provider], normalized)
    this.values.set(provider, normalized)
  }

  async clear(provider: GhostProvider): Promise<void> {
    await this.storage.delete(SECRET_KEYS[provider])
    this.values.delete(provider)
  }

  dispose(): void {
    this.values.clear()
  }
}
