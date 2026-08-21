import { strict as assert } from 'node:assert'

import {
  argumentsWithCanonicalPath,
  getCanonicalEditPath,
  getCanonicalEditPaths
} from '../../agent/editPaths'

const resolveFilePath = (filePath: string): string => {
  const workspace = '/workspace'
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return normalized.startsWith('/') ? normalized : `${workspace}/${normalized}`
}

suite('Canonical edit paths', () => {
  test('keys relative, ./, and absolute forms of the same file together', () => {
    const write = (path: string) => ({
      name: 'ghost_write_file',
      arguments: { path, content: 'updated' }
    })

    assert.equal(getCanonicalEditPath(write('src/app.ts'), resolveFilePath), '/workspace/src/app.ts')
    assert.equal(getCanonicalEditPath(write('./src/app.ts'), resolveFilePath), '/workspace/src/app.ts')
    assert.equal(getCanonicalEditPath(write('/workspace/src/app.ts'), resolveFilePath), '/workspace/src/app.ts')
  })

  test('canonicalizes transaction paths and drops duplicates', () => {
    const paths = getCanonicalEditPaths({
      name: 'ghost_apply_transaction',
      arguments: {
        edits: [
          { path: 'src/one.ts', content: 'one' },
          { path: '/workspace/src/one.ts', content: 'one-again' },
          { path: './src/two.ts', content: 'two' }
        ]
      }
    }, resolveFilePath)
    assert.deepEqual(paths, ['/workspace/src/one.ts', '/workspace/src/two.ts'])
  })

  test('matches write signatures across path spellings', () => {
    const relative = argumentsWithCanonicalPath({
      name: 'ghost_write_file',
      arguments: { path: 'src/app.ts', content: 'hello' }
    }, '/workspace/src/app.ts')
    const absolute = argumentsWithCanonicalPath({
      name: 'ghost_write_file',
      arguments: { path: '/workspace/src/app.ts', content: 'hello' }
    }, '/workspace/src/app.ts')
    assert.equal(JSON.stringify(relative), JSON.stringify(absolute))
  })

  test('does not treat a transaction as a single edit-loop file', () => {
    assert.equal(getCanonicalEditPath({
      name: 'ghost_apply_transaction',
      arguments: {
        edits: [
          { path: 'src/one.ts', content: 'one' },
          { path: 'src/two.ts', content: 'two' }
        ]
      }
    }, resolveFilePath), undefined)
  })
})
