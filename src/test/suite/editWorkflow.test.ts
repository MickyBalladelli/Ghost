import { strict as assert } from 'node:assert'

import { applyGhostEdit, parseGhostEdit } from '../../tools/editWorkflow'

suite('Reviewed edit workflow', () => {
  test('parses and applies sorted non-overlapping hunks', () => {
    const edit = parseGhostEdit({
      path: `${process.cwd()}/example.ts`,
      hunks: [
        { startLine: 1, endLine: 1, replacement: 'first', oldText: 'one' },
        { startLine: 3, endLine: 3, replacement: 'third', oldText: 'three' }
      ]
    })

    assert.equal(applyGhostEdit('one\ntwo\nthree', edit), 'first\ntwo\nthird')
    assert.equal(applyGhostEdit('one\ntwo\nthree', edit, new Set([1])), 'one\ntwo\nthird')
  })

  test('rejects overlapping and unsafe edits', () => {
    assert.throws(() => parseGhostEdit({
      path: `${process.cwd()}/example.ts`,
      hunks: [
        { startLine: 1, endLine: 2, replacement: 'new', oldText: 'one\ntwo' },
        { startLine: 2, endLine: 3, replacement: 'overlap', oldText: 'two\nthree' }
      ]
    }), /sorted and non-overlapping/)
    assert.throws(() => parseGhostEdit({
      path: '/tmp/outside-workspace.ts',
      hunks: [{ startLine: 1, endLine: 1, replacement: 'blocked', oldText: 'old' }]
    }), /inside the workspace/)
    assert.throws(() => parseGhostEdit({
      path: `${process.cwd()}/example.ts`,
      hunks: [{ startLine: 1, endLine: 1, replacement: 'blocked' }]
    }), /must include oldText/)
  })

  test('rejects stale hunk context before changing the file', () => {
    const edit = parseGhostEdit({
      path: `${process.cwd()}/example.ts`,
      hunks: [{ startLine: 1, endLine: 1, replacement: 'new', oldText: 'old' }]
    })

    assert.throws(() => applyGhostEdit('one\ntwo', edit), /old text does not match/)
  })

  test('treats an already applied replacement as a safe no-op', () => {
    const edit = parseGhostEdit({
      path: `${process.cwd()}/example.ts`,
      hunks: [{ startLine: 1, endLine: 1, replacement: 'updated', oldText: 'original' }]
    })

    assert.equal(applyGhostEdit('updated\ntwo', edit), 'updated\ntwo')
  })
})
