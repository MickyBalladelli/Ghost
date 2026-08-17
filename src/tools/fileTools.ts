import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { TextDecoder } from 'node:util'

import * as vscode from 'vscode'

import { getWorkspaceRoot, resolveWorkspacePath } from './workspacePath'
import { applyGhostEdit, parseGhostEdit, summarizeGhostEdit } from './editWorkflow'
import { atomicWriteFile } from './atomicFile'
import { readWorkspaceFile, verifyWorkspaceFile } from './workspaceFile'
import { applyFileTransaction, FileTransactionInput, parseFileTransaction, summarizeFileTransaction } from './transactionWorkflow'

export interface ReadFileInput {
  path: string
  mode?: 'head' | 'tail' | 'lines' | 'bytes' | 'symbol' | 'matches'
  startLine?: number
  endLine?: number
  lineCount?: number
  startByte?: number
  endByte?: number
  symbol?: string
  match?: string
  caseSensitive?: boolean
  maxMatches?: number
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
const MAX_READ_BYTES = 12000

interface FileMetadata {
  encoding: 'utf-8'
  lineEndings: 'LF' | 'CRLF' | 'CR' | 'mixed' | 'none'
  sizeBytes: number
  lineCount: number
  contentHash: string
}

function getLineEndings(content: string): FileMetadata['lineEndings'] {
  const endings = content.match(/\r\n|\n|\r/g) ?? []
  if (endings.length === 0) {
    return 'none'
  }
  const unique = new Set(endings)
  if (unique.size > 1) {
    return 'mixed'
  }
  return endings[0] === '\r\n' ? 'CRLF' : endings[0] === '\r' ? 'CR' : 'LF'
}

function getFileMetadata(bytes: Uint8Array, content: string): FileMetadata {
  return {
    encoding: 'utf-8',
    lineEndings: getLineEndings(content),
    sizeBytes: bytes.byteLength,
    lineCount: content.split(/\r\n|\n|\r/).length,
    contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  }
}

function assertInteger(value: number | undefined, name: string, minimum: number): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`)
  }
  return value
}

function splitLines(content: string): string[] {
  return content.split(/\r\n|\n|\r/)
}

function formatLineSelection(lines: string[], startLine: number, endLine: number, maxCharacters = MAX_READ_CHARACTERS): { content: string; actualEnd: number } {
  const selected: string[] = []
  let characterCount = 0
  let actualEnd = startLine - 1

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const numberedLine = `${lineNumber}: ${lines[lineNumber - 1]}`
    if (selected.length > 0 && characterCount + numberedLine.length > maxCharacters) {
      break
    }
    selected.push(numberedLine)
    characterCount += numberedLine.length
    actualEnd = lineNumber
  }

  return { content: selected.join('\n'), actualEnd }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findSymbolRange(lines: string[], symbol: string): { startLine: number; endLine: number } {
  const symbolPattern = new RegExp(`\\b${escapeRegExp(symbol)}\\b`)
  const declarationPattern = new RegExp(`\\b(?:class|interface|enum|function|def|type|namespace|module|struct|trait|object|const|let|var)\\s+${escapeRegExp(symbol)}\\b`)
  const startIndex = lines.findIndex(line => declarationPattern.test(line))
  const fallbackIndex = startIndex >= 0 ? startIndex : lines.findIndex(line => symbolPattern.test(line))

  if (fallbackIndex < 0) {
    throw new Error(`Symbol '${symbol}' was not found in the file`)
  }

  const startLine = fallbackIndex + 1
  let braceDepth = 0
  let sawBrace = false

  for (let index = fallbackIndex; index < lines.length; index += 1) {
    const line = lines[index]
    const opens = (line.match(/{/g) ?? []).length
    const closes = (line.match(/}/g) ?? []).length
    if (opens > 0 || closes > 0) {
      sawBrace = true
      braceDepth += opens - closes
      if (index > fallbackIndex && braceDepth <= 0) {
        return { startLine, endLine: index + 1 }
      }
    }
  }

  if (sawBrace && braceDepth > 0) {
    return { startLine, endLine: lines.length }
  }

  const baseIndent = lines[fallbackIndex].match(/^\s*/)?.[0].length ?? 0
  for (let index = fallbackIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() && (line.match(/^\s*/)?.[0].length ?? 0) <= baseIndent) {
      return { startLine, endLine: index }
    }
  }
  return { startLine, endLine: lines.length }
}

function isUtf8Boundary(bytes: Uint8Array, offset: number): boolean {
  return offset === 0 || offset === bytes.length || (bytes[offset] & 0xc0) !== 0x80
}

function readFileWindow(content: string, bytes: Uint8Array, input: ReadFileInput, filePath: string): string {
  const lines = splitLines(content)
  const metadata = getFileMetadata(bytes, content)
  const mode = input.mode ?? (input.startByte !== undefined || input.endByte !== undefined
    ? 'bytes'
    : input.symbol !== undefined
      ? 'symbol'
      : input.match !== undefined
        ? 'matches'
        : input.startLine !== undefined || input.endLine !== undefined ? 'lines' : 'head')
  if (!['head', 'tail', 'lines', 'bytes', 'symbol', 'matches'].includes(mode)) {
    throw new Error(`Unsupported read mode '${mode}'`)
  }
  const metadataText = JSON.stringify(metadata)

  if (mode === 'bytes') {
    const startByte = assertInteger(input.startByte ?? 0, 'startByte', 0) as number
    const endByte = Math.min(assertInteger(input.endByte ?? startByte + MAX_READ_BYTES, 'endByte', startByte) as number, bytes.length)
    if (startByte > bytes.length) {
      throw new Error(`startByte ${startByte} exceeds the file size of ${bytes.length} bytes`)
    }
    if (!isUtf8Boundary(bytes, startByte) || !isUtf8Boundary(bytes, endByte)) {
      throw new Error('Byte range must start and end on UTF-8 character boundaries')
    }
    const selected = decodeText(bytes.subarray(startByte, endByte))
    const nextHint = endByte < bytes.length ? `\n\n[Byte output truncated. Read the next chunk with ghost_read_file({"path":"${filePath}","mode":"bytes","startByte":${endByte},"endByte":${Math.min(endByte + MAX_READ_BYTES, bytes.length)}}).]` : ''
    return `File: ${filePath}\nMetadata: ${metadataText}\nRead mode: bytes ${startByte}-${endByte} of ${bytes.length}\n\n${selected}${nextHint}`
  }

  if (mode === 'matches') {
    if (!input.match) {
      throw new Error("match is required when mode is 'matches'")
    }
    const maxMatches = Math.min(assertInteger(input.maxMatches ?? 100, 'maxMatches', 1) as number, 200)
    const needle = input.caseSensitive === false ? input.match.toLocaleLowerCase() : input.match
    const matchingLines = lines.flatMap((line, index) => {
      const value = input.caseSensitive === false ? line.toLocaleLowerCase() : line
      return value.includes(needle) ? [{ lineNumber: index + 1, line }] : []
    })
    const selected = matchingLines.slice(0, maxMatches).map(item => `${item.lineNumber}: ${item.line}`).join('\n') || '[no matching lines]'
    const nextHint = matchingLines.length > maxMatches ? `\n\n[Matching lines truncated at ${maxMatches}. Use a narrower match or maxMatches.]` : ''
    return `File: ${filePath}\nMetadata: ${metadataText}\nRead mode: matching lines (${matchingLines.length} matches)\n\n${selected}${nextHint}`
  }

  let startLine = 1
  let endLine = lines.length
  if (mode === 'symbol') {
    if (!input.symbol?.trim()) {
      throw new Error("symbol is required when mode is 'symbol'")
    }
    const range = findSymbolRange(lines, input.symbol.trim())
    startLine = range.startLine
    endLine = range.endLine
  } else if (mode === 'tail') {
    const lineCount = Math.min(assertInteger(input.lineCount ?? MAX_READ_LINES, 'lineCount', 1) as number, MAX_READ_LINES)
    startLine = Math.max(1, lines.length - lineCount + 1)
    endLine = lines.length
  } else {
    startLine = assertInteger(input.startLine ?? 1, 'startLine', 1) as number
    endLine = assertInteger(input.endLine ?? startLine + MAX_READ_LINES - 1, 'endLine', startLine) as number
    endLine = Math.min(endLine, startLine + MAX_READ_LINES - 1, lines.length)
  }

  if (startLine > lines.length) {
    throw new Error(`startLine ${startLine} exceeds the file length of ${lines.length} lines`)
  }
  const selection = formatLineSelection(lines, startLine, endLine)
  const truncated = selection.actualEnd < endLine || endLine < lines.length
  const nextStart = selection.actualEnd + 1
  const nextHint = truncated && nextStart <= lines.length
    ? `\n\n[File output truncated. Read the next chunk with ghost_read_file({"path":"${filePath}","mode":"lines","startLine":${nextStart},"endLine":${Math.min(nextStart + MAX_READ_LINES - 1, lines.length)}}).]`
    : ''
  return `File: ${filePath}\nMetadata: ${metadataText}\nRead mode: ${mode}, lines ${startLine}-${selection.actualEnd} of ${lines.length}\n\n${selection.content}${nextHint}`
}

export class ReadFileTool implements vscode.LanguageModelTool<ReadFileInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ReadFileInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertNotCancelled(token)
    const uri = resolveWorkspacePath(options.input.path)
    const bytes = await vscode.workspace.fs.readFile(uri)
    const content = decodeText(bytes)
    return textResult(readFileWindow(content, bytes, options.input, uri.fsPath))
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
    await verifyWorkspaceFile(uri, { exists: true, content: options.input.content })

    return textResult(`Wrote ${options.input.content.length} characters to ${uri.fsPath}\nVerification: passed (readback matched).`)
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
    await verifyWorkspaceFile(uri, { exists: true, content: updated })
    return textResult(`${summarizeGhostEdit(edit)}\nApplied successfully.\nVerification: passed (readback matched).`)
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

export class ApplyTransactionTool implements vscode.LanguageModelTool<FileTransactionInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<FileTransactionInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertNotCancelled(token)
    const transaction = parseFileTransaction(options.input as unknown as Record<string, unknown>)
    const applied = await applyFileTransaction(transaction)
    return textResult(`${summarizeFileTransaction(applied)}\nApplied and verified as one transaction.`)
  }

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<FileTransactionInput>): vscode.PreparedToolInvocation {
    const transaction = parseFileTransaction(options.input as unknown as Record<string, unknown>)
    return {
      invocationMessage: `Applying ${transaction.edits.length} files as one transaction`,
      confirmationMessages: {
        title: 'Allow Ghost to apply this file transaction?',
        message: new vscode.MarkdownString(`Apply and verify **${transaction.edits.length} files** together?`)
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
    vscode.lm.registerTool('ghost_apply_transaction', new ApplyTransactionTool()),
    vscode.lm.registerTool('ghost_list_directory', new ListDirectoryTool())
  )
}

export { getWorkspaceRoot }
