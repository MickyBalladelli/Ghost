import type { LocalToolName } from '../agent/toolCallParser'
import { GHOST_POLICY } from '../ghostPolicy'

const continuation = (toolName: LocalToolName, value: string): string => {
  if (toolName === 'ghost_read_file') {
    const existingHint = value.match(/\[File output truncated\.[\s\S]*?\]/)?.[0]
    return existingHint ?? 'Read the next file chunk with ghost_read_file using startLine and endLine.'
  }
  if (toolName === 'ghost_list_directory') {
    return 'Call ghost_list_directory on a narrower directory or use a non-recursive listing.'
  }
  if (toolName === 'ghost_run_terminal_command') {
    return 'Run a narrower inspection command, such as head, tail, or a filtered search.'
  }
  return 'Inspect the affected file with ghost_read_file before continuing.'
}

export function limitToolResultText(toolName: LocalToolName, value: string): string {
  const limit = GHOST_POLICY.agent.toolResultCharacterLimits[toolName]
  if (value.length <= limit) {
    return value
  }
  const bytes = Buffer.byteLength(value, 'utf8')
  const metadata = `Tool result truncated for ${toolName}.\nbytes: ${bytes}\ncontinuation: ${continuation(toolName, value)}\nhead:\n`
  const tailLabel = '\n\ntail:\n'
  const remainingCharacters = Math.max(256, limit - metadata.length - tailLabel.length - 40)
  const headCharacters = Math.floor(remainingCharacters * 0.62)
  const tailCharacters = Math.max(128, remainingCharacters - headCharacters)
  return `${metadata}${value.slice(0, headCharacters)}${tailLabel}${value.slice(-tailCharacters)}`
}
