import { strict as assert } from 'node:assert'

import '../../webview/ghostWebviewToolTimeline'

type ToolTimelineApi = {
  compactAction: (name: string) => string
  summarizeOpenCodeToolProgress: (lines: string[]) => string[]
}

const toolTimeline = (globalThis as typeof globalThis & { GhostToolTimeline: ToolTimelineApi }).GhostToolTimeline

suite('OpenCode tool progress summary', () => {
  test('collapses consecutive tool status lines into one per-tool summary', () => {
    assert.deepEqual(
      toolTimeline.summarizeOpenCodeToolProgress([
        'OpenCode bash: pending',
        'OpenCode read: pending',
        'OpenCode bash: running',
        'OpenCode read: running',
        'OpenCode read: completed',
        'OpenCode bash: running',
        'OpenCode bash: completed',
        'OpenCode glob: pending',
        'OpenCode glob: running',
        'OpenCode glob: completed',
        'OpenCode read: pending',
        'OpenCode read: running',
        'OpenCode read: completed'
      ]),
      ['OpenCode tools: bash ×4 completed · read ×6 completed · glob ×3 completed']
    )
  })

  test('keeps other lines in place and splits runs around them', () => {
    assert.deepEqual(
      toolTimeline.summarizeOpenCodeToolProgress([
        'OpenCode session abc123',
        'OpenCode bash: running',
        'OpenCode bash: completed',
        'Ghost blocked a terminal file write; retrying with OpenCode edit tools…'
      ]),
      [
        'OpenCode session abc123',
        'OpenCode tools: bash ×2 completed',
        'Ghost blocked a terminal file write; retrying with OpenCode edit tools…'
      ]
    )
  })

  test('passes through non-matching lines and caps field lengths', () => {
    assert.deepEqual(toolTimeline.summarizeOpenCodeToolProgress([]), [])
    assert.deepEqual(
      toolTimeline.summarizeOpenCodeToolProgress(['Preparing model request', 'OpenCode bash:']),
      ['Preparing model request', 'OpenCode bash:']
    )
    const summarized = toolTimeline.summarizeOpenCodeToolProgress([
      `OpenCode ${'b'.repeat(60)}: ${'r'.repeat(60)}`
    ])
    assert.equal(summarized.length, 1)
    assert.ok((summarized[0] as string).length < 120)
  })
})
