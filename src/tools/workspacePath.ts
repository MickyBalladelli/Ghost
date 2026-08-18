import * as path from 'node:path'
import * as fs from 'node:fs'

import * as vscode from 'vscode'
import { GhostError } from '../ghostErrors'

function isInsideWorkspace(candidate: string, workspaceRoot: string): boolean {
  const relative = path.relative(workspaceRoot, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function canonicalWorkspacePath(candidate: string): string {
  let current = candidate
  const missingParts: string[] = []
  while (!fs.existsSync(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new GhostError('Path contains a symlink whose target does not exist', { code: 'tool.path-invalid' })
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('symlink')) {
        throw error
      }
    }
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    missingParts.unshift(path.basename(current))
    current = parent
  }

  let canonicalBase: string
  try {
    canonicalBase = fs.realpathSync.native(current)
  } catch {
    canonicalBase = path.resolve(current)
  }
  return path.resolve(canonicalBase, ...missingParts)
}

function canonicalWorkspaceRoot(root: string): string | undefined {
  try {
    if (!fs.statSync(root).isDirectory()) {
      return undefined
    }
    return fs.realpathSync.native(root)
  } catch {
    return undefined
  }
}

export function resolveWorkspacePath(input: string): vscode.Uri {
  const workspaceRoot = getWorkspaceRoot().fsPath
  const candidate = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(workspaceRoot, input)
  const canonicalCandidate = canonicalWorkspacePath(candidate)
  const workspaceFolder = vscode.workspace.workspaceFolders?.find(folder => {
    const root = canonicalWorkspaceRoot(folder.uri.fsPath)
    return root !== undefined && isInsideWorkspace(canonicalCandidate, root)
  })

  if (!workspaceFolder) {
    throw new GhostError('Path must be inside the current workspace', { code: 'tool.path-invalid' })
  }

  return vscode.Uri.file(canonicalCandidate)
}

export function getWorkspaceRoot(): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri

  if (!root) {
    throw new GhostError('Open a workspace before using Ghost tools', { code: 'tool.path-invalid' })
  }

  const canonicalRoot = canonicalWorkspaceRoot(root.fsPath)
  if (!canonicalRoot) {
    throw new GhostError('The current workspace root does not exist or is not a directory', { code: 'tool.path-invalid' })
  }

  return vscode.Uri.file(canonicalRoot)
}
