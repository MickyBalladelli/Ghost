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
  source?: 'editor' | 'disk'
  allowSpecialFile?: boolean
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
  cursor?: string
  pageSize?: number
  maxDepth?: number
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
const MAX_SAFE_READ_BYTES = 1_048_576

const VENDORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'vendor',
  'vendors',
  'third_party',
  'third-party',
  'bower_components',
  'pods'
])

const GENERATED_DIRECTORY_NAMES = new Set([
  'build',
  'dist',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  'target',
  '__pycache__'
])

function normalizedWorkspaceRelativePath(uri: vscode.Uri): string {
  return path.relative(getWorkspaceRoot().fsPath, uri.fsPath).split(path.sep).join('/')
}

function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index += 1
      } else {
        source += '[^/]*'
      }
    } else if (character === '?') {
      source += '[^/]'
    } else {
      source += escapeRegExp(character)
    }
  }
  return new RegExp(`^${source}$`, 'i')
}

function matchesGitignorePattern(relativePath: string, rawPattern: string): boolean {
  let pattern = rawPattern.trim()
  if (!pattern || pattern.startsWith('#')) {
    return false
  }
  if (pattern.startsWith('\\')) {
    pattern = pattern.slice(1)
  }
  const directoryOnly = pattern.endsWith('/')
  pattern = pattern.replace(/^\/+/, '').replace(/\/$/, '')
  const patternMatcher = globToRegExp(pattern)
  if (pattern.includes('/')) {
    const candidates = pattern.startsWith('/') ? [relativePath] : [relativePath, ...relativePath.split('/').map((_, index, parts) => parts.slice(index + 1).join('/'))]
    return candidates.some(candidate => patternMatcher.test(candidate)) || (directoryOnly && relativePath.startsWith(`${pattern}/`))
  }
  const segments = relativePath.split('/')
  return segments.some(segment => patternMatcher.test(segment)) || (directoryOnly && segments.includes(pattern))
}

async function isGitIgnored(uri: vscode.Uri): Promise<boolean> {
  const relativePath = normalizedWorkspaceRelativePath(uri)
  if (!relativePath || relativePath.startsWith('..')) {
    return false
  }
  try {
    const ignoreFile = vscode.Uri.joinPath(getWorkspaceRoot(), '.gitignore')
    const ignoreContent = new TextDecoder('utf-8', { fatal: true }).decode(await vscode.workspace.fs.readFile(ignoreFile))
    let ignored = false
    for (const rawPattern of ignoreContent.split(/\r\n|\n|\r/)) {
      const pattern = rawPattern.trim()
      if (!pattern || pattern.startsWith('#')) {
        continue
      }
      const negated = pattern.startsWith('!')
      const candidate = negated ? pattern.slice(1) : pattern
      if (matchesGitignorePattern(relativePath, candidate)) {
        ignored = !negated
      }
    }
    return ignored
  } catch {
    return false
  }
}

function pathCategoryReasons(uri: vscode.Uri): string[] {
  const relativePath = normalizedWorkspaceRelativePath(uri)
  const segments = relativePath.toLowerCase().split('/')
  const fileName = segments.at(-1) ?? ''
  const reasons: string[] = []
  if (segments.some(segment => VENDORED_DIRECTORY_NAMES.has(segment))) {
    reasons.push('vendored/dependency path')
  }
  if (segments.some(segment => GENERATED_DIRECTORY_NAMES.has(segment))
    || /(?:\.min\.|\.bundle\.|\.generated\.|-generated\.)/.test(fileName)
    || fileName.endsWith('.map')) {
    reasons.push('generated/build artifact')
  }
  return reasons
}

