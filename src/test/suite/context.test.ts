import { strict as assert } from 'node:assert'

import { truncateContext } from '../../agent/chatParticipant'

suite('Context window limits', () => {
  test('truncates oversized context and adds a marker', () => {
    const source = 'a'.repeat(5000)
    const result = truncateContext(source, 256)

    assert.ok(result.length < source.length)
    assert.match(result, /Context truncated by LocalPilot/)
  })

  test('keeps context below the configured approximation', () => {
    const result = truncateContext('abc', 256)

    assert.equal(result, 'abc')
  })
})
