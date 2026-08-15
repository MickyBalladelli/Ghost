import { strict as assert } from 'node:assert'

import { waitForDebounce } from '../../providers/inlineCompletionProvider'

function createToken(): { token: any; cancel: () => void } {
  let cancelled = false
  const listeners: Array<() => void> = []

  return {
    token: {
      get isCancellationRequested() {
        return cancelled
      },
      onCancellationRequested(listener: () => void) {
        listeners.push(listener)
        return {
          dispose: () => {
            const index = listeners.indexOf(listener)

            if (index >= 0) {
              listeners.splice(index, 1)
            }
          }
        }
      }
    },
    cancel: () => {
      cancelled = true
      for (const listener of [...listeners]) {
        listener()
      }
    }
  }
}

suite('Inline completion debounce', () => {
  test('waits for the debounce interval', async () => {
    const started = Date.now()
    const { token } = createToken()
    const completed = await waitForDebounce(10, token)

    assert.equal(completed, true)
    assert.ok(Date.now() - started >= 8)
  })

  test('stops when the request is cancelled', async () => {
    const request = createToken()
    const promise = waitForDebounce(100, request.token)
    request.cancel()

    assert.equal(await promise, false)
  })
})