function blockedReadResult(filePath: string, reasons: string[], safeAlternative: string): vscode.LanguageModelToolResult {
  return textResult([
    `Read blocked before model content was loaded: ${filePath}`,
    `Reason: ${reasons.join('; ')}.`,
    `Safe alternative: ${safeAlternative}`,
    'If the user explicitly asks to inspect this special file, retry with allowSpecialFile=true and a bounded read mode.'
  ].join('\n'))
}

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
    if (options.input.source !== undefined && !['editor', 'disk'].includes(options.input.source)) {
      throw new Error("source must be 'editor' or 'disk'")
    }
    const openDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString())
    if (openDocument?.isDirty && options.input.source === undefined) {
      return textResult(`Read paused: ${uri.fsPath} has unsaved editor changes. Retry with ghost_read_file({"path":"${uri.fsPath}","source":"editor"}) to read the buffer, or source:"disk" to read the saved disk version. Save or discard the editor changes before asking Ghost to edit this file.`)
    }

    if (options.input.source === 'editor') {
      if (!openDocument) {
        return textResult(`No open editor buffer exists for ${uri.fsPath}. Retry with source:"disk" or open the file in the editor first.`)
      }
      const bytes = Buffer.from(openDocument.getText(), 'utf8')
      const reasons = pathCategoryReasons(uri)
      if (await isGitIgnored(uri)) {
        reasons.push('matched .gitignore')
      }
      if (bytes.length > MAX_SAFE_READ_BYTES) {
        return blockedReadResult(uri.fsPath, [...reasons, `very large editor buffer (${bytes.length} bytes)`], 'Read a smaller editor selection or use ghost_search_workspace for exact text matches.')
      }
      if (reasons.length > 0 && !options.input.allowSpecialFile) {
        return blockedReadResult(uri.fsPath, reasons, 'Use ghost_search_workspace for text matches, or ask for a bounded explicit editor-buffer read.')
      }
      return textResult(`Source: editor buffer (unsaved changes included)\n${readFileWindow(openDocument.getText(), bytes, options.input, uri.fsPath)}`)
    }

    const stat = await vscode.workspace.fs.stat(uri)
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      throw new Error('The path points to a directory. Use ghost_list_directory instead.')
    }

    const reasons = pathCategoryReasons(uri)
    if (await isGitIgnored(uri)) {
      reasons.push('matched .gitignore')
    }
    if (stat.size > MAX_SAFE_READ_BYTES) {
      return blockedReadResult(
        uri.fsPath,
        [...reasons, `very large file (${stat.size} bytes)`],
        'Use ghost_search_workspace for exact text matches or ask for a smaller generated artifact. The text reader will not load files over 1 MiB.'
      )
    }
    if (reasons.length > 0 && !options.input.allowSpecialFile) {
      return blockedReadResult(
        uri.fsPath,
        reasons,
        'Use ghost_search_workspace for text matches, or ask for a bounded read of a specific file section.'
      )
    }

    const bytes = await vscode.workspace.fs.readFile(uri)
    let content: string
    try {
      content = decodeText(bytes)
    } catch {
      return blockedReadResult(
        uri.fsPath,
        ['binary or non-UTF-8 content'],
        'Use ghost_search_workspace for text matches or an external binary-aware inspection tool. The text reader will not expose binary bytes to the model.'
      )
    }
    const sourceNote = openDocument?.isDirty ? 'Source: disk (unsaved editor changes not included)\n' : 'Source: disk\n'
    return textResult(`${sourceNote}${readFileWindow(content, bytes, options.input, uri.fsPath)}`)
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
  depth: number,
  maxDepth: number,
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

    if (recursive && isDirectory && depth < maxDepth) {
      await collectDirectoryEntries(
        vscode.Uri.joinPath(directory, name),
        relativePath,
        true,
        depth + 1,
        maxDepth,
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
    const recursive = options.input.recursive ?? false
    const cursor = options.input.cursor === undefined ? 0 : Number(options.input.cursor)
    const pageSize = Math.min(options.input.pageSize ?? 100, 100)
    const maxDepth = recursive ? options.input.maxDepth ?? 3 : 0

    if (!Number.isInteger(cursor) || cursor < 0 || cursor > 5000) {
      throw new Error('cursor must be an integer from 0 through 5000')
    }
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw new Error('pageSize must be a positive integer')
    }
    if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 10) {
      throw new Error('maxDepth must be an integer from 0 through 10')
    }

    const scanLimit = Math.min(5000, cursor + pageSize + 1)

    await collectDirectoryEntries(uri, '', recursive, 0, maxDepth, token, entries, scanLimit)

    if (token.isCancellationRequested) {
      throw new Error('Tool invocation cancelled')
    }

    const page = entries.slice(cursor, cursor + pageSize)
    const hasMore = entries.length > cursor + pageSize
    const nextCursor = cursor + page.length
    const suffix = hasMore
      ? `\n\n[Directory page truncated. Continue with ghost_list_directory({"path":"${uri.fsPath}","recursive":${recursive},"pageSize":${pageSize},"maxDepth":${maxDepth},"cursor":"${nextCursor}"}).]`
      : ''
    return textResult(`Directory: ${uri.fsPath}\nDepth limit: ${maxDepth}\nEntries ${page.length === 0 ? 0 : cursor + 1}-${cursor + page.length}${hasMore ? '+' : ''}\n\n${page.join('\n') || '[empty]'}${suffix}`)
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
