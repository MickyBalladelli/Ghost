export const GHOST_SETTINGS_SCHEMA_VERSION = 2

export interface SettingsMigrationInput {
  version: number
  values: Record<string, unknown>
}

export interface SettingsMigrationResult {
  version: number
  values: Record<string, unknown>
  changed: boolean
}

const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

export const migrateGhostSettings = (input: SettingsMigrationInput): SettingsMigrationResult => {
  let version = Number.isInteger(input.version) && input.version >= 0 ? input.version : 0
  const values = { ...input.values }
  let changed = version !== GHOST_SETTINGS_SCHEMA_VERSION

  if (version < 1) {
    const legacyApproval = values.fileEditApproval
    const configuredScope = values.autoAcceptScope
    if (legacyApproval === 'auto' && (configuredScope === undefined || configuredScope === 'confirm')) {
      values.autoAcceptScope = 'always'
      changed = true
    }
    version = 1
  }

  if (version < 2) {
    if (values.enableDebugLogging === true && (values.logLevel === undefined || values.logLevel === 'off')) {
      values.logLevel = 'debug'
      changed = true
    }
    version = 2
  }

  return {
    version,
    values,
    changed: changed || !sameValue(values, input.values)
  }
}
