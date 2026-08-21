import { strict as assert } from 'node:assert'

import { GHOST_RETRY_POLICIES } from '../../agent/retryPolicy'
import {
  isFailedToolOutcome,
  isInspectionTool,
  shouldStopAgentForToolFailure
} from '../../agent/toolFailurePolicy'

suite('Tool failure stop policy', () => {
  test('treats read, search, and list as inspection tools', () => {
    assert.equal(isInspectionTool('ghost_read_file'), true)
    assert.equal(isInspectionTool('ghost_search_workspace'), true)
    assert.equal(isInspectionTool('ghost_list_directory'), true)
    assert.equal(isInspectionTool('ghost_write_file'), false)
  })

  test('continues after a missing-file read or failed search', () => {
    assert.equal(shouldStopAgentForToolFailure(
      'ghost_read_file',
      'failed',
      'Tool error: File \'src/missing.ts\' was not found. Retry with the workspace-relative path shown by ghost_list_directory.'
    ), false)
    assert.equal(shouldStopAgentForToolFailure(
      'ghost_search_workspace',
      'failed',
      'Tool error: Directory \'src/nope\' was not found in the current workspace.'
    ), false)
    assert.equal(shouldStopAgentForToolFailure(
      'ghost_list_directory',
      'failed',
      'Tool error: Directory \'lib\' was not found in the current workspace.'
    ), false)
  })

  test('stops on denied or blocked mutations and user cancellation', () => {
    assert.equal(shouldStopAgentForToolFailure('ghost_write_file', 'denied', 'User denied the file write.'), true)
    assert.equal(shouldStopAgentForToolFailure('ghost_apply_edit', 'blocked', 'Command blocked by workspace policy.'), true)
    assert.equal(shouldStopAgentForToolFailure('ghost_read_file', 'cancelled', 'Tool call cancelled by the user.'), true)
    assert.equal(shouldStopAgentForToolFailure('ghost_read_file', 'denied', 'User denied the file read.'), true)
  })

  test('stops on failed mutations but not on successful inspection', () => {
    assert.equal(shouldStopAgentForToolFailure(
      'ghost_apply_edit',
      'failed',
      'Edit expected the file to contain different text.'
    ), true)
    assert.equal(isFailedToolOutcome('success', 'File: src/app.ts\n...'), false)
    assert.equal(shouldStopAgentForToolFailure('ghost_read_file', 'success', 'File: src/app.ts\n...'), false)
  })

  test('caps path-recovery retries with the unused failedTool policy', () => {
    assert.equal(GHOST_RETRY_POLICIES.failedTool.maxRetries, 2)
  })
})
