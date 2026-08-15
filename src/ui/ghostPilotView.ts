import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'

import { getGhostPilotSettings } from '../config'
import {
  GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
  GhostPilotExtensionMessage,
  GhostPilotViewStatus,
  isGhostPilotWebviewMessage
} from './ghostPilotProtocol'

export class GhostPilotViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'ghostpilot.chat'

  private view: vscode.WebviewView | undefined
  private readonly disposables: vscode.Disposable[] = []
  private pendingMessages: GhostPilotExtensionMessage[] = []
  private status: GhostPilotViewStatus = 'ready'

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'out')]
    }
    webviewView.webview.html = this.getHtml(webviewView.webview)

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message)),
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) {
          this.view = undefined
        }
      })
    )

    const pendingMessages = this.pendingMessages
    this.pendingMessages = []
    for (const message of pendingMessages) {
      this.postMessage(message)
    }
  }

  setStatus(status: GhostPilotViewStatus): void {
    this.status = status
    this.postState()
  }

  reset(): void {
    this.status = 'ready'
    this.postMessage(this.createMessage('reset'))
    this.postState()
  }

  clear(): void {
    this.postMessage(this.createMessage('clear'))
  }

  async export(): Promise<void> {
    const settings = getGhostPilotSettings()
    const defaultUri = vscode.workspace.workspaceFolders?.[0]
      ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'ghostpilot-export.json')
      : undefined
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      saveLabel: 'Export GhostPilot',
      filters: { JSON: ['json'] }
    })

    if (!target) {
      return
    }

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      provider: settings.provider,
      chatModel: settings.chatModel,
      conversations: []
    }
    await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(exportData, null, 2), 'utf8'))
    await vscode.window.showInformationMessage(`GhostPilot interface exported to ${target.fsPath}.`)
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose()
    this.disposables.length = 0
    this.view = undefined
    this.pendingMessages = []
  }

  private async handleMessage(value: unknown): Promise<void> {
    if (!isGhostPilotWebviewMessage(value)) {
      return
    }

    switch (value.type) {
      case 'ready':
        this.postState()
        return
      case 'reset':
        this.reset()
        return
      case 'clear':
        this.clear()
        return
      case 'export':
        await this.export()
        return
    }
  }

  private postState(): void {
    const detail = this.status === 'ready'
      ? 'Local interface ready'
      : 'Ollama is offline'
    this.postMessage({
      source: 'ghostpilot-extension',
      version: GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
      type: 'state',
      status: this.status,
      detail
    })
  }

  private postMessage(message: GhostPilotExtensionMessage): void {
    if (!this.view) {
      this.pendingMessages.push(message)
      return
    }

    void this.view.webview.postMessage(message)
  }

  private createMessage(type: 'reset' | 'clear'): GhostPilotExtensionMessage {
    return {
      source: 'ghostpilot-extension',
      version: GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
      type
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64')
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'ghostPilotWebview.js')
    )
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      "connect-src 'none'"
    ].join('; ')

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GhostPilot</title>
    <style nonce="${nonce}">
      :root {
        color-scheme: light dark;
        --ghostpilot-accent: var(--vscode-textLink-foreground, #3794ff);
        --ghostpilot-border: var(--vscode-panel-border, var(--vscode-widget-border, transparent));
        --ghostpilot-surface: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-width: 220px;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
      }

      button {
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        border: 1px solid transparent;
        border-radius: 2px;
        cursor: pointer;
        font: inherit;
        padding: 5px 10px;
      }

      button:hover {
        background: var(--vscode-button-hoverBackground);
      }

      button:focus-visible {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .app {
        display: flex;
        min-height: 100vh;
        flex-direction: column;
      }

      .header {
        align-items: flex-start;
        border-bottom: 1px solid var(--ghostpilot-border);
        display: flex;
        gap: 10px;
        justify-content: space-between;
        padding: 12px;
      }

      .brand {
        align-items: center;
        display: flex;
        gap: 8px;
      }

      .brand-mark {
        color: var(--ghostpilot-accent);
        font-size: 18px;
      }

      .title {
        font-weight: 600;
      }

      .subtitle {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
        margin-top: 2px;
      }

      .status {
        align-items: center;
        color: var(--vscode-descriptionForeground);
        display: flex;
        font-size: 0.85em;
        gap: 5px;
        white-space: nowrap;
      }

      .status-dot {
        background: var(--vscode-testing-iconPassed, #73c991);
        border-radius: 50%;
        height: 7px;
        width: 7px;
      }

      .status.offline .status-dot {
        background: var(--vscode-testing-iconFailed, #f14c4c);
      }

      .content {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 16px;
        justify-content: center;
        padding: 24px 16px;
      }

      .empty-state {
        background: var(--ghostpilot-surface);
        border: 1px solid var(--ghostpilot-border);
        border-radius: 6px;
        padding: 18px;
        text-align: center;
      }

      .empty-state h1 {
        font-size: 1.1em;
        margin: 0 0 8px;
      }

      .empty-state p {
        color: var(--vscode-descriptionForeground);
        line-height: 1.45;
        margin: 0;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: center;
      }

      .secondary {
        background: transparent;
        border-color: var(--ghostpilot-border);
        color: var(--vscode-foreground);
      }

      .footer {
        border-top: 1px solid var(--ghostpilot-border);
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        padding: 8px 12px;
      }

      @media (forced-colors: active) {
        button,
        .empty-state {
          border: 1px solid CanvasText;
        }

        .status-dot {
          background: CanvasText;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          scroll-behavior: auto !important;
          transition-duration: 0.01ms !important;
        }
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`
  }
}
