import * as path from 'node:path'

import { LocalToolCall } from './toolCallParser'

type Arguments = Record<string, unknown>

const PATH_ALIASES = ['filePath', 'file_path', 'filename', 'file']
const CONTENT_ALIASES = ['contents', 'text', 'body', 'code']
const COMMAND_ALIASES = ['cmd']

const isRecord = (value: unknown): value is Arguments => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const invalid = (field: string, expectation: string): string => (
  `Invalid field '${field}': ${expectation}`
)

const missing = (field: string): string => `Missing required field '${field}'.`

function checkAllowedFields(input: Arguments, fields: readonly string[]): string | undefined {
  const allowed = new Set(fields)
  const unknown = Object.keys(input).find(field => !allowed.has(field))
  return unknown ? invalid(unknown, 'field is not allowed.') : undefined
}

function requiredString(input: Arguments, field: string, options: { absolute?: boolean; maxLength?: number; allowEmpty?: boolean } = {}): string | undefined {
  if (!(field in input)) return missing(field)
  if (typeof input[field] !== 'string' || (!options.allowEmpty && !input[field].trim())) {
    return invalid(field, 'expected a non-empty string.')
  }
  if (options.absolute && !path.isAbsolute(input[field] as string)) {
    return invalid(field, 'expected a non-empty absolute workspace path.')
  }
  if (options.maxLength !== undefined && (input[field] as string).length > options.maxLength) {
    return invalid(field, `must be at most ${options.maxLength} characters.`)
  }
  return undefined
}

function optionalString(input: Arguments, field: string, maxLength?: number): string | undefined {
  if (!(field in input)) return undefined
  if (typeof input[field] !== 'string') return invalid(field, 'expected a string.')
  if (maxLength !== undefined && (input[field] as string).length > maxLength) {
    return invalid(field, `must be at most ${maxLength} characters.`)
  }
  return undefined
}

function optionalNonEmptyString(input: Arguments, field: string, maxLength?: number): string | undefined {
  const result = optionalString(input, field, maxLength)
  if (result || !(field in input)) return result
  return !(input[field] as string).trim() ? invalid(field, 'expected a non-empty string.') : undefined
}

function optionalBoolean(input: Arguments, field: string): string | undefined {
  return field in input && typeof input[field] !== 'boolean'
    ? invalid(field, 'expected a boolean.')
    : undefined
}

function optionalInteger(input: Arguments, field: string, minimum: number, maximum?: number): string | undefined {
  if (!(field in input)) return undefined
  const value = input[field]
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return invalid(field, 'expected an integer.')
  }
  if (value < minimum) return invalid(field, `must be at least ${minimum}.`)
  if (maximum !== undefined && value > maximum) return invalid(field, `must be at most ${maximum}.`)
  return undefined
}

function optionalEnum(input: Arguments, field: string, values: readonly string[]): string | undefined {
  if (!(field in input)) return undefined
  if (typeof input[field] !== 'string' || !values.includes(input[field])) {
    return invalid(field, `expected one of: ${values.join(', ')}.`)
  }
  return undefined
}

function requiredArray(input: Arguments, field: string, minimum: number, maximum: number): string | undefined {
  if (!(field in input)) return missing(field)
  if (!Array.isArray(input[field])) return invalid(field, 'expected an array.')
  if (input[field].length < minimum) return invalid(field, `must contain at least ${minimum} item${minimum === 1 ? '' : 's'}.`)
  if (input[field].length > maximum) return invalid(field, `must contain at most ${maximum} items.`)
  return undefined
}

function optionalArray(input: Arguments, field: string, maximum: number): string | undefined {
  if (!(field in input)) return undefined
  if (!Array.isArray(input[field])) return invalid(field, 'expected an array.')
  if (input[field].length > maximum) return invalid(field, `must contain at most ${maximum} items.`)
  return undefined
}

function validateHunk(value: unknown, field: string, expectedContentPresent: boolean): string | undefined {
  if (!isRecord(value)) return invalid(field, 'expected an object.')
  const allowed = checkAllowedFields(value, ['startLine', 'endLine', 'replacement', 'oldText', 'oldHash', 'beforeContext', 'afterContext'])
  if (allowed) return allowed
  for (const [name, minimum] of [['startLine', 1], ['endLine', 1]] as const) {
    if (!(name in value)) return missing(`${field}.${name}`)
    const result = optionalInteger(value, name, minimum)
    if (result) return invalid(`${field}.${name}`, result.replace(`Invalid field '${name}': `, ''))
  }
  if ((value.endLine as number) < (value.startLine as number)) {
    return invalid(`${field}.endLine`, 'must be greater than or equal to startLine.')
  }
  if (typeof value.replacement !== 'string') return invalid(`${field}.replacement`, 'expected a string.')

  for (const name of ['oldText', 'beforeContext', 'afterContext']) {
    const result = optionalString(value, name, 10000)
    if (result) return result.replace(`'${name}'`, `'${field}.${name}'`)
  }
  if ('oldHash' in value && (typeof value.oldHash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.oldHash))) {
    return invalid(`${field}.oldHash`, 'expected a 64-character SHA-256 hash.')
  }
  if (!expectedContentPresent && !('oldText' in value) && !('oldHash' in value) && !('beforeContext' in value) && !('afterContext' in value)) {
    return invalid(field, 'must include oldText, oldHash, beforeContext, or afterContext.')
  }
  return undefined
}

