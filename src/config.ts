import * as vscode from 'vscode'

export const GHOST_CONFIGURATION_SECTION = 'ghost'

export type GhostProvider = 'ollama' | 'mlx-vlm' | 'openai-compatible'
export type GhostResponseLength = 'short' | 'balanced' | 'long' | 'unlimited'
export type GhostMode = 'ask' | 'edit' | 'agent' | 'explain' | 'inline'

export const GHOST_TOOL_NAMES = [
  'ghost_read_file',
  'ghost_write_file',
  'ghost_apply_edit',
  'ghost_run_terminal_command',
  'ghost_list_directory'
] as const

export interface GhostSettings {
  ollamaUrl: string
  openaiUrl: string
  chatModel: string
  autocompleteModel: string
  maxContextTokens: number
  enableInlineCompletions: boolean
  provider: GhostProvider
  mlxUrl: string
  temperature: number
  responseLength: GhostResponseLength
  mode: GhostMode
  enableConversationPersistence: boolean
  enableDebugLogging: boolean
  toolAllowlist?: string[]
  toolDenylist?: string[]
}

export type GhostSetting = keyof GhostSettings

export const DEFAULT_GHOST_SETTINGS: Readonly<GhostSettings> = {
  ollamaUrl: 'http://localhost:11434',
  openaiUrl: 'http://localhost:8001/v1',
  chatModel: 'qwen2.5-coder:7b',
  autocompleteModel: 'qwen2.5-coder:1.5b',
  maxContextTokens: 8192,
  enableInlineCompletions: true,
  provider: 'ollama',
  mlxUrl: 'http://localhost:8000',
  temperature: 0.2,
  responseLength: 'balanced',
  mode: 'agent',
  enableConversationPersistence: false,
  enableDebugLogging: false,
  toolAllowlist: [...GHOST_TOOL_NAMES],
  toolDenylist: []
}

export type GhostSettingsChangeListener = (
  settings: GhostSettings,
  event: vscode.ConfigurationChangeEvent
) => void

export class GhostConfig {
  getSettings(): GhostSettings {
    const configuration = vscode.workspace.getConfiguration(GHOST_CONFIGURATION_SECTION)

    return {
      ollamaUrl: configuration.get('ollamaUrl', DEFAULT_GHOST_SETTINGS.ollamaUrl),
      openaiUrl: configuration.get('openaiUrl', DEFAULT_GHOST_SETTINGS.openaiUrl),
      chatModel: configuration.get('chatModel', DEFAULT_GHOST_SETTINGS.chatModel),
      autocompleteModel: configuration.get('autocompleteModel', DEFAULT_GHOST_SETTINGS.autocompleteModel),
      maxContextTokens: configuration.get('maxContextTokens', DEFAULT_GHOST_SETTINGS.maxContextTokens),
      enableInlineCompletions: configuration.get(
        'enableInlineCompletions',
        DEFAULT_GHOST_SETTINGS.enableInlineCompletions
      ),
      provider: configuration.get('provider', DEFAULT_GHOST_SETTINGS.provider),
      mlxUrl: configuration.get('mlxUrl', DEFAULT_GHOST_SETTINGS.mlxUrl),
      temperature: configuration.get('temperature', DEFAULT_GHOST_SETTINGS.temperature),
      responseLength: configuration.get('responseLength', DEFAULT_GHOST_SETTINGS.responseLength),
      mode: configuration.get('mode', DEFAULT_GHOST_SETTINGS.mode),
      enableConversationPersistence: configuration.get('enableConversationPersistence', DEFAULT_GHOST_SETTINGS.enableConversationPersistence),
      enableDebugLogging: configuration.get('enableDebugLogging', DEFAULT_GHOST_SETTINGS.enableDebugLogging),
      toolAllowlist: configuration.get('toolAllowlist', DEFAULT_GHOST_SETTINGS.toolAllowlist),
      toolDenylist: configuration.get('toolDenylist', DEFAULT_GHOST_SETTINGS.toolDenylist)
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

  onDidChange(listener: GhostSettingsChangeListener): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(GHOST_CONFIGURATION_SECTION)) {
        listener(this.getSettings(), event)
      }
    })
  }
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
