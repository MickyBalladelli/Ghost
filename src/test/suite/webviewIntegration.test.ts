import { strict as assert } from 'node:assert'

import * as vscode from 'vscode'

import {
  GHOST_WEBVIEW_PROTOCOL_VERSION,
  GhostExtensionMessage
} from '../../ui/ghostProtocol'
import { GhostViewProvider } from '../../ui/ghostView'

interface FakeWebview {
  options?: vscode.WebviewOptions
  html: string
  cspSource: string
  asWebviewUri(uri: vscode.Uri): vscode.Uri
  postMessage(message: unknown): Thenable<boolean>
  onDidReceiveMessage(listener: (message: unknown) => unknown): vscode.Disposable
}

function createFakeView(posted: unknown[], setListener: (listener: (message: unknown) => unknown) => void): vscode.WebviewView {
  const webview: FakeWebview = {
    html: '',
    cspSource: 'vscode-resource:',
    asWebviewUri: uri => uri,
    postMessage: message => {
      posted.push(message)
      return Promise.resolve(true)
    },
    onDidReceiveMessage: listener => {
      setListener(listener)
      return new vscode.Disposable(() => {})
    }
  }

  return {
    webview,
    onDidDispose: () => new vscode.Disposable(() => {})
  } as unknown as vscode.WebviewView
}

function isLifecycleMessage(value: unknown): value is GhostExtensionMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    return false
  }
  return [
    'request-started',
    'thinking',
    'text-delta',
    'request-completed'
  ].includes((value as { type?: string }).type ?? '')
}

suite('Ghost webview integration', function () {
  this.timeout(10_000)

  test('renders the accessible interface and routes a multiline request', async () => {
    const posted: unknown[] = []
    let receivedRequest: vscode.ChatRequest | undefined
    let receive: ((message: unknown) => unknown) | undefined
    const provider = new GhostViewProvider(vscode.Uri.file(process.cwd()), {
      chatHandler: async (request, _context, response) => {
        receivedRequest = request
        response.progress('Preparing request')
        response.markdown('Request complete')
      }
    })
    const view = createFakeView(posted, listener => {
      receive = listener
    })
    provider.resolveWebviewView(view)

    assert.match((view.webview as unknown as FakeWebview).html, /id="messages"/)
    assert.match((view.webview as unknown as FakeWebview).html, /aria-live="polite"/)
    assert.match((view.webview as unknown as FakeWebview).html, /id="settings"/)
    assert.match((view.webview as unknown as FakeWebview).html, /id="attach"/)

    await receive?.({
      source: 'ghost-webview',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'submit',
      requestId: 'request-integration',
      conversationId: 'conversation-integration',
      prompt: 'Explain this\nwith two lines',
      attachments: [{ name: 'snippet.ts', content: 'const answer = 42' }]
    })

    assert.equal(receivedRequest?.prompt, 'Explain this\nwith two lines')
    const requestOptions = receivedRequest as unknown as { ghost?: { additionalContext?: string } }
    assert.match(requestOptions.ghost?.additionalContext ?? '', /snippet\.ts/)
    assert.equal(posted.filter(isLifecycleMessage).some(message => message.type === 'text-delta'), true)
    assert.equal(posted.filter(isLifecycleMessage).at(-1)?.type, 'request-completed')

    provider.dispose()
  })

  test('ignores a duplicate request envelope after completion', async () => {
    const posted: unknown[] = []
    let calls = 0
    let receive: ((message: unknown) => unknown) | undefined
    const provider = new GhostViewProvider(vscode.Uri.file(process.cwd()), {
      chatHandler: async (_request, _context, response) => {
        calls += 1
        response.markdown('done')
      }
    })
    const view = createFakeView(posted, listener => {
      receive = listener
    })
    provider.resolveWebviewView(view)

    const message = {
      source: 'ghost-webview',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'submit',
      requestId: 'duplicate-request',
      conversationId: 'conversation-integration',
      prompt: 'Do this once'
    }
    await receive?.(message)
    await receive?.(message)

    assert.equal(calls, 1)
    provider.dispose()
  })

  test('cancels an active request and resolves a tool approval', async () => {
    const posted: unknown[] = []
    let receive: ((message: unknown) => unknown) | undefined
    let approvalStarted: (() => void) | undefined
    const approvalReady = new Promise<void>(resolve => {
      approvalStarted = resolve
    })
    const provider = new GhostViewProvider(vscode.Uri.file(process.cwd()), {
      chatHandler: async (request, _context, response, token) => {
        const options = request as unknown as { ghost?: { approveTool?: (call: { name: string; arguments: Record<string, unknown> }) => Promise<{ decision: string }> } }
        if (options.ghost?.approveTool) {
          approvalStarted?.()
          const approval = await options.ghost.approveTool({
            name: 'ghost_run_terminal_command',
            arguments: { command: 'echo safe' }
          })
          response.markdown(`Approval: ${approval.decision}`)
        }
        await new Promise<void>(resolve => token.onCancellationRequested(() => resolve()))
      }
    })
    const view = createFakeView(posted, listener => {
      receive = listener
    })
    provider.resolveWebviewView(view)

    const request = {
      source: 'ghost-webview',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'submit',
      requestId: 'approval-request',
      conversationId: 'conversation-integration',
      prompt: 'Run a safe command'
    }
    const submitPromise = receive?.(request)
    await approvalReady
    const toolRequested = posted.find(value => (value as { type?: string }).type === 'tool-requested') as { toolCallId?: string }
    assert.ok(toolRequested?.toolCallId)

    await receive?.({
      source: 'ghost-webview',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'approve-tool',
      requestId: 'approval-request',
      conversationId: 'conversation-integration',
      toolCallId: toolRequested.toolCallId,
      decision: 'once'
    })
    await receive?.({
      source: 'ghost-webview',
      version: GHOST_WEBVIEW_PROTOCOL_VERSION,
      type: 'cancel',
      requestId: 'approval-request',
      conversationId: 'conversation-integration'
    })
    await submitPromise

    assert.equal(posted.filter(isLifecycleMessage).at(-1)?.type, 'request-completed')
    provider.dispose()
  })
})
