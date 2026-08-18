import { strict as assert } from 'node:assert'

import { createWorkspaceFileChange } from '../../tools/fileMutationWorkflow'
import { decodeText, isReadTooLarge, paginateDirectoryEntries, readFileWindow } from '../../tools/fileTools'
import { GHOST_POLICY } from '../../ghostPolicy'

suite('File tool helpers', () => {
  test('reads bounded line ranges and advertises the next chunk', () => {
    const content = Array.from({ length: GHOST_POLICY.file.maxReadLines + 5 }, (_, index) => `line ${index + 1}`).join('\n')
    const result = readFileWindow(content, Buffer.from(content, 'utf8'), {
      path: 'sample.ts',
      mode: 'lines',
      startLine: 1,
      endLine: GHOST_POLICY.file.maxReadLines + 5
    }, 'sample.ts')

    assert.match(result, /Read mode: lines 1-400 of 405/)
    assert.match(result, /400: line 400/)
    assert.doesNotMatch(result, /401: line 401/)
    assert.match(result, /File output truncated/)
  })

  test('preserves UTF-8 boundaries and reports CRLF metadata', () => {
    const content = 'one\r\ntwo café 💡\r\nthree'
    const bytes = Buffer.from(content, 'utf8')
    const lines = readFileWindow(content, bytes, {
      path: 'utf8.txt',
      mode: 'lines',
      startLine: 2,
      endLine: 2
    }, 'utf8.txt')
    assert.match(lines, /"lineEndings":"CRLF"/)
    assert.match(lines, /2: two café 💡/)
    assert.doesNotMatch(lines, /\r/)

    const word = Buffer.from('café 💡', 'utf8')
    const selected = readFileWindow('café 💡', word, {
      path: 'utf8.txt',
      mode: 'bytes',
      startByte: 0,
      endByte: Buffer.byteLength('café', 'utf8')
    }, 'utf8.txt')
    assert.match(selected, /\ncafé\n\n\[Byte output truncated/)
    assert.throws(() => readFileWindow('café 💡', word, {
      path: 'utf8.txt',
      mode: 'bytes',
      startByte: 0,
      endByte: 4
    }, 'utf8.txt'), /UTF-8 character boundaries/)
  })

  test('rejects binary and invalid UTF-8 content', () => {
    assert.throws(() => decodeText(new Uint8Array([0x66, 0x00, 0x6f])), /Binary files/)
    assert.throws(() => decodeText(new Uint8Array([0xff, 0xfe])), /Non-UTF-8 binary files/)
  })

  test('guards large reads at the configured boundary', () => {
    const limit = GHOST_POLICY.file.maxSafeReadBytes
    assert.equal(isReadTooLarge(limit), false)
    assert.equal(isReadTooLarge(limit + 1), true)
  })

  test('paginates directory entries with a continuation cursor', () => {
    const result = paginateDirectoryEntries(['[dir] src/', '[file] README.md', '[file] TODO.md'], 1, 1)
    assert.deepEqual(result, {
      entries: ['[file] README.md'],
      hasMore: true,
      nextCursor: 2
    })
    assert.deepEqual(paginateDirectoryEntries(['a', 'b'], 2, 1), {
      entries: [],
      hasMore: false,
      nextCursor: 2
    })
  })

  test('recognizes no-op writes before touching the filesystem', () => {
    const change = createWorkspaceFileChange({ exists: true, content: 'same' }, 'same')
    assert.equal(change.changed, false)
    assert.deepEqual(change.after, { exists: true, content: 'same' })
  })
})
