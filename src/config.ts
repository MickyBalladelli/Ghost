import * as vscode from 'vscode'

export const GHOSTPILOT_CONFIGURATION_SECTION = 'ghostpilot'

export type GhostPilotProvider = 'ollama' | 'mlx-vlm' | 'openai-compatible'
export type GhostPilotResponseLength = 'short' | 'balanced' | 'long' | 'unlimited'
export type GhostPilotMode = 'ask' | 'edit' | 'agent' | 'explain' | 'inline'

export const GHOSTPILOT_TOOL_NAMES = [
  'ghostpilot_read_file',
  'ghostpilot_write_file',
  'ghostpilot_run_terminal_command',
  'ghostpilot_list_directory'
] as const

export interface GhostPilotSettings {
  ollamaUrl: string
  chatModel: string
  autocompleteModel: string
  maxContextTokens: number
  enableInlineCompletions: boolean
  provider: GhostPilotProvider
  mlxUrl: string
  temperature: number
  responseLength: GhostPilotResponseLength
  mode: GhostPilotMode
  toolAllowlist?: string[]
  toolDenylist?: string[]
}

export type GhostPilotSetting = keyof GhostPilotSettings

export const DEFAULT_GHOSTPILOT_SETTINGS: Readonly<GhostPilotSettings> = {
  ollamaUrl: 'http://localhost:11434',
  chatModel: 'qwen2.5-coder:7b',
  autocompleteModel: 'qwen2.5-coder:1.5b',
  maxContextTokens: 8192,
  enableInlineCompletions: true,
  provider: 'ollama',
  mlxUrl: 'http://localhost:8000',
  temperature: 0.2,
  responseLength: 'balanced',
  mode: 'ask',
  toolAllowlist: [...GHOSTPILOT_TOOL_NAMES],
  toolDenylist: []
}

export type GhostPilotSettingsChangeListener = (
  settings: GhostPilotSettings,
  event: vscode.ConfigurationChangeEvent
) => void

export class GhostPilotConfig {
  getSettings(): GhostPilotSettings {
    const configuration = vscode.workspace.getConfiguration(GHOSTPILOT_CONFIGURATION_SECTION)

    return {
      ollamaUrl: configuration.get('ollamaUrl', DEFAULT_GHOSTPILOT_SETTINGS.ollamaUrl),
      chatModel: configuration.get('chatModel', DEFAULT_GHOSTPILOT_SETTINGS.chatModel),
      autocompleteModel: configuration.get('autocompleteModel', DEFAULT_GHOSTPILOT_SETTINGS.autocompleteModel),
      maxContextTokens: configuration.get('maxContextTokens', DEFAULT_GHOSTPILOT_SETTINGS.maxContextTokens),
      enableInlineCompletions: configuration.get(
        'enableInlineCompletions',
        DEFAULT_GHOSTPILOT_SETTINGS.enableInlineCompletions
      ),
      provider: configuration.get('provider', DEFAULT_GHOSTPILOT_SETTINGS.provider),
      mlxUrl: configuration.get('mlxUrl', DEFAULT_GHOSTPILOT_SETTINGS.mlxUrl),
      temperature: configuration.get('temperature', DEFAULT_GHOSTPILOT_SETTINGS.temperature),
      responseLength: configuration.get('responseLength', DEFAULT_GHOSTPILOT_SETTINGS.responseLength),
      mode: configuration.get('mode', DEFAULT_GHOSTPILOT_SETTINGS.mode),
      toolAllowlist: configuration.get('toolAllowlist', DEFAULT_GHOSTPILOT_SETTINGS.toolAllowlist),
      toolDenylist: configuration.get('toolDenylist', DEFAULT_GHOSTPILOT_SETTINGS.toolDenylist)
    }
  }

  get<K extends GhostPilotSetting>(setting: K): GhostPilotSettings[K] {
    const configuration = vscode.workspace.getConfiguration(GHOSTPILOT_CONFIGURATION_SECTION)
    return configuration.get(setting, DEFAULT_GHOSTPILOT_SETTINGS[setting]) as GhostPilotSettings[K]
  }

  async update<K extends GhostPilotSetting>(
    setting: K,
    value: GhostPilotSettings[K],
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    await vscode.workspace
      .getConfiguration(GHOSTPILOT_CONFIGURATION_SECTION)
      .update(setting, value, target)
  }

  onDidChange(listener: GhostPilotSettingsChangeListener): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(GHOSTPILOT_CONFIGURATION_SECTION)) {
        listener(this.getSettings(), event)
      }
    })
  }
}

export const ghostPilotConfig = new GhostPilotConfig()

export function getGhostPilotSettings(): GhostPilotSettings {
  return ghostPilotConfig.getSettings()
}

export function updateGhostPilotSetting<K extends GhostPilotSetting>(
  setting: K,
  value: GhostPilotSettings[K],
  target?: vscode.ConfigurationTarget
): Promise<void> {
  return ghostPilotConfig.update(setting, value, target)
}

export function onGhostPilotConfigurationChange(listener: GhostPilotSettingsChangeListener): vscode.Disposable {
  return ghostPilotConfig.onDidChange(listener)
}
