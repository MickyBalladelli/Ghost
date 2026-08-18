import Mocha from 'mocha'

export function runMocha(testFiles: string[]): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true })
  for (const testFile of testFiles) {
    mocha.addFile(testFile)
  }

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
