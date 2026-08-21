const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const copy = () => {
  try {
    require('./copyWebviewBuild.js')
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
  }
}

const extension = spawn('npx', ['tsc', '-watch', '-p', './', '--preserveWatchOutput'], {
  cwd: root,
  stdio: 'inherit'
})

const webview = spawn('npx', ['tsc', '-watch', '-p', './tsconfig.webview.json', '--preserveWatchOutput'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe']
})

const onWebviewOutput = chunk => {
  const text = chunk.toString()
  process.stdout.write(text)
  if (/Found 0 errors/.test(text)) {
    copy()
  }
}

webview.stdout.on('data', onWebviewOutput)
webview.stderr.on('data', chunk => process.stderr.write(chunk))

const cssPath = path.join(root, 'src', 'webview', 'ghostWebview.css')
fs.watchFile(cssPath, { interval: 500 }, () => copy())

const stop = () => {
  extension.kill()
  webview.kill()
  fs.unwatchFile(cssPath)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
