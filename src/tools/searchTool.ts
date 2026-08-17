import { spawn } from 'node:child_process'
import * as path from 'node:path'

import * as vscode from 'vscode'

import { getWorkspaceRoot, resolveWorkspacePath } from './workspacePath'

export interface SearchWorkspaceInput {
  query: string
  path?: string
  glob?: string
  caseSensitive?: boolean
  maxResults?: number
}

interface SearchMatch {
  path: string
  line: number
  column: number
  text: string
}

interface RipgrepResult {
  matches: SearchMatch[]
  truncated: boolean
}

const MAX_QUERY_LENGTH = 1000
const DEFAULT_MAX_RESULTS = 100
const MAX_RESULTS = 200

function textResult(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)])
}

function runRipgrep(
  args: string[],
  cwd: string,
  token: vscode.CancellationToken,
  maxResults: number
): Promise<RipgrepResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('rg', args, { cwd, shell: false, windowsHide: true })
    let errorOutput = ''
    let pending = ''
    let matches: SearchMatch[] = []
    let truncated = false
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      tokenSubscription.dispose()
      if (error) {
        reject(error)
      } else {
        resolve({ matches, truncated })
      }
    }

    const stop = (): void => {
      if (settled) return
      child.kill()
    }

    const tokenSubscription = token.onCancellationRequested(() => {
      stop()
      finish(new Error('Search cancelled'))
    })

    child.on('error', error => {
      finish(error instanceof Error ? error : new Error('Could not start ripgrep'))
    })
    child.stdout.on('data', chunk => {
      pending += Buffer.from(chunk).toString('utf8')
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line || matches.length >= maxResults) continue
        try {
          const event = JSON.parse(line) as {
            type?: string
            data?: {
              path?: { text?: string }
              lines?: { text?: string }
              line_number?: number
              submatches?: Array<{ start?: number }>
            }
          }
          if (event.type !== 'match' || !event.data?.path?.text || !event.data.line_number) continue
          const relativePath = event.data.path.text
          matches.push({
            path: path.resolve(cwd, relativePath),
            line: event.data.line_number,
            column: (event.data.submatches?.[0]?.start ?? 0) + 1,
            text: (event.data.lines?.text ?? '').replace(/\r?\n$/, '')
          })
          if (matches.length >= maxResults) {
            truncated = true
            stop()
            return
          }
        } catch {
          // Ignore non-match ripgrep events.
        }
      }
    })
    child.stderr.on('data', chunk => {
      errorOutput += Buffer.from(chunk).toString('utf8')
    })
    child.on('close', code => {
      if (settled) return
      if (code === 0 || code === 1 || (code === null && truncated)) {
        finish()
        return
      }
      finish(new Error(errorOutput.trim() || `ripgrep exited with code ${code ?? 'unknown'}`))
    })
  })
}

export class SearchWorkspaceTool implements vscode.LanguageModelTool<SearchWorkspaceInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SearchWorkspaceInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const query = options.input.query.trim()
    if (!query) throw new Error('Search query cannot be empty')
    if (query.length > MAX_QUERY_LENGTH) throw new Error(`Search query cannot exceed ${MAX_QUERY_LENGTH} characters`)

    const workspace = getWorkspaceRoot()
    const target = options.input.path ? resolveWorkspacePath(options.input.path) : workspace
    const relativeTarget = path.relative(workspace.fsPath, target.fsPath) || '.'
    const maxResults = Math.min(MAX_RESULTS, Math.max(1, Math.floor(options.input.maxResults ?? DEFAULT_MAX_RESULTS)))
    const args = ['--json', '--no-messages', '--fixed-strings', '--glob', '!{.git,node_modules,out,dist}/**']
    if (options.input.caseSensitive === false) args.push('--ignore-case')
    if (options.input.glob?.trim()) args.push('--glob', options.input.glob.trim())
    args.push(query, relativeTarget)

    const result = await runRipgrep(args, workspace.fsPath, token, maxResults)
    return textResult(JSON.stringify({
      query,
      path: target.fsPath,
      matches: result.matches,
      truncated: result.truncated,
      continuation: result.truncated
        ? `Repeat the search with maxResults and a narrower path or glob to inspect more matches.`
        : undefined
    }, null, 2))
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<SearchWorkspaceInput>): vscode.PreparedToolInvocation {
    return { invocationMessage: `Searching workspace for ${options.input.query}` }
  }
}

export function registerSearchTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.lm.registerTool('ghost_search_workspace', new SearchWorkspaceTool()))
}
