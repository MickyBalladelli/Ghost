import { strict as assert } from 'node:assert'

import { hasReachedToolCallLimit, MAX_TOOL_ROUNDS, MIN_TOOL_CALL_TOKENS, outputTokenBudget } from '../../agent/budgetPolicy'

suite('Agent budget policy', () => {
  test('scales the tool output reserve from context size', () => {
    assert.equal(MIN_TOOL_CALL_TOKENS, 1024)
    assert.equal(outputTokenBudget(undefined, true, 8192), 2048)
    assert.equal(outputTokenBudget(512, true, 8192), 2048)
    assert.equal(outputTokenBudget(undefined, true, 4096), 1024)
    assert.equal(outputTokenBudget(undefined, true, 32768), 4096)
    assert.equal(outputTokenBudget(8192, true, 8192), 8192)
    assert.equal(outputTokenBudget(512, false), 512)
  })

  test('stops at the 128-call safety boundary', () => {
    assert.equal(MAX_TOOL_ROUNDS, 128)
    assert.equal(hasReachedToolCallLimit(127), false)
    assert.equal(hasReachedToolCallLimit(128), true)
    assert.equal(hasReachedToolCallLimit(129), true)
  })
})
