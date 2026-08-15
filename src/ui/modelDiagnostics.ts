import * as vscode from 'vscode'

import { LocalPilotConfig, localPilotConfig } from '../config'
import { OllamaClient } from '../services/ollamaClient'

export const REQUIRED_OLLAMA_MODELS = [
  'qwen2.5-coder:7b',
  'qwen2.5-coder:1.5b'
]

export async function checkRequiredOllamaModels(
  configuration: LocalPilotConfig = localPilotConfig
): Promise<void> {
  const settings = configuration.getSettings()
  const client = new OllamaClient(settings.ollamaUrl)

  if (!(await client.checkHealth())) {
    await vscode.window.showErrorMessage(
      `Cannot reach Ollama at ${settings.ollamaUrl}. Start Ollama, then try again.`
    )
    return
  }

  let installedModels: string[]

  try {
    installedModels = await client.listModels()
  } catch {
    await vscode.window.showErrorMessage(`Could not list models from Ollama at ${settings.ollamaUrl}.`)
    return
  }
  const missingModels = REQUIRED_OLLAMA_MODELS.filter(model => !installedModels.includes(model))

  if (missingModels.length === 0) {
    await vscode.window.showInformationMessage('LocalPilot: Required Ollama models are ready.')
    return
  }

  const pullCommand = `ollama pull ${missingModels[0]}`
  const action = await vscode.window.showWarningMessage(
    `Missing Ollama model${missingModels.length === 1 ? '' : 's'}: ${missingModels.join(', ')}`,
    'Copy Pull Command'
  )

  if (action === 'Copy Pull Command') {
    await vscode.env.clipboard.writeText(pullCommand)
    await vscode.window.showInformationMessage(`Copied: ${pullCommand}`)
  }
}
