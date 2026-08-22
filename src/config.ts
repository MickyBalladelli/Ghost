import * as vscode from 'vscode'
import type { CustomResponseFormat, OpenAiProfileId } from './services/providerProfiles'
import type { GhostModelAliases, GhostModelProfiles } from './services/modelProfiles'
import { migrateGhostSettings, GHOST_SETTINGS_SCHEMA_VERSION, legacyFileEditApprovalMirror } from './settingsMigrations'

export const GHOST_CONFIGURATION_SECTION = 'ghost'

export type GhostProvider = 'ollama' | 'mlx-vlm' | 'openai-compatible' | 'opencode'
export type GhostResponseLength = 'short' | 'balanced' | 'long' | 'unlimited'
export type GhostMode = 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
export type GhostFileEditApproval = 'confirm' | 'auto'
export type GhostAutoAcceptScope = 'confirm' | 'one-edit' | 'current-file' | 'request' | 'session' | 'workspace' | 'always'
export type GhostLogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug'

export const GHOST_TOOL_NAMES = [
  'ghost_read_file',
  'ghost_search_workspace',
  'ghost_get_diagnostics',
  'ghost_git_context',
  'ghost_update_task_plan',
  'ghost_record_completion',
  'ghost_write_file',
  'ghost_apply_edit',
  'ghost_apply_transaction',
  'ghost_run_terminal_command',
  'ghost_list_directory'
] as const

export const DEFAULT_TERMINAL_ENVIRONMENT_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'SHELL',
  'ComSpec',
  'SystemRoot',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TERM',
  'CI',
  'PWD'
] as const

export interface GhostSettings {
  settingsSchemaVersion: number
  ollamaUrl: string
  openaiUrl: string
  openaiProfile: OpenAiProfileId
  openaiApiVersion: string
  openaiCustomModelsPath: string
  openaiCustomChatPath: string
  openaiCustomRequestTemplate: string
  openaiCustomResponseFormat: CustomResponseFormat
  openaiApiKeyHeader: string
  openaiApiKeyPrefix: string
  openaiOrganizationHeader: string
  openaiOrganization: string
  openaiProjectHeader: string
  openaiProject: string
  openaiProxy: string
  openaiNoProxy: string
  openaiTlsRejectUnauthorized: boolean
  openaiTlsCaFile: string
  openaiTlsCertFile: string
  openaiTlsKeyFile: string
  openCodeUrl: string
  openCodeUsername: string
  openCodeAgent: string
  openCodeSessionReuse: 'workspace' | 'new'
  chatModel: string
  autocompleteModel: string
  providerRequestTimeoutMinutes: number
  inlineCompletionTimeoutMs: number
  requestTimeLimitMinutes: number
  jsonMode: boolean
  modelProfile: string
  modelAliases: GhostModelAliases
  modelProfiles: GhostModelProfiles
  maxContextTokens: number
  enableInlineCompletions: boolean
  provider: GhostProvider
  mlxUrl: string
  temperature: number
  topP: number
  topK: number
  minP: number
  presencePenalty: number
  repeatPenalty: number
  seed?: number
  stopSequences: string[]
  contextWindow?: number
  grammar: string
  responseLength: GhostResponseLength
  mode: GhostMode
  fileEditApproval: GhostFileEditApproval
  autoAcceptScope: GhostAutoAcceptScope
  enableConversationPersistence: boolean
  enableDebugLogging: boolean
  logLevel: GhostLogLevel
  toolAllowlist?: string[]
  toolAsklist?: string[]
  toolDenylist?: string[]
  terminalEnvironmentAllowlist: string[]
  terminalEnvironmentAsklist: string[]
}

export type GhostSetting = keyof GhostSettings

