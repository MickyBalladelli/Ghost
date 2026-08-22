import * as path from 'node:path'
import * as vscode from 'vscode'

const DEFAULT_OPEN_CODE_PROJECT_CONFIG = `{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "edit": "ask",
    "bash": "ask",
    "external_directory": "deny"
  }
}
`

export async function ensureOpenCodeProjectConfig(directory: string): Promise<boolean> {
  const configUri = vscode.Uri.file(path.join(directory, 'opencode.json'))
  try {
    await vscode.workspace.fs.stat(configUri)
    return false
  } catch {
    try {
      await vscode.workspace.fs.writeFile(configUri, Buffer.from(DEFAULT_OPEN_CODE_PROJECT_CONFIG, 'utf8'))
      return true
    } catch {
      return false
    }
  }
}
