import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'

import { shouldAutoAcceptFileEdit } from '../../ui/autoAcceptPolicy'
import type { AutoAcceptToolCall } from '../../ui/autoAcceptPolicy'
import { shouldStopAgentForToolFailure } from '../../agent/toolFailurePolicy'

const fixtureRoot = path.join(process.cwd(), 'src', 'test', 'fixtures', 'regressions')

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(fixtureRoot, `${name}.json`), 'utf8')) as T
}

const writeCall = (): AutoAcceptToolCall => ({
  name: 'ghost_write_file',
  arguments: { path: 'src/app.ts', content: 'updated' }
})

suite('Agent regression fixtures', () => {
  test('one-edit auto-accept expires after the first mutation', () => {
    const data = fixture<{ firstAccepted: boolean; secondAccepted: boolean; consumeOneEdit: boolean }>('one-edit-expires')
    const first = shouldAutoAcceptFileEdit({ scope: 'one-edit' }, writeCall())
    assert.equal(first.accepted, data.firstAccepted)
    assert.equal(first.consumeOneEdit, data.consumeOneEdit)
    const second = shouldAutoAcceptFileEdit({ scope: 'one-edit', oneEditConsumed: true }, writeCall())
    assert.equal(second.accepted, data.secondAccepted)
  })

  test('a failed read does not abort the request', () => {
    const data = fixture<{ tool: string; status: 'failed'; result: string; shouldStop: boolean }>('failed-read-continues')
    assert.equal(shouldStopAgentForToolFailure(data.tool, data.status, data.result), data.shouldStop)
  })
})
