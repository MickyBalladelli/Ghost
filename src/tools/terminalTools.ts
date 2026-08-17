import { spawn } from 'node:child_process'

import * as vscode from 'vscode'

import { getWorkspaceRoot, resolveWorkspacePath } from './workspacePath'

export interface RunTerminalCommandInput {
  command: string
  cwd?: string
}

export type TerminalCommandRisk = 'file-write' | 'destructive' | 'network' | 'package-install' | 'privilege'

export interface TerminalCommandAudit {
  risks: TerminalCommandRisk[]
  blocked: boolean
  summary: string
  blockReason?: string
}

const COMMAND_TIMEOUT_MS = 120000
const MAX_OUTPUT_CHARS = 200000

export function auditTerminalCommand(command: string): TerminalCommandAudit {
  const normalized = command.trim().toLowerCase()
  const risks = new Set<TerminalCommandRisk>()

  if (/(?:^|[\s;&|])(?:>|>>|tee\b|touch\b|mkdir\b|cp\b|mv\b|install\b|dd\b|truncate\b)|\bsed\b[^\n;&|]*\s-i(?:\s|$)|\b(?:perl|python|python3|node|ruby|php)\b[^\n;&|]*(?:writefile|write_text|open\s*\([^)]*["'][wa])|\bgit\s+(?:apply|checkout|reset|clean)\b/.test(normalized)) {
    risks.add('file-write')
  }
  if (/(?:^|[\s;&|])(?:rm|rmdir|del|erase|format|mkfs|shred|truncate|kill|pkill|killall)\b|\b(?:git\s+(?:reset\s+--hard|clean\s+-[a-z]*f)|diskutil\s+erase|docker\s+system\s+prune)\b/.test(normalized)) {
    risks.add('destructive')
  }
  if (/(?:^|[\s;&|])(?:curl|wget|fetch|nc|netcat|ssh|scp|sftp)\b|\bgit\s+(?:clone|fetch|pull|push)\b|\b(?:npm|pnpm|yarn|pip|cargo|go)\s+(?:install|add|get)\b/.test(normalized)) {
    risks.add('network')
  }
  if (/(?:^|[\s;&|])(?:npm|pnpm|yarn)\s+(?:install|add|remove|update)\b|(?:^|[\s;&|])(?:pip|pip3|cargo|gem|go)\s+install\b|\b(?:brew|apt|apt-get|dnf|yum|pacman)\s+install\b|\bdotnet\s+add\s+package\b/.test(normalized)) {
    risks.add('package-install')
  }
  if (/(?:^|[\s;&|])(?:sudo|doas|su|runas)\b|\b(?:chmod|chown|Set-ExecutionPolicy)\b/.test(normalized)) {
    risks.add('privilege')
  }

  const orderedRisks: TerminalCommandRisk[] = ['file-write', 'destructive', 'network', 'package-install', 'privilege']
  const selectedRisks = orderedRisks.filter(risk => risks.has(risk))
  const labels: Record<TerminalCommandRisk, string> = {
    'file-write': 'file write',
    destructive: 'destructive action',
    network: 'network access',
    'package-install': 'package installation',
    privilege: 'privilege or permission change'
  }
  const summary = selectedRisks.length > 0
    ? selectedRisks.map(risk => labels[risk]).join(', ')
    : 'read-only or unknown operation'
  const blocked = risks.has('file-write')
  return {
    risks: selectedRisks,
    blocked,
    summary,
    ...(blocked ? { blockReason: 'Terminal file writes are disabled. Use Ghost file tools for workspace changes.' } : {})
  }
}

export function formatTerminalAudit(audit: TerminalCommandAudit): string {
  return audit.blocked
    ? `Audit: ${audit.summary}. Blocked: ${audit.blockReason}`
    : `Audit: ${audit.summary}. Ghost will run this command only after approval.`
}

function getShellInvocation(command: string): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec ?? 'powershell.exe'

    if (shell.toLowerCase().includes('cmd')) {
      return { shell, args: ['/d', '/s', '/c', command] }
    }

    return { shell, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] }
  }

  return { shell: '/bin/bash', args: ['-lc', command] }
}

function runCommand(command: string, cwd: string, token: vscode.CancellationToken): Promise<string> {
  return new Promise((resolve, reject) => {
    const invocation = getShellInvocation(command)
    const child = spawn(invocation.shell, invocation.args, {
      cwd,
      env: process.env,
      windowsHide: true
    })
    let output = ''
    let timedOut = false
    let settled = false
    let cancellationSubscription: vscode.Disposable | undefined

    const append = (chunk: string) => {
      if (output.length < MAX_OUTPUT_CHARS) {
        output += chunk.slice(0, MAX_OUTPUT_CHARS - output.length)
      }
    }

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, COMMAND_TIMEOUT_MS)

    const finish = (callback: () => void) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      cancellationSubscription?.dispose()
      callback()
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', append)
    child.stderr.on('data', (chunk: string) => append(`\n${chunk}`))
    child.on('error', error => finish(() => reject(error)))
    child.on('close', code => {
      const truncated = output.length >= MAX_OUTPUT_CHARS ? '\n[Output truncated]' : ''
      const timeoutMessage = timedOut ? `\n[Command timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds]` : ''
      const exitMessage = `\n[Exit code: ${code ?? 'unknown'}]`
      finish(() => resolve(`${output}${truncated}${timeoutMessage}${exitMessage}`))
    })

    cancellationSubscription = token.onCancellationRequested(() => {
      child.kill()
      finish(() => reject(new Error('Terminal command cancelled')))
    })

    if (token.isCancellationRequested) {
      child.kill()
      finish(() => reject(new Error('Terminal command cancelled')))
    }
  })
}

export class RunTerminalCommandTool implements vscode.LanguageModelTool<RunTerminalCommandInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunTerminalCommandInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    if (!options.input.command.trim()) {
      throw new Error('Command cannot be empty')
    }
    const audit = auditTerminalCommand(options.input.command)
    if (audit.blocked) {
      throw new Error(formatTerminalAudit(audit))
    }

    const cwd = options.input.cwd
      ? resolveWorkspacePath(options.input.cwd).fsPath
      : getWorkspaceRoot().fsPath
    const output = await runCommand(options.input.command, cwd, token)

    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(output)])
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<RunTerminalCommandInput>): vscode.PreparedToolInvocation {
    const audit = auditTerminalCommand(options.input.command)
    return {
      invocationMessage: `Audited terminal command: ${audit.summary}`,
      confirmationMessages: {
        title: 'Allow Ghost to run this terminal command?',
        message: new vscode.MarkdownString(`${formatTerminalAudit(audit)}\n\nRun this command?\n\n\`\`\`sh\n${options.input.command}\n\`\`\``)
      }
    }
  }
}

export function registerTerminalTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('ghost_run_terminal_command', new RunTerminalCommandTool())
  )
}
