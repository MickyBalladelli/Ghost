import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'

export function getGhostWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString('base64')
  const asset = (file: string): vscode.Uri => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', file))
  const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'icon.png'))
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    "connect-src 'none'"
  ].join('; ')
  const scripts = [
    'ghostWebviewConversationStore.js',
    'ghostWebviewProtocolClient.js',
    'ghostWebviewSettingsStore.js',
    'ghostWebviewHistory.js',
    'ghostWebviewRendering.js',
    'ghostWebviewShell.js',
    'ghostWebviewToolTimeline.js',
    'ghostWebviewComposer.js',
    'ghostWebviewModals.js',
    'ghostWebviewAccessibility.js',
    'ghostWebview.js'
  ]

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ghost</title>
    <link rel="stylesheet" href="${asset('ghostWebview.css')}" nonce="${nonce}">
  </head>
  <body data-ghost-icon="${iconUri}">
    <div id="app"></div>
    ${scripts.map(file => `<script nonce="${nonce}" src="${asset(file)}"></script>`).join('\n    ')}
  </body>
</html>`
}
