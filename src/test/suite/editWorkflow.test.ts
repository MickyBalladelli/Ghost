import { strict as assert } from 'node:assert'

import { applyGhostPilotEdit, parseGhostPilotEdit } from '../../tools/editWorkflow'

suite('Reviewed edit workflow', () => {
  test('parses and applies sorted non-overlapping hunks', () => {
    const edit = parseGhostPilotEdit({
      path: `${process.cwd()}/example.ts`,
      hunks: [
        { startLine: 1, endLine: 1, replacement: 'first' },
        { startLine: 3, endLine: 3, replacement: 'third' }
      ]
    })

    assert.equal(applyGhostPilotEdit('one\ntwo\nthree', edit), 'first\ntwo\nthird')
    assert.equal(applyGhostPilotEdit('one\ntwo\nthree', edit, new Set([1])), 'one\ntwo\nthird')
  })

  test('rejects overlapping and unsafe edits', () => {
    assert.throws(() => parseGhostPilotEdit({
      path: `${process.cwd()}/example.ts`,
      hunks: [
        { startLine: 1, endLine: 2, replacement: 'new' },
        { startLine: 2, endLine: 3, replacement: 'overlap' }
      ]
    }), /sorted and non-overlapping/)
    assert.throws(() => parseGhostPilotEdit({
      path: '/tmp/outside-workspace.ts',
      hunks: [{ startLine: 1, endLine: 1, replacement: 'blocked' }]
    }), /inside the workspace/)
  })
})
