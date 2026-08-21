import { strict as assert } from 'node:assert'

import { describesWorkspaceChange, isLikelyConversationalPrompt } from '../../agent/workspaceChangeIntent'

suite('Workspace change intent', () => {
  test('matches explicit edit requests', () => {
    assert.equal(describesWorkspaceChange('Please fix the bug in src/app.ts'), true)
    assert.equal(describesWorkspaceChange('Implement the login form'), true)
    assert.equal(describesWorkspaceChange('edit src/app.ts and add a helper'), true)
    assert.equal(describesWorkspaceChange('create a file for the new route'), true)
    assert.equal(describesWorkspaceChange('Apply this edit to the current file'), true)
    assert.equal(describesWorkspaceChange('refactor the cache module'), true)
  })

  test('ignores verbs used in explanations and how-to questions', () => {
    assert.equal(describesWorkspaceChange('How do I add a button?'), false)
    assert.equal(describesWorkspaceChange('This function adds two numbers'), false)
    assert.equal(describesWorkspaceChange('The change updates the cache'), false)
    assert.equal(describesWorkspaceChange('What does create do in this API?'), false)
    assert.equal(describesWorkspaceChange('Explain how to write a unit test'), false)
  })
})

suite('Conversational prompts', () => {
  test('treats short social replies as conversational', () => {
    assert.equal(isLikelyConversationalPrompt('thanks'), true)
    assert.equal(isLikelyConversationalPrompt('ok, go on'), true)
    assert.equal(isLikelyConversationalPrompt('What do you think?'), true)
  })

  test('does not treat Ask-mode coding questions as conversational', () => {
    assert.equal(isLikelyConversationalPrompt('Explain this function'), false)
    assert.equal(isLikelyConversationalPrompt('read the file and summarize it'), false)
    assert.equal(isLikelyConversationalPrompt('Please fix the bug in src/app.ts'), false)
  })

  test('treats how-to questions without edit intent as conversational', () => {
    assert.equal(describesWorkspaceChange('How do I add a button?'), false)
    assert.equal(isLikelyConversationalPrompt('How do I add a button?'), true)
  })

  test('rejects empty and oversized prompts', () => {
    assert.equal(isLikelyConversationalPrompt(''), false)
    assert.equal(isLikelyConversationalPrompt('x'.repeat(241)), false)
  })
})
