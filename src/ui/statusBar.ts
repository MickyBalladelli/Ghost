import * as vscode from 'vscode'

import type { GhostProvider } from '../config'

export type GhostStatus = 'ready' | 'generating' | 'offline'

const PROVIDER_LABELS: Record<GhostProvider, string> = {
  ollama: 'Ollama',
  'mlx-vlm': 'MLX/VLM',
  'openai-compatible': 'OpenAI-compatible',
  opencode: 'OpenCode'
}

const STATUS_ICONS: Record<GhostStatus, string> = {
  ready: '$(chip)',
  generating: '$(sync~spin)',
  offline: '$(error)'
}

export class GhostStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem
  private provider: GhostProvider = 'ollama'
  private status: GhostStatus = 'ready'

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.item.command = 'ghost.checkProviderStatus'
    this.setStatus('ready')
  }

  setProvider(provider: GhostProvider): void {
    this.provider = provider
    this.render()
  }

  setStatus(status: GhostStatus): void {
    this.status = status
    this.render()
  }

  private render(): void {
    const providerLabel = PROVIDER_LABELS[this.provider]
    this.item.text = this.status === 'ready'
      ? `${STATUS_ICONS.ready} Ghost: Ready`
      : this.status === 'generating'
        ? `${STATUS_ICONS.generating} Ghost: Generating...`
        : `${STATUS_ICONS.offline} Ghost: ${providerLabel} Offline`
    this.item.tooltip = this.status === 'ready'
      ? `Ghost is ready. Click to check the ${providerLabel} connection.`
      : this.status === 'generating'
        ? 'Ghost is generating a response.'
        : `${providerLabel} is offline. Click to check the provider connection.`
    this.item.show()
  }

  dispose(): void {
    this.item.dispose()
  }
}
