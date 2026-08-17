import * as vscode from 'vscode'

export interface WorkspaceFileSnapshot {
  exists: boolean
  content: string
}

export function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound'
}

export async function readWorkspaceFile(uri: vscode.Uri): Promise<WorkspaceFileSnapshot> {
  try {
    return {
      exists: true,
      content: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
    }
  } catch (error) {
    if (isFileNotFound(error)) {
      return { exists: false, content: '' }
    }
    throw error
  }
}

export function sameWorkspaceFile(left: WorkspaceFileSnapshot, right: WorkspaceFileSnapshot): boolean {
  return left.exists === right.exists && left.content === right.content
}
