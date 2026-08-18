import type { GhostEditHunk } from '../tools/editWorkflow'

export interface EditRecord {
  signature: string
  fingerprint: string
  ranges: Array<{ startLine: number; endLine: number }>
  hunks: GhostEditHunk[]
}

export interface FileEditState {
  signatures: Set<string>
  history: EditRecord[]
}

function rangesOverlap(left: { startLine: number; endLine: number }, right: { startLine: number; endLine: number }): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine
}

function isInverseEdit(previous: EditRecord | undefined, current: EditRecord): boolean {
  if (!previous || previous.hunks.length === 0 || previous.hunks.length !== current.hunks.length) {
    return false
  }

  return previous.hunks.every((previousHunk, index) => {
    const currentHunk = current.hunks[index]
    return previousHunk.startLine === currentHunk.startLine
      && previousHunk.endLine === currentHunk.endLine
      && previousHunk.oldText !== undefined
      && currentHunk.oldText !== undefined
      && previousHunk.replacement === currentHunk.oldText
      && currentHunk.replacement === previousHunk.oldText
  })
}

export function getEditLoopReason(state: FileEditState, record: EditRecord): string | undefined {
  if (state.history.some(previous => previous.fingerprint === record.fingerprint)) {
    return 'repeated or alternating edits'
  }
  if (isInverseEdit(state.history.at(-1), record)) {
    return 'an undo/reapply edit loop'
  }
  if (record.ranges.length > 0 && state.history.some(previous => previous.ranges.some(previousRange => record.ranges.some(range => rangesOverlap(previousRange, range))))) {
    return 'overlapping edits'
  }
  return undefined
}
