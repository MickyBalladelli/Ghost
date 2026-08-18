import * as vscode from 'vscode'

import { createChatParticipant, createChatParticipantHandler } from './agent/chatParticipant'
import { ghostConfig } from './config'
import type { GhostProvider } from './config'
import { createInlineCompletionProvider } from './providers/inlineCompletionProvider'
import { ProviderSecrets } from './services/providerSecrets'
import { GhostViewProvider } from './ui/ghostView'
import { GhostStatusBar } from './ui/statusBar'
import { registerLanguageModelTools } from './tools/registerTools'
import { clearGhostLogs, disposeGhostLogs, effectiveGhostLogLevel, showGhostLogs, writeGhostLog } from './logging/ghostLogger'

export async function activate(context: vscode.ExtensionContext) {
  const activationStartedAt = Date.now()
  const providerSecrets = new ProviderSecrets(context.secrets)
  await providerSecrets.initialize()
  const providerApiKey = (provider: GhostProvider): string | undefined => providerSecrets.get(provider)
  const helloWorldCommand = vscode.commands.registerCommand('ghost.helloWorld', () => {
    vscode.window.showInformationMessage('Ghost is ready.')
  })
  const inlineProvider = createInlineCompletionProvider(ghostConfig, undefined, undefined, () => providerApiKey('openai-compatible'))
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
    const [{ MlxClient }, { OllamaClient }, { createProfiledProviderClient }, { getOpenAiProfile, resolveOpenAiProfileEndpoint }] = await Promise.all([
      import('./services/mlxClient'),
      import('./services/ollamaClient'),
      import('./services/profiledProviderClient'),
      import('./services/providerProfiles')
    ])
    const settings = ghostConfig.getSettings()
    statusBar.setProvider(settings.provider)
    const providerLabel = settings.provider === 'mlx-vlm'
      ? 'MLX/VLM'
      : settings.provider === 'openai-compatible'
        ? getOpenAiProfile(settings.openaiProfile).label
        : 'Ollama'
    const client = settings.provider === 'mlx-vlm'
      ? new MlxClient(settings.mlxUrl, undefined, () => providerApiKey('mlx-vlm'))
      : settings.provider === 'openai-compatible'
        ? createProfiledProviderClient(settings, () => providerApiKey('openai-compatible'))
        : new OllamaClient(settings.ollamaUrl, 'ollama', undefined, () => providerApiKey('ollama'))
    const online = await client.checkHealth()
    statusBar.setStatus(online ? 'ready' : 'offline')
    ghostView.setStatus(online ? 'ready' : 'offline')

    if (online) {
      const endpoint = settings.provider === 'mlx-vlm'
        ? settings.mlxUrl
        : settings.provider === 'openai-compatible'
          ? resolveOpenAiProfileEndpoint(settings.openaiProfile, settings.openaiUrl)
          : settings.ollamaUrl
      await vscode.window.showInformationMessage(`${providerLabel} is online at ${endpoint}.`)
    } else {
      const endpoint = settings.provider === 'mlx-vlm'
        ? settings.mlxUrl
        : settings.provider === 'openai-compatible'
          ? resolveOpenAiProfileEndpoint(settings.openaiProfile, settings.openaiUrl)
          : settings.ollamaUrl
      await vscode.window.showErrorMessage(`${providerLabel} is offline at ${endpoint}.`)
    }
  })
  const checkModelsCommand = vscode.commands.registerCommand('ghost.checkModels', async () => {
    const { checkRequiredOllamaModels } = await import('./ui/modelDiagnostics')
    return checkRequiredOllamaModels(ghostConfig, () => providerApiKey('ollama'))
  })
  const setProviderApiKeyCommand = vscode.commands.registerCommand('ghost.setProviderApiKey', async () => {
    const provider = ghostConfig.getSettings().provider
    const value = await vscode.window.showInputBox({
      prompt: `Enter the ${provider} API key`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Stored in VS Code SecretStorage'
    })
    if (value === undefined) {
      return
    }
    await providerSecrets.set(provider, value)
    await vscode.window.showInformationMessage(`${provider} API key stored securely.`)
  })
  const clearProviderApiKeyCommand = vscode.commands.registerCommand('ghost.clearProviderApiKey', async () => {
    const provider = ghostConfig.getSettings().provider
    await providerSecrets.clear(provider)
    await vscode.window.showInformationMessage(`${provider} API key removed.`)
  })
  const ghostView = new GhostViewProvider(context.extensionUri, {
    chatHandler: createChatParticipantHandler({ statusBar, providerApiKey }),
    providerApiKey,
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
  const openLogsCommand = vscode.commands.registerCommand('ghost.openLogs', () => {
    showGhostLogs()
  })
  const clearLogsCommand = vscode.commands.registerCommand('ghost.clearLogs', () => {
    clearGhostLogs()
    void vscode.window.showInformationMessage('Ghost logs cleared.')
  })
  const chatParticipant = createChatParticipant({ statusBar, providerApiKey })
  registerLanguageModelTools(context)

  updateInlineStatusBar()
  writeGhostLog(
    'info',
    effectiveGhostLogLevel(ghostConfig.get('logLevel'), ghostConfig.get('enableDebugLogging')),
    'extension activated',
    { activationMs: Date.now() - activationStartedAt }
  )
  context.subscriptions.push(
    helloWorldCommand,
    inlineProviderRegistration,
    inlineProvider,
    toggleInlineCommand,
    checkOllamaCommand,
    checkModelsCommand,
    setProviderApiKeyCommand,
    clearProviderApiKeyCommand,
    ghostView,
    ghostViewRegistration,
    openViewCommand,
    focusViewCommand,
    resetViewCommand,
    exportViewCommand,
    clearViewCommand,
    openLogsCommand,
    clearLogsCommand,
    configurationListener,
    statusBar,
    inlineStatusBar,
    chatParticipant
  )
}

export function deactivate() {
  disposeGhostLogs()
}
