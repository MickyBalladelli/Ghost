import { strict as assert } from 'node:assert'

import {
  GHOSTPILOT_PERSISTENCE_SCHEMA_VERSION,
  GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION,
  isGhostPilotWebviewMessage
} from '../../ui/ghostPilotProtocol'

const envelope = { source: 'ghostpilot-webview', version: GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION }

suite('Webview message contract', () => {
  test('accepts a multiline prompt with attachments and context options', () => {
    assert.equal(isGhostPilotWebviewMessage({
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

    assert.equal(isGhostPilotWebviewMessage({ ...base, prompt: 'x'.repeat(20001) }), false)
    assert.equal(isGhostPilotWebviewMessage({
      ...base,
      prompt: 'valid',
      attachments: [{ name: 'large.txt', content: 'x'.repeat(1024 * 1024 + 1) }]
    }), false)
  })

  test('validates tool approval, settings, and persistence messages', () => {
    assert.equal(isGhostPilotWebviewMessage({
      ...envelope,
      type: 'approve-tool',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      toolCallId: 'tool-1',
      decision: 'once',
      selectedHunkIndexes: [0, 2]
    }), true)
    assert.equal(isGhostPilotWebviewMessage({
      ...envelope,
      type: 'update-settings',
      settings: {
        provider: 'ollama',
        enableConversationPersistence: false,
        enableDebugLogging: true,
        toolAllowlist: ['ghostpilot_read_file']
      }
    }), true)
    assert.equal(isGhostPilotWebviewMessage({
      ...envelope,
      type: 'persist-state',
      state: {
        schemaVersion: GHOSTPILOT_PERSISTENCE_SCHEMA_VERSION,
        conversations: [],
        promptHistory: ['hello']
      }
    }), true)
  })

  test('rejects malformed, duplicated, or stale envelopes', () => {
    assert.equal(isGhostPilotWebviewMessage({ ...envelope, type: 'unknown' }), false)
    assert.equal(isGhostPilotWebviewMessage({ ...envelope, type: 'cancel', requestId: '', conversationId: 'conversation-1' }), false)
    assert.equal(isGhostPilotWebviewMessage({ ...envelope, type: 'approve-tool', requestId: 'request-1', conversationId: 'conversation-1', toolCallId: 'tool-1', decision: 'reject' }), false)
    assert.equal(isGhostPilotWebviewMessage({ ...envelope, version: 999, type: 'ready' }), false)
  })
})
