import * as vscode from 'vscode'

import { createChatParticipant, createChatParticipantHandler } from './agent/chatParticipant'
import { ghostConfig } from './config'
import { createInlineCompletionProvider } from './providers/inlineCompletionProvider'
import { MlxClient } from './services/mlxClient'
import { OllamaClient } from './services/ollamaClient'
import { checkRequiredOllamaModels } from './ui/modelDiagnostics'
import { GhostViewProvider } from './ui/ghostView'
import { GhostStatusBar } from './ui/statusBar'
import { registerLanguageModelTools } from './tools/registerTools'

export function activate(context: vscode.ExtensionContext) {
  const helloWorldCommand = vscode.commands.registerCommand('ghost.helloWorld', () => {
    vscode.window.showInformationMessage('Ghost is ready.')
  })
  const inlineProvider = createInlineCompletionProvider()
  const inlineProviderRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    inlineProvider
  )
  const statusBar = new GhostStatusBar()
  const inlineStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90)

  const updateInlineStatusBar = () => {
    const enabled = ghostConfig.get('enableInlineCompletions')
    inlineStatusBar.text = enabled
      ? '$(sparkle) Ghost: Inline On'
      : '$(circle-slash) Ghost: Inline Off'
    inlineStatusBar.tooltip = enabled
      ? 'Ghost inline completions are enabled. Click to disable.'
      : 'Ghost inline completions are disabled. Click to enable.'
    inlineStatusBar.command = 'ghost.toggleInline'
    inlineStatusBar.show()
  }

  const toggleInlineCommand = vscode.commands.registerCommand('ghost.toggleInline', async () => {
    const enabled = ghostConfig.get('enableInlineCompletions')
    await ghostConfig.update('enableInlineCompletions', !enabled)
    updateInlineStatusBar()
  })
  const configurationListener = ghostConfig.onDidChange((settings, event) => {
    if (event.affectsConfiguration('ghost.enableInlineCompletions')) {
      updateInlineStatusBar()
    }
    if (event.affectsConfiguration('ghost.provider')) {
      statusBar.setProvider(settings.provider)
    }
  })
  const checkOllamaCommand = vscode.commands.registerCommand('ghost.checkOllamaStatus', async () => {
    const settings = ghostConfig.getSettings()
    statusBar.setProvider(settings.provider)
    const providerLabel = settings.provider === 'mlx-vlm'
      ? 'MLX/VLM'
      : settings.provider === 'openai-compatible'
        ? 'OpenAI-compatible'
        : 'Ollama'
    const client = settings.provider === 'mlx-vlm'
      ? new MlxClient(settings.mlxUrl)
      : new OllamaClient(
          settings.provider === 'openai-compatible' ? settings.openaiUrl : settings.ollamaUrl,
          settings.provider === 'openai-compatible' ? 'openai-compatible' : 'ollama'
        )
    const online = await client.checkHealth()
    statusBar.setStatus(online ? 'ready' : 'offline')
    ghostView.setStatus(online ? 'ready' : 'offline')

    if (online) {
      const endpoint = settings.provider === 'mlx-vlm'
        ? settings.mlxUrl
        : settings.provider === 'openai-compatible'
          ? settings.openaiUrl
          : settings.ollamaUrl
      await vscode.window.showInformationMessage(`${providerLabel} is online at ${endpoint}.`)
    } else {
      const endpoint = settings.provider === 'mlx-vlm'
        ? settings.mlxUrl
        : settings.provider === 'openai-compatible'
          ? settings.openaiUrl
          : settings.ollamaUrl
      await vscode.window.showErrorMessage(`${providerLabel} is offline at ${endpoint}.`)
    }
  })
  const checkModelsCommand = vscode.commands.registerCommand('ghost.checkModels', () => {
    return checkRequiredOllamaModels()
  })
  const ghostView = new GhostViewProvider(context.extensionUri, {
    chatHandler: createChatParticipantHandler({ statusBar }),
    globalState: context.globalState,
    workspaceState: context.workspaceState
  })
  const ghostViewRegistration = vscode.window.registerWebviewViewProvider(
    GhostViewProvider.viewType,
    ghostView,
    { webviewOptions: { retainContextWhenHidden: true } }
  )
  const openGhostView = () => vscode.commands.executeCommand('workbench.view.extension.ghost')
  const openViewCommand = vscode.commands.registerCommand('ghost.open', openGhostView)
  const focusViewCommand = vscode.commands.registerCommand('ghost.focus', openGhostView)
  const resetViewCommand = vscode.commands.registerCommand('ghost.reset', async () => {
    await openGhostView()
    await ghostView.reset()
  })
  const exportViewCommand = vscode.commands.registerCommand('ghost.export', () => {
    return ghostView.export()
  })
  const clearViewCommand = vscode.commands.registerCommand('ghost.clear', async () => {
    await openGhostView()
    ghostView.clear()
  })
  const chatParticipant = createChatParticipant({ statusBar })
  registerLanguageModelTools(context)

  updateInlineStatusBar()
  context.subscriptions.push(
    helloWorldCommand,
    inlineProviderRegistration,
    toggleInlineCommand,
    checkOllamaCommand,
    checkModelsCommand,
    ghostView,
    ghostViewRegistration,
    openViewCommand,
    focusViewCommand,
    resetViewCommand,
    exportViewCommand,
    clearViewCommand,
    configurationListener,
    statusBar,
    inlineStatusBar,
    chatParticipant
  )
}

export function deactivate() {}
