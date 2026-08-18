import * as path from 'node:path'
import { randomBytes } from 'node:crypto'

import * as vscode from 'vscode'

import { isFileNotFound, readWorkspaceFile, sameWorkspaceFile, WorkspaceFileSnapshot } from './workspaceFile'
import { awaitCancellable, throwIfCancelled } from './cancellation'
import { invalidateWorkspaceCache } from './workspaceCache'
import { GhostFileSystem, vscodeFileSystem } from '../runtimeDependencies'

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((byte, index) => byte === right[index])
}

async function deleteIfPresent(uri: vscode.Uri, filesystem: GhostFileSystem): Promise<void> {
  try {
    await filesystem.delete(uri, { useTrash: false })
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error
    }
  }
}

export async function atomicWriteFile(
  uri: vscode.Uri,
  content: Uint8Array,
  expected?: WorkspaceFileSnapshot,
  token?: vscode.CancellationToken,
  filesystem: GhostFileSystem = vscodeFileSystem
): Promise<void> {
  const parent = vscode.Uri.file(path.dirname(uri.fsPath))
  const suffix = randomBytes(8).toString('hex')
  const baseName = path.basename(uri.fsPath)
  const temporary = vscode.Uri.joinPath(parent, `.${baseName}.ghost-${suffix}.tmp`)
  const backup = vscode.Uri.joinPath(parent, `.${baseName}.ghost-${suffix}.bak`)
  throwIfCancelled(token)
  await filesystem.createDirectory(parent)
  const initial = await readWorkspaceFile(uri, token, filesystem)
  if (expected && !sameWorkspaceFile(initial, expected)) {
    throw new Error(`File changed externally. Refresh and rebase the edit before retrying: ${uri.fsPath}`)
  }
  const targetExists = initial.exists
  let backupCreated = false
  let targetReplaced = false

  try {
    if (targetExists) {
      throwIfCancelled(token)
      await filesystem.copy(uri, backup)
      backupCreated = true
    }

    throwIfCancelled(token)
    await filesystem.writeFile(temporary, content)
    throwIfCancelled(token)
    const temporaryContent = await awaitCancellable(filesystem.readFile(temporary), token)
    if (!sameBytes(temporaryContent, content)) {
      throw new Error(`Atomic write verification failed for ${uri.fsPath}`)
    }

    if (expected) {
      const latest = await readWorkspaceFile(uri, token, filesystem)
      if (!sameWorkspaceFile(latest, expected)) {
        throw new Error(`File changed externally. Refresh and rebase the edit before retrying: ${uri.fsPath}`)
      }
    }

    throwIfCancelled(token)
    await filesystem.rename(temporary, uri, { overwrite: true })
    targetReplaced = true
    invalidateWorkspaceCache(uri)
    throwIfCancelled(token)

    const savedContent = await awaitCancellable(filesystem.readFile(uri), token)
    if (!sameBytes(savedContent, content)) {
      throw new Error(`Atomic write verification failed for ${uri.fsPath}`)
    }
  } catch (error) {
    if (targetReplaced) {
      try {
        if (targetExists) {
          await filesystem.rename(backup, uri, { overwrite: true })
        } else {
          await deleteIfPresent(uri, filesystem)
        }
        invalidateWorkspaceCache(uri)
      } catch (restoreError) {
        const originalMessage = error instanceof Error ? error.message : String(error)
        const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError)
        throw new Error(`${originalMessage}; original file restore failed: ${restoreMessage}`)
      }
    }
    throw error
  } finally {
    try {
      await deleteIfPresent(temporary, filesystem)
      if (backupCreated) {
        await deleteIfPresent(backup, filesystem)
      }
    } catch {
      // The write result is already known. Do not hide it behind cleanup failure.
    }
  }
}
