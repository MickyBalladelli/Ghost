import * as vscode from 'vscode'

import { createChatParticipant } from './agent/chatParticipant'
import { ghostPilotConfig } from './config'
import { createInlineCompletionProvider } from './providers/inlineCompletionProvider'
import { OllamaClient } from './services/ollamaClient'
import { checkRequiredOllamaModels } from './ui/modelDiagnostics'
import { GhostPilotStatusBar } from './ui/statusBar'
import { registerLanguageModelTools } from './tools/registerTools'

export function activate(context: vscode.ExtensionContext) {
  const helloWorldCommand = vscode.commands.registerCommand('ghostpilot-ai.helloWorld', () => {
    vscode.window.showInformationMessage('GhostPilot AI is ready.')
  })
  const inlineProvider = createInlineCompletionProvider()
  const inlineProviderRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    inlineProvider
  )
  const statusBar = new GhostPilotStatusBar()
  const inlineStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90)

  const updateInlineStatusBar = () => {
    const enabled = ghostPilotConfig.get('enableInlineCompletions')
    inlineStatusBar.text = enabled
      ? '$(sparkle) GhostPilot: Inline On'
      : '$(circle-slash) GhostPilot: Inline Off'
    inlineStatusBar.tooltip = enabled
      ? 'GhostPilot inline completions are enabled. Click to disable.'
      : 'GhostPilot inline completions are disabled. Click to enable.'
    inlineStatusBar.command = 'ghostpilot.toggleInline'
    inlineStatusBar.show()
  }

  const toggleInlineCommand = vscode.commands.registerCommand('ghostpilot.toggleInline', async () => {
    const enabled = ghostPilotConfig.get('enableInlineCompletions')
    await ghostPilotConfig.update('enableInlineCompletions', !enabled)
    updateInlineStatusBar()
  })
  const configurationListener = ghostPilotConfig.onDidChange((settings, event) => {
    if (event.affectsConfiguration('ghostpilot.enableInlineCompletions')) {
      updateInlineStatusBar()
    }
  })
  const checkOllamaCommand = vscode.commands.registerCommand('ghostpilot.checkOllamaStatus', async () => {
    const settings = ghostPilotConfig.getSettings()
    const client = new OllamaClient(settings.ollamaUrl)
    const online = await client.checkHealth()
    statusBar.setStatus(online ? 'ready' : 'offline')

    if (online) {
      await vscode.window.showInformationMessage(`Ollama is online at ${settings.ollamaUrl}.`)
    } else {
      await vscode.window.showErrorMessage(`Ollama is offline at ${settings.ollamaUrl}.`)
    }
  })
  const checkModelsCommand = vscode.commands.registerCommand('ghostpilot.checkModels', () => {
    return checkRequiredOllamaModels()
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
    configurationListener,
    statusBar,
    inlineStatusBar,
    chatParticipant
  )
}

export function deactivate() {}
