import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'

import { getEditLoopReason, EditRecord } from '../../agent/editLoopGuard'
import { classifyLocalToolResponse } from '../../agent/toolCallParser'
import { createProviderAdapter, ProviderClient } from '../../services/providerAdapter'
import { ChatRequestOptions } from '../../services/chatTypes'
import { applyWorkspaceFileChange, createWorkspaceFileChange } from '../../tools/fileMutationWorkflow'
import { GhostFileSystem } from '../../runtimeDependencies'
import { readWorkspaceFile } from '../../tools/workspaceFile'
import { parseGhostEdit } from '../../tools/editWorkflow'

const fixtureRoot = path.join(process.cwd(), 'src', 'test', 'fixtures', 'regressions')

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(fixtureRoot, `${name}.json`), 'utf8')) as T
}

const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined })
} as vscode.CancellationToken

class FixtureFileSystem implements GhostFileSystem {
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
    this.files.set(destination.fsPath, await this.readFile(source))
    this.files.delete(source.fsPath)
  }

  async delete(uri: vscode.Uri): Promise<void> {
    if (!this.files.delete(uri.fsPath)) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
  }
}

class FixtureProvider implements ProviderClient {
  constructor(private readonly response: string) {}

  async checkHealth(): Promise<boolean> {
    return true
  }

  async *streamChatCompletion(_options: ChatRequestOptions): AsyncGenerator<string> {
    yield this.response
  }
}

async function collect(adapter: ReturnType<typeof createProviderAdapter>, options: ChatRequestOptions): Promise<string> {
  let output = ''
  for await (const chunk of adapter.stream(options)) {
    output += chunk
  }
  return output
}

suite('Regression fixtures', () => {
  test('rejects the malformed shader edit before touching a file', () => {
    const data = fixture<{ edit: Record<string, unknown>; expectedError: string }>('malformed-shader-edit')
    assert.throws(() => parseGhostEdit(data.edit), new RegExp(data.expectedError))
  })

  test('reports the historical missing shader file without creating it', async () => {
    const data = fixture<{ path: string; expectedExists: boolean }>('missing-file')
    const filesystem = new FixtureFileSystem()
    const snapshot = await readWorkspaceFile(vscode.Uri.file(path.join(process.cwd(), data.path)), token, filesystem)
    assert.equal(snapshot.exists, data.expectedExists)
    assert.equal(snapshot.content, '')
    assert.equal(filesystem.files.size, 0)
  })

  test('preserves empty provider output as empty output', async () => {
    const data = fixture<{ response: string; expectedOutput: string }>('provider-empty-output')
    const adapter = createProviderAdapter('ollama', new FixtureProvider(data.response))
    assert.equal(await collect(adapter, { model: 'fixture', messages: [] }), data.expectedOutput)
  })

  test('keeps failed applies from changing the original file', async () => {
    const data = fixture<{ path: string; before: string; after: string; failOn: string; expectedError: string }>('failed-apply')
    const filesystem = new FixtureFileSystem()
    const filePath = path.join(process.cwd(), data.path)
    const uri = vscode.Uri.file(filePath)
    filesystem.files.set(filePath, Buffer.from(data.before, 'utf8'))
    filesystem.failWritesMatching = data.failOn
    const change = createWorkspaceFileChange({ exists: true, content: data.before }, data.after)

    await assert.rejects(
      () => applyWorkspaceFileChange(uri, change, { exists: true, content: data.before }, token, filesystem),
      new RegExp(data.expectedError)
    )
    assert.equal(Buffer.from(filesystem.files.get(filePath) ?? []).toString('utf8'), data.before)
  })

  test('classifies truncated tool arguments for retry', () => {
    const data = fixture<{ response: string; expectedState: string }>('truncated-tool-arguments')
    assert.equal(classifyLocalToolResponse(data.response).state, data.expectedState)
  })

  test('stops repeated edits to the same file', () => {
    const data = fixture<{ first: EditRecord; second: EditRecord; expectedReason: string }>('repeated-file-edits')
    const reason = getEditLoopReason({ signatures: new Set(), history: [data.first] }, data.second)
    assert.equal(reason, data.expectedReason)
  })
})
