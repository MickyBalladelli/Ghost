import * as vscode from 'vscode'

import { createChatParticipant } from './agent/chatParticipant'
import { localPilotConfig } from './config'
import { createInlineCompletionProvider } from './providers/inlineCompletionProvider'
import { OllamaClient } from './services/ollamaClient'
import { checkRequiredOllamaModels } from './ui/modelDiagnostics'
import { LocalPilotStatusBar } from './ui/statusBar'
import { registerLanguageModelTools } from './tools/registerTools'

export function activate(context: vscode.ExtensionContext) {
  const helloWorldCommand = vscode.commands.registerCommand('localpilot-ai.helloWorld', () => {
    vscode.window.showInformationMessage('LocalPilot AI is ready.')
  })
  const inlineProvider = createInlineCompletionProvider()
  const inlineProviderRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    inlineProvider
  )
  const statusBar = new LocalPilotStatusBar()
  const inlineStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90)

  const updateInlineStatusBar = () => {
    const enabled = localPilotConfig.get('enableInlineCompletions')
    inlineStatusBar.text = enabled
      ? '$(sparkle) LocalPilot: Inline On'
      : '$(circle-slash) LocalPilot: Inline Off'
    inlineStatusBar.tooltip = enabled
      ? 'LocalPilot inline completions are enabled. Click to disable.'
      : 'LocalPilot inline completions are disabled. Click to enable.'
    inlineStatusBar.command = 'localpilot.toggleInline'
    inlineStatusBar.show()
  }

  const toggleInlineCommand = vscode.commands.registerCommand('localpilot.toggleInline', async () => {
    const enabled = localPilotConfig.get('enableInlineCompletions')
    await localPilotConfig.update('enableInlineCompletions', !enabled)
    updateInlineStatusBar()
  })
  const configurationListener = localPilotConfig.onDidChange((settings, event) => {
    if (event.affectsConfiguration('localpilot.enableInlineCompletions')) {
      updateInlineStatusBar()
    }
  })
  const checkOllamaCommand = vscode.commands.registerCommand('localpilot.checkOllamaStatus', async () => {
    const settings = localPilotConfig.getSettings()
    const client = new OllamaClient(settings.ollamaUrl)
    const online = await client.checkHealth()
    statusBar.setStatus(online ? 'ready' : 'offline')

    if (online) {
      await vscode.window.showInformationMessage(`Ollama is online at ${settings.ollamaUrl}.`)
    } else {
      await vscode.window.showErrorMessage(`Ollama is offline at ${settings.ollamaUrl}.`)
    }
  })
  const checkModelsCommand = vscode.commands.registerCommand('localpilot.checkModels', () => {
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
