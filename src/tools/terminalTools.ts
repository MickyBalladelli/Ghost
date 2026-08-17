import { spawn } from 'node:child_process'

import * as vscode from 'vscode'

import { DEFAULT_TERMINAL_ENVIRONMENT_ALLOWLIST, getGhostSettings } from '../config'
import { redactSensitiveText } from '../privacy/redact'
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
const PROCESS_TERMINATION_GRACE_MS = 500

type TerminationReason = 'timeout' | 'cancelled' | 'output-limit'
const SECRET_ENVIRONMENT_NAME = /(?:API|ACCESS|AUTH|BEARER|CERT|COOKIE|CREDENTIAL|KEY|PASSWORD|PASSWD|PRIVATE|SECRET|TOKEN)/i
const VALID_ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function getEnvironmentValue(name: string): string | undefined {
  if (process.env[name] !== undefined) {
    return process.env[name]
  }
  const entry = Object.entries(process.env).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return entry?.[1]
}

function getTerminalEnvironment(): NodeJS.ProcessEnv {
  const configured = getGhostSettings().terminalEnvironmentAllowlist
  const names = Array.isArray(configured) ? configured : DEFAULT_TERMINAL_ENVIRONMENT_ALLOWLIST
  const environment: NodeJS.ProcessEnv = {}
  for (const rawName of names) {
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    if (!VALID_ENVIRONMENT_NAME.test(name) || SECRET_ENVIRONMENT_NAME.test(name)) {
      continue
    }
    const value = getEnvironmentValue(name)
    if (value !== undefined) {
      environment[name] = value
    }
  }
  return environment
}

function redactTerminalOutput(output: string, environment: NodeJS.ProcessEnv): string {
  const values = Object.values(environment)
    .filter((value): value is string => typeof value === 'string' && value.length >= 4)
    .sort((left, right) => right.length - left.length)
  return values.reduce((redacted, value) => redacted.split(value).join('[REDACTED_ENV]'), redactSensitiveText(output))
}

function terminateProcessTree(child: ReturnType<typeof spawn>, force: boolean): void {
  if (!child.pid) {
    child.kill(force ? 'SIGKILL' : 'SIGTERM')
    return
  }
  if (process.platform === 'win32') {
    const args = ['/pid', String(child.pid), '/t']
    if (force) {
      args.push('/f')
    }
    const taskkill = spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' })
    taskkill.on('error', () => child.kill(force ? 'SIGKILL' : 'SIGTERM'))
    return
  }
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    child.kill(force ? 'SIGKILL' : 'SIGTERM')
  }
}

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
    const environment = getTerminalEnvironment()
    const child = spawn(invocation.shell, invocation.args, {
      cwd,
      env: environment,
      detached: process.platform !== 'win32',
      windowsHide: true
    })
    let output = ''
    let timedOut = false
    let outputLimitReached = false
    let terminationReason: TerminationReason | undefined
    let settled = false
    let cancellationSubscription: vscode.Disposable | undefined
    let forceTerminationTimer: NodeJS.Timeout | undefined

    const terminate = (reason: TerminationReason): void => {
      if (settled || terminationReason) {
        return
      }
      terminationReason = reason
      terminateProcessTree(child, false)
      forceTerminationTimer = setTimeout(() => terminateProcessTree(child, true), PROCESS_TERMINATION_GRACE_MS)
    }

    const append = (chunk: string) => {
      if (output.length >= MAX_OUTPUT_CHARS) {
        terminate('output-limit')
        return
      }
      output += chunk.slice(0, MAX_OUTPUT_CHARS - output.length)
      if (output.length >= MAX_OUTPUT_CHARS) {
        outputLimitReached = true
        terminate('output-limit')
      }
    }

    const timeout = setTimeout(() => {
      timedOut = true
      terminate('timeout')
    }, COMMAND_TIMEOUT_MS)

    const finish = (callback: () => void) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      if (forceTerminationTimer) {
        clearTimeout(forceTerminationTimer)
      }
      cancellationSubscription?.dispose()
      callback()
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', append)
    child.stderr.on('data', (chunk: string) => append(`\n${chunk}`))
    child.on('error', error => finish(() => reject(error)))
    child.on('close', code => {
      const outputMessage = outputLimitReached ? '\n[Output limit reached; process stopped]' : ''
      const timeoutMessage = timedOut ? `\n[Command timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds; process tree stopped]` : ''
      const exitMessage = `\n[Exit code: ${code ?? 'unknown'}]`
      const result = `${redactTerminalOutput(output, environment)}${outputMessage}${timeoutMessage}${exitMessage}`
      if (terminationReason === 'cancelled') {
        finish(() => reject(new Error(`Terminal command cancelled; process tree stopped.\n${result}`)))
        return
      }
      if (terminationReason === 'timeout') {
        finish(() => reject(new Error(result)))
        return
      }
      finish(() => resolve(result))
    })

    cancellationSubscription = token.onCancellationRequested(() => {
      terminate('cancelled')
    })

    if (token.isCancellationRequested) {
      terminate('cancelled')
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
