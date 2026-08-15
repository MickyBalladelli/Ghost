import { strict as assert } from 'node:assert'
import { Readable } from 'node:stream'

import {
  buildFimPrompt,
  streamOllamaJson
} from '../../services/ollamaClient'
import { streamSseTokens } from '../../services/mlxClient'

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []

  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  return chunks
}

suite('Ollama client parsing', () => {
  test('parses Ollama newline-delimited streaming responses', async () => {
    const body = Readable.from([
      '{"message":{"content":"hello"},"done":false}\n',
      '{"message":{"content":" world"},"done":false}\n',
      '{"done":true}\n'
    ])

    assert.deepEqual(await collect(streamOllamaJson(body)), ['hello', ' world'])
  })

  test('parses OpenAI SSE chunks split across network frames', async () => {
    const body = Readable.from([
      Buffer.from('data: {"choices":[{"delta":{"content":"hel'),
      Buffer.from('lo"}}]}\n\n'),
      Buffer.from('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'),
      Buffer.from('data: [DONE]\n\n')
    ])

    assert.deepEqual(await collect(streamSseTokens(body)), ['hello', ' world'])
  })

  test('builds the Qwen-compatible FIM prompt', () => {
    assert.equal(buildFimPrompt('const value = ', ';'), '<PRE>const value = <SUF>;<MID>')
  })
})
