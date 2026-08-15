export const LOCAL_TOOL_NAMES = [
  'ghostpilot_read_file',
  'ghostpilot_write_file',
  'ghostpilot_run_terminal_command',
  'ghostpilot_list_directory'
] as const

export type LocalToolName = typeof LOCAL_TOOL_NAMES[number]

export interface LocalToolCall {
  name: LocalToolName
  arguments: Record<string, unknown>
}

function isLocalToolName(value: unknown): value is LocalToolName {
  return typeof value === 'string' && (LOCAL_TOOL_NAMES as readonly string[]).includes(value)
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
  const name = nested.name ?? nested.tool ?? nested.tool_name
  const args = nested.arguments ?? nested.parameters ?? nested.input

  if (!isLocalToolName(name)) {
    return undefined
  }

  return {
    name,
    arguments: parseArguments(args) ?? {}
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

  return undefined
}
