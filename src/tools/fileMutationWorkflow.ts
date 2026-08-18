import * as vscode from 'vscode'

import { atomicWriteFile } from './atomicFile'
import { applyGhostEdit, GhostFileEdit } from './editWorkflow'
import { readWorkspaceFile, sameWorkspaceFile, assertNoUnsavedEditorChanges, verifyWorkspaceFile, WorkspaceFileSnapshot } from './workspaceFile'
import { resolveWorkspacePath } from './workspacePath'
import { GhostError } from '../ghostErrors'

export interface FileMutationOptions {
  expectedContent?: string
  expectedFileExists?: boolean
}

export interface WorkspaceFileChange {
  before: WorkspaceFileSnapshot
  after: WorkspaceFileSnapshot
  changed: boolean
}

export function resolveFileMutationPath(filePath: string): vscode.Uri {
  return resolveWorkspacePath(filePath)
}

export function assertFileMutationAllowed(filePaths: string[]): void {
  assertNoUnsavedEditorChanges(filePaths.map(resolveFileMutationPath))
}

export async function readFileMutation(
  filePath: string,
  token: vscode.CancellationToken
): Promise<{ uri: vscode.Uri; snapshot: WorkspaceFileSnapshot }> {
  const uri = resolveFileMutationPath(filePath)
  return { uri, snapshot: await readWorkspaceFile(uri, token) }
}

export function expectedWorkspaceSnapshot(options: FileMutationOptions): WorkspaceFileSnapshot | undefined {
  if (options.expectedContent === undefined && options.expectedFileExists === undefined) {
    return undefined
  }
  return {
    exists: options.expectedFileExists ?? true,
    content: options.expectedContent ?? ''
  }
}

export function assertExpectedWorkspaceSnapshot(
  current: WorkspaceFileSnapshot,
  expected: WorkspaceFileSnapshot | undefined
): void {
  if (expected && !sameWorkspaceFile(current, expected)) {
    throw new GhostError('File changed externally. Refresh and rebase the edit before retrying.', { code: 'tool.conflict', retryable: true })
  }
}

export function createWorkspaceFileChange(
  before: WorkspaceFileSnapshot,
  content: string
): WorkspaceFileChange {
  const after = { exists: true, content }
  return {
    before,
    after,
    changed: !sameWorkspaceFile(before, after)
  }
}

export function createWorkspaceEditChange(
  before: WorkspaceFileSnapshot,
  edit: GhostFileEdit,
  selectedHunkIndexes?: Set<number>
): WorkspaceFileChange {
  if (edit.expectedContent !== undefined && before.content !== edit.expectedContent) {
    throw new GhostError('Edit expected different file content', { code: 'tool.conflict', retryable: true })
  }
  return createWorkspaceFileChange(
    before,
    applyGhostEdit(before.content, edit, selectedHunkIndexes)
  )
}

export async function applyWorkspaceFileChange(
  uri: vscode.Uri,
  change: WorkspaceFileChange,
  expected: WorkspaceFileSnapshot,
  token: vscode.CancellationToken
): Promise<void> {
  if (!change.changed) {
    return
  }
  await atomicWriteFile(uri, Buffer.from(change.after.content, 'utf8'), expected, token)
  await verifyWorkspaceFile(uri, change.after, token)
}
