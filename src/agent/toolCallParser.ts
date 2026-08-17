export const LOCAL_TOOL_NAMES = [
  'ghost_read_file',
  'ghost_search_workspace',
  'ghost_get_diagnostics',
  'ghost_git_context',
  'ghost_write_file',
  'ghost_apply_edit',
  'ghost_apply_transaction',
  'ghost_run_terminal_command',
  'ghost_list_directory'
] as const

export type LocalToolName = typeof LOCAL_TOOL_NAMES[number]

const LOCAL_TOOL_ALIASES: Record<string, LocalToolName> = {
  read_file: 'ghost_read_file',
  search_workspace: 'ghost_search_workspace',
  get_diagnostics: 'ghost_get_diagnostics',
  git_context: 'ghost_git_context',
  write_file: 'ghost_write_file',
  apply_edit: 'ghost_apply_edit',
  apply_transaction: 'ghost_apply_transaction',
  run_terminal_command: 'ghost_run_terminal_command',
  list_directory: 'ghost_list_directory',
  ghostreadfile: 'ghost_read_file',
  ghostsearchworkspace: 'ghost_search_workspace',
  ghostgetdiagnostics: 'ghost_get_diagnostics',
  ghostgitcontext: 'ghost_git_context',
  ghostwritefile: 'ghost_write_file',
  ghostapplyedit: 'ghost_apply_edit',
  ghostapplytransaction: 'ghost_apply_transaction',
  ghostrunterminalcommand: 'ghost_run_terminal_command',
  ghostlistdirectory: 'ghost_list_directory'
}

export interface LocalToolCall {
  name: LocalToolName
  arguments: Record<string, unknown>
}

function isLocalToolName(value: unknown): value is LocalToolName {
  return typeof value === 'string' && (LOCAL_TOOL_NAMES as readonly string[]).includes(value)
}

function normalizeLocalToolName(value: unknown): LocalToolName | undefined {
  if (isLocalToolName(value)) {
    return value
  }

  return typeof value === 'string' ? LOCAL_TOOL_ALIASES[value.toLowerCase()] : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getJsonCandidates(text: string): string[] {
  const candidates: string[] = []

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') {
      continue
    }

    let depth = 0
    let inString = false
    let escaped = false

    for (let end = start; end < text.length; end += 1) {
      const character = text[end]

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (character === '\\') {
          escaped = true
        } else if (character === '"') {
          inString = false
        }
        continue
      }

      if (character === '"') {
        inString = true
      } else if (character === '{') {
        depth += 1
      } else if (character === '}') {
        depth -= 1

        if (depth === 0) {
          candidates.push(text.slice(start, end + 1))
          start = end
          break
        }
      }
    }
  }

  return candidates
}

