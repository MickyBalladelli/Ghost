import * as path from 'node:path'

import { runMocha } from '../mochaRunner'
import { EXTENSION_HOST_TEST_FILES } from '../testSuites'

export function run(): Promise<void> {
  return runMocha(EXTENSION_HOST_TEST_FILES.map(file => path.resolve(__dirname, file)))
}