export const DEFAULT_GHOST_SETTINGS: Readonly<GhostSettings> = {
  settingsSchemaVersion: GHOST_SETTINGS_SCHEMA_VERSION,
  ollamaUrl: 'http://localhost:11434',
  openaiUrl: 'http://localhost:8001/v1',
  openaiProfile: 'generic',
  openaiApiVersion: '2024-10-21',
  openaiCustomModelsPath: '/v1/models',
  openaiCustomChatPath: '/v1/chat/completions',
  openaiCustomRequestTemplate: '{"model":"{{model}}","messages":"{{messages}}","stream":"{{stream}}","temperature":"{{temperature}}","top_p":"{{topP}}","max_tokens":"{{maxTokens}}"}',
  openaiCustomResponseFormat: 'openai-sse',
  openaiApiKeyHeader: 'Authorization',
  openaiApiKeyPrefix: 'Bearer',
  openaiOrganizationHeader: 'OpenAI-Organization',
  openaiOrganization: '',
  openaiProjectHeader: 'OpenAI-Project',
  openaiProject: '',
  openaiProxy: '',
  openaiNoProxy: 'localhost,127.0.0.1,::1',
  openaiTlsRejectUnauthorized: true,
  openaiTlsCaFile: '',
  openaiTlsCertFile: '',
  openaiTlsKeyFile: '',
  openCodeUrl: 'http://127.0.0.1:4096',
  openCodeUsername: 'opencode',
  openCodeAgent: '',
  openCodeSessionReuse: 'workspace',
  chatModel: 'qwen2.5-coder:7b',
  autocompleteModel: 'qwen2.5-coder:1.5b',
  providerRequestTimeoutMinutes: 15,
  inlineCompletionTimeoutMs: 30000,
  requestTimeLimitMinutes: 60,
  jsonMode: false,
  modelProfile: '',
  modelAliases: {},
  modelProfiles: {},
  maxContextTokens: 8192,
  enableInlineCompletions: true,
  provider: 'ollama',
  mlxUrl: 'http://localhost:8000',
  temperature: 0.3,
  topP: 0.9,
  topK: 20,
  minP: 0.05,
  presencePenalty: 0.0,
  repeatPenalty: 1.05,
  seed: undefined,
  stopSequences: [],
  contextWindow: undefined,
  grammar: '',
  responseLength: 'balanced',
  mode: 'agent',
  fileEditApproval: 'confirm',
  autoAcceptScope: 'confirm',
  enableConversationPersistence: true,
  enableDebugLogging: false,
  logLevel: 'off',
  toolAllowlist: [...GHOST_TOOL_NAMES],
  toolAsklist: [],
  toolDenylist: [],
  terminalEnvironmentAllowlist: [...DEFAULT_TERMINAL_ENVIRONMENT_ALLOWLIST],
  terminalEnvironmentAsklist: []
}

export type GhostSettingsChangeListener = (
  settings: GhostSettings,
  event: vscode.ConfigurationChangeEvent
) => void

export class GhostConfig {
  private configuredSchemaVersion(configuration: vscode.WorkspaceConfiguration): number {
    const inspection = configuration.inspect<number>('settingsSchemaVersion')
    const configured = inspection?.workspaceFolderValue
      ?? inspection?.workspaceValue
      ?? inspection?.globalValue
    return typeof configured === 'number' && Number.isInteger(configured) && configured >= 0 ? configured : 0
  }

  private configurationTarget(configuration: vscode.WorkspaceConfiguration, setting: string): vscode.ConfigurationTarget {
    const inspection = configuration.inspect(setting)
    if (inspection?.workspaceFolderValue !== undefined) {
      return vscode.ConfigurationTarget.WorkspaceFolder
    }
    if (inspection?.workspaceValue !== undefined) {
      return vscode.ConfigurationTarget.Workspace
    }
    return vscode.ConfigurationTarget.Global
  }

  private isRegistered(configuration: vscode.WorkspaceConfiguration, setting: string): boolean {
    return configuration.inspect(setting) !== undefined
  }

  async migrateSettings(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(GHOST_CONFIGURATION_SECTION)
    const version = this.configuredSchemaVersion(configuration)
    const migration = migrateGhostSettings({
      version,
      values: {
        fileEditApproval: configuration.get('fileEditApproval'),
        autoAcceptScope: configuration.get('autoAcceptScope'),
        enableDebugLogging: configuration.get('enableDebugLogging'),
        logLevel: configuration.get('logLevel')
      }
    })
    if (!migration.changed) {
      return
    }

    for (const [setting, value] of Object.entries(migration.values)) {
      if (!this.isRegistered(configuration, setting)) {
        continue
      }
      if (!sameSettingValue(setting, value, configuration)) {
        await configuration.update(setting, value, this.configurationTarget(configuration, setting))
      }
    }
    if (this.isRegistered(configuration, 'settingsSchemaVersion')) {
      await configuration.update('settingsSchemaVersion', migration.version, this.configurationTarget(configuration, 'settingsSchemaVersion'))
    }
  }

