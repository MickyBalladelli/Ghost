import { strict as assert } from 'node:assert'
import * as path from 'node:path'

import { auditTerminalCommand, formatTerminalAudit } from '../../tools/terminalAudit'
import { isInsideWorkspaceRoot, resolveTerminalCwd } from '../../tools/workspaceContainment'

suite('Terminal audit', () => {
  test('blocks file-write commands without spawning a shell', () => {
    const audit = auditTerminalCommand('echo hello > src/out.txt')
    assert.equal(audit.blocked, true)
    assert.ok(audit.risks.includes('file-write'))
    assert.match(formatTerminalAudit(audit), /Blocked/)
  })

  test('flags destructive, network, and package-install risks without blocking inspection', () => {
    assert.deepEqual(auditTerminalCommand('rm -rf dist').risks, ['destructive'])
    assert.equal(auditTerminalCommand('rm -rf dist').blocked, false)
    assert.ok(auditTerminalCommand('curl https://example.test').risks.includes('network'))
    assert.ok(auditTerminalCommand('npm install lodash').risks.includes('package-install'))
    const ls = auditTerminalCommand('ls src')
    assert.equal(ls.blocked, false)
    assert.deepEqual(ls.risks, [])
  })
})

suite('Terminal cwd jail', () => {
  const workspaceRoot = path.resolve('/workspace')

  test('keeps relative and nested cwd inside the workspace', () => {
    assert.equal(resolveTerminalCwd('src', workspaceRoot), path.resolve(workspaceRoot, 'src'))
    assert.equal(isInsideWorkspaceRoot(path.resolve(workspaceRoot, 'src/lib'), workspaceRoot), true)
    assert.equal(resolveTerminalCwd(undefined, workspaceRoot), workspaceRoot)
  })

  test('rejects cwd that escapes the workspace', () => {
    assert.throws(() => resolveTerminalCwd('../outside', workspaceRoot), /inside the current workspace/)
    assert.throws(() => resolveTerminalCwd('/etc', workspaceRoot), /inside the current workspace/)
    assert.equal(isInsideWorkspaceRoot(path.resolve(workspaceRoot, '..'), workspaceRoot), false)
  })
})
