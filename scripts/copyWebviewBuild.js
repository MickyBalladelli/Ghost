const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, '.webview-build', 'webview')
const target = path.join(root, 'out', 'webview')

fs.mkdirSync(target, { recursive: true })

for (const file of fs.readdirSync(source)) {
  const sourcePath = path.join(source, file)
  const targetPath = path.join(target, file)

  if (!file.endsWith('.js')) {
    fs.copyFileSync(sourcePath, targetPath)
    continue
  }

  const browserSource = fs.readFileSync(sourcePath, 'utf8')
    .replace(/^"use strict";\nObject\.defineProperty\(exports, "__esModule", \{ value: true \}\);\n/, '')
    .replace(/\nexport \{\};\s*$/, '\n')

  if (/^(import |export )|\brequire\(|\bexports\.|\bmodule\.exports/m.test(browserSource)) {
    throw new Error(`Webview output is not classic browser JavaScript: ${file}`)
  }

  fs.writeFileSync(targetPath, browserSource)
}

console.log('Copied browser webview output into out/webview')
