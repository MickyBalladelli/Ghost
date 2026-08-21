import { strict as assert } from 'node:assert'

import { GHOST_RETRY_POLICIES } from '../../agent/retryPolicy'
import { getEditLoopReason, FileEditState, EditRecord } from '../../agent/editLoopGuard'
import {
  getInspectionPathRecoveryKey,
  shouldRetryInspectionPath,
  shouldStopAgentForToolFailure
} from '../../agent/toolFailurePolicy'

function editRecord(fingerprint: string, startLine = 1, endLine = 1, oldText = 'one', replacement = 'two'): EditRecord {
  return {
    signature: fingerprint,
    fingerprint,
    ranges: [{ startLine, endLine }],
    hunks: [{ startLine, endLine, oldText, replacement }]
  }
}

suite('Chat participant stop policy', () => {
  test('retries inspection path failures then continues without stopping the request', () => {
    const result = 'Tool error: File \'src/missing.ts\' was not found.'
    const key = getInspectionPathRecoveryKey('ghost_read_file', result, 'src/missing.ts')
    assert.equal(key, 'ghost_read_file:src/missing.ts')
    assert.equal(shouldRetryInspectionPath(0, GHOST_RETRY_POLICIES.failedTool.maxRetries), true)
    assert.equal(shouldRetryInspectionPath(GHOST_RETRY_POLICIES.failedTool.maxRetries, GHOST_RETRY_POLICIES.failedTool.maxRetries), false)
    assert.equal(shouldStopAgentForToolFailure('ghost_read_file', 'failed', result), false)
  })

  test('stops on mutation failure even after inspection retries are exhausted', () => {
    const result = 'Edit expected the file to contain different text.'
    assert.equal(getInspectionPathRecoveryKey('ghost_apply_edit', result, 'src/app.ts'), undefined)
    assert.equal(shouldStopAgentForToolFailure('ghost_apply_edit', 'failed', result), true)
    assert.equal(shouldStopAgentForToolFailure('ghost_write_file', 'failed', 'Tool error: Write failed after retry.'), true)
  })

  test('allows overlapping non-identical edits after a fresh read', () => {
    const state: FileEditState = {
      signatures: new Set(),
      history: [editRecord('first', 10, 20, 'block', 'updated block')]
    }
    assert.equal(
      getEditLoopReason(state, editRecord('refine-line-12', 12, 12, 'old line', 'new line')),
      undefined
    )
  })
})
