import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'

const source = (file: string): string => readFileSync(path.join(process.cwd(), 'src', file), 'utf8')

const shellSource = source('webview/ghostWebviewShell.ts')
const webviewSource = source('webview/ghostWebview.ts')
const viewSource = source('ui/ghostView.ts')

suite('Accessibility contract audit', () => {
  test('gives every modal dialog semantics and a labelled heading', () => {
    const modalIds = [
      'settings-modal',
      'tool-permissions-modal',
      'terminal-environment-permissions-modal',
      'privacy-modal',
      'context-modal',
      'first-run-modal',
      'history-modal',
      'prompt-history-modal'
    ]

    for (const modalId of modalIds) {
      assert.match(shellSource, new RegExp(`modal\\('${modalId}'`))
    }

    assert.match(shellSource, /role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId/)
    assert.match(shellSource, /id: 'edit-tool-modal'.*role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'edit-tool-title'/)
  })

  test('keeps button names and button type requirements in shell and rendered markup', () => {
    assert.match(shellSource, /const button = .*createElement\('button', \{ id, type: 'button'/)
    assert.match(shellSource, /const closeButton = .*'aria-label': labelText/)

    const renderedButtons = [...webviewSource.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0])
    assert.ok(renderedButtons.length > 0)
    for (const button of renderedButtons) {
      assert.match(button, /type="button"/)
      assert.match(button, /aria-label=|>[^<]*[A-Za-z][^<]*<\/button>/)
    }

    assert.match(webviewSource, /document\.createElement\('button'\)/)
    assert.match(webviewSource, /button\.type = 'button'/)
    assert.match(webviewSource, /button\.textContent =/)
    assert.match(webviewSource, /button\.setAttribute\('aria-label'/)
  })

  test('exposes live status updates to assistive technology', () => {
    const statusIds = [
      'model-profile-effective',
      'model-capabilities',
      'connection-indicator',
      'auto-accept-indicator',
      'attachment-limit',
      'persistence-status',
      'screen-reader-status',
      'status-text',
      'setup-provider-status',
      'setup-model-status',
      'setup-test-status',
      'history-search-summary'
    ]

    for (const statusId of statusIds) {
      assert.match(shellSource, new RegExp(`id: '${statusId}'[^\\n]*role: 'status'[^\\n]*'aria-live': 'polite'`))
    }

    assert.match(shellSource, /role: 'log', 'aria-label': 'Conversation messages', 'aria-live': 'polite'/)
    assert.match(webviewSource, /screenReaderStatusElement\.textContent =/)
    assert.match(webviewSource, /statusTextElement\.textContent =/)
  })

  test('keeps contrast, focus, and motion-safe styling present', () => {
    assert.match(viewSource, /@media \(forced-colors: active\)/)
    assert.match(viewSource, /--ghost-accent: Highlight/)
    assert.match(viewSource, /--ghost-surface: Canvas/)
    assert.match(viewSource, /border-color: ButtonText/)
    assert.match(viewSource, /:focus-visible/)
    assert.match(viewSource, /outline-color: Highlight/)
    assert.match(viewSource, /@media \(prefers-reduced-motion: reduce\)/)
    assert.match(viewSource, /animation-duration: 0\.01ms !important/)
  })

  test('keeps keyboard paths wired to shared accessibility helpers', () => {
    assert.match(webviewSource, /event\.key === 'Tab'/)
    assert.match(webviewSource, /accessibility\.focusWrapTarget\(/)
    assert.match(webviewSource, /event\.key !== 'Escape'/)
    assert.match(webviewSource, /accessibility\.approvalKeyboardAction\(/)
    assert.match(webviewSource, /event\.shiftKey/)
    assert.match(webviewSource, /event\.preventDefault\(\)/)
  })
})
