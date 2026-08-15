import * as vscode from 'vscode'

export type GhostStatus = 'ready' | 'generating' | 'offline'

const STATUS_TEXT: Record<GhostStatus, string> = {
  ready: '$(chip) Ghost: Ready',
  generating: '$(sync~spin) Ghost: Generating...',
  offline: '$(error) Ghost: Ollama Offline'
}

const STATUS_TOOLTIP: Record<GhostStatus, string> = {
  ready: 'Ghost is ready. Click to check the Ollama connection.',
  generating: 'Ghost is generating a response.',
  offline: 'Ollama is offline. Click to check the Ollama connection.'
}

export class GhostStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.item.command = 'ghost.checkOllamaStatus'
    this.setStatus('ready')
  }

  setStatus(status: GhostStatus): void {
    this.item.text = STATUS_TEXT[status]
    this.item.tooltip = STATUS_TOOLTIP[status]
    this.item.show()
  }

  dispose(): void {
    this.item.dispose()
  }
}
