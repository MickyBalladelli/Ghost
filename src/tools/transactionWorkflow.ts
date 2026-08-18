import * as vscode from 'vscode'

import { atomicWriteFile } from './atomicFile'
import { applyGhostEdit, GhostEditHunk, parseGhostEdit } from './editWorkflow'
import { readWorkspaceFile, sameWorkspaceFile, WorkspaceFileSnapshot } from './workspaceFile'
import { resolveWorkspacePath } from './workspacePath'
import { throwIfCancelled } from './cancellation'
import { GhostFileSystem, vscodeFileSystem } from '../runtimeDependencies'

export interface TransactionFileInput {
  path: string
  content?: string
  hunks?: GhostEditHunk[]
  expectedContent?: string
}

export interface FileTransactionInput {
  edits: TransactionFileInput[]
}

export interface PreparedTransactionFile {
  path: string
  uri: vscode.Uri
  before: WorkspaceFileSnapshot
  after: string
}

export function parseFileTransaction(value: Record<string, unknown>): FileTransactionInput {
  if (!Array.isArray(value.edits) || value.edits.length < 2 || value.edits.length > 50) {
    throw new Error('A file transaction must contain between 2 and 50 edits')
  }

  const paths = new Set<string>()
  const edits = value.edits.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Transaction edit ${index + 1} is malformed`)
    }
    const input = item as Record<string, unknown>
    if (typeof input.path !== 'string' || !input.path.trim()) {
      throw new Error(`Transaction edit ${index + 1} requires a path`)
    }
    const uri = resolveWorkspacePath(input.path)
    if (paths.has(uri.fsPath)) {
      throw new Error(`Transaction contains duplicate path ${uri.fsPath}`)
    }
    paths.add(uri.fsPath)

    const hasContent = typeof input.content === 'string'
    const hasHunks = Array.isArray(input.hunks)
    if (hasContent === hasHunks) {
      throw new Error(`Transaction edit ${index + 1} must contain content or hunks, not both`)
    }
    if (hasHunks) {
      const parsed = parseGhostEdit({
        path: input.path,
        hunks: input.hunks,
        ...(typeof input.expectedContent === 'string' ? { expectedContent: input.expectedContent } : {})
      })
      return {
        path: parsed.path,
        hunks: parsed.hunks,
        ...(parsed.expectedContent !== undefined ? { expectedContent: parsed.expectedContent } : {})
      }
    }
    return {
      path: uri.fsPath,
      content: input.content as string,
      ...(typeof input.expectedContent === 'string' ? { expectedContent: input.expectedContent } : {})
    }
  })

  return { edits }
}

export async function prepareFileTransaction(
  transaction: FileTransactionInput,
  expectedSnapshots?: Record<string, WorkspaceFileSnapshot>,
  token?: vscode.CancellationToken,
  filesystem: GhostFileSystem = vscodeFileSystem
): Promise<PreparedTransactionFile[]> {
  return Promise.all(transaction.edits.map(async edit => {
    throwIfCancelled(token)
    const uri = resolveWorkspacePath(edit.path)
    const before = await readWorkspaceFile(uri, token, filesystem)
    const expected = expectedSnapshots?.[uri.fsPath]
      ?? (edit.expectedContent !== undefined ? { exists: true, content: edit.expectedContent } : undefined)
    if (expected && !sameWorkspaceFile(before, expected)) {
      throw new Error(`File changed externally. Refresh and rebase the transaction before retrying: ${uri.fsPath}`)
    }
    const after = edit.content !== undefined
      ? edit.content
      : applyGhostEdit(before.content, { path: edit.path, hunks: edit.hunks ?? [] })
    return { path: uri.fsPath, uri, before, after }
  }))
}

async function deleteIfPresent(uri: vscode.Uri, filesystem: GhostFileSystem): Promise<void> {
  try {
    await filesystem.delete(uri, { useTrash: false })
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') {
      throw error
    }
  }
}

async function restoreFile(file: PreparedTransactionFile, filesystem: GhostFileSystem): Promise<void> {
  const current = await readWorkspaceFile(file.uri, undefined, filesystem)
  if (!sameWorkspaceFile(current, { exists: true, content: file.after })) {
    throw new Error(`Cannot roll back ${file.path} because it changed during the transaction`)
  }
  if (!file.before.exists) {
    await deleteIfPresent(file.uri, filesystem)
    return
  }
  await atomicWriteFile(file.uri, Buffer.from(file.before.content, 'utf8'), current, undefined, filesystem)
}

export async function applyFileTransaction(
  transaction: FileTransactionInput,
  expectedSnapshots?: Record<string, WorkspaceFileSnapshot>,
  token?: vscode.CancellationToken,
  filesystem: GhostFileSystem = vscodeFileSystem
): Promise<PreparedTransactionFile[]> {
  const prepared = await prepareFileTransaction(transaction, expectedSnapshots, token, filesystem)
  const changed = prepared.filter(file => !sameWorkspaceFile(file.before, { exists: true, content: file.after }))
  const applied: PreparedTransactionFile[] = []

  try {
    for (const file of changed) {
      throwIfCancelled(token)
      await atomicWriteFile(file.uri, Buffer.from(file.after, 'utf8'), file.before, token, filesystem)
      applied.push(file)
    }
    for (const file of changed) {
      throwIfCancelled(token)
      const current = await readWorkspaceFile(file.uri, token, filesystem)
      if (!sameWorkspaceFile(current, { exists: true, content: file.after })) {
        throw new Error(`Transaction verification failed for ${file.path}`)
      }
    }
    return prepared
  } catch (error) {
    for (const file of [...applied].reverse()) {
      try {
        await restoreFile(file, filesystem)
      } catch (restoreError) {
        const message = restoreError instanceof Error ? restoreError.message : String(restoreError)
        throw new Error(`Transaction failed and rollback failed: ${message}`)
      }
    }
    throw error
  }
}

export function summarizeFileTransaction(files: PreparedTransactionFile[]): string {
  const changed = files.filter(file => !sameWorkspaceFile(file.before, { exists: true, content: file.after }))
  return `Transaction: ${changed.length} of ${files.length} files changed (${changed.map(file => file.path).join(', ')})`
}
