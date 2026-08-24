import { strict as assert } from 'node:assert'

import { OpenRouterClient, buildOpenRouterChatBody, normalizeOpenRouterProviderOrder, parseOpenRouterModels } from '../../services/openRouterClient'
import type { FetchLike } from '../../services/httpTypes'

const transport = {
  apiKeyHeader: 'Authorization',
  apiKeyPrefix: 'Bearer',
  organizationHeader: '',
  organization: '',
  projectHeader: '',
  project: '',
  proxy: '',
  noProxy: '',
  tlsRejectUnauthorized: true,
  tlsCaFile: '',
  tlsCertFile: '',
  tlsKeyFile: ''
}

const routing = {
  allowFallbacks: true,
  requireParameters: true,
  dataCollection: 'deny' as const,
  providerOrder: ['anthropic', 'openai']
}

suite('OpenRouter client', () => {
  test('maps model metadata and per-token prices to Ghost metadata', () => {
    const models = parseOpenRouterModels({
      data: [{
        id: 'anthropic/claude-3.5-sonnet:free',
        name: 'Claude 3.5 Sonnet',
        context_length: 200000,
        max_completion_tokens: 8192,
        architecture: { modality: 'text+image->text', input_modalities: ['text', 'image'] },
        pricing: { prompt: '0.000003', completion: '0.000015' },
        supported_parameters: ['temperature', 'top_p', 'tools', 'tool_choice', 'response_format']
      }]
    })

    assert.deepEqual(models[0], {
      id: 'anthropic/claude-3.5-sonnet:free',
      displayName: 'Claude 3.5 Sonnet',
      contextWindow: 200000,
      outputLimit: 8192,
      supportsTools: true,
      supportsJsonMode: true,
      supportsVision: true,
      supportsFIM: false,
      supportsStreaming: true,
      supportsSampling: {
        temperature: true,
        topP: true,
        topK: false,
        minP: false,
        presencePenalty: false,
        repeatPenalty: false
      },
      pricing: { input: 3, output: 15 },
      pricingStatus: 'paid'
    })
  })

  test('validates provider order and serializes OpenRouter routing', () => {
    assert.deepEqual(normalizeOpenRouterProviderOrder(['anthropic', 'anthropic', 'bad provider', 'openai']), ['anthropic', 'openai'])
    assert.deepEqual(buildOpenRouterChatBody({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: '', reasoning: 'previous reasoning' }],
      generation: { maxTokens: 4096 }
    }, routing, 1024), {
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: '', reasoning: 'previous reasoning' }],
      stream: true,
      max_tokens: 1024,
      provider: {
        allow_fallbacks: true,
        require_parameters: true,
        data_collection: 'deny',
        order: ['anthropic', 'openai']
      }
    })
  })

  test('sends OpenRouter headers, preserves model ids, and streams tool calls', async () => {
    const requests: Array<{ url: string; headers: Headers; body?: Record<string, unknown> }> = []
    const request: FetchLike = async (url, init = {}) => {
      requests.push({
        url,
        headers: new Headers(init.headers),
        ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) as Record<string, unknown> } : {})
      })
      if (url.endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'meta/llama-3.1-8b-instruct:free', supported_parameters: ['tools'] }] }), { status: 200 })
      }
      return new Response('data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"ghost_read_file","arguments":"{\\"path\\":\\"TODO.md\\"}"}}]}}]}\n\ndata: [DONE]\n\n', { status: 200 })
    }
    const client = new OpenRouterClient({
      url: 'https://openrouter.ai/api/v1',
      referer: 'https://ghost.example',
      title: 'Ghost',
      routing,
      transport
    }, () => 'or-test-key', request)

    assert.deepEqual(await client.listModels(), ['meta/llama-3.1-8b-instruct:free'])
    const chunks: string[] = []
    for await (const chunk of client.streamChatCompletion({ model: 'meta/llama-3.1-8b-instruct:free', messages: [] })) chunks.push(chunk)

    assert.equal(chunks.join(''), '{"tool":"ghost_read_file","arguments":{"path":"TODO.md"}}')
    assert.equal(requests[0].headers.get('authorization'), 'Bearer or-test-key')
    assert.equal(requests[0].headers.get('http-referer'), 'https://ghost.example')
    assert.equal(requests[0].headers.get('x-openrouter-title'), 'Ghost')
    assert.equal(requests[1].body?.model, 'meta/llama-3.1-8b-instruct:free')
  })

  test('passes reasoning-only responses to the agent continuation recovery', async () => {
    let completionRequests = 0
    const request: FetchLike = async (_url, init = {}) => {
      if (init.body && typeof init.body === 'string') completionRequests += 1
      if (completionRequests === 1) {
        return new Response('data: {"choices":[{"delta":{"reasoning":"I need to inspect the workspace first."}}]}\n\ndata: [DONE]\n\n', { status: 200 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { reasoning: 'Still thinking.' }, finish_reason: 'length' }] }), { status: 200 })
    }
    const client = new OpenRouterClient({
      url: 'https://openrouter.ai/api/v1',
      referer: '',
      title: '',
      routing,
      transport
    }, () => 'or-test-key', request)

    const events: string[] = []
    for await (const event of client.streamChatEvents({ model: 'stealth/ox-alpha', messages: [] })) {
      events.push(event.type === 'reasoning' ? event.text : event.type === 'text' ? event.text : event.name ?? '')
    }

    assert.deepEqual(events, ['I need to inspect the workspace first.'])
    assert.equal(completionRequests, 2)
  })

  test('preserves reasoning from the non-stream fallback', async () => {
    let completionRequests = 0
    const request: FetchLike = async (_url, init = {}) => {
      if (init.body && typeof init.body === 'string') completionRequests += 1
      if (completionRequests === 1) {
        return new Response('data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n\n', { status: 200 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { reasoning: 'Fallback reasoning.' } }] }), { status: 200 })
    }
    const client = new OpenRouterClient({
      url: 'https://openrouter.ai/api/v1',
      referer: '',
      title: '',
      routing,
      transport
    }, () => 'or-test-key', request)

    const events: string[] = []
    for await (const event of client.streamChatEvents({ model: 'stealth/ox-alpha', messages: [] })) {
      if (event.type === 'reasoning') events.push(event.text)
    }

    assert.deepEqual(events, ['Fallback reasoning.'])
    assert.equal(completionRequests, 2)
  })

  test('falls back when a streamed tool call has no arguments', async () => {
    let completionRequests = 0
    const request: FetchLike = async (_url, init = {}) => {
      if (init.body && typeof init.body === 'string') completionRequests += 1
      if (completionRequests === 1) {
        return new Response('data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"ghost_read_file"}}]}}]}\n\ndata: [DONE]\n\n', { status: 200 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'ghost_read_file', arguments: '{"path":"TODO.md"}' } }] } }] }), { status: 200 })
    }
    const client = new OpenRouterClient({
      url: 'https://openrouter.ai/api/v1',
      referer: '',
      title: '',
      routing,
      transport
    }, () => 'or-test-key', request)

    const events: string[] = []
    for await (const event of client.streamChatEvents({ model: 'stealth/ox-alpha', messages: [] })) {
      if (event.type === 'tool-call' && event.arguments) events.push(`${event.name}:${event.arguments}`)
    }

    assert.deepEqual(events, ['ghost_read_file:{"path":"TODO.md"}'])
    assert.equal(completionRequests, 2)
  })

  test('reserves enough completion space for Ox Alpha reasoning', async () => {
    let requestBody: Record<string, unknown> | undefined
    const request: FetchLike = async (_url, init = {}) => {
      if (typeof init.body === 'string') requestBody = JSON.parse(init.body) as Record<string, unknown>
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 })
    }
    const client = new OpenRouterClient({
      url: 'https://openrouter.ai/api/v1',
      referer: '',
      title: '',
      routing,
      transport
    }, () => 'or-test-key', request)

    for await (const _event of client.streamChatEvents({
      model: 'stealth/ox-alpha',
      messages: [],
      generation: { maxTokens: 1024 }
    })) {
      // Consume the response.
    }

    assert.equal(requestBody?.max_tokens, 8192)
    assert.deepEqual(requestBody?.reasoning, { effort: 'low' })
  })
})
