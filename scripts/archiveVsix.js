const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const trash = path.join(root, 'Trash')
const artifacts = fs.readdirSync(root).filter(file => file.toLowerCase().endsWith('.vsix'))

if (!artifacts.length) {
  console.log('No root VSIX artifacts to archive')
  process.exit(0)
}

fs.mkdirSync(trash, { recursive: true })

for (const artifact of artifacts) {
  const source = path.join(root, artifact)
  let target = path.join(trash, artifact)
  let suffix = 1
  while (fs.existsSync(target)) {
    target = path.join(trash, `${artifact}.${suffix}`)
    suffix += 1
  }
  fs.renameSync(source, target)
  console.log(`Archived ${artifact} to ${path.relative(root, target)}`)
}
