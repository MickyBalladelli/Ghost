import * as vscode from 'vscode'
import { throwIfCancelled } from './cancellation'
import { readFreshWorkspaceFile } from './workspaceCache'
import { GhostFileSystem, vscodeFileSystem } from '../runtimeDependencies'

export interface WorkspaceFileSnapshot {
  exists: boolean
  content: string
}

export function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound'
}

export async function readWorkspaceFile(uri: vscode.Uri, token?: vscode.CancellationToken, filesystem: GhostFileSystem = vscodeFileSystem): Promise<WorkspaceFileSnapshot> {
    throwIfCancelled(token)
    try {
      const bytes = filesystem === vscodeFileSystem
      ? await readFreshWorkspaceFile(uri, token)
      : await filesystem.readFile(uri)
    return {
      exists: true,
      content: Buffer.from(bytes).toString('utf8')
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

export function hasUnsavedEditorChanges(uri: vscode.Uri): boolean {
  return vscode.workspace.textDocuments.some(document => document.uri.toString() === uri.toString() && document.isDirty)
}

export function assertNoUnsavedEditorChanges(uris: vscode.Uri[]): void {
  const dirtyPaths = [...new Set(uris.filter(uri => hasUnsavedEditorChanges(uri)).map(uri => uri.fsPath))]
  if (dirtyPaths.length > 0) {
    throw new Error(`Unsaved editor changes block this file edit: ${dirtyPaths.join(', ')}. Save or discard the editor changes before editing the disk file.`)
  }
}

export async function verifyWorkspaceFile(uri: vscode.Uri, expected: WorkspaceFileSnapshot, token?: vscode.CancellationToken, filesystem: GhostFileSystem = vscodeFileSystem): Promise<void> {
  const actual = await readWorkspaceFile(uri, token, filesystem)
  if (!sameWorkspaceFile(actual, expected)) {
    throw new Error(`Verification failed: ${uri.fsPath} does not contain the expected content`)
  }
}
