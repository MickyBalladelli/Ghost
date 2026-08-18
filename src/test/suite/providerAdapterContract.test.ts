import { strict as assert } from 'node:assert'

import {
  createProviderAdapter,
  ProviderClient,
  ProviderError,
  ProviderId
} from '../../services/providerAdapter'
import { ChatRequestOptions, ChatStreamEvent } from '../../services/chatTypes'

const options: ChatRequestOptions = {
  model: 'contract-model',
  messages: [{ role: 'user', content: 'hello' }]
}

function cancelledError(): Error {
  const error = new Error('The request was cancelled.')
  error.name = 'AbortError'
  return error
}

async function collectText(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

async function collectEvents(stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

class EventProvider implements ProviderClient {
  async checkHealth(): Promise<boolean> {
    return true
  }

  async *streamChatCompletion(request: ChatRequestOptions): AsyncGenerator<string> {
    if (request.signal?.aborted) throw cancelledError()
    yield 'fallback text'
  }

  async *streamChatEvents(request: ChatRequestOptions): AsyncGenerator<ChatStreamEvent> {
    if (request.signal?.aborted) throw cancelledError()
    yield { type: 'text', text: 'native text' }
    if (request.tools?.length) {
      yield { type: 'tool-call', name: 'ghost_read_file', arguments: '{"path":"TODO.md"}', done: true }
    }
  }
}

class TextOnlyProvider implements ProviderClient {
  async checkHealth(): Promise<boolean> {
    return true
  }

  async *streamChatCompletion(request: ChatRequestOptions): AsyncGenerator<string> {
    if (request.signal?.aborted) throw cancelledError()
    yield 'text-only provider'
  }
}

class FailingProvider implements ProviderClient {
  async checkHealth(): Promise<boolean> {
    return true
  }

  async *streamChatCompletion(): AsyncGenerator<string> {
    throw new Error('provider network disconnected')
  }
}

const providerIds: ProviderId[] = ['ollama', 'mlx-vlm', 'openai-compatible']

for (const provider of providerIds) {
  suite(`Provider adapter contract: ${provider}`, () => {
    test('streams text and preserves native tool events', async () => {
      const adapter = createProviderAdapter(provider, new EventProvider())
      assert.deepEqual(await collectText(adapter.stream(options)), ['fallback text'])
      assert.deepEqual(await collectEvents(adapter.streamEvents({
        ...options,
        tools: [{ type: 'function', function: { name: 'ghost_read_file', parameters: {} } }]
      })), [
        { type: 'text', text: 'native text' },
        { type: 'tool-call', name: 'ghost_read_file', arguments: '{"path":"TODO.md"}', done: true }
      ])
    })

    test('falls back to text events for older clients', async () => {
      const adapter = createProviderAdapter(provider, new TextOnlyProvider())
      assert.deepEqual(await collectEvents(adapter.streamEvents(options)), [{ type: 'text', text: 'text-only provider' }])
    })

    test('normalizes provider failures', async () => {
      const adapter = createProviderAdapter(provider, new FailingProvider())
      await assert.rejects(
        () => collectText(adapter.stream(options)),
        error => error instanceof ProviderError && error.provider === provider && error.code === 'network' && error.retryable
      )
    })

    test('normalizes cancellation', async () => {
      const controller = new AbortController()
      controller.abort()
      const adapter = createProviderAdapter(provider, new EventProvider())
      await assert.rejects(
        () => collectEvents(adapter.streamEvents({ ...options, signal: controller.signal })),
        error => error instanceof ProviderError && error.provider === provider && error.code === 'cancelled' && !error.retryable
      )
    })

    test('reports provider capabilities with the requested model', () => {
      const adapter = createProviderAdapter(provider, new EventProvider())
      const capabilities = adapter.capabilities(options.model)
      assert.equal(capabilities.provider, provider)
      assert.equal(capabilities.model, options.model)
      assert.equal(capabilities.supportsStreaming, true)
      assert.equal(typeof capabilities.contextWindow, 'number')
      assert.equal(typeof capabilities.outputLimit, 'number')
    })
  })
}
