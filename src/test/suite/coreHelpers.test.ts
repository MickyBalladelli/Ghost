import { strict as assert } from 'node:assert'

import { DEFAULT_GHOST_SETTINGS } from '../../config'
import { migrateGhostSettings, GHOST_SETTINGS_SCHEMA_VERSION } from '../../settingsMigrations'
import { normalizeEndpoint, joinEndpoint, removeEndpointSuffix } from '../../services/endpoint'
import { createProviderAdapter, ProviderClient } from '../../services/providerAdapter'
import { redactSensitiveText, redactSensitiveValue, isExternalEndpoint } from '../../privacy/redact'
import { resolveWorkspacePath } from '../../tools/workspacePath'
import { applyGhostEdit, parseGhostEdit } from '../../tools/editWorkflow'
import { createToolResult } from '../../tools/toolResult'
import { limitToolResultText } from '../../tools/toolResultLimits'

const emptyStream = async function* (): AsyncGenerator<string> {}

const fakeProvider = (): ProviderClient => ({
  checkHealth: async () => true,
  streamChatCompletion: emptyStream
})

suite('Core Ghost helpers', () => {
  test('keeps settings defaults versioned and migrates legacy values', () => {
    assert.equal(DEFAULT_GHOST_SETTINGS.settingsSchemaVersion, GHOST_SETTINGS_SCHEMA_VERSION)
    const migrated = migrateGhostSettings({
      version: 0,
      values: { fileEditApproval: 'auto', autoAcceptScope: 'confirm', enableDebugLogging: true, logLevel: 'off' }
    })
    assert.equal(migrated.version, GHOST_SETTINGS_SCHEMA_VERSION)
    assert.equal(migrated.values.autoAcceptScope, 'always')
    assert.equal(migrated.values.logLevel, 'debug')
    assert.equal(migrated.changed, true)
  })

  test('normalizes and joins provider endpoints without duplicate paths', () => {
    assert.equal(normalizeEndpoint(' https://example.test/v1/// '), 'https://example.test/v1')
    assert.equal(joinEndpoint('https://example.test/v1', '/v1/models'), 'https://example.test/v1/models')
    assert.equal(removeEndpointSuffix('https://example.test/v1/chat/completions', 'chat/completions'), 'https://example.test/v1')
  })

  test('exposes provider capability differences through one adapter contract', () => {
    const mlx = createProviderAdapter('mlx-vlm', fakeProvider()).capabilities('vision-model')
    const ollama = createProviderAdapter('ollama', fakeProvider()).capabilities('coding-model')
    assert.equal(mlx.supportsTools, false)
    assert.equal(mlx.supportsVision, true)
    assert.equal(mlx.supportsFIM, false)
    assert.equal(ollama.supportsTools, true)
    assert.equal(ollama.supportsFIM, true)
  })

  test('redacts secrets in text and nested values', () => {
    assert.match(redactSensitiveText('Authorization: Bearer super-secret-token'), /Bearer \[REDACTED\]/)
    const redacted = redactSensitiveValue({ apiKey: 'secret', nested: { password: 'hidden', safe: 'value' } }) as Record<string, unknown>
    assert.equal(redacted.apiKey, '[REDACTED]')
    assert.deepEqual(redacted.nested, { password: '[REDACTED]', safe: 'value' })
    assert.equal(isExternalEndpoint('http://localhost:11434'), false)
    assert.equal(isExternalEndpoint('https://api.example.test'), true)
  })

  test('accepts workspace paths and rejects paths outside the workspace', () => {
    assert.match(resolveWorkspacePath('src/config.ts').fsPath, /src[\\/]config\.ts$/)
    assert.throws(() => resolveWorkspacePath('../outside-workspace.ts'), /inside the current workspace/)
  })

  test('applies reviewed edits and keeps selected hunk behavior', () => {
    const edit = parseGhostEdit({
      path: `${process.cwd()}/example.ts`,
      hunks: [
        { startLine: 1, endLine: 1, replacement: 'updated one', oldText: 'one' },
        { startLine: 3, endLine: 3, replacement: 'updated three', oldText: 'three' }
      ]
    })
    assert.equal(applyGhostEdit('one\ntwo\nthree', edit), 'updated one\ntwo\nupdated three')
    assert.equal(applyGhostEdit('one\ntwo\nthree', edit, new Set([1])), 'one\ntwo\nupdated three')
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
