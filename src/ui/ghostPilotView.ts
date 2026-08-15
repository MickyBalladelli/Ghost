import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'

import { createChatParticipantHandler, GhostPilotRequestOptions } from '../agent/chatParticipant'
import { ghostPilotConfig, getGhostPilotSettings } from '../config'
import { MlxClient } from '../services/mlxClient'
import { OllamaClient } from '../services/ollamaClient'
import {
  GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
  GhostPilotAttachment,
  GhostPilotExtensionMessage,
  GhostPilotSettingsUpdate,
  GhostPilotViewStatus,
  GhostPilotWebviewRequestOptions,
  isGhostPilotWebviewMessage
} from './ghostPilotProtocol'

export class GhostPilotViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'ghostpilot.chat'

  private view: vscode.WebviewView | undefined
  private readonly disposables: vscode.Disposable[] = []
  private readonly requests = new Map<string, vscode.CancellationTokenSource>()
  private pendingMessages: GhostPilotExtensionMessage[] = []
  private status: GhostPilotViewStatus = 'ready'

  private readonly chatHandler: vscode.ChatRequestHandler

  constructor(
    private readonly extensionUri: vscode.Uri,
    options: { chatHandler?: vscode.ChatRequestHandler } = {}
  ) {
    this.chatHandler = options.chatHandler ?? createChatParticipantHandler()
    this.disposables.push(ghostPilotConfig.onDidChange(() => {
      void this.sendControlsState()
    }))
  }

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
        this.cancelRequests()
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
    void this.sendControlsState()
  }

  setStatus(status: GhostPilotViewStatus): void {
    this.status = status
    this.postState()
    void this.sendControlsState()
  }

  reset(): void {
    this.cancelRequests()
    this.status = 'ready'
    this.postMessage(this.createMessage('reset'))
    this.postState()
  }

  clear(): void {
    this.cancelRequests()
    this.postMessage(this.createMessage('clear'))
  }

  private async submit(
    requestId: string,
    conversationId: string,
    prompt: string,
    options: GhostPilotWebviewRequestOptions = {},
    attachments: GhostPilotAttachment[] = []
  ): Promise<void> {
    if (this.requests.has(requestId)) {
      return
    }

    const cancellation = new vscode.CancellationTokenSource()
    this.requests.set(requestId, cancellation)
    this.postMessage({
      source: 'ghostpilot-extension',
      version: GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
      type: 'chat-started',
      requestId,
      conversationId
    })

    const response = {
      markdown: (delta: string) => {
        this.postMessage({
          source: 'ghostpilot-extension',
          version: GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
          type: 'chat-delta',
          requestId,
          conversationId,
          delta
        })
      },
      progress: (progress: string) => {
        this.postMessage({
          source: 'ghostpilot-extension',
          version: GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
          type: 'chat-progress',
          requestId,
          conversationId,
          progress
        })
      }
    } as unknown as vscode.ChatResponseStream

    const safeAttachments = attachments.slice(0, 8).map(attachment => ({
      ...attachment,
      name: attachment.name.slice(0, 200),
      content: attachment.content?.slice(0, 1024 * 1024)
    }))
    const workspaceReferences = safeAttachments.flatMap(attachment => {
      if (!attachment.path) {
        return []
      }
      const uri = vscode.Uri.file(attachment.path)
      return vscode.workspace.getWorkspaceFolder(uri)
        ? [{ value: uri, id: attachment.name, modelDescription: attachment.name }]
        : []
    })
    const droppedContext = safeAttachments
      .filter(attachment => attachment.content)
      .map(attachment => `Dropped attachment: ${attachment.name}\n\n${attachment.content}`)
      .join('\n\n')
    const requestOptions: GhostPilotRequestOptions = {
      ...options,
      additionalContext: droppedContext || undefined
    }

    try {
      await this.chatHandler(
        {
          prompt,
          references: workspaceReferences,
          ghostPilot: requestOptions
        } as unknown as vscode.ChatRequest,
        {} as vscode.ChatContext,
        response,
        cancellation.token
      )
      this.postMessage({
        source: 'ghostpilot-extension',
        version: GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
        type: 'chat-completed',
        requestId,
        conversationId,
        status: cancellation.token.isCancellationRequested ? 'cancelled' : 'completed'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GhostPilot request failed'
      this.postMessage({
        source: 'ghostpilot-extension',
        version: GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
        type: 'chat-error',
        requestId,
        conversationId,
        error: message
      })
    } finally {
      this.requests.delete(requestId)
      cancellation.dispose()
    }
  }

  private cancel(requestId: string): void {
    this.requests.get(requestId)?.cancel()
  }

  private cancelRequests(): void {
    for (const request of this.requests.values()) {
      request.cancel()
    }
  }

  private async sendControlsState(): Promise<void> {
    const settings = getGhostPilotSettings()
    let models: string[] = []
    let connection: 'online' | 'offline' | 'unknown' = 'unknown'

    try {
      const client = settings.provider === 'mlx-vlm'
        ? new MlxClient(settings.mlxUrl)
        : new OllamaClient(settings.ollamaUrl, settings.provider === 'openai-compatible' ? 'openai-compatible' : 'auto')
      const online = await client.checkHealth(1500)
      connection = online ? 'online' : 'offline'
      if (online) {
        models = await client.listModels()
      }
    } catch {
      connection = 'offline'
    }

    if (models.length === 0) {
      models = [settings.chatModel]
    }

    const editor = vscode.window.activeTextEditor
    const activeFile = editor
      ? {
          name: editor.document.fileName.split(/[\\/]/).pop() ?? editor.document.fileName,
          path: editor.document.uri.fsPath,
          languageId: editor.document.languageId,
          hasSelection: !editor.selection.isEmpty
        }
      : undefined
    const openFiles = vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => tab.label))
    const folders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? []

    this.postMessage({
      source: 'ghostpilot-extension',
      version: GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
      type: 'controls-state',
      settings: {
        provider: settings.provider,
        chatModel: settings.chatModel,
        autocompleteModel: settings.autocompleteModel,
        maxContextTokens: settings.maxContextTokens,
        temperature: settings.temperature,
        responseLength: settings.responseLength,
        mode: settings.mode
      },
      models,
      connection,
      context: {
        workspaceName: vscode.workspace.name ?? 'Untitled workspace',
        folders,
        ...(activeFile ? { activeFile } : {}),
        openFiles
      },
      tools: [
        'ghostpilot_read_file',
        'ghostpilot_write_file',
        'ghostpilot_run_terminal_command',
        'ghostpilot_list_directory'
      ]
    })
  }

  private async updateSettings(update: GhostPilotSettingsUpdate): Promise<void> {
    if (update.provider) {
      await ghostPilotConfig.update('provider', update.provider)
    }
    if (typeof update.chatModel === 'string' && update.chatModel.trim()) {
      await ghostPilotConfig.update('chatModel', update.chatModel.trim())
    }
    if (typeof update.autocompleteModel === 'string' && update.autocompleteModel.trim()) {
      await ghostPilotConfig.update('autocompleteModel', update.autocompleteModel.trim())
    }
    if (typeof update.maxContextTokens === 'number' && Number.isFinite(update.maxContextTokens)) {
      await ghostPilotConfig.update('maxContextTokens', Math.max(1, Math.floor(update.maxContextTokens)))
    }
    if (typeof update.temperature === 'number' && Number.isFinite(update.temperature)) {
      await ghostPilotConfig.update('temperature', Math.min(2, Math.max(0, update.temperature)))
    }
    if (update.responseLength) {
      await ghostPilotConfig.update('responseLength', update.responseLength)
    }
    if (update.mode) {
      await ghostPilotConfig.update('mode', update.mode)
    }
    await this.sendControlsState()
  }

  private async pickFiles(): Promise<void> {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      canSelectFiles: true,
      openLabel: 'Attach to GhostPilot'
    })
    if (!files) {
      return
    }
    this.postMessage({
      source: 'ghostpilot-extension',
      version: GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
      type: 'file-picked',
      attachments: files.map(file => ({ name: file.path.split(/[\\/]/).pop() ?? file.fsPath, path: file.fsPath }))
    })
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
    this.cancelRequests()
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
      case 'check-status':
        await vscode.commands.executeCommand('ghostpilot.checkOllamaStatus')
        return
      case 'submit':
        await this.submit(value.requestId, value.conversationId, value.prompt, value.options, value.attachments)
        return
      case 'cancel':
        this.cancel(value.requestId)
        return
      case 'load-controls':
      case 'refresh-models':
        await this.sendControlsState()
        return
      case 'update-settings':
        await this.updateSettings(value.settings)
        return
      case 'pick-file':
        await this.pickFiles()
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

      .control-strip {
        align-items: center;
        border-bottom: 1px solid var(--ghostpilot-border);
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 7px 10px;
      }

      .control-label {
        color: var(--vscode-descriptionForeground);
        font-size: 0.78em;
      }

      select,
      input[type='text'],
      input[type='search'],
      input[type='number'],
      textarea {
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, var(--ghostpilot-border));
        border-radius: 2px;
        color: var(--vscode-input-foreground);
        font: inherit;
      }

      .control-strip select {
        max-width: 150px;
        min-width: 0;
        padding: 3px 5px;
      }

      .connection-indicator {
        align-items: center;
        color: var(--vscode-descriptionForeground);
        display: flex;
        font-size: 0.78em;
        gap: 4px;
        margin-left: auto;
        white-space: nowrap;
      }

      .connection-indicator .status-dot {
        background: var(--vscode-descriptionForeground);
      }

      .connection-indicator.online .status-dot {
        background: var(--vscode-testing-iconPassed, #73c991);
      }

      .connection-indicator.offline .status-dot {
        background: var(--vscode-testing-iconFailed, #f14c4c);
      }

      .control-button,
      .context-button {
        background: transparent;
        border: 1px solid var(--ghostpilot-border);
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        padding: 3px 7px;
      }

      .control-button:hover,
      .context-button:hover {
        color: var(--vscode-foreground);
      }

      .context-row {
        align-items: center;
        display: flex;
        gap: 5px;
        min-height: 25px;
      }

      .context-chips,
      .attachment-list {
        display: flex;
        flex: 1;
        flex-wrap: wrap;
        gap: 4px;
        min-width: 0;
      }

      .context-chip,
      .attachment-chip {
        background: var(--vscode-badge-background);
        border: 0;
        border-radius: 10px;
        color: var(--vscode-badge-foreground);
        font-size: 0.75em;
        max-width: 180px;
        overflow: hidden;
        padding: 3px 7px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .context-chip.removed {
        background: transparent;
        border: 1px dashed var(--ghostpilot-border);
        color: var(--vscode-descriptionForeground);
      }

      .attachment-list:empty {
        display: none;
      }

      .attachment-list {
        margin: 4px 0;
      }

      .attachment-chip {
        align-items: center;
        display: inline-flex;
        gap: 4px;
      }

      .attachment-chip button {
        background: transparent;
        border: 0;
        color: inherit;
        padding: 0;
      }

      .prompt-wrap {
        position: relative;
      }

      .mention-menu {
        background: var(--vscode-quickInput-background, var(--ghostpilot-surface));
        border: 1px solid var(--ghostpilot-border);
        border-radius: 3px;
        bottom: calc(100% + 4px);
        box-shadow: 0 4px 12px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.25));
        left: 0;
        max-height: 180px;
        overflow: auto;
        position: absolute;
        width: min(100%, 300px);
        z-index: 2;
      }

      .mention-option,
      .history-item {
        background: transparent;
        border: 0;
        color: var(--vscode-foreground);
        display: block;
        overflow: hidden;
        padding: 7px 9px;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
      }

      .mention-option:hover,
      .history-item:hover {
        background: var(--vscode-list-hoverBackground);
      }

      .modal-backdrop {
        align-items: center;
        background: var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
        display: flex;
        inset: 0;
        justify-content: center;
        padding: 16px;
        position: fixed;
        z-index: 5;
      }

      .modal {
        background: var(--vscode-quickInput-background, var(--ghostpilot-surface));
        border: 1px solid var(--ghostpilot-border);
        border-radius: 5px;
        box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35));
        max-height: 90vh;
        max-width: 460px;
        overflow: auto;
        padding: 14px;
        width: 100%;
      }

      .modal-header,
      .modal-footer,
      .modal-subheader,
      .preset-row {
        align-items: center;
        display: flex;
        gap: 8px;
        justify-content: space-between;
      }

      .modal-header h2,
      .modal-subheader h3 {
        font-size: 1em;
        margin: 0;
      }

      .settings-grid {
        display: grid;
        gap: 8px;
        grid-template-columns: 1fr 1fr;
        margin: 16px 0;
      }

      .settings-grid label {
        align-self: center;
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
      }

      .settings-grid input,
      .settings-grid select,
      .preset-section input,
      .preset-section textarea,
      #history-search {
        padding: 5px 7px;
        width: 100%;
      }

      .preset-section {
        border-top: 1px solid var(--ghostpilot-border);
        padding-top: 12px;
      }

      .preset-section > * {
        margin-bottom: 8px;
      }

      .preset-row select {
        flex: 1;
      }

      .modal-description {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        line-height: 1.4;
      }

      .context-preview,
      .history-list {
        margin: 12px 0;
      }

      .context-preview-item {
        align-items: center;
        border-bottom: 1px solid var(--ghostpilot-border);
        display: flex;
        gap: 8px;
        padding: 8px 0;
      }

      .context-preview-item span {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .context-preview-item small {
        color: var(--vscode-descriptionForeground);
      }

      .history-list {
        max-height: 260px;
        overflow: auto;
      }

      .history-item {
        border-bottom: 1px solid var(--ghostpilot-border);
      }

      .composer.dragging {
        border-color: var(--vscode-focusBorder);
        outline: 1px dashed var(--vscode-focusBorder);
      }

      .header-actions,
      .sidebar-header,
      .composer-footer,
      .status-footer,
      .message-header,
      .message-actions,
      .code-header,
      .conversation-item {
        align-items: center;
        display: flex;
      }

      .header-actions {
        gap: 4px;
      }

      .icon-button {
        align-items: center;
        background: transparent;
        border-color: transparent;
        color: var(--vscode-descriptionForeground);
        display: inline-flex;
        justify-content: center;
        min-height: 26px;
        min-width: 26px;
        padding: 2px 6px;
      }

      .icon-button:hover,
      .conversation-action:hover {
        background: var(--vscode-toolbar-hoverBackground);
        color: var(--vscode-foreground);
      }

      .chat-layout {
        display: flex;
        flex: 1;
        min-height: 0;
      }

      .sidebar {
        border-right: 1px solid var(--ghostpilot-border);
        display: flex;
        flex: 0 0 166px;
        flex-direction: column;
        min-width: 0;
      }

      .sidebar-header {
        border-bottom: 1px solid var(--ghostpilot-border);
        justify-content: space-between;
        padding: 8px;
      }

      .sidebar-title {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        font-weight: 600;
        text-transform: uppercase;
      }

      .conversation-list {
        overflow: auto;
        padding: 4px;
      }

      .conversation-item {
        border-radius: 3px;
        gap: 2px;
        margin-bottom: 2px;
        min-width: 0;
      }

      .conversation-item.active {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
      }

      .conversation-select {
        background: transparent;
        border: 0;
        color: inherit;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        padding: 7px 5px 7px 8px;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .conversation-select:hover {
        background: transparent;
      }

      .conversation-actions {
        display: flex;
        opacity: 0;
      }

      .conversation-item:hover .conversation-actions,
      .conversation-item:focus-within .conversation-actions {
        opacity: 1;
      }

      .conversation-action {
        background: transparent;
        border: 0;
        color: var(--vscode-descriptionForeground);
        padding: 4px;
      }

      .chat-main {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      }

      .messages {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 16px 12px;
        scroll-behavior: smooth;
      }

      .state-card {
        background: var(--ghostpilot-surface);
        border: 1px solid var(--ghostpilot-border);
        border-radius: 6px;
        margin: auto;
        max-width: 420px;
        padding: 24px 18px;
        text-align: center;
      }

      .state-icon {
        color: var(--ghostpilot-accent);
        font-size: 24px;
        font-weight: 700;
        margin-bottom: 8px;
      }

      .state-card h1 {
        font-size: 1.1em;
        margin: 0 0 8px;
      }

      .state-card p {
        color: var(--vscode-descriptionForeground);
        line-height: 1.45;
        margin: 6px 0;
      }

      .state-help {
        font-size: 0.9em;
      }

      .message {
        margin: 0 auto 18px;
        max-width: 780px;
      }

      .message.user {
        background: var(--vscode-textBlockQuote-background, var(--ghostpilot-surface));
        border-left: 2px solid var(--ghostpilot-accent);
        border-radius: 3px;
        padding: 10px 12px;
      }

      .message-header {
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        justify-content: space-between;
        margin-bottom: 6px;
      }

      .message-header strong {
        color: var(--vscode-foreground);
      }

      .message-state {
        font-style: italic;
      }

      .message-body {
        line-height: 1.5;
        overflow-wrap: anywhere;
      }

      .message-body p,
      .message-body h1,
      .message-body h2,
      .message-body h3,
      .message-body ul,
      .message-body table {
        margin: 0 0 10px;
      }

      .message-body p:last-child,
      .message-body ul:last-child,
      .message-body table:last-child {
        margin-bottom: 0;
      }

      .message-body h1,
      .message-body h2,
      .message-body h3 {
        font-size: 1.1em;
      }

      .message-body a {
        color: var(--vscode-textLink-foreground);
      }

      .message-body code {
        background: var(--vscode-textCodeBlock-background);
        border-radius: 3px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.92em;
        padding: 1px 4px;
      }

      .code-block {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--ghostpilot-border);
        border-radius: 4px;
        margin: 10px 0;
        overflow: hidden;
      }

      .code-header {
        background: var(--vscode-editorWidget-background);
        border-bottom: 1px solid var(--ghostpilot-border);
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        justify-content: space-between;
        padding: 4px 8px;
      }

      .code-copy {
        background: transparent;
        border: 0;
        color: var(--vscode-textLink-foreground);
        padding: 2px 4px;
      }

      .code-block pre {
        margin: 0;
        overflow: auto;
        padding: 10px;
      }

      .code-block pre code {
        background: transparent;
        padding: 0;
        white-space: pre;
      }

      .code-comment {
        color: var(--vscode-charts-green, #6a9955);
      }

      .code-string {
        color: var(--vscode-debugTokenExpression-string, #ce9178);
      }

      .code-number {
        color: var(--vscode-debugTokenExpression-number, #b5cea8);
      }

      .code-keyword {
        color: var(--vscode-debugTokenExpression-name, #569cd6);
      }

      .message-actions {
        gap: 6px;
        margin-top: 8px;
        opacity: 0;
      }

      .message:hover .message-actions,
      .message:focus-within .message-actions,
      .message.error .message-actions {
        opacity: 1;
      }

      .message-action {
        background: transparent;
        border: 0;
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        padding: 2px 4px;
      }

      .message-action:hover {
        color: var(--vscode-textLink-foreground);
      }

      .message.error .message-body {
        color: var(--vscode-errorForeground);
      }

      .composer {
        border: 1px solid var(--ghostpilot-border);
        border-radius: 4px;
        margin: 0 12px 8px;
        padding: 8px;
      }

      .composer:focus-within {
        border-color: var(--vscode-focusBorder);
      }

      .composer textarea {
        background: transparent;
        border: 0;
        color: var(--vscode-input-foreground);
        display: block;
        font: inherit;
        line-height: 1.45;
        max-height: 180px;
        min-height: 24px;
        outline: 0;
        overflow-y: hidden;
        padding: 2px;
        resize: none;
        width: 100%;
      }

      .composer textarea::placeholder {
        color: var(--vscode-input-placeholderForeground);
      }

      .composer-footer {
        color: var(--vscode-descriptionForeground);
        gap: 8px;
        font-size: 0.78em;
        margin-top: 6px;
      }

      .composer-hint {
        flex: 1;
      }

      .composer-count {
        white-space: nowrap;
      }

      .stop-button {
        background: transparent;
        border-color: var(--vscode-errorForeground);
        color: var(--vscode-errorForeground);
      }

      .status-footer {
        border-top: 1px solid var(--ghostpilot-border);
        color: var(--vscode-descriptionForeground);
        font-size: 0.8em;
        gap: 6px;
        padding: 7px 12px;
      }

      .status-footer.busy .status-dot {
        background: var(--ghostpilot-accent);
      }

      .status-footer.offline .status-dot {
        background: var(--vscode-testing-iconFailed, #f14c4c);
      }

      .screen-reader-only,
      .screen-reader-status {
        height: 1px;
        margin: -1px;
        overflow: hidden;
        position: absolute;
        width: 1px;
        clip: rect(0, 0, 0, 0);
      }

      @media (max-width: 500px) {
        .sidebar {
          flex-basis: 132px;
        }

        .composer-hint {
          display: none;
        }
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
