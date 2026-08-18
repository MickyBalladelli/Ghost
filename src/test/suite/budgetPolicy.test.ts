import { strict as assert } from 'node:assert'

import { hasReachedToolCallLimit, MAX_TOOL_ROUNDS, MIN_TOOL_CALL_TOKENS, outputTokenBudget } from '../../agent/budgetPolicy'

suite('Agent budget policy', () => {
  test('keeps tool-enabled output budgets at the 4096-token minimum', () => {
    assert.equal(MIN_TOOL_CALL_TOKENS, 4096)
    assert.equal(outputTokenBudget(undefined, true), 4096)
    assert.equal(outputTokenBudget(512, true), 4096)
    assert.equal(outputTokenBudget(8192, true), 8192)
    assert.equal(outputTokenBudget(512, false), 512)
  })

  test('stops at the 128-call safety boundary', () => {
    assert.equal(MAX_TOOL_ROUNDS, 128)
    assert.equal(hasReachedToolCallLimit(127), false)
    assert.equal(hasReachedToolCallLimit(128), true)
    assert.equal(hasReachedToolCallLimit(129), true)
  })
})
