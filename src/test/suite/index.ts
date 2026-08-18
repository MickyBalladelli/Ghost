import * as path from 'node:path'

import Mocha from 'mocha'

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true })
  const testsRoot = __dirname

  mocha.addFile(path.resolve(testsRoot, 'ollamaClient.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'providerResilience.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'providerAdapterContract.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'inlineCompletionProvider.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'context.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'protocol.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'requestState.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'persistenceModel.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'toolCallParser.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'editWorkflow.test.js'))
  mocha.addFile(path.resolve(testsRoot, 'webviewIntegration.test.js'))

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
