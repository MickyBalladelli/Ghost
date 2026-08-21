import { strict as assert } from 'node:assert'

import { describesWorkspaceChange } from '../../agent/workspaceChangeIntent'

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
