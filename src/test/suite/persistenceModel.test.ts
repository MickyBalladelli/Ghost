import { strict as assert } from 'node:assert'

import {
  addPromptToHistory,
  MAX_GHOSTPILOT_PROMPT_HISTORY,
  migratePersistedState,
  normalizePromptHistory
} from '../../ui/persistenceModel'

suite('Conversation persistence model', () => {
  test('deduplicates and bounds prompt history', () => {
    assert.deepEqual(addPromptToHistory(['older', 'same'], ' same '), ['same', 'older'])
    assert.equal(normalizePromptHistory(['valid', 42, '', '  ']).length, 1)
    assert.equal(addPromptToHistory(Array.from({ length: 105 }, (_, index) => `prompt-${index}`), 'new').length, MAX_GHOSTPILOT_PROMPT_HISTORY)
  })

  test('migrates schema 1 and malformed state into the current safe shape', () => {
    const migrated = migratePersistedState({
      schemaVersion: 1,
      conversations: [{ id: 'conversation-1' }],
      activeConversationId: 'conversation-1',
      promptHistory: ['hello', 42],
      showReasoning: true
    })

    assert.equal(migrated.schemaVersion, 2)
    assert.deepEqual(migrated.promptHistory, ['hello'])
    assert.deepEqual(migratePersistedState(undefined).conversations, [])
  })
})
