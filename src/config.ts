import * as vscode from 'vscode'

export const LOCALPILOT_CONFIGURATION_SECTION = 'localpilot'

export type LocalPilotProvider = 'ollama' | 'mlx-vlm' | 'openai-compatible'

export interface LocalPilotSettings {
  ollamaUrl: string
  chatModel: string
  autocompleteModel: string
  maxContextTokens: number
  enableInlineCompletions: boolean
  provider: LocalPilotProvider
  mlxUrl: string
}

export type LocalPilotSetting = keyof LocalPilotSettings

export const DEFAULT_LOCALPILOT_SETTINGS: Readonly<LocalPilotSettings> = {
  ollamaUrl: 'http://localhost:11434',
  chatModel: 'qwen2.5-coder:7b',
  autocompleteModel: 'qwen2.5-coder:1.5b',
  maxContextTokens: 8192,
  enableInlineCompletions: true,
  provider: 'ollama',
  mlxUrl: 'http://localhost:8000'
}

export type LocalPilotSettingsChangeListener = (
  settings: LocalPilotSettings,
  event: vscode.ConfigurationChangeEvent
) => void

export class LocalPilotConfig {
  getSettings(): LocalPilotSettings {
    const configuration = vscode.workspace.getConfiguration(LOCALPILOT_CONFIGURATION_SECTION)

    return {
      ollamaUrl: configuration.get('ollamaUrl', DEFAULT_LOCALPILOT_SETTINGS.ollamaUrl),
      chatModel: configuration.get('chatModel', DEFAULT_LOCALPILOT_SETTINGS.chatModel),
      autocompleteModel: configuration.get('autocompleteModel', DEFAULT_LOCALPILOT_SETTINGS.autocompleteModel),
      maxContextTokens: configuration.get('maxContextTokens', DEFAULT_LOCALPILOT_SETTINGS.maxContextTokens),
      enableInlineCompletions: configuration.get(
        'enableInlineCompletions',
        DEFAULT_LOCALPILOT_SETTINGS.enableInlineCompletions
      ),
      provider: configuration.get('provider', DEFAULT_LOCALPILOT_SETTINGS.provider),
      mlxUrl: configuration.get('mlxUrl', DEFAULT_LOCALPILOT_SETTINGS.mlxUrl)
    }
  }

  get<K extends LocalPilotSetting>(setting: K): LocalPilotSettings[K] {
    const configuration = vscode.workspace.getConfiguration(LOCALPILOT_CONFIGURATION_SECTION)
    return configuration.get(setting, DEFAULT_LOCALPILOT_SETTINGS[setting]) as LocalPilotSettings[K]
  }

  async update<K extends LocalPilotSetting>(
    setting: K,
    value: LocalPilotSettings[K],
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    await vscode.workspace
      .getConfiguration(LOCALPILOT_CONFIGURATION_SECTION)
      .update(setting, value, target)
  }

  onDidChange(listener: LocalPilotSettingsChangeListener): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(LOCALPILOT_CONFIGURATION_SECTION)) {
        listener(this.getSettings(), event)
      }
    })
  }
}

export const localPilotConfig = new LocalPilotConfig()

export function getLocalPilotSettings(): LocalPilotSettings {
  return localPilotConfig.getSettings()
}

export function updateLocalPilotSetting<K extends LocalPilotSetting>(
  setting: K,
  value: LocalPilotSettings[K],
  target?: vscode.ConfigurationTarget
): Promise<void> {
  return localPilotConfig.update(setting, value, target)
}

export function onLocalPilotConfigurationChange(listener: LocalPilotSettingsChangeListener): vscode.Disposable {
  return localPilotConfig.onDidChange(listener)
}
