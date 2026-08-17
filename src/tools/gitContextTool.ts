import { spawn } from 'node:child_process'
import * as path from 'node:path'

import * as vscode from 'vscode'

import { getWorkspaceRoot, resolveWorkspacePath } from './workspacePath'

export interface GitContextInput {
  operation: 'status' | 'diff' | 'stagedDiff' | 'branch' | 'history'
  path?: string
  maxEntries?: number
}

interface GitCommandResult {
  stdout: string
  stderr: string
  truncated: boolean
}

interface GitScope {
  repository: string
  workspacePath: string
  filePath?: string
}

const MAX_OUTPUT_CHARACTERS = 24000
const MAX_ENTRIES = 200

function textResult(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)])
}

function runGit(args: string[], cwd: string, token: vscode.CancellationToken): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false
    const timeout = setTimeout(() => {
      child.kill()
      finish(new Error('Git command timed out'))
    }, 10000)

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      cancellationSubscription.dispose()
      if (error) {
        reject(error)
      } else {
        resolve({ stdout, stderr, truncated })
      }
    }

    const append = (current: string, chunk: unknown): string => {
      const value = Buffer.from(chunk as Uint8Array).toString('utf8')
      const remaining = MAX_OUTPUT_CHARACTERS - current.length
      if (remaining <= 0) {
        truncated = true
        return current
      }
      if (value.length > remaining) {
        truncated = true
        return current + value.slice(0, remaining)
      }
      return current + value
    }

    const cancellationSubscription = token.onCancellationRequested(() => {
      child.kill()
      finish(new Error('Git command cancelled'))
    })

    child.stdout.on('data', chunk => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', chunk => {
      stderr = append(stderr, chunk)
    })
    child.on('error', error => finish(error instanceof Error ? error : new Error('Could not start Git')))
    child.on('close', code => {
      if (settled) return
      if (code === 0 || (truncated && code === null)) {
        finish()
        return
      }
      finish(new Error(stderr.trim() || `Git exited with code ${code ?? 'unknown'}`))
    })
  })
}

function relativeGitPath(root: string, target: string): string {
  const relative = path.relative(root, target).split(path.sep).join('/')
  if (relative === '' || relative === '.') {
    return '.'
  }
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('Git path is outside the current workspace')
  }
  return relative
}

async function getGitScope(input: GitContextInput, token: vscode.CancellationToken): Promise<GitScope> {
  const workspaceRoot = getWorkspaceRoot().fsPath
  const requestedPath = input.path?.trim() || (input.operation === 'diff' || input.operation === 'stagedDiff' || input.operation === 'history' ? activeFilePath() : undefined)
  const targetUri = requestedPath
    ? resolveWorkspacePath(requestedPath)
    : undefined
  const targetFolder = targetUri ? vscode.workspace.getWorkspaceFolder(targetUri) : undefined
  const folderRoot = targetFolder?.uri.fsPath ?? workspaceRoot
  const repositoryResult = await runGit(['rev-parse', '--show-toplevel'], folderRoot, token)
  const repository = repositoryResult.stdout.trim().split(/\r?\n/)[0]
  if (!repository) {
    throw new Error('The current workspace is not inside a Git repository')
  }
  return {
    repository,
    workspacePath: relativeGitPath(repository, folderRoot),
    ...(targetUri ? { filePath: relativeGitPath(repository, targetUri.fsPath) } : {})
  }
}

function activeFilePath(): string | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri
  return uri && vscode.workspace.getWorkspaceFolder(uri) ? uri.fsPath : undefined
}

function formatOutput(scope: GitScope, operation: GitContextInput['operation'], output: string, truncated: boolean, pathSpec?: string): string {
  const header = [
    `Git operation: ${operation}`,
    `Repository: ${scope.repository}`,
    ...(pathSpec ? [`Path: ${pathSpec}`] : [])
  ].join('\n')
  const body = output.trim() || '[no changes]'
  return `${header}\n\n${body}${truncated ? '\n\n[Git output truncated. Request a narrower file path.]' : ''}`
}

export class GitContextTool implements vscode.LanguageModelTool<GitContextInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GitContextInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) {
      throw new Error('Git context request cancelled')
    }

    const input = options.input
    if (!['status', 'diff', 'stagedDiff', 'branch', 'history'].includes(input.operation)) {
      throw new Error('operation must be status, diff, stagedDiff, branch, or history')
    }
    const scope = await getGitScope(input, token)
    const maxEntries = Math.min(input.maxEntries ?? 100, MAX_ENTRIES)
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('maxEntries must be a positive integer')
    }

    if (input.operation === 'branch') {
      const branch = await runGit(['branch', '--show-current'], scope.repository, token)
      const commit = await runGit(['rev-parse', '--short', 'HEAD'], scope.repository, token)
      return textResult(formatOutput(scope, input.operation, `branch: ${branch.stdout.trim() || '(detached HEAD)'}\ncommit: ${commit.stdout.trim()}`, branch.truncated || commit.truncated))
    }

    const pathSpec = input.operation === 'status'
      ? scope.filePath ?? scope.workspacePath
      : scope.filePath
    if ((input.operation === 'diff' || input.operation === 'stagedDiff' || input.operation === 'history') && !pathSpec) {
      return textResult('Git context needs a file path for this operation. Open or select a workspace file, then retry with its workspace-relative or absolute path.')
    }

    let args: string[]
    if (input.operation === 'status') {
      args = ['status', '--short', '--untracked-files=normal', '--', pathSpec ?? '.']
    } else if (input.operation === 'diff') {
      args = ['diff', '--no-ext-diff', '--', pathSpec as string]
    } else if (input.operation === 'stagedDiff') {
      args = ['diff', '--cached', '--no-ext-diff', '--', pathSpec as string]
    } else {
      args = ['log', '--follow', `-n${maxEntries}`, '--date=iso-strict', '--format=%h%x09%ad%x09%an%x09%s', '--', pathSpec as string]
    }
    const result = await runGit(args, scope.repository, token)
    const output = input.operation === 'status'
      ? result.stdout.split(/\r?\n/).filter(Boolean).slice(0, maxEntries).join('\n')
      : result.stdout
    return textResult(formatOutput(scope, input.operation, output, result.truncated || (input.operation === 'status' && result.stdout.split(/\r?\n/).filter(Boolean).length > maxEntries), pathSpec))
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<GitContextInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Reading Git ${options.input.operation}`
    }
  }
}

export function registerGitContextTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.lm.registerTool('ghost_git_context', new GitContextTool()))
}
