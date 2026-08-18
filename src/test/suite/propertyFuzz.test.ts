import { strict as assert } from 'node:assert'

import { classifyLocalToolResponse, parseLocalToolCall } from '../../agent/toolCallParser'
import { applyGhostEdit, parseGhostEdit } from '../../tools/editWorkflow'
import { joinEndpoint, normalizeEndpoint, removeEndpointSuffix } from '../../services/endpoint'
import { redactSensitiveText, redactSensitiveValue } from '../../privacy/redact'
import { decodeGhostWebviewMessage, GHOST_WEBVIEW_PROTOCOL_VERSION } from '../../ui/ghostProtocol'

class DeterministicRandom {
  private value = 0x9e3779b9

  next(): number {
    this.value = Math.imul(this.value ^ (this.value >>> 16), 0x21f0aaad)
    this.value = Math.imul(this.value ^ (this.value >>> 15), 0x735a2d97)
    return (this.value ^ (this.value >>> 15)) >>> 0
  }

  integer(maximum: number): number {
    return this.next() % maximum
  }

  text(length: number): string {
    const alphabet = 'abcXYZ012 _-'
    return Array.from({ length }, () => alphabet[this.integer(alphabet.length)]).join('')
  }
}

const random = new DeterministicRandom()

suite('Deterministic property and fuzz coverage', () => {
  test('keeps tool JSON parsing total for generated valid and truncated inputs', () => {
    for (let index = 0; index < 100; index += 1) {
      const path = `src/${random.text(4)}-${index}.ts`
      const valid = JSON.stringify({ tool: 'ghost_read_file', arguments: { path } })
      assert.doesNotThrow(() => classifyLocalToolResponse(valid))
      assert.equal(parseLocalToolCall(valid)?.arguments.path, path)

      const truncated = valid.slice(0, random.integer(valid.length))
      assert.doesNotThrow(() => classifyLocalToolResponse(truncated))
      assert.doesNotThrow(() => parseLocalToolCall(truncated))
    }
  })

  test('applies generated non-overlapping edit hunks without changing unrelated lines', () => {
    for (let index = 0; index < 60; index += 1) {
      const lines = Array.from({ length: 8 }, (_, line) => `line-${index}-${line}`)
      const hunks = [1, 3, 5].map(line => ({
        startLine: line,
        endLine: line,
        oldText: lines[line - 1],
        replacement: `replacement-${index}-${line}`
      }))
      const edit = parseGhostEdit({ path: 'generated.ts', hunks })
      const result = applyGhostEdit(lines.join('\n'), edit)

      assert.match(result, new RegExp(`replacement-${index}-1`))
      assert.match(result, new RegExp(`replacement-${index}-3`))
      assert.match(result, new RegExp(`replacement-${index}-5`))
      assert.match(result, new RegExp(`line-${index}-2`))
      assert.match(result, new RegExp(`line-${index}-8`))
    }
  })

  test('keeps protocol decoding bounded and rejects generated mutations', () => {
    for (let index = 0; index < 80; index += 1) {
      const message = {
        source: 'ghost-webview',
        version: GHOST_WEBVIEW_PROTOCOL_VERSION,
        type: 'submit',
        requestId: `request-${index}`,
        conversationId: `conversation-${index}`,
        prompt: `Explain ${random.text(12)}`
      }
      assert.equal(decodeGhostWebviewMessage(message)?.type, 'submit')
      assert.equal(decodeGhostWebviewMessage({ ...message, version: 99 }), undefined)
      assert.equal(decodeGhostWebviewMessage({ ...message, prompt: '' }), undefined)
    }
  })

  test('redacts generated secrets and preserves safe text', () => {
    for (let index = 0; index < 80; index += 1) {
      const secret = `token-${index}-${random.text(8)}`
      const redacted = redactSensitiveText(`Authorization: Bearer ${secret}; note=${random.text(6)}`)
      assert.equal(redacted.includes(secret), false)
      assert.match(redacted, /\[REDACTED\]/)
      assert.equal(redactSensitiveValue({ safe: random.text(5) }).safe.length, 5)
    }
  })

  test('normalizes generated endpoint paths without duplicate suffixes', () => {
    for (let index = 0; index < 80; index += 1) {
      const base = `http://localhost:${8000 + index}/api///`
      const normalized = normalizeEndpoint(base)
      assert.equal(normalizeEndpoint(normalized), normalized)
      const joined = joinEndpoint(normalized, 'api/v1/models')
      assert.equal(joined.includes('/api/api/'), false)
      assert.equal(removeEndpointSuffix(joined, 'models').endsWith('/models'), false)
    }
  })
})
