import { strict as assert } from 'node:assert'

import { getRequestStatusForEvent } from '../../ui/requestState'

suite('Request lifecycle state', () => {
  test('moves through context, provider, streaming, and completion states', () => {
    let status = getRequestStatusForEvent({ type: 'request-started' }, 'idle')
    assert.equal(status, 'preparing')
    status = getRequestStatusForEvent({ type: 'thinking', phase: 'provider' }, status)
    assert.equal(status, 'connecting')
    status = getRequestStatusForEvent({ type: 'text-delta', phase: 'streaming' }, status)
    assert.equal(status, 'streaming')
    status = getRequestStatusForEvent({ type: 'request-completed', status: 'completed' }, status)
    assert.equal(status, 'completed')
  })

  test('keeps approval, cancellation, and failure states distinct', () => {
    assert.equal(getRequestStatusForEvent({ type: 'tool-requested', phase: 'tool' }, 'thinking'), 'waiting-for-approval')
    assert.equal(getRequestStatusForEvent({ type: 'request-completed', status: 'cancelled' }, 'streaming'), 'cancelled')
    assert.equal(getRequestStatusForEvent({ type: 'error', phase: 'error' }, 'streaming'), 'failed')
  })

  test('honors an explicit state and preserves unknown events', () => {
    assert.equal(getRequestStatusForEvent({ type: 'thinking', state: 'connecting' }, 'idle'), 'connecting')
    assert.equal(getRequestStatusForEvent({ type: 'warning' }, 'thinking'), 'thinking')
  })
})
