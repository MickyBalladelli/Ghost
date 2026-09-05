import { strict as assert } from 'node:assert'

import { getEditLoopReason, FileEditState, EditRecord } from '../../agent/editLoopGuard'

function editRecord(fingerprint: string, startLine = 1, endLine = 1, oldText = 'one', replacement = 'two'): EditRecord {
  return {
    signature: fingerprint,
    fingerprint,
    ranges: [{ startLine, endLine }],
    hunks: [{ startLine, endLine, oldText, replacement }]
  }
}

suite('Edit loop guard', () => {
  test('stops repeated fingerprints and inverse hunks', () => {
    const repeatedState: FileEditState = {
      signatures: new Set(),
      history: [editRecord('same')]
    }
    assert.equal(getEditLoopReason(repeatedState, editRecord('same')), 'repeated or alternating edits')

    const inverseState: FileEditState = {
      signatures: new Set(),
      history: [editRecord('first', 2, 2, 'one', 'two')]
    }
    assert.equal(
      getEditLoopReason(inverseState, editRecord('second', 2, 2, 'two', 'one')),
      'an undo/reapply edit loop'
    )
  })

  test('allows overlapping refinements with a new fingerprint', () => {
    const state: FileEditState = {
      signatures: new Set(),
      history: [editRecord('first', 10, 20, 'block', 'updated block')]
    }
    assert.equal(
      getEditLoopReason(state, editRecord('refine-line-12', 12, 12, 'old line', 'new line')),
      undefined
    )
  })

  test('allows the same replacement shape when the old text differs', () => {
    const state: FileEditState = {
      signatures: new Set(),
      history: [editRecord('first', 1, 1, 'version 1', 'version 2')]
    }
    assert.equal(
      getEditLoopReason(state, editRecord('second', 1, 1, 'version 0', 'version 2')),
      undefined
    )
  })
})
