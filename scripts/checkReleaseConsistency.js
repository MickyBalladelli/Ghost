const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const root = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const version = packageJson.version
const semverPattern = '(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?)'
const errors = []

function requireEqual(label, expected, actual) {
  if (expected !== actual) {
    errors.push(`${label}: expected ${expected}, found ${actual ?? 'missing'}`)
  }
}

requireEqual('package-lock top-level version', version, packageLock.version)
requireEqual('package-lock root package version', version, packageLock.packages?.['']?.version)
requireEqual('package-lock root package name', packageJson.name, packageLock.packages?.['']?.name)

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
const readmeVersion = new RegExp('Current release:\\s*`' + semverPattern + '`').exec(readme)?.[1]
requireEqual('README current release', version, readmeVersion)

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
const changelogVersion = new RegExp(`^##\\s+${semverPattern}(?:\\s|$)`, 'm').exec(changelog)?.[1]
requireEqual('CHANGELOG latest release', version, changelogVersion)

function readZipEntry(filePath, entryName) {
  const archive = fs.readFileSync(filePath)
  const centralDirectorySignature = 0x02014b50
  const localFileSignature = 0x04034b50
  for (let offset = 0; offset + 46 <= archive.length; offset += 1) {
    if (archive.readUInt32LE(offset) !== centralDirectorySignature) continue
    const compression = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (name !== entryName) {
      offset += 45 + nameLength + extraLength + commentLength
      continue
    }

    const localOffset = archive.readUInt32LE(offset + 42)
    if (archive.readUInt32LE(localOffset) !== localFileSignature) {
      throw new Error(`${path.basename(filePath)} has an invalid local ZIP entry`)
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = archive.subarray(dataStart, dataStart + compressedSize)
    if (compression === 0) return compressed
    if (compression === 8) return zlib.inflateRawSync(compressed)
    throw new Error(`${path.basename(filePath)} uses unsupported ZIP compression ${compression}`)
  }
  return undefined
}

const vsixFiles = fs.readdirSync(root).filter(file => file.toLowerCase().endsWith('.vsix'))
if (!vsixFiles.length) {
  errors.push('VSIX: no artifact found; run npm run package first')
}

for (const file of vsixFiles) {
  const filePath = path.join(root, file)
  const fileVersion = new RegExp(`-${semverPattern}\\.vsix$`, 'i').exec(file)?.[1]
  requireEqual(`${file} filename version`, version, fileVersion)
  try {
    const manifest = readZipEntry(filePath, 'extension/package.json')
    if (!manifest) {
      errors.push(`${file}: extension/package.json is missing`)
      continue
    }
    const extensionPackage = JSON.parse(manifest.toString('utf8'))
    requireEqual(`${file} manifest name`, packageJson.name, extensionPackage.name)
    requireEqual(`${file} manifest publisher`, packageJson.publisher, extensionPackage.publisher)
    requireEqual(`${file} manifest version`, version, extensionPackage.version)
  } catch (error) {
    errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (errors.length) {
  console.error('Release consistency check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log(`Release consistency check passed for ${packageJson.name} ${version} (${vsixFiles.length} VSIX)`)
}