  getSettings(): GhostSettings {
    const configuration = vscode.workspace.getConfiguration(GHOST_CONFIGURATION_SECTION)

    const autoAcceptScope = configuration.get('autoAcceptScope', DEFAULT_GHOST_SETTINGS.autoAcceptScope)
    const configuredMode = configuration.get<string>('mode', DEFAULT_GHOST_SETTINGS.mode)
    const fileEditApproval = legacyFileEditApprovalMirror(autoAcceptScope)
    return {
      settingsSchemaVersion: this.configuredSchemaVersion(configuration),
      ollamaUrl: configuration.get('ollamaUrl', DEFAULT_GHOST_SETTINGS.ollamaUrl),
      openaiUrl: configuration.get('openaiUrl', DEFAULT_GHOST_SETTINGS.openaiUrl),
      openaiProfile: configuration.get('openaiProfile', DEFAULT_GHOST_SETTINGS.openaiProfile),
      openaiApiVersion: configuration.get('openaiApiVersion', DEFAULT_GHOST_SETTINGS.openaiApiVersion),
      openaiCustomModelsPath: configuration.get('openaiCustomModelsPath', DEFAULT_GHOST_SETTINGS.openaiCustomModelsPath),
      openaiCustomChatPath: configuration.get('openaiCustomChatPath', DEFAULT_GHOST_SETTINGS.openaiCustomChatPath),
      openaiCustomRequestTemplate: configuration.get('openaiCustomRequestTemplate', DEFAULT_GHOST_SETTINGS.openaiCustomRequestTemplate),
      openaiCustomResponseFormat: configuration.get('openaiCustomResponseFormat', DEFAULT_GHOST_SETTINGS.openaiCustomResponseFormat),
      openaiApiKeyHeader: configuration.get('openaiApiKeyHeader', DEFAULT_GHOST_SETTINGS.openaiApiKeyHeader),
      openaiApiKeyPrefix: configuration.get('openaiApiKeyPrefix', DEFAULT_GHOST_SETTINGS.openaiApiKeyPrefix),
      openaiOrganizationHeader: configuration.get('openaiOrganizationHeader', DEFAULT_GHOST_SETTINGS.openaiOrganizationHeader),
      openaiOrganization: configuration.get('openaiOrganization', DEFAULT_GHOST_SETTINGS.openaiOrganization),
      openaiProjectHeader: configuration.get('openaiProjectHeader', DEFAULT_GHOST_SETTINGS.openaiProjectHeader),
      openaiProject: configuration.get('openaiProject', DEFAULT_GHOST_SETTINGS.openaiProject),
      openaiProxy: configuration.get('openaiProxy', DEFAULT_GHOST_SETTINGS.openaiProxy),
      openaiNoProxy: configuration.get('openaiNoProxy', DEFAULT_GHOST_SETTINGS.openaiNoProxy),
      openaiTlsRejectUnauthorized: configuration.get('openaiTlsRejectUnauthorized', DEFAULT_GHOST_SETTINGS.openaiTlsRejectUnauthorized),
      openaiTlsCaFile: configuration.get('openaiTlsCaFile', DEFAULT_GHOST_SETTINGS.openaiTlsCaFile),
      openaiTlsCertFile: configuration.get('openaiTlsCertFile', DEFAULT_GHOST_SETTINGS.openaiTlsCertFile),
      openaiTlsKeyFile: configuration.get('openaiTlsKeyFile', DEFAULT_GHOST_SETTINGS.openaiTlsKeyFile),
      openCodeUrl: configuration.get('openCodeUrl', DEFAULT_GHOST_SETTINGS.openCodeUrl),
      openCodeUsername: configuration.get('openCodeUsername', DEFAULT_GHOST_SETTINGS.openCodeUsername),
      openCodeAgent: configuration.get('openCodeAgent', DEFAULT_GHOST_SETTINGS.openCodeAgent),
      openCodeSessionReuse: configuration.get('openCodeSessionReuse', DEFAULT_GHOST_SETTINGS.openCodeSessionReuse),
      chatModel: configuration.get('chatModel', DEFAULT_GHOST_SETTINGS.chatModel),
      autocompleteModel: configuration.get('autocompleteModel', DEFAULT_GHOST_SETTINGS.autocompleteModel),
      providerRequestTimeoutMinutes: configuration.get('providerRequestTimeoutMinutes', DEFAULT_GHOST_SETTINGS.providerRequestTimeoutMinutes),
      inlineCompletionTimeoutMs: configuration.get('inlineCompletionTimeoutMs', DEFAULT_GHOST_SETTINGS.inlineCompletionTimeoutMs),
      requestTimeLimitMinutes: configuration.get('requestTimeLimitMinutes', DEFAULT_GHOST_SETTINGS.requestTimeLimitMinutes),
      jsonMode: configuration.get('jsonMode', DEFAULT_GHOST_SETTINGS.jsonMode),
      modelProfile: configuration.get('modelProfile', DEFAULT_GHOST_SETTINGS.modelProfile),
      modelAliases: configuration.get('modelAliases', DEFAULT_GHOST_SETTINGS.modelAliases),
      modelProfiles: configuration.get('modelProfiles', DEFAULT_GHOST_SETTINGS.modelProfiles),
      maxContextTokens: configuration.get('maxContextTokens', DEFAULT_GHOST_SETTINGS.maxContextTokens),
      enableInlineCompletions: configuration.get(
        'enableInlineCompletions',
        DEFAULT_GHOST_SETTINGS.enableInlineCompletions
      ),
      provider: configuration.get('provider', DEFAULT_GHOST_SETTINGS.provider),
      mlxUrl: configuration.get('mlxUrl', DEFAULT_GHOST_SETTINGS.mlxUrl),
      temperature: configuration.get('temperature', DEFAULT_GHOST_SETTINGS.temperature),
      topP: configuration.get('topP', DEFAULT_GHOST_SETTINGS.topP),
      topK: configuration.get('topK', DEFAULT_GHOST_SETTINGS.topK),
      minP: configuration.get('minP', DEFAULT_GHOST_SETTINGS.minP),
      presencePenalty: configuration.get('presencePenalty', DEFAULT_GHOST_SETTINGS.presencePenalty),
      repeatPenalty: configuration.get('repeatPenalty', DEFAULT_GHOST_SETTINGS.repeatPenalty),
      seed: configuration.get('seed', DEFAULT_GHOST_SETTINGS.seed),
      stopSequences: configuration.get('stopSequences', DEFAULT_GHOST_SETTINGS.stopSequences),
      contextWindow: configuration.get('contextWindow', DEFAULT_GHOST_SETTINGS.contextWindow),
      grammar: configuration.get('grammar', DEFAULT_GHOST_SETTINGS.grammar),
      responseLength: configuration.get('responseLength', DEFAULT_GHOST_SETTINGS.responseLength),
      mode: configuredMode === 'inline' ? DEFAULT_GHOST_SETTINGS.mode : configuredMode as GhostMode,
      fileEditApproval,
      autoAcceptScope,
      enableConversationPersistence: configuration.get('enableConversationPersistence', DEFAULT_GHOST_SETTINGS.enableConversationPersistence),
      enableDebugLogging: configuration.get('enableDebugLogging', DEFAULT_GHOST_SETTINGS.enableDebugLogging),
      logLevel: configuration.get('logLevel', DEFAULT_GHOST_SETTINGS.logLevel),
      toolAllowlist: configuration.get('toolAllowlist', DEFAULT_GHOST_SETTINGS.toolAllowlist),
      toolAsklist: configuration.get('toolAsklist', DEFAULT_GHOST_SETTINGS.toolAsklist),
      toolDenylist: configuration.get('toolDenylist', DEFAULT_GHOST_SETTINGS.toolDenylist),
      terminalEnvironmentAllowlist: configuration.get('terminalEnvironmentAllowlist', DEFAULT_GHOST_SETTINGS.terminalEnvironmentAllowlist),
      terminalEnvironmentAsklist: configuration.get('terminalEnvironmentAsklist', DEFAULT_GHOST_SETTINGS.terminalEnvironmentAsklist)
    }
  }

