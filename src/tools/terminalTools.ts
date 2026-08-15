import { spawn } from 'node:child_process'

import * as vscode from 'vscode'

import { getWorkspaceRoot, resolveWorkspacePath } from './workspacePath'

export interface RunTerminalCommandInput {
  command: string
  cwd?: string
}

const COMMAND_TIMEOUT_MS = 120000
const MAX_OUTPUT_CHARS = 200000

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

    const cwd = options.input.cwd
      ? resolveWorkspacePath(options.input.cwd).fsPath
      : getWorkspaceRoot().fsPath
    const output = await runCommand(options.input.command, cwd, token)

    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(output)])
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<RunTerminalCommandInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Running terminal command in ${options.input.cwd ?? 'the workspace'}`,
      confirmationMessages: {
        title: 'Allow GhostPilot to run this terminal command?',
        message: new vscode.MarkdownString(`Run this command?\n\n\`\`\`sh\n${options.input.command}\n\`\`\``)
      }
    }
  }
}

export function registerTerminalTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('ghostpilot_run_terminal_command', new RunTerminalCommandTool())
  )
}
