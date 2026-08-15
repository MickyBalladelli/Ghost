import * as vscode from 'vscode'

export type GhostPilotStatus = 'ready' | 'generating' | 'offline'

const STATUS_TEXT: Record<GhostPilotStatus, string> = {
  ready: '$(chip) GhostPilot: Ready',
  generating: '$(sync~spin) GhostPilot: Generating...',
  offline: '$(error) GhostPilot: Ollama Offline'
}

const STATUS_TOOLTIP: Record<GhostPilotStatus, string> = {
  ready: 'GhostPilot is ready. Click to check the Ollama connection.',
  generating: 'GhostPilot is generating a response.',
  offline: 'Ollama is offline. Click to check the Ollama connection.'
}

export class GhostPilotStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.item.command = 'ghostpilot.checkOllamaStatus'
    this.setStatus('ready')
  }

  setStatus(status: GhostPilotStatus): void {
    this.item.text = STATUS_TEXT[status]
    this.item.tooltip = STATUS_TOOLTIP[status]
    this.item.show()
  }

  dispose(): void {
    this.item.dispose()
  }
}
