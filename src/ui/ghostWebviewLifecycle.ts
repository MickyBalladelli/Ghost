import * as vscode from 'vscode'

import type { GhostExtensionMessage } from './ghostProtocol'

export class GhostWebviewLifecycle {
  view: vscode.WebviewView | undefined
  pendingMessages: GhostExtensionMessage[] = []
  disposed = false

  attach(view: vscode.WebviewView): void {
    this.view = view
  }

  detach(view: vscode.WebviewView): void {
    if (this.view === view) {
      this.view = undefined
    }
  }

  takePendingMessages(): GhostExtensionMessage[] {
    const pendingMessages = this.pendingMessages
    this.pendingMessages = []
    return pendingMessages
  }

  dispose(): void {
    this.disposed = true
    this.view = undefined
    this.pendingMessages = []
  }
}
