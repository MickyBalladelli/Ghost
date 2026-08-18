import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import * as path from 'node:path'
import * as vscode from 'vscode'

import { getEditLoopReason, FileEditState, EditRecord } from '../../agent/editLoopGuard'
import { parseGhostEdit, applyGhostEdit } from '../../tools/editWorkflow'
import { applyFileTransaction } from '../../tools/transactionWorkflow'
import { GhostFileSystem } from '../../runtimeDependencies'
import { ApprovalRaceGuard } from '../../ui/approvalRaceGuard'

const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined })
} as vscode.CancellationToken

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function editRecord(fingerprint: string, startLine = 1, endLine = 1, oldText = 'one', replacement = 'two'): EditRecord {
  return {
    signature: fingerprint,
    fingerprint,
    ranges: [{ startLine, endLine }],
    hunks: [{ startLine, endLine, oldText, replacement }]
  }
}

class MemoryFileSystem implements GhostFileSystem {
  readonly files = new Map<string, Uint8Array>()
  failWritesMatching?: string

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const content = this.files.get(uri.fsPath)
    if (!content) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    return content.slice()
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    if (this.failWritesMatching && uri.fsPath.includes(this.failWritesMatching)) {
      throw new Error(`Injected write failure for ${uri.fsPath}`)
    }
    this.files.set(uri.fsPath, content.slice())
  }

  async createDirectory(): Promise<void> {}

  async copy(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
    this.files.set(destination.fsPath, (await this.readFile(source)).slice())
  }

  async rename(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
    const content = await this.readFile(source)
    this.files.set(destination.fsPath, content)
    this.files.delete(source.fsPath)
  }

  async delete(uri: vscode.Uri): Promise<void> {
    if (!this.files.delete(uri.fsPath)) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
  }
}

function fileContent(filesystem: MemoryFileSystem, filePath: string): string {
  return Buffer.from(filesystem.files.get(filePath) ?? []).toString('utf8')
}

suite('Edit safety', () => {
  test('rejects stale hashes before changing content', () => {
    const edit = parseGhostEdit({
      path: path.join(process.cwd(), 'stale-hash.ts'),
      hunks: [{ startLine: 1, endLine: 1, replacement: 'new', oldHash: hashText('old') }]
    })

    assert.throws(() => applyGhostEdit('changed', edit), /content hash does not match/)
  })

  test('detects repeated, oscillating, and overlapping edits', () => {
    const repeatedState: FileEditState = {
      signatures: new Set(),
      history: [editRecord('same')]
    }
    assert.match(getEditLoopReason(repeatedState, editRecord('same')) ?? '', /repeated or alternating/)

    const inverseState: FileEditState = {
      signatures: new Set(),
      history: [editRecord('first', 2, 2, 'one', 'two')]
    }
    assert.match(getEditLoopReason(inverseState, editRecord('second', 2, 2, 'two', 'one')) ?? '', /undo\/reapply/)

    const overlapState: FileEditState = {
      signatures: new Set(),
      history: [editRecord('first', 3, 4)]
    }
    assert.match(getEditLoopReason(overlapState, editRecord('second', 4, 5)) ?? '', /overlapping/)
  })

  test('rolls back earlier files when a later transaction write fails', async () => {
    const filesystem = new MemoryFileSystem()
    const firstPath = path.join(process.cwd(), 'rollback-a.txt')
    const secondPath = path.join(process.cwd(), 'rollback-b.txt')
    filesystem.files.set(firstPath, Buffer.from('before a'))
    filesystem.files.set(secondPath, Buffer.from('before b'))
    filesystem.failWritesMatching = '.rollback-b.txt.ghost-'

    await assert.rejects(() => applyFileTransaction({
      edits: [
        { path: firstPath, content: 'after a' },
        { path: secondPath, content: 'after b' }
      ]
    }, undefined, token, filesystem), /Injected write failure/)

    assert.equal(fileContent(filesystem, firstPath), 'before a')
    assert.equal(fileContent(filesystem, secondPath), 'before b')
  })

  test('rejects a transaction when an expected snapshot is stale', async () => {
    const filesystem = new MemoryFileSystem()
    const filePath = path.join(process.cwd(), 'stale-transaction.txt')
    filesystem.files.set(filePath, Buffer.from('current'))

    await assert.rejects(() => applyFileTransaction({
      edits: [
        { path: filePath, content: 'next' },
        { path: path.join(process.cwd(), 'stale-transaction-other.txt'), content: 'other' }
      ]
    }, {
      [filePath]: { exists: true, content: 'stale' }
    }, token, filesystem), /changed externally/)

    assert.equal(fileContent(filesystem, filePath), 'current')
  })

  test('allows one approval decision and ignores the racing second decision', () => {
    const guard = new ApprovalRaceGuard()
    assert.equal(guard.begin('tool-1'), true)
    assert.equal(guard.begin('tool-1'), false)
    guard.end('tool-1')
    assert.equal(guard.begin('tool-1'), true)
    guard.clear()
    assert.equal(guard.begin('tool-1'), true)
  })
})
