const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const semverPattern = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?'

function replaceMarker(relativePath, pattern, replacement) {
  const filePath = path.join(root, relativePath)
  const text = fs.readFileSync(filePath, 'utf8')
  if (!pattern.test(text)) {
    throw new Error(`${relativePath}: release marker not found`)
  }
  fs.writeFileSync(filePath, text.replace(pattern, replacement))
}

replaceMarker(
  'README.md',
  new RegExp(`Current release:\\s*\`${semverPattern}\``),
  `Current release: \`${version}\``
)
replaceMarker(
  'docs/release.md',
  new RegExp(`^version:\\s*${semverPattern}`, 'm'),
  `version: ${version}`
)

console.log(`Synced release markers to ${version}`)
