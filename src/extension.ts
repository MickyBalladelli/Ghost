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
import { redactSensitiveText } from './privacy/redact'

export async function activate(context: vscode.ExtensionContext) {
  const activationStartedAt = Date.now()
  const providerSecrets = new ProviderSecrets(context.secrets)
  await providerSecrets.initialize()
  await ghostConfig.migrateSettings()
  const providerApiKey = (provider: GhostProvider): string | undefined => providerSecrets.get(provider)
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
  const checkProviderStatus = async () => {
    const [{ MlxClient }, { OllamaClient }, { createProfiledProviderClient }, { getOpenAiProfile, resolveOpenAiProfileEndpoint }, { OpenCodeClient }] = await Promise.all([
      import('./services/mlxClient'),
      import('./services/ollamaClient'),
      import('./services/profiledProviderClient'),
      import('./services/providerProfiles'),
      import('./services/openCodeClient')
    ])
    const settings = ghostConfig.getSettings()
    statusBar.setProvider(settings.provider)
    const providerLabel = settings.provider === 'opencode'
      ? 'OpenCode'
      : settings.provider === 'mlx-vlm'
      ? 'MLX/VLM'
      : settings.provider === 'openai-compatible'
        ? getOpenAiProfile(settings.openaiProfile).label
        : 'Ollama'
    const client = settings.provider === 'opencode'
      ? new OpenCodeClient(settings.openCodeUrl, {
          username: settings.openCodeUsername,
          password: () => providerApiKey('opencode')
        })
      : settings.provider === 'mlx-vlm'
      ? new MlxClient(settings.mlxUrl, undefined, () => providerApiKey('mlx-vlm'))
      : settings.provider === 'openai-compatible'
        ? createProfiledProviderClient(settings, () => providerApiKey('openai-compatible'))
        : new OllamaClient(settings.ollamaUrl, 'ollama', undefined, () => providerApiKey('ollama'))
    const openCodeHealth = settings.provider === 'opencode' && client instanceof OpenCodeClient
      ? await client.health()
      : undefined
    const online = openCodeHealth ? openCodeHealth.healthy && openCodeHealth.compatible : await client.checkHealth()
    statusBar.setStatus(online ? 'ready' : 'offline')
    ghostView.setStatus(online ? 'ready' : 'offline')

    if (openCodeHealth?.healthy && !openCodeHealth.compatible) {
      await vscode.window.showErrorMessage(`OpenCode ${openCodeHealth.version ?? 'unknown'} is not compatible. Ghost supports OpenCode 1.x.`)
    } else if (online) {
      const endpoint = settings.provider === 'opencode'
        ? settings.openCodeUrl
        : settings.provider === 'mlx-vlm'
        ? settings.mlxUrl
        : settings.provider === 'openai-compatible'
          ? resolveOpenAiProfileEndpoint(settings.openaiProfile, settings.openaiUrl)
          : settings.ollamaUrl
      await vscode.window.showInformationMessage(`${providerLabel} is online at ${endpoint}.`)
    } else if (openCodeHealth?.error) {
      await vscode.window.showErrorMessage(`OpenCode connection failed: ${redactSensitiveText(openCodeHealth.error)}`)
    } else {
      const endpoint = settings.provider === 'opencode'
        ? settings.openCodeUrl
        : settings.provider === 'mlx-vlm'
        ? settings.mlxUrl
        : settings.provider === 'openai-compatible'
          ? resolveOpenAiProfileEndpoint(settings.openaiProfile, settings.openaiUrl)
          : settings.ollamaUrl
      await vscode.window.showErrorMessage(`${providerLabel} is offline at ${endpoint}.`)
    }
  }
  const checkProviderCommand = vscode.commands.registerCommand('ghost.checkProviderStatus', checkProviderStatus)
  const checkOllamaCommand = vscode.commands.registerCommand('ghost.checkOllamaStatus', checkProviderStatus)
  const checkModelsCommand = vscode.commands.registerCommand('ghost.checkModels', async () => {
    const { checkRequiredOllamaModels } = await import('./ui/modelDiagnostics')
    return checkRequiredOllamaModels(ghostConfig, () => providerApiKey('ollama'))
  })
  const setProviderApiKeyCommand = vscode.commands.registerCommand('ghost.setProviderApiKey', async () => {
    const provider = ghostConfig.getSettings().provider
    const value = await vscode.window.showInputBox({
      prompt: provider === 'opencode' ? 'Enter the OpenCode server password' : `Enter the ${provider} API key`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'Stored in VS Code SecretStorage'
    })
    if (value === undefined) {
      return
    }
    await providerSecrets.set(provider, value)
    await vscode.window.showInformationMessage(provider === 'opencode' ? 'OpenCode password stored securely.' : `${provider} API key stored securely.`)
  })
  const clearProviderApiKeyCommand = vscode.commands.registerCommand('ghost.clearProviderApiKey', async () => {
    const provider = ghostConfig.getSettings().provider
    await providerSecrets.clear(provider)
    await vscode.window.showInformationMessage(provider === 'opencode' ? 'OpenCode password removed.' : `${provider} API key removed.`)
  })
  const selectedWorkspaceRoot = (): string | undefined => {
    const active = vscode.window.activeTextEditor
      ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri.fsPath
      : undefined
    return active ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  }
  const selectedConversationId = (): string | undefined => {
    const state = context.workspaceState.get<{ activeConversationId?: unknown }>(GhostViewProvider.workspaceStateKey)
    return typeof state?.activeConversationId === 'string' && state.activeConversationId.trim()
      ? state.activeConversationId
      : undefined
  }
  const newOpenCodeSessionCommand = vscode.commands.registerCommand('ghost.newOpenCodeSession', async () => {
    const directory = selectedWorkspaceRoot()
    if (!directory) {
      await vscode.window.showErrorMessage('Open a workspace before creating an OpenCode session.')
      return
    }
    const conversationId = selectedConversationId()
    if (!conversationId) {
      await vscode.window.showErrorMessage('Open a Ghost conversation before creating an OpenCode session.')
      return
    }
    const { openCodeSessionStorageKey } = await import('./services/openCodeClient')
    await context.workspaceState.update(openCodeSessionStorageKey(directory, conversationId), undefined)
    await vscode.window.showInformationMessage('Ghost will create a new OpenCode session for this conversation on the next request.')
  })
  const selectOpenCodeSessionCommand = vscode.commands.registerCommand('ghost.selectOpenCodeSession', async () => {
    const directory = selectedWorkspaceRoot()
    if (!directory) {
      await vscode.window.showErrorMessage('Open a workspace before selecting an OpenCode session.')
      return
    }
    const conversationId = selectedConversationId()
    if (!conversationId) {
      await vscode.window.showErrorMessage('Open a Ghost conversation before selecting an OpenCode session.')
      return
    }
    const { OpenCodeClient, openCodeSessionStorageKey } = await import('./services/openCodeClient')
    const settings = ghostConfig.getSettings()
    const client = new OpenCodeClient(settings.openCodeUrl, {
      username: settings.openCodeUsername,
      password: () => providerApiKey('opencode')
    })
    const sessions = (await client.listSessions(directory)).filter(session => session.directory === directory)
    if (sessions.length === 0) {
      await vscode.window.showInformationMessage('OpenCode has no sessions for this workspace.')
      return
    }
    const selected = await vscode.window.showQuickPick(sessions.map(session => ({
      label: session.title,
      description: session.id,
      session
    })), { placeHolder: 'Choose the OpenCode session Ghost should resume' })
    if (!selected) return
    await context.workspaceState.update(openCodeSessionStorageKey(directory, conversationId), selected.session.id)
    await vscode.window.showInformationMessage(`Ghost selected OpenCode session for this conversation: ${selected.session.title}`)
  })
  const deleteOpenCodeSessionCommand = vscode.commands.registerCommand('ghost.deleteOpenCodeSession', async () => {
    const directory = selectedWorkspaceRoot()
    if (!directory) return
    const { OpenCodeClient, openCodeSessionStorageKey } = await import('./services/openCodeClient')
    const conversationId = selectedConversationId()
    if (!conversationId) {
      await vscode.window.showInformationMessage('Ghost has no active conversation.')
      return
    }
    const key = openCodeSessionStorageKey(directory, conversationId)
    const sessionId = context.workspaceState.get<string>(key)
    if (!sessionId) {
      await vscode.window.showInformationMessage('Ghost has no selected OpenCode session for this conversation.')
      return
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Delete OpenCode session ${sessionId}?`,
      { modal: true },
      'Delete session'
    )
    if (confirmed !== 'Delete session') return
    const settings = ghostConfig.getSettings()
    const client = new OpenCodeClient(settings.openCodeUrl, {
      username: settings.openCodeUsername,
      password: () => providerApiKey('opencode')
    })
    await client.deleteSession(sessionId, directory)
    await context.workspaceState.update(key, undefined)
    await vscode.window.showInformationMessage('OpenCode session deleted.')
  })
  const renameOpenCodeSessionCommand = vscode.commands.registerCommand('ghost.renameOpenCodeSession', async () => {
    const directory = selectedWorkspaceRoot()
    if (!directory) return
    const { OpenCodeClient, openCodeSessionStorageKey } = await import('./services/openCodeClient')
    const conversationId = selectedConversationId()
    if (!conversationId) {
      await vscode.window.showInformationMessage('Ghost has no active conversation.')
      return
    }
    const sessionId = context.workspaceState.get<string>(openCodeSessionStorageKey(directory, conversationId))
    if (!sessionId) {
      await vscode.window.showInformationMessage('Ghost has no selected OpenCode session for this conversation.')
      return
    }
    const title = await vscode.window.showInputBox({ prompt: 'Rename the current OpenCode session', validateInput: value => value.trim() ? undefined : 'Enter a title' })
    if (!title?.trim()) return
    const settings = ghostConfig.getSettings()
    const client = new OpenCodeClient(settings.openCodeUrl, {
      username: settings.openCodeUsername,
      password: () => providerApiKey('opencode')
    })
    await client.renameSession(sessionId, directory, title)
    await vscode.window.showInformationMessage(`OpenCode session renamed to ${title.trim()}.`)
  })
  const forkOpenCodeSessionCommand = vscode.commands.registerCommand('ghost.forkOpenCodeSession', async () => {
    const directory = selectedWorkspaceRoot()
    if (!directory) return
    const { OpenCodeClient, openCodeSessionStorageKey } = await import('./services/openCodeClient')
    const conversationId = selectedConversationId()
    if (!conversationId) {
      await vscode.window.showInformationMessage('Ghost has no active conversation.')
      return
    }
    const key = openCodeSessionStorageKey(directory, conversationId)
    const sessionId = context.workspaceState.get<string>(key)
    if (!sessionId) {
      await vscode.window.showInformationMessage('Ghost has no selected OpenCode session for this conversation.')
      return
    }
    const settings = ghostConfig.getSettings()
    const client = new OpenCodeClient(settings.openCodeUrl, {
      username: settings.openCodeUsername,
      password: () => providerApiKey('opencode')
    })
    const fork = await client.forkSession(sessionId, directory)
    await context.workspaceState.update(key, fork.id)
    await vscode.window.showInformationMessage(`Ghost selected forked OpenCode session ${fork.id}.`)
  })
  const selectOpenCodeAgentCommand = vscode.commands.registerCommand('ghost.selectOpenCodeAgent', async () => {
    const directory = selectedWorkspaceRoot()
    if (!directory) return
    const { OpenCodeClient } = await import('./services/openCodeClient')
    const settings = ghostConfig.getSettings()
    const client = new OpenCodeClient(settings.openCodeUrl, {
      username: settings.openCodeUsername,
      password: () => providerApiKey('opencode')
    })
    const agents = await client.listAgents(directory)
    const selected = await vscode.window.showQuickPick([
      { label: 'OpenCode default', description: 'Use the server default agent', id: '' },
      ...agents.map(agent => ({ label: agent.id, description: agent.description, id: agent.id }))
    ], { placeHolder: 'Choose the OpenCode agent Ghost should use' })
    if (!selected) return
    await ghostConfig.update('openCodeAgent', selected.id)
    await vscode.window.showInformationMessage(selected.id ? `Ghost selected OpenCode agent ${selected.id}.` : 'Ghost will use the default OpenCode agent.')
  })
  const ghostView = new GhostViewProvider(context.extensionUri, {
    chatHandler: createChatParticipantHandler({ statusBar, providerApiKey, openCodeSessionStorage: context.workspaceState }),
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
  const openSetupCommand = vscode.commands.registerCommand('ghost.openSetup', async () => {
    await openGhostView()
    ghostView.openSetup()
  })
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
  const chatParticipant = createChatParticipant({
    statusBar,
    providerApiKey,
    openCodeSessionStorage: context.workspaceState,
    approveTool: (call, requestKey) => ghostView.approveChatTool(call, requestKey)
  })
  registerLanguageModelTools(context)

  updateInlineStatusBar()
  writeGhostLog(
    'info',
    effectiveGhostLogLevel(ghostConfig.get('logLevel'), ghostConfig.get('enableDebugLogging')),
    'extension activated',
    { activationMs: Date.now() - activationStartedAt }
  )
  context.subscriptions.push(
    providerSecrets,
    inlineProviderRegistration,
    inlineProvider,
    toggleInlineCommand,
    checkProviderCommand,
    checkOllamaCommand,
    checkModelsCommand,
    setProviderApiKeyCommand,
    clearProviderApiKeyCommand,
    newOpenCodeSessionCommand,
    selectOpenCodeSessionCommand,
    deleteOpenCodeSessionCommand,
    renameOpenCodeSessionCommand,
    forkOpenCodeSessionCommand,
    selectOpenCodeAgentCommand,
    ghostView,
    ghostViewRegistration,
    openViewCommand,
    focusViewCommand,
    openSetupCommand,
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