  get<K extends GhostSetting>(setting: K): GhostSettings[K] {
    const configuration = vscode.workspace.getConfiguration(GHOST_CONFIGURATION_SECTION)
    return configuration.get(setting, DEFAULT_GHOST_SETTINGS[setting]) as GhostSettings[K]
  }

  async update<K extends GhostSetting>(
    setting: K,
    value: GhostSettings[K],
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    await vscode.workspace
      .getConfiguration(GHOST_CONFIGURATION_SECTION)
      .update(setting, value, target)
  }

  async clear<K extends GhostSetting>(
    setting: K,
    target: vscode.ConfigurationTarget
  ): Promise<void> {
    await vscode.workspace
      .getConfiguration(GHOST_CONFIGURATION_SECTION)
      .update(setting, undefined, target)
  }

  onDidChange(listener: GhostSettingsChangeListener): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(GHOST_CONFIGURATION_SECTION)) {
        listener(this.getSettings(), event)
      }
    })
  }
}

function sameSettingValue(setting: string, value: unknown, configuration: vscode.WorkspaceConfiguration): boolean {
  return JSON.stringify(configuration.get(setting)) === JSON.stringify(value)
}

export const ghostConfig = new GhostConfig()

export function getGhostSettings(): GhostSettings {
  return ghostConfig.getSettings()
}

export function updateGhostSetting<K extends GhostSetting>(
  setting: K,
  value: GhostSettings[K],
  target?: vscode.ConfigurationTarget
): Promise<void> {
  return ghostConfig.update(setting, value, target)
}

export function onGhostConfigurationChange(listener: GhostSettingsChangeListener): vscode.Disposable {
  return ghostConfig.onDidChange(listener)
}
