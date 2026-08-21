import { strict as assert } from 'node:assert'

import {
  GHOST_SETTINGS_SCHEMA_VERSION,
  legacyFileEditApprovalMirror,
  migrateGhostSettings
} from '../../settingsMigrations'

suite('Settings migrations', () => {
  test('maps leftover fileEditApproval auto to request, not always', () => {
    const migrated = migrateGhostSettings({
      version: 0,
      values: { fileEditApproval: 'auto', autoAcceptScope: 'confirm', enableDebugLogging: true, logLevel: 'off' }
    })
    assert.equal(migrated.version, GHOST_SETTINGS_SCHEMA_VERSION)
    assert.equal(migrated.values.autoAcceptScope, 'request')
    assert.equal(migrated.values.fileEditApproval, 'auto')
    assert.equal(migrated.values.logLevel, 'debug')
    assert.equal(migrated.changed, true)
  })

  test('repairs schema v2 leftovers that still have auto plus confirm', () => {
    const migrated = migrateGhostSettings({
      version: 2,
      values: { fileEditApproval: 'auto', autoAcceptScope: 'confirm' }
    })
    assert.equal(migrated.version, 3)
    assert.equal(migrated.values.autoAcceptScope, 'request')
    assert.equal(migrated.changed, true)
  })

  test('leaves an explicit always scope in place', () => {
    const migrated = migrateGhostSettings({
      version: 2,
      values: { fileEditApproval: 'auto', autoAcceptScope: 'always' }
    })
    assert.equal(migrated.version, 3)
    assert.equal(migrated.values.autoAcceptScope, 'always')
    assert.equal(migrated.values.fileEditApproval, 'auto')
  })

  test('mirrors fileEditApproval from autoAcceptScope', () => {
    assert.equal(legacyFileEditApprovalMirror('confirm'), 'confirm')
    assert.equal(legacyFileEditApprovalMirror(undefined), 'confirm')
    assert.equal(legacyFileEditApprovalMirror('request'), 'auto')
    assert.equal(legacyFileEditApprovalMirror('always'), 'auto')
  })
})
