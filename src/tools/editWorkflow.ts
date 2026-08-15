import * as path from 'node:path'

import { resolveWorkspacePath } from './workspacePath'

export interface GhostEditHunk {
  startLine: number
  endLine: number
  replacement: string
}

export interface GhostFileEdit {
  path: string
  hunks: GhostEditHunk[]
  expectedContent?: string
  description?: string
}

const MAX_HUNKS = 50
const MAX_REPLACEMENT_CHARACTERS = 100000

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
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || (startLine as number) < 1 || (endLine as number) < (startLine as number)) {
      throw new Error(`Edit hunk ${index + 1} has invalid line bounds`)
    }
    if (typeof replacement !== 'string') {
      throw new Error(`Edit hunk ${index + 1} replacement must be a string`)
    }
    if ((startLine as number) <= previousEndLine) {
      throw new Error('Edit hunks must be sorted and non-overlapping')
    }
    previousEndLine = endLine as number
    replacementCharacters += replacement.length
    if (replacementCharacters > MAX_REPLACEMENT_CHARACTERS) {
      throw new Error('Edit replacement content is too large')
    }
    return { startLine: startLine as number, endLine: endLine as number, replacement }
  })

  return {
    path: value.path,
    hunks,
    ...(typeof value.expectedContent === 'string' ? { expectedContent: value.expectedContent } : {}),
    ...(typeof value.description === 'string' ? { description: value.description.slice(0, 500) } : {})
  }
}

export function applyGhostEdit(content: string, edit: GhostFileEdit, selectedHunkIndexes?: Set<number>): string {
  const lines = content.split('\n')
  const selected = selectedHunkIndexes
    ? edit.hunks.filter((_hunk, index) => selectedHunkIndexes.has(index))
    : edit.hunks
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
