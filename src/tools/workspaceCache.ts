import * as vscode from 'vscode'

import { awaitCancellable, throwIfCancelled } from './cancellation'

interface CachedFile {
  mtime: number
  size: number
  bytes: Uint8Array
}

interface CachedDirectory {
  mtime: number
  entries: [string, vscode.FileType][]
}

const fileCache = new Map<string, CachedFile>()
const directoryCache = new Map<string, CachedDirectory>()

const cacheKey = (uri: vscode.Uri): string => uri.toString()

export async function readCachedWorkspaceFile(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<Uint8Array> {
  throwIfCancelled(token)
  const key = cacheKey(uri)
  const stat = await vscode.workspace.fs.stat(uri)
  const cached = fileCache.get(key)
  if (cached && cached.mtime === stat.mtime && cached.size === stat.size) {
    return cached.bytes.slice()
  }

  const bytes = Uint8Array.from(await awaitCancellable(vscode.workspace.fs.readFile(uri), token))
  fileCache.set(key, { mtime: stat.mtime, size: stat.size, bytes })
  return bytes.slice()
}

export async function readCachedWorkspaceDirectory(uri: vscode.Uri, token?: vscode.CancellationToken): Promise<[string, vscode.FileType][]> {
  throwIfCancelled(token)
  const key = cacheKey(uri)
  const stat = await vscode.workspace.fs.stat(uri)
  const cached = directoryCache.get(key)
  if (cached && cached.mtime === stat.mtime) {
    return cached.entries.map(([name, type]) => [name, type])
  }

  const entries = await awaitCancellable(vscode.workspace.fs.readDirectory(uri), token)
  const normalized = entries.map(([name, type]) => [name, type] as [string, vscode.FileType])
  directoryCache.set(key, { mtime: stat.mtime, entries: normalized })
  return normalized.map(([name, type]) => [name, type])
}

export function invalidateWorkspaceCache(uri?: vscode.Uri): void {
  if (uri) {
    fileCache.delete(cacheKey(uri))
  } else {
    fileCache.clear()
  }
  directoryCache.clear()
}

export function registerWorkspaceCache(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => invalidateWorkspaceCache(event.document.uri)),
    vscode.workspace.onDidSaveTextDocument(document => invalidateWorkspaceCache(document.uri)),
    vscode.workspace.onDidCreateFiles(event => event.files.forEach(uri => invalidateWorkspaceCache(uri))),
    vscode.workspace.onDidDeleteFiles(event => event.files.forEach(uri => invalidateWorkspaceCache(uri))),
    vscode.workspace.onDidRenameFiles(event => event.files.forEach(file => {
      invalidateWorkspaceCache(file.oldUri)
      invalidateWorkspaceCache(file.newUri)
    }))
  )
}
