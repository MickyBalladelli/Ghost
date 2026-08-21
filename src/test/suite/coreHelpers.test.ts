import { strict as assert } from 'node:assert'

import { DEFAULT_GHOST_SETTINGS } from '../../config'
import { migrateGhostSettings, GHOST_SETTINGS_SCHEMA_VERSION } from '../../settingsMigrations'
import { createProviderAdapter, ProviderClient } from '../../services/providerAdapter'
import { resolveWorkspacePath } from '../../tools/workspacePath'
import { applyGhostEdit, parseGhostEdit } from '../../tools/editWorkflow'

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
    assert.equal(migrated.values.autoAcceptScope, 'request')
    assert.equal(migrated.values.logLevel, 'debug')
    assert.equal(migrated.changed, true)
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
})
