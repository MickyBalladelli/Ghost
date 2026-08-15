import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('localpilot-ai.helloWorld', () => {
    vscode.window.showInformationMessage('LocalPilot AI is ready.')
  })

  context.subscriptions.push(disposable)
}

export function deactivate() {}