function validateHunks(input: Arguments, field: string, expectedContentPresent: boolean): string | undefined {
  const result = requiredArray(input, field, 1, 50)
  if (result) return result
  for (const [index, hunk] of (input[field] as unknown[]).entries()) {
    const hunkResult = validateHunk(hunk, `${field}[${index}]`, expectedContentPresent)
    if (hunkResult) return hunkResult
  }
  return undefined
}

function validateReadFile(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['path', ...PATH_ALIASES, 'source', 'allowSpecialFile', 'mode', 'startLine', 'endLine', 'lineCount', 'startByte', 'endByte', 'symbol', 'match', 'caseSensitive', 'maxMatches'])
  if (allowed) return allowed
  return requiredString(input, 'path', { absolute: true })
    ?? optionalEnum(input, 'source', ['editor', 'disk'])
    ?? optionalBoolean(input, 'allowSpecialFile')
    ?? optionalEnum(input, 'mode', ['head', 'tail', 'lines', 'bytes', 'symbol', 'matches'])
    ?? optionalInteger(input, 'startLine', 1)
    ?? optionalInteger(input, 'endLine', 1)
    ?? optionalInteger(input, 'lineCount', 1, 400)
    ?? optionalInteger(input, 'startByte', 0)
    ?? optionalInteger(input, 'endByte', 0)
    ?? optionalNonEmptyString(input, 'symbol')
    ?? optionalNonEmptyString(input, 'match')
    ?? optionalBoolean(input, 'caseSensitive')
    ?? optionalInteger(input, 'maxMatches', 1, 200)
}

function validateSearch(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['query', 'path', 'glob', 'caseSensitive', 'maxResults'])
  if (allowed) return allowed
  return requiredString(input, 'query', { maxLength: 1000 })
    ?? optionalString(input, 'path')
    ?? optionalString(input, 'glob')
    ?? optionalBoolean(input, 'caseSensitive')
    ?? optionalInteger(input, 'maxResults', 1, 200)
}

function validateDiagnostics(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['path', 'severity', 'maxResults'])
  if (allowed) return allowed
  return optionalNonEmptyString(input, 'path')
    ?? optionalEnum(input, 'severity', ['error', 'warning', 'information', 'hint'])
    ?? optionalInteger(input, 'maxResults', 1, 200)
}

function validateGit(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['operation', 'path', 'maxEntries'])
  if (allowed) return allowed
  return requiredString(input, 'operation')
    ?? optionalEnum(input, 'operation', ['status', 'diff', 'stagedDiff', 'branch', 'history'])
    ?? optionalNonEmptyString(input, 'path')
    ?? optionalInteger(input, 'maxEntries', 1, 200)
}

function validateTaskPlan(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['steps', 'currentStep', 'blockedReason', 'completionEvidence'])
  if (allowed) return allowed
  const stepsResult = requiredArray(input, 'steps', 1, 50)
  if (stepsResult) return stepsResult
  for (const [index, step] of (input.steps as unknown[]).entries()) {
    const field = `steps[${index}]`
    if (!isRecord(step)) return invalid(field, 'expected an object.')
    const stepAllowed = checkAllowedFields(step, ['id', 'title', 'checked', 'evidence'])
    if (stepAllowed) return stepAllowed.replace("Invalid field '", `Invalid field '${field}.`)
    const idResult = requiredString(step, 'id', { maxLength: 100 })
    if (idResult) return idResult.replace("Invalid field '", `Invalid field '${field}.`)
    const titleResult = requiredString(step, 'title', { maxLength: 500 })
    if (titleResult) return titleResult.replace("Invalid field '", `Invalid field '${field}.`)
    if (!('checked' in step)) return missing(`${field}.checked`)
    if (typeof step.checked !== 'boolean') return invalid(`${field}.checked`, 'expected a boolean.')
    const evidenceResult = optionalString(step, 'evidence', 1000)
    if (evidenceResult) return evidenceResult.replace("Invalid field '", `Invalid field '${field}.`)
  }
  return optionalString(input, 'currentStep', 100)
    ?? optionalString(input, 'blockedReason', 1000)
    ?? optionalArray(input, 'completionEvidence', 10)
    ?? (Array.isArray(input.completionEvidence)
      ? input.completionEvidence.reduce<string | undefined>((error, value, index) => error ?? (typeof value !== 'string'
        ? invalid(`completionEvidence[${index}]`, 'expected a string.')
        : value.length > 1000
          ? invalid(`completionEvidence[${index}]`, 'must be at most 1000 characters.')
          : undefined), undefined)
      : undefined)
}

