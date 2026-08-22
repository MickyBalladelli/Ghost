const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const packagePath = path.join(root, 'package.json')
const configPath = path.join(root, 'src', 'config.ts')
const migrationsPath = path.join(root, 'src', 'settingsMigrations.ts')
const outputPath = path.join(root, 'docs', 'configuration.md')
const undefinedValue = Symbol('undefined')

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const configurationProperties = packageJson.contributes?.configuration?.properties ?? {}

function sourceFile(filePath) {
  return ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

const sourceFiles = [sourceFile(configPath), sourceFile(migrationsPath)]
const declarations = new Map()

for (const file of sourceFiles) {
  file.forEachChild(node => {
    if (!ts.isVariableStatement(node)) return
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        declarations.set(declaration.name.text, declaration.initializer)
      }
    }
  })
}

function evaluate(node, resolving = new Set()) {
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node)) {
    return evaluate(node.expression, resolving)
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isIdentifier(node)) {
    if (node.text === 'undefined') return undefinedValue
    const initializer = declarations.get(node.text)
    if (!initializer || resolving.has(node.text)) return undefinedValue
    const nextResolving = new Set(resolving)
    nextResolving.add(node.text)
    return evaluate(initializer, nextResolving)
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const value = evaluate(node.operand, resolving)
    return typeof value === 'number' ? -value : undefinedValue
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap(element => {
      if (ts.isSpreadElement(element)) {
        const value = evaluate(element.expression, resolving)
        return Array.isArray(value) ? value : []
      }
      const value = evaluate(element, resolving)
      return value === undefinedValue ? [] : [value]
    })
  }
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.flatMap(property => {
      if (!ts.isPropertyAssignment(property)) return []
      const name = property.name
      const key = ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
      if (!key) return []
      const value = evaluate(property.initializer, resolving)
      return [[key, value]]
    }))
  }
  return undefinedValue
}

const defaultDeclaration = declarations.get('DEFAULT_GHOST_SETTINGS')
if (!defaultDeclaration) {
  throw new Error('Could not find DEFAULT_GHOST_SETTINGS in src/config.ts')
}

const sourceDefaults = evaluate(defaultDeclaration)
const sourceSettingNames = new Set(Object.keys(sourceDefaults))
const packageSettingNames = new Set(Object.keys(configurationProperties).map(name => name.replace(/^ghost\./, '')))
const missingInPackage = [...sourceSettingNames].filter(name => !packageSettingNames.has(name))
const missingInSource = [...packageSettingNames].filter(name => !sourceSettingNames.has(name))

function sameValue(left, right) {
  if (left === undefinedValue || right === undefinedValue) return left === right
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]))
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length && leftKeys.every(key => sameValue(left[key], right[key]))
  }
  return left === right
}

const mismatches = []
for (const [name, property] of Object.entries(configurationProperties)) {
  const setting = name.replace(/^ghost\./, '')
  const packageDefault = Object.prototype.hasOwnProperty.call(property, 'default') ? property.default : undefinedValue
  if (!sameValue(sourceDefaults[setting], packageDefault)) {
    mismatches.push(`${name}: package default ${formatValue(packageDefault)} does not match src/config.ts default ${formatValue(sourceDefaults[setting])}`)
  }
}

if (missingInPackage.length || missingInSource.length || mismatches.length) {
  const details = [
    ...missingInPackage.map(name => `${name}: present in src/config.ts but missing from package.json`),
    ...missingInSource.map(name => `${name}: present in package.json but missing from src/config.ts`),
    ...mismatches
  ]
  throw new Error(`Configuration drift detected:\n${details.join('\n')}`)
}

function formatValue(value) {
  if (value === undefinedValue) return 'not set'
  if (typeof value === 'string') return value ? `\`${value.replaceAll('`', '\\`')}\`` : 'empty'
  if (Array.isArray(value) || (value && typeof value === 'object')) return `\`${JSON.stringify(value)}\``
  return `\`${String(value)}\``
}

function formatType(property) {
  const type = property.type ?? (property.default === undefined ? 'object' : typeof property.default)
  const constraints = []
  if (Array.isArray(property.enum)) constraints.push(`one of ${property.enum.map(value => `\`${value}\``).join(', ')}`)
  if (typeof property.minimum === 'number') constraints.push(`min ${property.minimum}`)
  if (typeof property.maximum === 'number') constraints.push(`max ${property.maximum}`)
  return [type, ...constraints].join('; ')
}

function formatDescription(property) {
  return (property.markdownDescription ?? property.description ?? 'No description.').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

const categories = ['Provider', 'Models and generation', 'Agent safety', 'Persistence and diagnostics', 'Advanced']

function categoryForName(name) {
  if (/^(provider|ollamaUrl|mlxUrl|openai|openCode)/.test(name)) return 'Provider'
  if (/^(chatModel|autocompleteModel|inlineCompletionTimeoutMs|temperature|topP|topK|minP|presencePenalty|repeatPenalty|seed|stopSequences|contextWindow|grammar|jsonMode|modelProfile|modelAliases|modelProfiles|maxContextTokens|responseLength|enableInlineCompletions)$/.test(name)) return 'Models and generation'
  if (/^(mode|fileEditApproval|autoAcceptScope|tool|terminalEnvironment|requestTimeLimitMinutes)$/.test(name)) return 'Agent safety'
  if (/^(enableConversationPersistence|enableDebugLogging|logLevel)$/.test(name)) return 'Persistence and diagnostics'
  return 'Advanced'
}

const sections = categories.map(title => {
  const properties = Object.entries(configurationProperties).filter(([name]) => categoryForName(name.replace(/^ghost\./, '')) === title)
  if (!properties.length) return ''
  const lines = [`## ${title}`, '', '| Setting | Type | Default | Description |', '| --- | --- | --- | --- |']
  for (const [name, property] of properties) {
    const defaultValue = Object.prototype.hasOwnProperty.call(property, 'default') ? property.default : undefinedValue
    lines.push(`| \`${name}\` | ${formatType(property)} | ${formatValue(defaultValue)} | ${formatDescription(property)} |`)
  }
  return lines.join('\n')
}).filter(Boolean)

const output = [
  '# Ghost configuration reference',
  '',
  '<!-- Generated from package.json by `npm run docs:config`. Do not edit by hand. -->',
  '',
  `Package version: \`${packageJson.version}\`.`,
  '',
  'Defaults and descriptions below come from the VS Code extension manifest. The generator checks every manifest default against `DEFAULT_GHOST_SETTINGS` in `src/config.ts` and fails when they drift.',
  '',
  ...sections.flatMap(section => [section, ''])
].join('\n').trimEnd() + '\n'

fs.writeFileSync(outputPath, output)
console.log(`Wrote ${path.relative(root, outputPath)} (${Object.keys(configurationProperties).length} settings)`)
