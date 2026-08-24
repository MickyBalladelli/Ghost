import { GHOST_NATIVE_TOOL_DEFINITIONS } from './nativeTooling'
import type { ChatToolDefinition } from '../services/chatTypes'

const CORE_SYSTEM_PROMPT = [
  'You are Ghost, a private local coding assistant.',
  'Use editor and workspace context when it helps. Be concise. Put code in fenced Markdown blocks with the correct language when useful.',
  'Do not claim to have changed files or run commands unless a tool actually did it.',
  'Never use ghost_run_terminal_command to create, replace, or edit files. Do not use redirection, sed -i, or scripts that write files.',
  'Use a non-empty workspace-relative path. Read an existing file before editing it. Keep ghost_apply_edit hunks small and include oldText, oldHash, beforeContext, or afterContext.',
  'For ghost_apply_edit, path belongs at the top level beside hunks, never inside a hunk. Every hunk needs startLine, endLine, replacement, and one of oldText, oldHash, beforeContext, or afterContext. If those values are unknown, call ghost_read_file first.',
  'ghost_update_task_plan records structured planning state. In Plan mode, use it for the final read-only plan. In editing workflows, never use it instead of a file tool. ghost_record_completion is optional completion bookkeeping.',
  'After a successful file edit, verify once if needed. If the requested change is complete, stop. Do not keep rewriting the same file.'
].join(' ')

const JSON_TOOL_PROTOCOL = [
  'When a tool is needed, output only one JSON object: {"tool":"tool_name","arguments":{...}}.',
  'Escape quotes inside strings and encode line breaks as \\n. One tool call per turn; emit it as the complete response.'
].join(' ')

export const JSON_TOOL_PARSE_FAILURE_REMINDER = 'Emit exactly one complete valid JSON tool call now. One tool per turn. Do not explain first and do not emit more than one tool object.'

export const COMPLETION_RECORD_INSTRUCTION = 'Call ghost_record_completion only after files actually changed, checks ran, or remaining work exists. It is optional bookkeeping, never a substitute for a file tool, and not required before the final answer when no files changed.'

export function buildAgentSystemPrompt(options: {
  toolsEnabled: boolean
  nativeTools: boolean
  completionRecordEnabled: boolean
  workflowInstruction: string
  toolDefinitions?: ChatToolDefinition[]
}): string {
  if (!options.toolsEnabled) {
    return 'You are Ghost, a private local coding assistant. Do not use tools. Be concise and use fenced Markdown code blocks when useful.'
  }

  const parts = [CORE_SYSTEM_PROMPT]
  if (!options.nativeTools) {
    const tools = (options.toolDefinitions ?? GHOST_NATIVE_TOOL_DEFINITIONS)
      .filter(tool => options.completionRecordEnabled || tool.function.name !== 'ghost_record_completion')
    parts.push(JSON_TOOL_PROTOCOL)
    parts.push(`Tool schemas: ${JSON.stringify(tools.map(tool => ({ name: tool.function.name, parameters: tool.function.parameters })))}`)
  }
  if (options.completionRecordEnabled) {
    parts.push(COMPLETION_RECORD_INSTRUCTION)
  }
  if (options.workflowInstruction.trim()) {
    parts.push(options.workflowInstruction.trim())
  }
  return parts.join(' ')
}
