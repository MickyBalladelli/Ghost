type GhostPilotViewStatus = 'ready' | 'offline'

type GhostPilotExtensionMessage =
  | {
      source: 'ghostpilot-extension'
      version: 1
      type: 'state'
      status: GhostPilotViewStatus
      detail: string
    }
  | {
      source: 'ghostpilot-extension'
      version: 1
      type: 'reset' | 'clear'
    }

interface GhostPilotWebviewApi {
  postMessage(message: unknown): void
}

declare function acquireVsCodeApi(): GhostPilotWebviewApi

const vscode = acquireVsCodeApi()
const app = document.getElementById('app')

if (!app) {
  throw new Error('GhostPilot webview root is missing')
}

app.innerHTML = `
  <div class="app">
    <header class="header">
      <div>
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">✦</span>
          <span class="title">GhostPilot</span>
        </div>
        <div class="subtitle">Local-first coding assistant</div>
      </div>
      <div class="status" id="status" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        <span id="status-text">Ready</span>
      </div>
    </header>
    <main class="content">
      <section class="empty-state" aria-labelledby="welcome-title">
        <h1 id="welcome-title">GhostPilot is ready</h1>
        <p id="welcome-copy">Open a chat when you are ready. Your local provider and workspace tools will stay inside VS Code.</p>
      </section>
      <div class="actions" aria-label="Interface actions">
        <button type="button" id="export">Export</button>
        <button type="button" id="clear" class="secondary">Clear</button>
        <button type="button" id="reset" class="secondary">Reset</button>
      </div>
    </main>
    <footer class="footer">GhostPilot does not send data until you submit a prompt.</footer>
  </div>
`

const post = (type: 'ready' | 'reset' | 'clear' | 'export') => {
  vscode.postMessage({
    source: 'ghostpilot-webview',
    version: 1,
    type
  })
}

const isExtensionMessage = (value: unknown): value is GhostPilotExtensionMessage => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const message = value as Record<string, unknown>
  if (message.source !== 'ghostpilot-extension' || message.version !== 1) {
    return false
  }

  if (message.type === 'state') {
    return (
      (message.status === 'ready' || message.status === 'offline') &&
      typeof message.detail === 'string'
    )
  }

  return message.type === 'reset' || message.type === 'clear'
}

const setStatus = (status: GhostPilotViewStatus, detail: string) => {
  const statusElement = document.getElementById('status')
  const statusText = document.getElementById('status-text')
  if (!statusElement || !statusText) {
    return
  }

  statusElement.classList.toggle('offline', status === 'offline')
  statusText.textContent = status === 'ready' ? 'Ready' : 'Offline'
  statusElement.setAttribute('aria-label', detail)
}

window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || !isExtensionMessage(event.data)) {
    return
  }

  if (event.data.type === 'state') {
    setStatus(event.data.status, event.data.detail)
    return
  }

  if (event.data.type === 'reset') {
    setStatus('ready', 'Local interface ready')
  }
})

document.getElementById('export')?.addEventListener('click', () => post('export'))
document.getElementById('clear')?.addEventListener('click', () => post('clear'))
document.getElementById('reset')?.addEventListener('click', () => post('reset'))

post('ready')
