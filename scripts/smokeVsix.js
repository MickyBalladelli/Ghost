const fs = require('node:fs')
const path = require('node:path')

const { downloadAndUnzipVSCode, runVSCodeCommand } = require('@vscode/test-electron')

const vsixPath = process.argv[2]
const version = process.env.VSCODE_VERSION || 'stable'

if (!vsixPath || !fs.existsSync(vsixPath)) {
  throw new Error(`VSIX file not found: ${vsixPath || '(missing argument)'}`)
}

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))
const extensionId = `${manifest.publisher}.${manifest.name}`.toLowerCase()

async function main() {
  await downloadAndUnzipVSCode(version)
  await runVSCodeCommand(['--install-extension', path.resolve(vsixPath), '--force'], { version })
  const installed = await runVSCodeCommand(['--list-extensions'], { version })
  const installedIds = installed.stdout.toLowerCase().split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!installedIds.includes(extensionId)) {
    throw new Error(`Installed extension list did not contain ${extensionId}`)
  }
  console.log(`VSIX smoke install passed for ${extensionId}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
