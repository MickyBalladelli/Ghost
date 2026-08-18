import { strict as assert } from 'node:assert'

import { classifyLocalToolResponse, parseLocalToolCall } from '../../agent/toolCallParser'
import { validateLocalToolCall } from '../../agent/toolSchema'

suite('Tool call parsing', () => {
  test('parses direct, nested, and fenced tool calls', () => {
    assert.deepEqual(parseLocalToolCall('{"tool":"ghost_read_file","arguments":{"path":"/workspace/a.ts"}}'), {
      name: 'ghost_read_file',
      arguments: { path: '/workspace/a.ts' }
    })
    assert.deepEqual(parseLocalToolCall('```json\n{"tool_call":{"name":"ghost_list_directory","arguments":"{\\"path\\":\\"/workspace\\"}"}}\n```'), {
      name: 'ghost_list_directory',
      arguments: { path: '/workspace' }
    })
  })

  test('accepts compact tool names emitted by local models', () => {
    assert.deepEqual(parseLocalToolCall('{"tool":"ghostapplyedit","arguments":{"path":"/workspace/test.html","hunks":[]}}'), {
      name: 'ghost_apply_edit',
      arguments: { path: '/workspace/test.html', hunks: [] }
    })
  })

  test('recovers an Ollama write call with raw multiline content', () => {
    const output = `Now I will edit the file. {"tool":"ghostwritefile","arguments":{"path":"/workspace/file.ts","content":"line one
const value = "text"
"}}`

    assert.deepEqual(parseLocalToolCall(output), {
      name: 'ghost_write_file',
      arguments: {
        path: '/workspace/file.ts',
        content: 'line one\nconst value = "text"\n'
      }
    })
  })

  test('skips malformed objects and rejects unknown tools', () => {
    assert.equal(parseLocalToolCall('{"tool":"not-a-real-tool","arguments":{}}'), undefined)
    assert.equal(parseLocalToolCall('{"tool":"ghost_read_file","arguments":"not json"}'), {
      name: 'ghost_read_file',
      arguments: {}
    })
    assert.equal(parseLocalToolCall('{"tool":"ghost_read_file"'), undefined)
  })

  test('classifies malformed compact names and truncated JSON', () => {
    const malformedName = classifyLocalToolResponse('{"tool":"ghostapply-edit","arguments":{"path":"/workspace/a.ts"}}')
    assert.equal(malformedName.state, 'unknown-tool')
    assert.match(malformedName.detail ?? '', /ghostapply-edit/)

    const truncated = classifyLocalToolResponse('{"tool":"ghostapplyedit","arguments":{"path":"/workspace/a.ts"')
    assert.equal(truncated.state, 'truncated-json')

    const malformedJson = classifyLocalToolResponse('{"tool":"ghost_read_file","arguments":{oops}}')
    assert.equal(malformedJson.state, 'malformed-json')
  })

  test('selects the first valid tool call when several are present', () => {
    const result = classifyLocalToolResponse([
      '{"tool":"ghost_read_file","arguments":{"path":"/workspace/first.ts"}}',
      '{"tool":"ghost_list_directory","arguments":{"path":"/workspace"}}'
    ].join('\n'))

    assert.equal(result.state, 'tool-call')
    assert.deepEqual(result.call, {
      name: 'ghost_read_file',
      arguments: { path: '/workspace/first.ts' }
    })
  })

  test('separates parser success from invalid tool schemas', () => {
    const parsed = parseLocalToolCall('{"tool":"ghost_read_file","arguments":{"path":42}}')
    assert.ok(parsed)
    assert.match(validateLocalToolCall(parsed) ?? '', /Invalid field 'path'/)

    const missing = parseLocalToolCall('{"tool":"ghost_apply_edit","arguments":{"path":"/workspace/a.ts","hunks":[]}}')
    assert.ok(missing)
    assert.match(validateLocalToolCall(missing) ?? '', /must contain at least 1 item/)
  })

  test('recognizes output-only replies without treating them as tool calls', () => {
    const result = classifyLocalToolResponse('I inspected the file. It already contains the requested change.')
    assert.equal(result.state, 'explanatory-only')
    assert.equal(result.call, undefined)
  })

  test('handles duplicate JSON objects by selecting the first valid call', () => {
    const result = parseLocalToolCall('{"status":"thinking"}\n{"tool":"ghost_read_file","arguments":{"path":"/workspace/a.ts"}}')

    assert.equal(result?.name, 'ghost_read_file')
  })
})