function parseArguments(value: unknown): Record<string, unknown> | undefined {
  if (isObject(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return undefined
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return isObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function normalizeToolArguments(name: LocalToolName, value: Record<string, unknown>): Record<string, unknown> {
  const argumentsCopy = { ...value }
  const aliases: Record<string, string[]> = {
    path: ['filePath', 'file_path', 'filename', 'file'],
    content: ['contents', 'text', 'body', 'code'],
    command: ['cmd']
  }

  for (const [key, candidates] of Object.entries(aliases)) {
    if (argumentsCopy[key] !== undefined) {
      continue
    }
    const alias = candidates.find(candidate => argumentsCopy[candidate] !== undefined)
    if (alias) {
      argumentsCopy[key] = argumentsCopy[alias]
    }
  }

  return argumentsCopy
}

function parseCandidate(value: unknown): LocalToolCall | undefined {
  if (!isObject(value)) {
    return undefined
  }

  const nested = isObject(value.tool_call)
    ? value.tool_call
    : isObject(value.toolCall)
      ? value.toolCall
      : isObject(value.function)
        ? value.function
        : value
  const name = normalizeLocalToolName(nested.name ?? nested.tool ?? nested.tool_name)
  const rawArguments = nested.arguments ?? nested.parameters ?? nested.input

  if (!name) {
    return undefined
  }

  return {
    name,
    arguments: normalizeToolArguments(
      name,
      parseArguments(rawArguments) ?? Object.fromEntries(
        Object.entries(nested).filter(([key]) => !['name', 'tool', 'tool_name'].includes(key))
      )
    )
  }
}

function parseLooseToolName(text: string): LocalToolName | undefined {
  const match = /["'](?:tool|name|tool_name)["']\s*:\s*["']?([A-Za-z0-9_-]+)/.exec(text)
  return normalizeLocalToolName(match?.[1])
}

function decodeLooseString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    return value
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
  }
}

function escapeRawJsonStringControls(value: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (const character of value) {
    if (inString) {
      if (escaped) {
        result += character
        escaped = false
        continue
      }
      if (character === '\\') {
        result += character
        escaped = true
        continue
      }
      if (character === '"') {
        result += character
        inString = false
        continue
      }
      if (character === '\n') {
        result += '\\n'
        continue
      }
      if (character === '\r') {
        result += '\\r'
        continue
      }
      if (character === '\t') {
        result += '\\t'
        continue
      }
      result += character
      continue
    }

    result += character
    if (character === '"') {
      inString = true
    }
  }

  return result
}

function parseLooseWriteFile(text: string): LocalToolCall | undefined {
  if (parseLooseToolName(text) !== 'ghost_write_file') {
    return undefined
  }

  const pathMatch = /["']path["']\s*:\s*"([^"]+)"/.exec(text)
  const contentMarker = /["']content["']\s*:\s*"/.exec(text)
  if (!pathMatch || !contentMarker || contentMarker.index === undefined) {
    return undefined
  }

  const contentStart = contentMarker.index + contentMarker[0].length
  const remaining = text.slice(contentStart)
  const closingMatches = [...remaining.matchAll(/"\s*}\s*}/g)]
  const closingContent = closingMatches.at(-1)
  const rawContent = closingContent?.index === undefined
    ? remaining.replace(/\s*```[\s\S]*$/, '').trimEnd()
    : remaining.slice(0, closingContent.index)
  if (!rawContent) {
    return undefined
  }
  return {
    name: 'ghost_write_file',
    arguments: {
      path: decodeLooseString(pathMatch[1]),
      content: decodeLooseString(rawContent)
    }
  }
}

function parseLooseApplyEdit(text: string): LocalToolCall | undefined {
  if (parseLooseToolName(text) !== 'ghost_apply_edit') {
    return undefined
  }

  const pathMatch = /["']path["']\s*:\s*"((?:\\.|[^"])*)"/.exec(text)
  const startLineMatch = /["']startLine["']\s*:\s*(\d+)/.exec(text)
  const endLineMatch = /["']endLine["']\s*:\s*(\d+)/.exec(text)
  const replacementMarker = /["']replacement["']\s*:\s*"/.exec(text)
  if (!pathMatch || !startLineMatch || !endLineMatch || !replacementMarker || replacementMarker.index === undefined) {
    return undefined
  }

  const replacementStart = replacementMarker.index + replacementMarker[0].length
  const remaining = text.slice(replacementStart)
  const closingMatches = [...remaining.matchAll(/"\s*}\s*]\s*}\s*}/g)]
  const closing = closingMatches.at(-1)
  if (closing?.index === undefined) {
    return undefined
  }

  return {
    name: 'ghost_apply_edit',
    arguments: {
      path: decodeLooseString(pathMatch[1]),
      hunks: [{
        startLine: Number(startLineMatch[1]),
        endLine: Number(endLineMatch[1]),
        replacement: decodeLooseString(remaining.slice(0, closing.index))
      }]
    }
  }
}

export function hasLocalToolCallIntent(text: string): boolean {
  return parseLooseToolName(text) !== undefined
}

export function parseLocalToolCall(text: string): LocalToolCall | undefined {
  for (const candidate of getJsonCandidates(text)) {
    try {
      const call = parseCandidate(JSON.parse(candidate) as unknown)

      if (call) {
        return call
      }
    } catch {
      try {
        const repaired = parseCandidate(JSON.parse(escapeRawJsonStringControls(candidate)) as unknown)

        if (repaired) {
          return repaired
        }
      } catch {
        // Continue searching if the model emitted another JSON object first.
      }
    }
  }

  return parseLooseWriteFile(text) ?? parseLooseApplyEdit(text)
}
