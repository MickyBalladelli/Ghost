import { strict as assert } from 'node:assert'

import { parseLocalToolCall } from '../../agent/toolCallParser'

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

  test('handles duplicate JSON objects by selecting the first valid call', () => {
    const result = parseLocalToolCall('{"status":"thinking"}\n{"tool":"ghost_read_file","arguments":{"path":"/workspace/a.ts"}}')

    assert.equal(result?.name, 'ghost_read_file')
  })
})
