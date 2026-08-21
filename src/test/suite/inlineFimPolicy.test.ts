import { strict as assert } from 'node:assert'

import { shouldFetchInlineFim } from '../../providers/inlineFimPolicy'

suite('Inline FIM policy', () => {
  test('does not fetch FIM for MLX/VLM', () => {
    assert.equal(shouldFetchInlineFim('mlx-vlm'), false)
  })

  test('fetches FIM for Ollama', () => {
    assert.equal(shouldFetchInlineFim('ollama'), true)
  })

  test('fetches FIM only for OpenAI-compatible profiles that expose it', () => {
    assert.equal(shouldFetchInlineFim('openai-compatible', 'generic'), true)
    assert.equal(shouldFetchInlineFim('openai-compatible', 'lm-studio'), false)
    assert.equal(shouldFetchInlineFim('openai-compatible', 'anthropic'), false)
    assert.equal(shouldFetchInlineFim('openai-compatible', 'gemini'), false)
  })
})
