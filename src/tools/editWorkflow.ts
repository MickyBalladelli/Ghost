import * as path from 'node:path'
import { createHash } from 'node:crypto'

import { resolveWorkspacePath } from './workspacePath'

export interface GhostEditHunk {
  startLine: number
  endLine: number
  replacement: string
  oldText?: string
  oldHash?: string
  beforeContext?: string
  afterContext?: string
}

export interface GhostFileEdit {
  path: string
  hunks: GhostEditHunk[]
  expectedContent?: string
  description?: string
}

const MAX_HUNKS = 50
const MAX_REPLACEMENT_CHARACTERS = 100000
const MAX_CONTEXT_CHARACTERS = 10000

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

export function parseGhostEdit(value: Record<string, unknown>): GhostFileEdit {
  if (typeof value.path !== 'string' || !path.isAbsolute(value.path)) {
    throw new Error('Edit path must be an absolute path inside the workspace')
  }
  resolveWorkspacePath(value.path)
  if (!Array.isArray(value.hunks) || value.hunks.length === 0 || value.hunks.length > MAX_HUNKS) {
    throw new Error(`Edit must contain between 1 and ${MAX_HUNKS} hunks`)
  }

  let previousEndLine = 0
  let replacementCharacters = 0
  const hunks = value.hunks.map((hunk, index) => {
    if (!isRecord(hunk)) {
      throw new Error(`Edit hunk ${index + 1} is malformed`)
    }
    const startLine = hunk.startLine
    const endLine = hunk.endLine
    const replacement = hunk.replacement
    const oldText = hunk.oldText
    const oldHash = hunk.oldHash
    const beforeContext = hunk.beforeContext
    const afterContext = hunk.afterContext
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || (startLine as number) < 1 || (endLine as number) < (startLine as number)) {
      throw new Error(`Edit hunk ${index + 1} has invalid line bounds`)
    }
    if (typeof replacement !== 'string') {
      throw new Error(`Edit hunk ${index + 1} replacement must be a string`)
    }
    for (const [name, context] of [
      ['oldText', oldText],
      ['beforeContext', beforeContext],
      ['afterContext', afterContext]
    ] as const) {
      if (context !== undefined && typeof context !== 'string') {
        throw new Error(`Edit hunk ${index + 1} ${name} must be a string`)
      }
      if (typeof context === 'string' && context.length > MAX_CONTEXT_CHARACTERS) {
        throw new Error(`Edit hunk ${index + 1} ${name} is too large`)
      }
    }
    if (oldHash !== undefined && (typeof oldHash !== 'string' || !/^[a-f\d]{64}$/i.test(oldHash))) {
      throw new Error(`Edit hunk ${index + 1} oldHash must be a SHA-256 hash`)
    }
    if (oldText === undefined && oldHash === undefined && beforeContext === undefined && afterContext === undefined && typeof value.expectedContent !== 'string') {
      throw new Error(`Edit hunk ${index + 1} must include oldText, oldHash, beforeContext, or afterContext`)
    }
    if ((startLine as number) <= previousEndLine) {
      throw new Error('Edit hunks must be sorted and non-overlapping')
    }
    previousEndLine = endLine as number
    replacementCharacters += replacement.length
    if (replacementCharacters > MAX_REPLACEMENT_CHARACTERS) {
      throw new Error('Edit replacement content is too large')
    }
    return {
      startLine: startLine as number,
      endLine: endLine as number,
      replacement,
      ...(typeof oldText === 'string' ? { oldText } : {}),
      ...(typeof oldHash === 'string' ? { oldHash: oldHash.toLowerCase() } : {}),
      ...(typeof beforeContext === 'string' ? { beforeContext } : {}),
      ...(typeof afterContext === 'string' ? { afterContext } : {})
    }
  })

  return {
    path: value.path,
    hunks,
    ...(typeof value.expectedContent === 'string' ? { expectedContent: value.expectedContent } : {}),
    ...(typeof value.description === 'string' ? { description: value.description.slice(0, 500) } : {})
  }
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function validateHunkContext(lines: string[], hunk: GhostEditHunk, index: number): void {
  const actualText = lines.slice(hunk.startLine - 1, hunk.endLine).join('\n')
  if (hunk.oldText !== undefined && actualText !== hunk.oldText) {
    throw new Error(`Edit hunk ${index + 1} old text does not match the current file. Refresh and rebase the edit.`)
  }
  if (hunk.oldHash !== undefined && hashText(actualText) !== hunk.oldHash) {
    throw new Error(`Edit hunk ${index + 1} content hash does not match the current file. Refresh and rebase the edit.`)
  }
  const before = lines.slice(0, hunk.startLine - 1).join('\n')
  if (hunk.beforeContext !== undefined && !before.endsWith(hunk.beforeContext)) {
    throw new Error(`Edit hunk ${index + 1} preceding context does not match the current file. Refresh and rebase the edit.`)
  }
  const after = lines.slice(hunk.endLine).join('\n')
  if (hunk.afterContext !== undefined && !after.startsWith(hunk.afterContext)) {
    throw new Error(`Edit hunk ${index + 1} following context does not match the current file. Refresh and rebase the edit.`)
  }
}

export function applyGhostEdit(content: string, edit: GhostFileEdit, selectedHunkIndexes?: Set<number>): string {
  const lines = content.split('\n')
  const selected = selectedHunkIndexes
    ? edit.hunks.filter((_hunk, index) => selectedHunkIndexes.has(index))
    : edit.hunks
  for (const [index, hunk] of edit.hunks.entries()) {
    if (!selectedHunkIndexes || selectedHunkIndexes.has(index)) {
      validateHunkContext(lines, hunk, index)
    }
  }
  for (const hunk of [...selected].reverse()) {
    if (hunk.endLine > lines.length) {
      throw new Error(`Edit hunk exceeds file length at line ${hunk.startLine}`)
    }
    lines.splice(hunk.startLine - 1, hunk.endLine - hunk.startLine + 1, ...hunk.replacement.split('\n'))
  }
  return lines.join('\n')
}

export function summarizeGhostEdit(edit: GhostFileEdit): string {
  const lineCount = edit.hunks.reduce((total, hunk) => total + hunk.endLine - hunk.startLine + 1, 0)
  return `${edit.path}: ${edit.hunks.length} hunk${edit.hunks.length === 1 ? '' : 's'}, ${lineCount} line${lineCount === 1 ? '' : 's'} changed`
}
