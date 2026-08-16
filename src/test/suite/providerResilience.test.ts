import { strict as assert } from 'node:assert'
import { Readable } from 'node:stream'

import fetch, { Response } from 'node-fetch'

import { MlxClient, streamSseTokens } from '../../services/mlxClient'
import { OllamaClient } from '../../services/ollamaClient'

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []

  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  return chunks
}

suite('Provider resilience', () => {
  test('uses the native Ollama chat endpoint for the Ollama provider', async () => {
    const requests: string[] = []
    const request = (async (url: string) => {
      requests.push(url)
      return new Response('{"message":{"content":"{\\"tool\\":\\"ghost_apply_edit\\"}"},"done":true}\n', { status: 200 })
    }) as unknown as typeof fetch
    const client = new OllamaClient('http://127.0.0.1:11434', 'ollama', request)

    assert.deepEqual(await collect(client.streamChatCompletion({ model: 'local-model', messages: [] })), ['{"tool":"ghost_apply_edit"}'])
    assert.deepEqual(requests, ['http://127.0.0.1:11434/api/chat'])
  })

  test('uses the OpenAI-compatible chat endpoint for the OpenAI provider', async () => {
    const requests: string[] = []
    const request = (async (url: string) => {
      requests.push(url)
      return new Response('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n', { status: 200 })
    }) as unknown as typeof fetch
    const client = new OllamaClient('http://127.0.0.1:8001/v1', 'openai-compatible', request)

    assert.deepEqual(await collect(client.streamChatCompletion({ model: 'local-model', messages: [] })), ['done'])
    assert.deepEqual(requests, ['http://127.0.0.1:8001/v1/chat/completions'])
  })

  test('uses the configured endpoint and falls back between compatible APIs', async () => {
    const requests: string[] = []
    const request = (async (url: string) => {
      requests.push(url)
      if (url.endsWith('/v1/models')) {
        return new Response('not found', { status: 404 })
      }
      return new Response(JSON.stringify({ models: [{ name: 'local-model' }] }), { status: 200 })
    }) as unknown as typeof fetch
    const client = new OllamaClient('http://127.0.0.1:11434', 'auto', request)

    assert.deepEqual(await client.listModels(), ['local-model'])
    assert.deepEqual(requests, [
      'http://127.0.0.1:11434/v1/models',
      'http://127.0.0.1:11434/api/tags'
    ])
  })

  test('reports provider disconnects and empty streaming responses', async () => {
    const request = (async () => new Response('provider offline', { status: 503 })) as unknown as typeof fetch
    const client = new OllamaClient('http://localhost:11434', 'ollama', request)

    await assert.rejects(
      () => collect(client.streamChatCompletion({ model: 'missing', messages: [] })),
      /503/
    )

    const emptyClient = new MlxClient('http://localhost:8000', (async () => new Response(undefined, { status: 200 })) as unknown as typeof fetch)
    await assert.rejects(
      () => collect(emptyClient.streamChatCompletion({ model: 'missing', messages: [] })),
      /empty streaming response/
    )
  })

  test('stops safely on malformed SSE and invalid UTF-8', async () => {
    const malformed = Readable.from([
      Buffer.from('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'),
      Buffer.from('data: {not json}\n\n')
    ])
    assert.deepEqual(await collect(streamSseTokens(malformed)), ['ok'])

    const invalid = Readable.from([Buffer.from([0xff, 0xfe, 0x00])])
    assert.deepEqual(await collect(streamSseTokens(invalid)), [])
  })
})
