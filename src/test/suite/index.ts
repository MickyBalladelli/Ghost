import * as path from 'node:path'

import Mocha from 'mocha'

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true })
  const testsRoot = __dirname

  mocha.addFile(path.resolve(testsRoot, 'ollamaClient.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'inlineCompletionProvider.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'context.test.js'))

  return new Promise((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} test suite failure${failures === 1 ? '' : 's'}`))
      } else {
        resolve()
      }
    })
  })
}