function validateCompletion(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['changedFiles', 'checksRun', 'failures', 'remainingWork'])
  if (allowed) return allowed
  for (const field of ['changedFiles', 'checksRun', 'failures', 'remainingWork']) {
    const result = requiredArray(input, field, 0, 100)
    if (result) return result
    for (const [index, value] of (input[field] as unknown[]).entries()) {
      if (typeof value !== 'string') return invalid(`${field}[${index}]`, 'expected a string.')
      if (value.length > 2000) return invalid(`${field}[${index}]`, 'must be at most 2000 characters.')
    }
  }
  return undefined
}

function validateWrite(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['path', ...PATH_ALIASES, 'content', ...CONTENT_ALIASES])
  if (allowed) return allowed
  return requiredString(input, 'path', { absolute: true })
    ?? requiredString(input, 'content', { allowEmpty: true })
}

function validateEdit(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['path', ...PATH_ALIASES, 'expectedContent', 'hunks'])
  if (allowed) return allowed
  const pathResult = requiredString(input, 'path', { absolute: true })
  if (pathResult) return pathResult
  const expectedContentResult = optionalString(input, 'expectedContent')
  if (expectedContentResult) return expectedContentResult
  return validateHunks(input, 'hunks', 'expectedContent' in input)
}

function validateTransaction(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['edits'])
  if (allowed) return allowed
  const editsResult = requiredArray(input, 'edits', 2, 50)
  if (editsResult) return editsResult
  for (const [index, value] of (input.edits as unknown[]).entries()) {
    const field = `edits[${index}]`
    if (!isRecord(value)) return invalid(field, 'expected an object.')
    const editAllowed = checkAllowedFields(value, ['path', ...PATH_ALIASES, 'content', ...CONTENT_ALIASES, 'expectedContent', 'hunks'])
    if (editAllowed) return editAllowed.replace("Invalid field '", `Invalid field '${field}.`)
    const pathResult = requiredString(value, 'path', { absolute: true })
    if (pathResult) return pathResult.replace("Invalid field '", `Invalid field '${field}.`)
    const expectedResult = optionalString(value, 'expectedContent')
    if (expectedResult) return expectedResult.replace("Invalid field '", `Invalid field '${field}.`)
    const hasContent = 'content' in value
    const hasHunks = 'hunks' in value
    if (hasContent === hasHunks) return invalid(field, 'must contain exactly one of content or hunks.')
    if (hasContent && typeof value.content !== 'string') return invalid(`${field}.content`, 'expected a string.')
    if (hasHunks) {
      const hunksResult = validateHunks(value, 'hunks', 'expectedContent' in value)
      if (hunksResult) return hunksResult.replace("'hunks", `'${field}.hunks`)
    }
  }
  return undefined
}

function validateTerminal(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['command', ...COMMAND_ALIASES, 'cwd'])
  if (allowed) return allowed
  return requiredString(input, 'command') ?? optionalString(input, 'cwd')
}

function validateDirectory(input: Arguments): string | undefined {
  const allowed = checkAllowedFields(input, ['path', ...PATH_ALIASES, 'recursive', 'cursor', 'pageSize', 'maxDepth'])
  if (allowed) return allowed
  return requiredString(input, 'path', { absolute: true })
    ?? optionalBoolean(input, 'recursive')
    ?? optionalString(input, 'cursor')
    ?? (typeof input.cursor === 'string' && !/^\d+$/.test(input.cursor) ? invalid('cursor', 'must contain only digits.') : undefined)
    ?? optionalInteger(input, 'pageSize', 1, 100)
    ?? optionalInteger(input, 'maxDepth', 0, 10)
}

const VALIDATORS: Record<LocalToolCall['name'], (input: Arguments) => string | undefined> = {
  ghost_read_file: validateReadFile,
  ghost_search_workspace: validateSearch,
  ghost_get_diagnostics: validateDiagnostics,
  ghost_git_context: validateGit,
  ghost_update_task_plan: validateTaskPlan,
  ghost_record_completion: validateCompletion,
  ghost_write_file: validateWrite,
  ghost_apply_edit: validateEdit,
  ghost_apply_transaction: validateTransaction,
  ghost_run_terminal_command: validateTerminal,
  ghost_list_directory: validateDirectory
}

export function validateLocalToolCall(call: LocalToolCall): string | undefined {
  if (!isRecord(call.arguments)) return 'Invalid tool arguments: expected an object.'
  return VALIDATORS[call.name](call.arguments)
}
