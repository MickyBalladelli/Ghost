import * as path from 'node:path'

import * as vscode from 'vscode'

function isInsideWorkspace(candidate: string, workspaceRoot: string): boolean {
  const relative = path.relative(workspaceRoot, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function resolveWorkspacePath(input: string): vscode.Uri {
  if (!path.isAbsolute(input)) {
    throw new Error('Path must be absolute and inside the current workspace')
  }

  const candidate = path.resolve(input)
  const workspaceFolder = vscode.workspace.workspaceFolders?.find(folder => {
    const root = path.resolve(folder.uri.fsPath)
    return isInsideWorkspace(candidate, root)
  })

  if (!workspaceFolder) {
    throw new Error('Path must be inside the current workspace')
  }

  return vscode.Uri.file(candidate)
}

export function getWorkspaceRoot(): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri

  if (!root) {
    throw new Error('Open a workspace before using LocalPilot tools')
  }

  return root
}
