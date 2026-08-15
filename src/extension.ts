import * as vscode from 'vscode'

import { createChatParticipant } from './agent/chatParticipant'
import { localPilotConfig } from './config'
import { createInlineCompletionProvider } from './providers/inlineCompletionProvider'

export function activate(context: vscode.ExtensionContext) {
  const helloWorldCommand = vscode.commands.registerCommand('localpilot-ai.helloWorld', () => {
    vscode.window.showInformationMessage('LocalPilot AI is ready.')
  })
  const inlineProvider = createInlineCompletionProvider()
  const inlineProviderRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    inlineProvider
  )
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)

  const updateStatusBar = () => {
    const enabled = localPilotConfig.get('enableInlineCompletions')
    statusBar.text = enabled
      ? '$(sparkle) LocalPilot: Inline On'
      : '$(circle-slash) LocalPilot: Inline Off'
    statusBar.tooltip = enabled
      ? 'LocalPilot inline completions are enabled. Click to disable.'
      : 'LocalPilot inline completions are disabled. Click to enable.'
    statusBar.command = 'localpilot.toggleInline'
    statusBar.show()
  }

  const toggleInlineCommand = vscode.commands.registerCommand('localpilot.toggleInline', async () => {
    const enabled = localPilotConfig.get('enableInlineCompletions')
    await localPilotConfig.update('enableInlineCompletions', !enabled)
    updateStatusBar()
  })
  const configurationListener = localPilotConfig.onDidChange((settings, event) => {
    if (event.affectsConfiguration('localpilot.enableInlineCompletions')) {
      updateStatusBar()
    }
  })
  const chatParticipant = createChatParticipant()

  updateStatusBar()
  context.subscriptions.push(
    helloWorldCommand,
    inlineProviderRegistration,
    toggleInlineCommand,
    configurationListener,
    statusBar,
    chatParticipant
  )
}

export function deactivate() {}
