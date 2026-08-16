export const LOCAL_TOOL_NAMES = [
  'ghost_read_file',
  'ghost_write_file',
  'ghost_apply_edit',
  'ghost_run_terminal_command',
  'ghost_list_directory'
] as const

export type LocalToolName = typeof LOCAL_TOOL_NAMES[number]

const LOCAL_TOOL_ALIASES: Record<string, LocalToolName> = {
  ghostreadfile: 'ghost_read_file',
  ghostwritefile: 'ghost_write_file',
  ghostapplyedit: 'ghost_apply_edit',
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
  const args = nested.arguments ?? nested.parameters ?? nested.input

  if (!name) {
    return undefined
  }

  return {
    name,
    arguments: parseArguments(args) ?? {}
  }
}

function parseLooseToolName(text: string): LocalToolName | undefined {
  const match = /["'](?:tool|name|tool_name)["']\s*:\s*["']?([A-Za-z0-9_-]+)/.exec(text)
  return normalizeLocalToolName(match?.[1])
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
  const content = rawContent.includes('\n')
    ? rawContent
    : (() => {
        try {
          return JSON.parse(`"${rawContent}"`) as string
        } catch {
          return rawContent.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
        }
      })()

  return {
    name: 'ghost_write_file',
    arguments: {
      path: pathMatch[1],
      content
    }
  }
}

export function parseLocalToolCall(text: string): LocalToolCall | undefined {
  for (const candidate of getJsonCandidates(text)) {
    try {
      const call = parseCandidate(JSON.parse(candidate) as unknown)

      if (call) {
        return call
      }
    } catch {
      // Continue searching if the model emitted another JSON object first.
    }
  }

  return parseLooseWriteFile(text)
}
