import * as path from 'node:path'
import { TextDecoder } from 'node:util'

import * as vscode from 'vscode'

import { getWorkspaceRoot, resolveWorkspacePath } from './workspacePath'
import { applyGhostEdit, parseGhostEdit, summarizeGhostEdit } from './editWorkflow'
import { atomicWriteFile } from './atomicFile'
import { readWorkspaceFile } from './workspaceFile'

export interface ReadFileInput {
  path: string
  startLine?: number
  endLine?: number
}

export interface WriteFileInput {
  path: string
  content: string
}

export interface ApplyEditInput {
  path: string
  expectedContent?: string
  hunks: Array<{
    startLine: number
    endLine: number
    replacement: string
    oldText?: string
    oldHash?: string
    beforeContext?: string
    afterContext?: string
  }>
}

export interface ListDirectoryInput {
  path: string
  recursive?: boolean
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0)) {
    throw new Error('Binary files are not supported by the text file tool')
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Non-UTF-8 binary files are not supported by the text file tool')
  }
}

function textResult(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)])
}

function assertNotCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new Error('Tool invocation cancelled')
  }
}

const MAX_READ_LINES = 400
const MAX_READ_CHARACTERS = 12000

function readFileWindow(content: string, input: ReadFileInput, filePath: string): string {
  const lines = content.split(/\r?\n/)
  const hasRange = input.startLine !== undefined || input.endLine !== undefined
  const startLine = input.startLine ?? 1
  const endLine = input.endLine ?? startLine + MAX_READ_LINES - 1

  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new Error('startLine must be a positive integer')
  }
  if (!Number.isInteger(endLine) || endLine < startLine) {
    throw new Error('endLine must be an integer greater than or equal to startLine')
  }
  if (startLine > lines.length) {
    throw new Error(`startLine ${startLine} exceeds the file length of ${lines.length} lines`)
  }

  const requestedEnd = Math.min(endLine, startLine + MAX_READ_LINES - 1, lines.length)
  const selected: string[] = []
  let characterCount = 0
  let actualEnd = startLine - 1

  for (let lineNumber = startLine; lineNumber <= requestedEnd; lineNumber += 1) {
    const line = lines[lineNumber - 1]
    const numberedLine = `${lineNumber}: ${line}`
    if (selected.length > 0 && characterCount + numberedLine.length > MAX_READ_CHARACTERS) {
      break
    }
    selected.push(numberedLine)
    characterCount += numberedLine.length
    actualEnd = lineNumber
  }

  const truncated = actualEnd < lines.length
  const nextStart = actualEnd + 1
  const nextHint = truncated
    ? `\n\n[File output truncated. Read the next chunk with ghost_read_file({"path":"${filePath}","startLine":${nextStart},"endLine":${Math.min(nextStart + MAX_READ_LINES - 1, lines.length)}}).]`
    : ''

  if (!hasRange && !truncated) {
    return `File: ${filePath}\n\n${content}`
  }

  return `File: ${filePath}\nLines ${startLine}-${actualEnd} of ${lines.length}\n\n${selected.join('\n')}${nextHint}`
}

export class ReadFileTool implements vscode.LanguageModelTool<ReadFileInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ReadFileInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertNotCancelled(token)
    const uri = resolveWorkspacePath(options.input.path)
    const content = decodeText(await vscode.workspace.fs.readFile(uri))
    return textResult(readFileWindow(content, options.input, uri.fsPath))
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
    const current = await readWorkspaceFile(uri)
    await atomicWriteFile(uri, Buffer.from(options.input.content, 'utf8'), current)

    return textResult(`Wrote ${options.input.content.length} characters to ${uri.fsPath}`)
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<WriteFileInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: `Writing ${options.input.path}`,
      confirmationMessages: {
        title: 'Allow Ghost to write this file?',
        message: new vscode.MarkdownString(`Write the complete contents of **${options.input.path}**?`)
      }
    }
  }
}

export class ApplyEditTool implements vscode.LanguageModelTool<ApplyEditInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ApplyEditInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertNotCancelled(token)
    const edit = parseGhostEdit(options.input as unknown as Record<string, unknown>)
    const uri = resolveWorkspacePath(edit.path)
    const current = decodeText(await vscode.workspace.fs.readFile(uri))
    if (edit.expectedContent !== undefined && current !== edit.expectedContent) {
      throw new Error('Edit expected different file content')
    }
    const updated = applyGhostEdit(current, edit)
    if (updated === current) {
      return textResult(`${summarizeGhostEdit(edit)}\nNo changes needed.`)
    }
    await atomicWriteFile(uri, Buffer.from(updated, 'utf8'), { exists: true, content: current })
    return textResult(`${summarizeGhostEdit(edit)}\nApplied successfully.`)
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ApplyEditInput>): vscode.PreparedToolInvocation {
    const edit = parseGhostEdit(options.input as unknown as Record<string, unknown>)
    return {
      invocationMessage: `Applying ${edit.path}`,
      confirmationMessages: {
        title: 'Allow Ghost to apply this edit?',
        message: new vscode.MarkdownString(summarizeGhostEdit(edit))
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
    vscode.lm.registerTool('ghost_read_file', new ReadFileTool()),
    vscode.lm.registerTool('ghost_write_file', new WriteFileTool()),
    vscode.lm.registerTool('ghost_apply_edit', new ApplyEditTool()),
    vscode.lm.registerTool('ghost_list_directory', new ListDirectoryTool())
  )
}

export { getWorkspaceRoot }
