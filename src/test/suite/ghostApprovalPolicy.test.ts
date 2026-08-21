import { strict as assert } from 'node:assert'

import { shouldAutoAcceptFileEdit } from '../../ui/autoAcceptPolicy'
import type { AutoAcceptToolCall } from '../../ui/autoAcceptPolicy'
import { resolveLanguageModelToolPermission, resolveToolPermission } from '../../ui/toolPermissionPolicy'

const writeCall = (path = 'src/app.ts'): AutoAcceptToolCall => ({
  name: 'ghost_write_file',
  arguments: { path, content: 'updated' }
})

const editCall = (path = 'src/app.ts'): AutoAcceptToolCall => ({
  name: 'ghost_apply_edit',
  arguments: { path, hunks: [{ startLine: 1, endLine: 1, replacement: 'new', oldText: 'old' }] }
})

const transactionCall = (): AutoAcceptToolCall => ({
  name: 'ghost_apply_transaction',
  arguments: {
    edits: [
      { path: 'src/one.ts', content: 'one' },
      { path: 'src/two.ts', content: 'two' }
    ]
  }
})

suite('File edit auto-accept policy', () => {
  test('confirm and emergency pause never auto-accept', () => {
    assert.equal(shouldAutoAcceptFileEdit({ scope: 'confirm' }, writeCall()).accepted, false)
    assert.equal(shouldAutoAcceptFileEdit({ scope: 'always', autoAcceptDisabled: true }, writeCall()).accepted, false)
    assert.equal(shouldAutoAcceptFileEdit({ scope: 'one-edit', autoAcceptDisabled: true }, writeCall()).accepted, false)
  })

  test('one-edit accepts a single mutation then expires', () => {
    const first = shouldAutoAcceptFileEdit({ scope: 'one-edit' }, writeCall())
    assert.equal(first.accepted, true)
    assert.equal(first.consumeOneEdit, true)

    const second = shouldAutoAcceptFileEdit({ scope: 'one-edit', oneEditConsumed: true }, editCall())
    assert.equal(second.accepted, false)
    assert.equal(second.consumeOneEdit, undefined)

    const transaction = shouldAutoAcceptFileEdit({ scope: 'one-edit' }, transactionCall())
    assert.equal(transaction.accepted, true)
    assert.equal(transaction.consumeOneEdit, true)
  })

  test('session auto-accepts only while the Ghost session is active', () => {
    assert.equal(shouldAutoAcceptFileEdit({ scope: 'session' }, writeCall()).accepted, false)
    assert.equal(shouldAutoAcceptFileEdit({ scope: 'session', sessionActive: false }, writeCall()).accepted, false)
    assert.equal(shouldAutoAcceptFileEdit({ scope: 'session', sessionActive: true }, writeCall()).accepted, true)
  })

  test('request, workspace, and always keep auto-accepting', () => {
    assert.equal(shouldAutoAcceptFileEdit({ scope: 'request' }, writeCall()).accepted, true)
    assert.equal(shouldAutoAcceptFileEdit({ scope: 'workspace' }, editCall()).accepted, true)
    assert.equal(shouldAutoAcceptFileEdit({ scope: 'always' }, transactionCall()).accepted, true)
  })

  test('current-file pins to the first path in the request', () => {
    const first = shouldAutoAcceptFileEdit({ scope: 'current-file' }, writeCall('src/app.ts'))
    assert.equal(first.accepted, true)
    assert.equal(first.nextAutoAcceptFilePath, 'src/app.ts')

    const sameFile = shouldAutoAcceptFileEdit({
      scope: 'current-file',
      autoAcceptFilePath: 'src/app.ts'
    }, editCall('src/app.ts'))
    assert.equal(sameFile.accepted, true)

    const otherFile = shouldAutoAcceptFileEdit({
      scope: 'current-file',
      autoAcceptFilePath: 'src/app.ts'
    }, writeCall('src/other.ts'))
    assert.equal(otherFile.accepted, false)

    const transaction = shouldAutoAcceptFileEdit({ scope: 'current-file' }, transactionCall())
    assert.equal(transaction.accepted, false)
  })

  test('current-file matches relative, ./, and absolute forms of the same file', () => {
    const resolveFilePath = (filePath: string): string => {
      const workspace = '/workspace'
      const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
      return normalized.startsWith('/') ? normalized : `${workspace}/${normalized}`
    }

    const first = shouldAutoAcceptFileEdit({ scope: 'current-file', resolveFilePath }, writeCall('src/app.ts'))
    assert.equal(first.accepted, true)
    assert.equal(first.nextAutoAcceptFilePath, '/workspace/src/app.ts')

    const dotted = shouldAutoAcceptFileEdit({
      scope: 'current-file',
      autoAcceptFilePath: first.nextAutoAcceptFilePath,
      resolveFilePath
    }, editCall('./src/app.ts'))
    assert.equal(dotted.accepted, true)

    const absolute = shouldAutoAcceptFileEdit({
      scope: 'current-file',
      autoAcceptFilePath: first.nextAutoAcceptFilePath,
      resolveFilePath
    }, writeCall('/workspace/src/app.ts'))
    assert.equal(absolute.accepted, true)

    const otherFile = shouldAutoAcceptFileEdit({
      scope: 'current-file',
      autoAcceptFilePath: first.nextAutoAcceptFilePath,
      resolveFilePath
    }, writeCall('/workspace/src/other.ts'))
    assert.equal(otherFile.accepted, false)
  })
})

