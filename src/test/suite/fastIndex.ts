import * as path from 'node:path'

import { runMocha } from '../mochaRunner'
import { FAST_TEST_FILES } from '../testSuites'

export function run(): Promise<void> {
  return runMocha(FAST_TEST_FILES.map(file => path.resolve(__dirname, file)))
}
