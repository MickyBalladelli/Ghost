import { run } from './suite/fastIndex'

void run().catch(error => {
  console.error(error)
  process.exit(1)
})
