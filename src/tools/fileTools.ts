import * as path from 'node:path'

import * as vscode from 'vscode'

import { getWorkspaceRoot, resolveWorkspacePath } from './workspacePath'

export interface ReadFileInput {
  path: string
}

export interface WriteFileInput {
  path: string
  content: string
}

export interface ListDirectoryInput {
  path: string
  recursive?: boolean
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0)) {
    throw new Error('Binary files are not supported by the text file tool')
  }

  return Buffer.from(bytes).toString('utf8')
}

function textResult(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)])
}

function assertNotCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new Error('Tool invocation cancelled')
  }
}

export class ReadFileTool implements vscode.LanguageModelTool<ReadFileInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ReadFileInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertNotCancelled(token)
    const uri = resolveWorkspacePath(options.input.path)
    const content = decodeText(await vscode.workspace.fs.readFile(uri))
    return textResult(`File: ${uri.fsPath}\n\n${content}`)
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ReadFileInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Reading ${options.input.path}`
    }
  }
}

export class WriteFileTool implements vscode.LanguageModelTool<WriteFileInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<WriteFileInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertNotCancelled(token)
    const uri = resolveWorkspacePath(options.input.path)
    const parent = vscode.Uri.file(path.dirname(uri.fsPath))

    await vscode.workspace.fs.createDirectory(parent)
    await vscode.workspace.fs.writeFile(uri, Buffer.from(options.input.content, 'utf8'))

    return textResult(`Wrote ${options.input.content.length} characters to ${uri.fsPath}`)
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<WriteFileInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Writing ${options.input.path}`,
      confirmationMessages: {
        title: 'Allow LocalPilot to write this file?',
        message: new vscode.MarkdownString(`Write the complete contents of **${options.input.path}**?`)
      }
    }
  }
}

async function collectDirectoryEntries(
  directory: vscode.Uri,
  relativePrefix: string,
  recursive: boolean,
  token: vscode.CancellationToken,
  entries: string[],
  limit: number
): Promise<void> {
  if (entries.length >= limit || token.isCancellationRequested) {
    return
  }

  const children = await vscode.workspace.fs.readDirectory(directory)
  children.sort(([leftName, leftType], [rightName, rightType]) => {
    const leftDirectory = leftType === vscode.FileType.Directory ? 0 : 1
    const rightDirectory = rightType === vscode.FileType.Directory ? 0 : 1
    return leftDirectory - rightDirectory || leftName.localeCompare(rightName)
  })

  for (const [name, type] of children) {
    if (entries.length >= limit || token.isCancellationRequested) {
      return
    }

    const relativePath = path.join(relativePrefix, name)
    const isDirectory = type === vscode.FileType.Directory
    entries.push(`${isDirectory ? '[dir] ' : '[file]'}${relativePath}${isDirectory ? '/' : ''}`)

    if (recursive && isDirectory) {
      await collectDirectoryEntries(
        vscode.Uri.joinPath(directory, name),
        relativePath,
        true,
        token,
        entries,
        limit
      )
    }
  }
}

export class ListDirectoryTool implements vscode.LanguageModelTool<ListDirectoryInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ListDirectoryInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertNotCancelled(token)
    const uri = resolveWorkspacePath(options.input.path)
    const entries: string[] = []

    await collectDirectoryEntries(uri, '', options.input.recursive ?? false, token, entries, 500)

    if (token.isCancellationRequested) {
      throw new Error('Tool invocation cancelled')
    }

    const suffix = entries.length === 500 ? '\n\n[Directory listing truncated at 500 entries]' : ''
    return textResult(`Directory: ${uri.fsPath}\n\n${entries.join('\n') || '[empty]'}${suffix}`)
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ListDirectoryInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Listing ${options.input.path}`
    }
  }
}

export function registerFileTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('localpilot_read_file', new ReadFileTool()),
    vscode.lm.registerTool('localpilot_write_file', new WriteFileTool()),
    vscode.lm.registerTool('localpilot_list_directory', new ListDirectoryTool())
  )
}

export { getWorkspaceRoot }
