import * as vscode from 'vscode'

export type LocalPilotStatus = 'ready' | 'generating' | 'offline'

const STATUS_TEXT: Record<LocalPilotStatus, string> = {
  ready: '$(chip) LocalPilot: Ready',
  generating: '$(sync~spin) LocalPilot: Generating...',
  offline: '$(error) LocalPilot: Ollama Offline'
}

const STATUS_TOOLTIP: Record<LocalPilotStatus, string> = {
  ready: 'LocalPilot is ready. Click to check the Ollama connection.',
  generating: 'LocalPilot is generating a response.',
  offline: 'Ollama is offline. Click to check the Ollama connection.'
}

export class LocalPilotStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.item.command = 'localpilot.checkOllamaStatus'
    this.setStatus('ready')
  }

  setStatus(status: LocalPilotStatus): void {
    this.item.text = STATUS_TEXT[status]
    this.item.tooltip = STATUS_TOOLTIP[status]
    this.item.show()
  }

  dispose(): void {
    this.item.dispose()
  }
}
