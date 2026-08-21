import { strict as assert } from 'node:assert'

import {
  GHOST_PERSISTENCE_SCHEMA_VERSION,
  GHOST_WEBVIEW_PROTOCOL_VERSION,
  isGhostWebviewMessage
} from '../../ui/ghostProtocol'

const envelope = { source: 'ghost-webview', version: GHOST_WEBVIEW_PROTOCOL_VERSION }

suite('Webview message contract', () => {
  test('accepts a multiline prompt with attachments and context options', () => {
    assert.equal(isGhostWebviewMessage({
      ...envelope,
      type: 'submit',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      prompt: 'Explain this code\nThen suggest a test',
      options: {
        mode: 'explain',
        context: { workspace: true, selection: true }
      },
      attachments: [{ name: 'example.ts', content: 'const value = 1', mimeType: 'text/typescript' }]
    }), true)
  })

  test('rejects oversized prompts and attachments', () => {
    const base = {
      ...envelope,
      type: 'submit',
      requestId: 'request-1',
      conversationId: 'conversation-1'
    }

    assert.equal(isGhostWebviewMessage({ ...base, prompt: 'x'.repeat(20001) }), false)
    assert.equal(isGhostWebviewMessage({
      ...base,
      prompt: 'valid',
      attachments: [{ name: 'large.txt', content: 'x'.repeat(1024 * 1024 + 1) }]
    }), false)
  })

  test('validates tool approval, settings, and persistence messages', () => {
    assert.equal(isGhostWebviewMessage({
      ...envelope,
      type: 'approve-tool',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      toolCallId: 'tool-1',
      decision: 'once',
      selectedHunkIndexes: [0, 2]
    }), true)
    assert.equal(isGhostWebviewMessage({
      ...envelope,
      type: 'update-settings',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      settings: {
        provider: 'ollama',
        enableConversationPersistence: false,
        enableDebugLogging: true,
        toolAllowlist: ['ghost_read_file'],
        autoAcceptScope: 'confirm'
      }
    }), true)
    assert.equal(isGhostWebviewMessage({
      ...envelope,
      type: 'persist-state',
      state: {
        schemaVersion: GHOST_PERSISTENCE_SCHEMA_VERSION,
        conversations: [],
        promptHistory: ['hello']
      }
    }), true)
  })

  test('rejects malformed, duplicated, or stale envelopes', () => {
    assert.equal(isGhostWebviewMessage({ ...envelope, type: 'unknown' }), false)
    assert.equal(isGhostWebviewMessage({ ...envelope, type: 'cancel', requestId: '', conversationId: 'conversation-1' }), false)
    assert.equal(isGhostWebviewMessage({ ...envelope, type: 'approve-tool', requestId: 'request-1', conversationId: 'conversation-1', toolCallId: 'tool-1', decision: 'reject' }), false)
    assert.equal(isGhostWebviewMessage({ ...envelope, version: 999, type: 'ready' }), false)
  })
})
