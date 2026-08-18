import { strict as assert } from 'node:assert'
import * as path from 'node:path'
import * as vscode from 'vscode'

import { ContextBudgetManager } from '../../agent/chatParticipant'
import { classifyLocalToolResponse } from '../../agent/toolCallParser'
import { createProviderAdapter, ProviderClient } from '../../services/providerAdapter'
import { ChatRequestOptions } from '../../services/chatTypes'
import { applyWorkspaceFileChange, createWorkspaceEditChange, readFileMutation } from '../../tools/fileMutationWorkflow'
import { GhostFileSystem } from '../../runtimeDependencies'
import { readWorkspaceFile } from '../../tools/workspaceFile'
import { parseGhostEdit } from '../../tools/editWorkflow'

class FakeProvider implements ProviderClient {
  calls = 0

  constructor(private readonly responses: Array<string | Error>) {}

  async checkHealth(): Promise<boolean> {
    return true
  }

  async *streamChatCompletion(options: ChatRequestOptions): AsyncGenerator<string> {
    this.calls += 1
    if (options.signal?.aborted) {
      const error = new Error('The request was cancelled.')
      error.name = 'AbortError'
      throw error
    }
    const response = this.responses.shift()
    if (response instanceof Error) {
      throw response
    }
    if (response) {
      yield response
    }
  }
}

class MemoryFileSystem implements GhostFileSystem {
  readonly files = new Map<string, Uint8Array>()

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const content = this.files.get(uri.fsPath)
    if (!content) throw vscode.FileSystemError.FileNotFound(uri)
    return content.slice()
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    this.files.set(uri.fsPath, content.slice())
  }

  async createDirectory(): Promise<void> {}

  async copy(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
    this.files.set(destination.fsPath, (await this.readFile(source)).slice())
  }

  async rename(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
    this.files.set(destination.fsPath, await this.readFile(source))
    this.files.delete(source.fsPath)
  }

  async delete(uri: vscode.Uri): Promise<void> {
    if (!this.files.delete(uri.fsPath)) throw vscode.FileSystemError.FileNotFound(uri)
  }
}

const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined })
} as vscode.CancellationToken

async function collect(adapter: ReturnType<typeof createProviderAdapter>, options: ChatRequestOptions): Promise<string> {
  let result = ''
  for await (const chunk of adapter.stream(options)) {
    result += chunk
  }
  return result
}

suite('Fake provider integration', () => {
  test('reads, approves, edits, and verifies a file change', async () => {
    const filesystem = new MemoryFileSystem()
    const filePath = path.join(process.cwd(), 'fake-provider-flow.ts')
    filesystem.files.set(filePath, Buffer.from('before'))
    const provider = new FakeProvider([
      '{"tool":"ghost_read_file","arguments":{"path":"fake-provider-flow.ts"}}',
      '{"tool":"ghost_apply_edit","arguments":{"path":"fake-provider-flow.ts","hunks":[{"startLine":1,"endLine":1,"replacement":"after","oldText":"before"}]}}'
    ])
    const adapter = createProviderAdapter('ollama', provider)
    const request = { model: 'fake', messages: [{ role: 'user' as const, content: 'change it' }] }

    const readCall = classifyLocalToolResponse(await collect(adapter, request)).call
    assert.equal(readCall?.name, 'ghost_read_file')
    const readSnapshot = await readWorkspaceFile(vscode.Uri.file(filePath), token, filesystem)
    assert.equal(readSnapshot.content, 'before')

    const editCall = classifyLocalToolResponse(await collect(adapter, request)).call
    assert.equal(editCall?.name, 'ghost_apply_edit')
    let approved = false
    const approval = async (): Promise<boolean> => {
      approved = true
      return true
    }
    assert.equal(await approval(), true)
    assert.equal(approved, true)

    const edit = parseGhostEdit(editCall?.arguments ?? {})
    const { uri, snapshot } = await readFileMutation(edit.path, token, filesystem)
    const change = createWorkspaceEditChange(snapshot, edit)
    await applyWorkspaceFileChange(uri, change, snapshot, token, filesystem)
    const verified = await readWorkspaceFile(uri, token, filesystem)
    assert.equal(verified.content, 'after')
    assert.equal(provider.calls, 2)
  })

  test('retries a failed provider request with the same fake provider', async () => {
    const provider = new FakeProvider([new Error('provider network disconnected'), 'retry succeeded'])
    const adapter = createProviderAdapter('ollama', provider)
    const request = { model: 'fake', messages: [{ role: 'user' as const, content: 'retry' }] }

    await assert.rejects(() => collect(adapter, request), /network disconnected/)
    assert.equal(await collect(adapter, request), 'retry succeeded')
    assert.equal(provider.calls, 2)
  })

  test('normalizes cancellation without a live provider', async () => {
    const provider = new FakeProvider(['should not be emitted'])
    const adapter = createProviderAdapter('ollama', provider)
    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      () => collect(adapter, { model: 'fake', messages: [], signal: controller.signal }),
      error => error instanceof Error && error.name === 'ProviderError' && /cancelled/i.test(error.message)
    )
  })

  test('keeps empty provider output empty', async () => {
    const provider = new FakeProvider([''])
    const adapter = createProviderAdapter('ollama', provider)
    assert.equal(await collect(adapter, { model: 'fake', messages: [] }), '')
  })

  test('compacts oversized context while retaining a bounded request', () => {
    const manager = new ContextBudgetManager(5000, 4096, true, text => Math.ceil(text.length / 4))
    const messages = [
      { role: 'system' as const, content: 'system instructions' },
      { role: 'user' as const, content: 'important request '.repeat(2500) },
      { role: 'assistant' as const, content: 'older output '.repeat(1000) }
    ]

    const result = manager.prepare(messages)
    assert.equal(result.compacted, true)
    assert.ok(result.omittedTokens > 0)
    assert.ok(result.inputTokens <= 904)
    assert.match(String(result.messages[0].content), /system instructions/)
  })
})
