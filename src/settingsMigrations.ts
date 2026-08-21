export const GHOST_SETTINGS_SCHEMA_VERSION = 3

export type LegacyFileEditApproval = 'confirm' | 'auto'

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

const isLegacyAutoWithoutScope = (values: Record<string, unknown>): boolean => (
  values.fileEditApproval === 'auto' && (values.autoAcceptScope === undefined || values.autoAcceptScope === 'confirm')
)

export const legacyFileEditApprovalMirror = (scope: string | undefined): LegacyFileEditApproval => (
  scope === 'confirm' || scope === undefined ? 'confirm' : 'auto'
)

export const migrateGhostSettings = (input: SettingsMigrationInput): SettingsMigrationResult => {
  let version = Number.isInteger(input.version) && input.version >= 0 ? input.version : 0
  const values = { ...input.values }
  let changed = version !== GHOST_SETTINGS_SCHEMA_VERSION

  if (version < 1) {
    if (isLegacyAutoWithoutScope(values)) {
      values.autoAcceptScope = 'request'
      values.fileEditApproval = 'auto'
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

  if (version < 3) {
    if (isLegacyAutoWithoutScope(values)) {
      values.autoAcceptScope = 'request'
      values.fileEditApproval = 'auto'
      changed = true
    } else if (typeof values.autoAcceptScope === 'string') {
      const mirrored = legacyFileEditApprovalMirror(values.autoAcceptScope)
      if (values.fileEditApproval !== mirrored) {
        values.fileEditApproval = mirrored
        changed = true
      }
    }
    version = 3
  }

  return {
    version,
    values,
    changed: changed || !sameValue(values, input.values)
  }
}
