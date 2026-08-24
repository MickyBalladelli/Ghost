import { strict as assert } from 'node:assert'

import { GHOST_NATIVE_TOOL_DEFINITIONS } from '../../agent/nativeTooling'
import { ollamaModelReportsTools } from '../../services/ollamaToolMetadata'
import { shouldUseNativeToolCalling } from '../../agent/nativeToolSupport'
import { buildAgentSystemPrompt } from '../../agent/systemPrompt'

suite('Native tool support', () => {
  test('detects Ollama tool metadata from capabilities or template', () => {
    assert.equal(ollamaModelReportsTools({ capabilities: ['completion', 'tools'] }), true)
    assert.equal(ollamaModelReportsTools({ capabilities: ['completion'] }), false)
    assert.equal(ollamaModelReportsTools({ template: '{{ .Prompt }}{{ .Tools }}' }), true)
    assert.equal(ollamaModelReportsTools({ template: '{{ .Prompt }}' }), false)
    assert.equal(ollamaModelReportsTools({}), false)
  })

  test('enables native tools only for supported Ollama models and OpenAI chat', () => {
    assert.equal(shouldUseNativeToolCalling({ toolsEnabled: true, provider: 'ollama', ollamaReportsTools: true }), true)
    assert.equal(shouldUseNativeToolCalling({ toolsEnabled: true, provider: 'ollama', ollamaReportsTools: false }), false)
    assert.equal(shouldUseNativeToolCalling({ toolsEnabled: true, provider: 'openai-compatible', openaiProtocol: 'openai-chat' }), true)
    assert.equal(shouldUseNativeToolCalling({ toolsEnabled: true, provider: 'openrouter', ollamaReportsTools: true }), true)
    assert.equal(shouldUseNativeToolCalling({ toolsEnabled: true, provider: 'openrouter', ollamaReportsTools: false }), false)
    assert.equal(shouldUseNativeToolCalling({ toolsEnabled: true, provider: 'mlx-vlm' }), false)
    assert.equal(shouldUseNativeToolCalling({ toolsEnabled: false, provider: 'ollama', ollamaReportsTools: true }), false)
  })
})

suite('Native tool schemas', () => {
  test('mirrors apply-edit hunk validators', () => {
    const applyEdit = GHOST_NATIVE_TOOL_DEFINITIONS.find(tool => tool.function.name === 'ghost_apply_edit')
    const hunks = (applyEdit?.function.parameters.properties as { hunks: { items: Record<string, unknown> } }).hunks.items
    assert.deepEqual(hunks.required, ['startLine', 'endLine', 'replacement'])
    assert.equal(hunks.additionalProperties, false)
    assert.ok(Object.prototype.hasOwnProperty.call(hunks.properties, 'oldText'))
    assert.ok(Object.prototype.hasOwnProperty.call(hunks.properties, 'oldHash'))
    assert.ok(Object.prototype.hasOwnProperty.call(hunks.properties, 'beforeContext'))
    assert.ok(Object.prototype.hasOwnProperty.call(hunks.properties, 'afterContext'))
  })

  test('includes read modes that execution validates', () => {
    const readFile = GHOST_NATIVE_TOOL_DEFINITIONS.find(tool => tool.function.name === 'ghost_read_file')
    const properties = readFile?.function.parameters.properties as Record<string, unknown>
    assert.ok('allowSpecialFile' in properties)
    assert.ok('startByte' in properties)
    assert.ok('endByte' in properties)
    assert.ok('caseSensitive' in properties)
    assert.ok('maxMatches' in properties)
  })
})

suite('System prompt size', () => {
  test('keeps the always-on native-tools prompt short and omits JSON schemas', () => {
    const prompt = buildAgentSystemPrompt({
      toolsEnabled: true,
      nativeTools: true,
      completionRecordEnabled: false,
      workflowInstruction: ''
    })
    assert.ok(prompt.length < 1200)
    assert.equal(prompt.includes('{"tool":"tool_name"'), false)
    assert.equal(prompt.includes('ghost_apply_edit({"path"'), false)
    assert.ok(prompt.includes('optional bookkeeping'))
  })

  test('adds the JSON protocol only when native tools are off', () => {
    const prompt = buildAgentSystemPrompt({
      toolsEnabled: true,
      nativeTools: false,
      completionRecordEnabled: true,
      workflowInstruction: ''
    })
    assert.ok(prompt.includes('{"tool":"tool_name"'))
    assert.ok(prompt.includes('ghost_record_completion'))
    assert.ok(prompt.includes('"oldText"'))
    assert.ok(prompt.includes('only after files actually changed'))
  })
})
