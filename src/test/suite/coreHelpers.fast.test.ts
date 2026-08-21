import { strict as assert } from 'node:assert'

import { joinEndpoint, normalizeEndpoint, removeEndpointSuffix } from '../../services/endpoint'
import { isExternalEndpoint, redactSensitiveText, redactSensitiveValue } from '../../privacy/redact'
import { createToolResult } from '../../tools/toolResult'
import { limitToolResultText } from '../../tools/toolResultLimits'

suite('Core helpers (fast)', () => {
  test('normalizes and joins provider endpoints without duplicate paths', () => {
    assert.equal(normalizeEndpoint(' https://example.test/v1/// '), 'https://example.test/v1')
    assert.equal(joinEndpoint('https://example.test/v1', '/v1/models'), 'https://example.test/v1/models')
    assert.equal(removeEndpointSuffix('https://example.test/v1/chat/completions', 'chat/completions'), 'https://example.test/v1')
  })

  test('redacts secrets in text and nested values', () => {
    assert.match(redactSensitiveText('Authorization: Bearer super-secret-token'), /Bearer \[REDACTED\]/)
    const redacted = redactSensitiveValue({ apiKey: 'secret', nested: { password: 'hidden', safe: 'value' } }) as Record<string, unknown>
    assert.equal(redacted.apiKey, '[REDACTED]')
    assert.deepEqual(redacted.nested, { password: '[REDACTED]', safe: 'value' })
    assert.equal(isExternalEndpoint('http://localhost:11434'), false)
    assert.equal(isExternalEndpoint('https://api.example.test'), true)
  })

  test('tracks typed tool metadata and enforces production result limits', () => {
    const result = createToolResult('Warning: partial output\n[File output truncated.]', { changedFiles: ['src/config.ts'] })
    assert.equal(result.status, 'success')
    assert.deepEqual(result.changedFiles, ['src/config.ts'])
    assert.equal(result.truncated, true)
    assert.deepEqual(result.warnings, ['Warning: partial output'])
    assert.equal(result.retryable, false)
    assert.equal(result.bytes, Buffer.byteLength(result.text, 'utf8'))

    const limited = limitToolResultText('ghost_read_file', 'x'.repeat(30000))
    assert.ok(limited.length <= 16000)
    assert.match(limited, /Tool result truncated for ghost_read_file/)
  })
})
