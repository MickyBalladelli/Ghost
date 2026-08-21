import { createHash } from 'node:crypto'

import { resolveWorkspacePath } from './workspacePath'
import { GHOST_POLICY } from '../ghostPolicy'

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

const { maxHunks: MAX_HUNKS, maxReplacementCharacters: MAX_REPLACEMENT_CHARACTERS, maxContextCharacters: MAX_CONTEXT_CHARACTERS } = GHOST_POLICY.edit

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

export function parseGhostEdit(value: Record<string, unknown>): GhostFileEdit {
  if (typeof value.path !== 'string' || !value.path.trim()) {
    throw new Error('Edit path must be a non-empty relative or absolute path inside the workspace')
  }
  const resolvedPath = resolveWorkspacePath(value.path).fsPath
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
    path: resolvedPath,
    hunks,
    ...(typeof value.expectedContent === 'string' ? { expectedContent: value.expectedContent } : {}),
    ...(typeof value.description === 'string' ? { description: value.description.slice(0, 500) } : {})
  }
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n|\r/g, '\n')
}

function splitLines(value: string): string[] {
  return value.split(/\r\n|\n|\r/)
}

function detectLineEnding(value: string): string {
  return value.match(/\r\n|\n|\r/)?.[0] ?? '\n'
}

function isHunkAlreadyApplied(lines: string[], hunk: GhostEditHunk): boolean {
  if (!hunk.replacement) {
    return false
  }

  const replacementLines = splitLines(normalizeLineEndings(hunk.replacement))
  const replacementText = normalizeLineEndings(hunk.replacement)
  const directText = lines.slice(hunk.startLine - 1, hunk.startLine - 1 + replacementLines.length).join('\n')
  if (normalizeLineEndings(directText) === replacementText) {
    return true
  }

  let matches = 0
  for (let start = 0; start <= lines.length - replacementLines.length; start += 1) {
    const candidateText = lines.slice(start, start + replacementLines.length).join('\n')
    if (normalizeLineEndings(candidateText) === replacementText) {
      matches += 1
      if (matches > 1) {
        return false
      }
    }
  }
  return matches === 1
}

function rebaseHunk(lines: string[], hunk: GhostEditHunk, index: number): GhostEditHunk {
  if (hunk.oldText === undefined) {
    return hunk
  }

  const currentText = lines.slice(hunk.startLine - 1, hunk.endLine).join('\n')
  if (normalizeLineEndings(currentText) === normalizeLineEndings(hunk.oldText)) {
    try {
      validateHunkContext(lines, hunk, index)
      return hunk
    } catch {
      // The exact text is still present, but surrounding lines moved. Rebase below.
    }
  }

  const oldLines = splitLines(normalizeLineEndings(hunk.oldText))
  const candidates: GhostEditHunk[] = []
  for (let start = 0; start <= lines.length - oldLines.length; start += 1) {
    const candidateText = lines.slice(start, start + oldLines.length).join('\n')
    if (normalizeLineEndings(candidateText) === normalizeLineEndings(hunk.oldText)) {
      candidates.push({ ...hunk, startLine: start + 1, endLine: start + oldLines.length })
    }
  }

  const contextualCandidates = candidates.filter(candidate => {
    try {
      validateHunkContext(lines, candidate, index)
      return true
    } catch {
      return false
    }
  })
  const rankedCandidates = contextualCandidates.length > 0 ? contextualCandidates : candidates
  const nearestCandidates = rankedCandidates
    .map(candidate => ({
      candidate,
      distance: Math.abs(candidate.startLine - hunk.startLine)
    }))
    .sort((left, right) => left.distance - right.distance)
  const candidate = nearestCandidates.length > 0
    && (nearestCandidates.length === 1 || nearestCandidates[0].distance < nearestCandidates[1].distance)
    ? nearestCandidates[0].candidate
    : undefined
  return candidate
    ? { ...candidate, oldHash: undefined, beforeContext: undefined, afterContext: undefined }
    : hunk
}

function validateHunkContext(lines: string[], hunk: GhostEditHunk, index: number): void {
  const actualText = lines.slice(hunk.startLine - 1, hunk.endLine).join('\n')
  if (hunk.oldText !== undefined && normalizeLineEndings(actualText) !== normalizeLineEndings(hunk.oldText)) {
    throw new Error(`Edit hunk ${index + 1} old text does not match the current file. Refresh and rebase the edit.`)
  }
  if (hunk.oldHash !== undefined && hashText(normalizeLineEndings(actualText)) !== hunk.oldHash) {
    throw new Error(`Edit hunk ${index + 1} content hash does not match the current file. Refresh and rebase the edit.`)
  }
  const before = lines.slice(0, hunk.startLine - 1).join('\n')
  if (hunk.beforeContext !== undefined && !normalizeLineEndings(before).endsWith(normalizeLineEndings(hunk.beforeContext))) {
    throw new Error(`Edit hunk ${index + 1} preceding context does not match the current file. Refresh and rebase the edit.`)
  }
  const after = lines.slice(hunk.endLine).join('\n')
  if (hunk.afterContext !== undefined && !normalizeLineEndings(after).startsWith(normalizeLineEndings(hunk.afterContext))) {
    throw new Error(`Edit hunk ${index + 1} following context does not match the current file. Refresh and rebase the edit.`)
  }
}

export function applyGhostEdit(content: string, edit: GhostFileEdit, selectedHunkIndexes?: Set<number>): string {
  const lines = splitLines(content)
  const lineEnding = detectLineEnding(content)
  const alreadyAppliedHunks = new Set<number>()
  const effectiveHunks = edit.hunks.map((hunk, index) => {
    if (selectedHunkIndexes && !selectedHunkIndexes.has(index)) {
      return hunk
    }
    if (isHunkAlreadyApplied(lines, hunk)) {
      alreadyAppliedHunks.add(index)
      return hunk
    }
    return rebaseHunk(lines, hunk, index)
  })
  const selected = selectedHunkIndexes
    ? effectiveHunks.filter((_hunk, index) => selectedHunkIndexes.has(index) && !alreadyAppliedHunks.has(index))
    : effectiveHunks.filter((_hunk, index) => !alreadyAppliedHunks.has(index))
  for (const [index, hunk] of effectiveHunks.entries()) {
    if ((!selectedHunkIndexes || selectedHunkIndexes.has(index)) && !alreadyAppliedHunks.has(index)) {
      validateHunkContext(lines, hunk, index)
    }
  }
  for (const hunk of [...selected].reverse()) {
    if (hunk.endLine > lines.length) {
      throw new Error(`Edit hunk exceeds file length at line ${hunk.startLine}`)
    }
    lines.splice(hunk.startLine - 1, hunk.endLine - hunk.startLine + 1, ...splitLines(hunk.replacement))
  }
  return lines.join(lineEnding)
}

export function summarizeGhostEdit(edit: GhostFileEdit): string {
  const lineCount = edit.hunks.reduce((total, hunk) => total + hunk.endLine - hunk.startLine + 1, 0)
  return `${edit.path}: ${edit.hunks.length} hunk${edit.hunks.length === 1 ? '' : 's'}, ${lineCount} line${lineCount === 1 ? '' : 's'} changed`
}