suite('Shared tool permission policy', () => {
  const confirmAutoAccept = { scope: 'confirm' as const }

  test('denylist blocks even when auto-accept is always', () => {
    const decision = resolveToolPermission('ghost_write_file', {
      denylist: ['ghost_write_file'],
      autoAccept: { scope: 'always' }
    }, writeCall())
    assert.equal(decision.blockedByPolicy, true)
    assert.equal(decision.autoAcceptedFileEdit, false)
    assert.equal(decision.needsInteractiveApproval, false)
  })

  test('asklist requires interactive approval for otherwise allowed tools', () => {
    const decision = resolveToolPermission('ghost_read_file', {
      allowlist: ['ghost_read_file'],
      asklist: ['ghost_read_file'],
      autoAccept: confirmAutoAccept
    }, { name: 'ghost_read_file', arguments: { path: 'src/app.ts' } })
    assert.equal(decision.asksByPolicy, true)
    assert.equal(decision.needsInteractiveApproval, true)
  })

  test('session-approved file edits skip the interactive prompt', () => {
    const decision = resolveToolPermission('ghost_write_file', {
      autoAccept: confirmAutoAccept,
      sessionApprovedFileEdits: true
    }, writeCall())
    assert.equal(decision.needsInteractiveApproval, false)
    assert.equal(decision.autoAcceptedFileEdit, false)
  })

  test('confirm file edits still need approval without memory or auto-accept', () => {
    const decision = resolveToolPermission('ghost_write_file', {
      autoAccept: confirmAutoAccept
    }, writeCall())
    assert.equal(decision.needsInteractiveApproval, true)
  })

  test('always auto-accept skips the interactive prompt for file edits', () => {
    const decision = resolveToolPermission('ghost_write_file', {
      autoAccept: { scope: 'always' }
    }, writeCall())
    assert.equal(decision.autoAcceptedFileEdit, true)
    assert.equal(decision.needsInteractiveApproval, false)
  })
})

suite('Language Model tool permission policy', () => {
  test('denylist blocks writes even when auto-accept is always', () => {
    const decision = resolveLanguageModelToolPermission('ghost_write_file', {
      denylist: ['ghost_write_file'],
      autoAcceptScope: 'always'
    }, writeCall())
    assert.equal(decision.blockedByPolicy, true)
    assert.equal(decision.needsInteractiveApproval, false)
    assert.equal(decision.autoAcceptedFileEdit, false)
  })

  test('denylist blocks inspection tools', () => {
    const decision = resolveLanguageModelToolPermission('ghost_read_file', {
      denylist: ['ghost_read_file'],
      autoAcceptScope: 'confirm'
    }, { name: 'ghost_read_file', arguments: { path: 'src/app.ts' } })
    assert.equal(decision.blockedByPolicy, true)
    assert.equal(decision.needsInteractiveApproval, false)
  })

  test('session, one-edit, and current-file still require confirmation outside the Ghost view', () => {
    for (const autoAcceptScope of ['session', 'one-edit', 'current-file'] as const) {
      const decision = resolveLanguageModelToolPermission('ghost_write_file', {
        autoAcceptScope
      }, writeCall())
      assert.equal(decision.needsInteractiveApproval, true, autoAcceptScope)
      assert.equal(decision.autoAcceptedFileEdit, false, autoAcceptScope)
    }
  })

  test('request, workspace, and always skip confirmation for file edits', () => {
    for (const autoAcceptScope of ['request', 'workspace', 'always'] as const) {
      const decision = resolveLanguageModelToolPermission('ghost_write_file', {
        autoAcceptScope
      }, writeCall())
      assert.equal(decision.autoAcceptedFileEdit, true, autoAcceptScope)
      assert.equal(decision.needsInteractiveApproval, false, autoAcceptScope)
    }
  })

  test('conversation-state tools ignore the denylist', () => {
    const decision = resolveLanguageModelToolPermission('ghost_update_task_plan', {
      denylist: ['ghost_update_task_plan'],
      autoAcceptScope: 'confirm'
    }, { name: 'ghost_update_task_plan', arguments: {} })
    assert.equal(decision.blockedByPolicy, false)
    assert.equal(decision.needsInteractiveApproval, false)
  })
})
