import { strict as assert } from 'node:assert'

import { parseLocalToolCall } from '../../agent/toolCallParser'

suite('Tool call parsing', () => {
  test('parses direct, nested, and fenced tool calls', () => {
    assert.deepEqual(parseLocalToolCall('{"tool":"ghostpilot_read_file","arguments":{"path":"/workspace/a.ts"}}'), {
      name: 'ghostpilot_read_file',
      arguments: { path: '/workspace/a.ts' }
    })
    assert.deepEqual(parseLocalToolCall('```json\n{"tool_call":{"name":"ghostpilot_list_directory","arguments":"{\\"path\\":\\"/workspace\\"}"}}\n```'), {
      name: 'ghostpilot_list_directory',
      arguments: { path: '/workspace' }
    })
  })

  test('skips malformed objects and rejects unknown tools', () => {
    assert.equal(parseLocalToolCall('{"tool":"not-a-real-tool","arguments":{}}'), undefined)
    assert.equal(parseLocalToolCall('{"tool":"ghostpilot_read_file","arguments":"not json"}'), {
      name: 'ghostpilot_read_file',
      arguments: {}
    })
    assert.equal(parseLocalToolCall('{"tool":"ghostpilot_read_file"'), undefined)
  })

  test('handles duplicate JSON objects by selecting the first valid call', () => {
    const result = parseLocalToolCall('{"status":"thinking"}\n{"tool":"ghostpilot_read_file","arguments":{"path":"/workspace/a.ts"}}')

    assert.equal(result?.name, 'ghostpilot_read_file')
  })
})
