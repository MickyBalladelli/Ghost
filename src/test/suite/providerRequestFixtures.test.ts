import { strict as assert } from 'node:assert'

import {
  buildMlxChatBody,
  buildOllamaChatBody,
  buildOpenAiChatBody,
  buildOpenAiResponsesBody
} from '../../services/providerRequestBuilders'

const tools = [{
  type: 'function' as const,
  function: {
    name: 'ghost_read_file',
    description: 'Read a file',
    parameters: { type: 'object', properties: {} }
  }
}]

const generation = {
  temperature: 0.2,
  topP: 0.8,
  topK: 12,
  minP: 0.05,
  presencePenalty: 0.1,
  repeatPenalty: 1.05,
  seed: 7,
  stop: ['<END>'],
  contextWindow: 4096,
  grammar: 'json',
  maxTokens: 256
}

const textMessages = [{ role: 'user' as const, content: 'hello' }]
const imageMessages = [{
  role: 'user' as const,
  content: [
    { type: 'text' as const, text: 'Look at this' },
    { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAE=', detail: 'low' as const } }
  ]
}]

function wire<T>(body: T): T {
  return JSON.parse(JSON.stringify(body)) as T
}

suite('Provider request fixtures', () => {
  test('keeps only supported sampling fields in OpenAI-compatible requests', () => {
    const body = wire(buildOpenAiChatBody({ model: 'openai-model', generation }, textMessages, true))

    assert.deepEqual(body, {
      model: 'openai-model',
      messages: textMessages,
      stream: true,
      temperature: 0.2,
      top_p: 0.8,
      presence_penalty: 0.1,
      seed: 7,
      stop: ['<END>'],
      max_tokens: 256
    })
    assert.equal('top_k' in body, false)
    assert.equal('min_p' in body, false)
    assert.equal('repeat_penalty' in body, false)
  })

  test('keeps native Ollama options and converts image data URLs to base64', () => {
    const body = wire(buildOllamaChatBody({ model: 'llama3', generation }, imageMessages, true))

    assert.deepEqual(body, {
      model: 'llama3',
      messages: [{ role: 'user', content: 'Look at this', images: ['AAE='] }],
      stream: true,
      options: {
        temperature: 0.2,
        top_p: 0.8,
        top_k: 12,
        min_p: 0.05,
        presence_penalty: 0.1,
        repeat_penalty: 1.05,
        seed: 7,
        stop: ['<END>'],
        num_ctx: 4096,
        grammar: 'json',
        num_predict: 256
      }
    })
  })

  test('keeps MLX vision requests and omits unsupported tools and sampling fields', () => {
    const body = wire(buildMlxChatBody({
      model: 'mlx-model',
      messages: imageMessages,
      generation,
      tools,
      toolChoice: 'auto',
      responseFormat: { type: 'json_object' }
    }))

    assert.deepEqual(body, {
      model: 'mlx-model',
      messages: imageMessages,
      temperature: 0.2,
      top_p: 0.8,
      presence_penalty: 0.1,
      seed: 7,
      stop: ['<END>'],
      grammar: 'json',
      max_tokens: 256,
      stream: true
    })
    assert.equal('top_k' in body, false)
    assert.equal('min_p' in body, false)
    assert.equal('repeat_penalty' in body, false)
    assert.equal('tools' in body, false)
    assert.equal('tool_choice' in body, false)
    assert.equal('response_format' in body, false)
  })

  test('serializes image content for OpenAI Responses fixtures', () => {
    const body = wire(buildOpenAiResponsesBody({ model: 'openai-model', generation }, imageMessages))

    assert.deepEqual(body, {
      model: 'openai-model',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'Look at this' },
          { type: 'input_image', image_url: 'data:image/png;base64,AAE=', detail: 'low' }
        ]
      }],
      stream: true,
      temperature: 0.2,
      top_p: 0.8,
      seed: 7,
      stop: ['<END>'],
      max_output_tokens: 256
    })
    assert.equal('top_k' in body, false)
    assert.equal('min_p' in body, false)
    assert.equal('repeat_penalty' in body, false)
  })
})
