import * as path from 'node:path'
import { randomBytes } from 'node:crypto'

import * as vscode from 'vscode'

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((byte, index) => byte === right[index])
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri)
    return true
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
      return false
    }
    throw error
  }
}

async function deleteIfPresent(uri: vscode.Uri): Promise<void> {
  if (await fileExists(uri)) {
    await vscode.workspace.fs.delete(uri, { useTrash: false })
  }
}

export async function atomicWriteFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
  const parent = vscode.Uri.file(path.dirname(uri.fsPath))
  const suffix = randomBytes(8).toString('hex')
  const baseName = path.basename(uri.fsPath)
  const temporary = vscode.Uri.joinPath(parent, `.${baseName}.ghost-${suffix}.tmp`)
  const backup = vscode.Uri.joinPath(parent, `.${baseName}.ghost-${suffix}.bak`)
  const targetExists = await fileExists(uri)
  let backupCreated = false
  let targetReplaced = false

  try {
    await vscode.workspace.fs.createDirectory(parent)
    if (targetExists) {
      await vscode.workspace.fs.copy(uri, backup)
      backupCreated = true
    }

    await vscode.workspace.fs.writeFile(temporary, content)
    const temporaryContent = await vscode.workspace.fs.readFile(temporary)
    if (!sameBytes(temporaryContent, content)) {
      throw new Error(`Atomic write verification failed for ${uri.fsPath}`)
    }

    await vscode.workspace.fs.rename(temporary, uri, { overwrite: true })
    targetReplaced = true

    const savedContent = await vscode.workspace.fs.readFile(uri)
    if (!sameBytes(savedContent, content)) {
      throw new Error(`Atomic write verification failed for ${uri.fsPath}`)
    }
  } catch (error) {
    if (targetReplaced) {
      try {
        if (targetExists) {
          await vscode.workspace.fs.rename(backup, uri, { overwrite: true })
        } else {
          await deleteIfPresent(uri)
        }
      } catch (restoreError) {
        const originalMessage = error instanceof Error ? error.message : String(error)
        const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError)
        throw new Error(`${originalMessage}; original file restore failed: ${restoreMessage}`)
      }
    }
    throw error
  } finally {
    try {
      await deleteIfPresent(temporary)
      if (backupCreated) {
        await deleteIfPresent(backup)
      }
    } catch {
      // The write result is already known. Do not hide it behind cleanup failure.
    }
  }
}
