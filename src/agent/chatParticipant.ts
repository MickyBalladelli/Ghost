import * as vscode from 'vscode'
import { TextDecoder } from 'node:util'

import { LocalToolExecutor } from '../tools/localToolExecutor'
import { redactSensitiveText } from '../privacy/redact'
import { GhostConfig, GhostProvider, ghostConfig } from '../config'
import { LlmFactory } from '../services/llmFactory'
import { MlxClient, MlxMessage } from '../services/mlxClient'
import { OllamaClient } from '../services/ollamaClient'
import { GhostStatusBar } from '../ui/statusBar'
import { LocalToolCall, parseLocalToolCall } from './toolCallParser'

const CHAT_PARTICIPANT_ID = 'ghost.agent'
const DEFAULT_TEMPERATURE = 0.2

const SYSTEM_PROMPT = [
  'You are Ghost, a private local coding assistant.',
  'Use the supplied editor and workspace context when it helps answer the user.',
  'Be concise. Put code in fenced Markdown blocks with the correct language when useful.',
  'Do not claim to have changed files or run commands unless a tool actually did it.',
  'When a tool is needed, output only one JSON object in this exact shape: {"tool":"tool_name","arguments":{...}}.',
  'Tool JSON must be valid JSON: escape every quote inside a string and encode line breaks as \\n. Never put raw multiline text inside a JSON string.',
  'When using a tool, do not explain the plan first; emit the tool call as the complete response.',
  'Never use ghost_run_terminal_command to create, replace, or edit files. Do not use cat >, tee, heredocs, redirection, sed -i, or scripts that write files. If a file tool fails, inspect the tool result and retry with ghost_read_file, ghost_apply_edit, or ghost_write_file.',
  'Every file or directory tool call must include a non-empty absolute path inside the current workspace. Never omit path, use an empty path, or use a bare filename. Before writing or editing, read the target file first when it exists.',
  'Available tools: ghost_read_file({"path":"absolute workspace path"}), ghost_write_file({"path":"absolute workspace path","content":"full text"}), ghost_apply_edit({"path":"absolute workspace path","hunks":[{"startLine":1,"endLine":1,"replacement":"new text"}]}), ghost_run_terminal_command({"command":"bash or PowerShell command","cwd":"optional absolute workspace path"}), ghost_list_directory({"path":"absolute workspace path","recursive":false}).',
  'After receiving a tool result, continue the task and provide the final answer.'
].join(' ')

const MAX_TOOL_ROUNDS = 32
const MAX_TOOL_RESULT_CHARACTERS = 16000

function summarizeToolResult(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 600 ? `${compact.slice(0, 600)}…` : compact
}

function getToolArgumentError(call: LocalToolCall): string | undefined {
  const pathToolNames = new Set(['ghost_read_file', 'ghost_write_file', 'ghost_apply_edit', 'ghost_list_directory'])
  const requiredArgument = pathToolNames.has(call.name)
    ? 'path'
    : call.name === 'ghost_run_terminal_command'
      ? 'command'
      : undefined
  if (!requiredArgument) {
    return undefined
  }
  if (typeof call.arguments[requiredArgument] === 'string' && call.arguments[requiredArgument].trim()) {
    if (call.name !== 'ghost_run_terminal_command') {
      return undefined
    }

    const command = call.arguments.command as string
    const writesFiles = [
      /(?:^|[;&|]\s*)(?:cat|tee|printf|echo)\b[\s\S]*(?:>>?|<<-?)/i,
      /(?:>>?|<<-?)\s*["']?(?:\/|\.\/|[a-z]:[\\/])/i,
      /\b(?:sed|perl)\b[^;&|]*\s-i(?:\s|$)/i,
      /\b(?:python|python3|node|ruby|php)\b[\s\S]*(?:write_text|writeFile(?:Sync)?|open\s*\([^)]*["'][wa])/i
    ].some(pattern => pattern.test(command))

    if (writesFiles) {
      return 'Terminal file writes are disabled for workspace edits. Retry with one ghost_read_file, ghost_apply_edit, or ghost_write_file call. Use ghost_run_terminal_command only for inspection, builds, tests, or commands explicitly requested by the user.'
    }

    return undefined
  }
  return `Tool call rejected: ${call.name} requires a non-empty '${requiredArgument}'. Retry with one JSON tool call using the absolute path from the workspace context.`
}

export interface ChatParticipantOptions {
  configuration?: GhostConfig
  llmFactory?: LlmFactory
  toolExecutor?: LocalToolExecutor
  statusBar?: GhostStatusBar
}

export interface GhostContextSelection {
  workspace?: boolean
  folders?: boolean
  activeFile?: boolean
  selection?: boolean
  openFiles?: boolean
  tools?: boolean
}

export interface GhostRequestOptions {
  provider?: GhostProvider
  model?: string
  temperature?: number
  maxContextTokens?: number
  maxTokens?: number
  mode?: 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
  context?: GhostContextSelection
  additionalContext?: string
  showReasoning?: boolean
  customSystemInstructions?: string
  approveTool?: (call: LocalToolCall) => Promise<GhostToolApproval>
  confirmContinue?: (toolCallCount: number) => Promise<boolean>
}

export interface GhostToolApproval {
  decision: 'once' | 'session' | 'reject'
  arguments?: Record<string, unknown>
  expectedContent?: string
  alreadyApplied?: boolean
  appliedContent?: string
  selectedHunkIndexes?: number[]
  reason?: string
}

interface EditorContext {
  text: string
  filePath: string
  languageId: string
}

function createCancellationSignal(token: vscode.CancellationToken): {
  signal: AbortSignal
  dispose: () => void
} {
  const controller = new AbortController()
  const subscription = token.onCancellationRequested(() => controller.abort())

  if (token.isCancellationRequested) {
    controller.abort()
  }

  return {
    signal: controller.signal,
    dispose: () => subscription.dispose()
  }
}

export function truncateContext(text: string, maxTokens: number): string {
  const maxCharacters = Math.max(1000, maxTokens * 4)

  if (text.length <= maxCharacters) {
    return text
  }

  return `${text.slice(0, maxCharacters)}\n\n[Context truncated by Ghost]`
}

function getActiveEditorContext(maxContextTokens: number, includeSelection: boolean): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor

  if (!editor) {
    return undefined
  }

  const document = editor.document
  const selectedText = includeSelection ? document.getText(editor.selection) : ''
  const text = selectedText || document.getText()

  return {
    text: truncateContext(text, maxContextTokens),
    filePath: document.uri.fsPath,
    languageId: document.languageId
  }
}

function getWorkspaceContext(includeOpenFiles: boolean, includeFolders: boolean): string {
  const workspaceName = vscode.workspace.name ?? 'untitled workspace'
  const workspaceFolders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? []
  const openTabs = includeOpenFiles
    ? vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => tab.label))
    : []
  const terminals = vscode.window.terminals.map(terminal => terminal.name)

  return [
    `Workspace: ${workspaceName}`,
    `Workspace folders: ${includeFolders && workspaceFolders.length > 0 ? workspaceFolders.join(', ') : 'none'}`,
    `Open tabs: ${openTabs.length > 0 ? openTabs.join(', ') : 'none'}`,
    `Open terminals: ${terminals.length > 0 ? terminals.join(', ') : 'none'}`,
    'Terminal output: unavailable unless captured by an extension-owned terminal.'
  ].join('\n')
}

function getWorkspaceQuery(prompt: string): string[] {
  const match = /@workspace\b([^\n]*)/i.exec(prompt)

  if (!match?.[1]) {
    return []
  }

  return match[1]
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9._/-]{1,}/g)
    ?.slice(0, 5) ?? []
}

function escapeGlobToken(token: string): string {
  return token.replace(/[\\*?[\]{}]/g, '\\$&')
}

function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0)
}

function decodeText(bytes: Uint8Array): string | undefined {
  if (isBinary(bytes)) {
    return undefined
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

function getReferenceUri(value: unknown): { uri: vscode.Uri; range?: vscode.Range } | undefined {
  if (value instanceof vscode.Uri) {
    return { uri: value }
  }

  if (value && typeof value === 'object' && 'uri' in value) {
    const location = value as vscode.Location
    return { uri: location.uri, range: location.range }
  }

  if (typeof value === 'string' && value.startsWith('file://')) {
    return { uri: vscode.Uri.parse(value) }
  }

  return undefined
}

async function readTextFile(uri: vscode.Uri, range?: vscode.Range): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri)
    const text = decodeText(bytes)

    if (text === undefined) {
      return undefined
    }

    if (!range) {
      return text
    }

    return text
      .split(/\r?\n/)
      .slice(range.start.line, range.end.line + 1)
      .join('\n')
  } catch {
    return undefined
  }
}

async function findWorkspaceFiles(query: string, token: vscode.CancellationToken): Promise<vscode.Uri[]> {
  const folders = vscode.workspace.workspaceFolders ?? []
  const tokens = getWorkspaceQuery(query)
  const matches = new Map<string, vscode.Uri>()

  for (const folder of folders) {
    for (const searchToken of tokens) {
      if (token.isCancellationRequested) {
        return []
      }

      const pattern = new vscode.RelativePattern(folder, `**/*${escapeGlobToken(searchToken)}*`)
      const uris = await vscode.workspace.findFiles(pattern, '**/{node_modules,.git,out,dist}/**', 8)

      for (const uri of uris) {
        matches.set(uri.toString(), uri)
      }
    }
  }

  return [...matches.values()].slice(0, 12)
}

async function getWorkspaceSearchContext(
  prompt: string,
  maxContextTokens: number,
  token: vscode.CancellationToken
): Promise<string> {
  const query = getWorkspaceQuery(prompt)

  if (query.length === 0) {
    return ''
  }

  const files = await findWorkspaceFiles(prompt, token)
  const maxFileCharacters = Math.max(1000, Math.floor((maxContextTokens * 4) / Math.max(files.length, 1)))
  const sections: string[] = []

  for (const file of files) {
    const text = await readTextFile(file)

    if (text === undefined) {
      continue
    }

    sections.push(`File: ${file.fsPath}\n\n${truncateContext(text, Math.floor(maxFileCharacters / 4))}`)
  }

  return sections.length > 0
    ? `@workspace matches for ${query.join(', ')}:\n\n${sections.join('\n\n')}`
    : `@workspace found no readable files matching: ${query.join(', ')}`
}

async function getReferenceContext(
  request: vscode.ChatRequest,
  maxContextTokens: number,
  token: vscode.CancellationToken
): Promise<string> {
  if (request.references.length === 0) {
    return ''
  }

  const maxFileCharacters = Math.max(1000, Math.floor((maxContextTokens * 4) / request.references.length))
  const sections: string[] = []

  for (const reference of request.references) {
    if (token.isCancellationRequested) {
      return ''
    }

    const location = getReferenceUri(reference.value)

    if (location) {
      const text = await readTextFile(location.uri, location.range)

      if (text !== undefined) {
        sections.push(`Attached file: ${location.uri.fsPath}\n\n${truncateContext(text, Math.floor(maxFileCharacters / 4))}`)
        continue
      }
    }

    const label = typeof reference.value === 'string'
      ? reference.value
      : reference.modelDescription ?? reference.id
    sections.push(`Chat reference: ${label}`)
  }

  return sections.join('\n\n')
}

async function buildContextPrompt(
  request: vscode.ChatRequest,
  settings: ReturnType<GhostConfig['getSettings']>,
  token: vscode.CancellationToken,
  options: GhostRequestOptions = {},
  onProgress?: (detail: string) => void
): Promise<string> {
  const context = options.context ?? {}
  onProgress?.('Context: collecting prompt context')
  const editor = context.activeFile === false
    ? undefined
    : getActiveEditorContext(settings.maxContextTokens, context.selection !== false)
  if (editor) {
    onProgress?.('Context: reading active file')
  }
  const sections = [`User request:\n${request.prompt.trim()}`]

  if (editor) {
    const selectedLabel = vscode.window.activeTextEditor?.selection.isEmpty ? 'File content' : 'Selected text'
    sections.push(
      `Active file: ${editor.filePath}\nLanguage: ${editor.languageId}\n${selectedLabel}:\n\n\`\`\`${editor.languageId}\n${editor.text}\n\`\`\``
    )
  }

  if (context.workspace !== false) {
    onProgress?.('Context: preparing workspace context')
    sections.push(getWorkspaceContext(context.openFiles !== false, context.folders !== false))
  }

  let workspaceSearch = ''
  if (context.workspace !== false) {
    onProgress?.('Context: searching workspace')
    workspaceSearch = await getWorkspaceSearchContext(request.prompt, settings.maxContextTokens, token)
  }

  if (workspaceSearch) {
    sections.push(workspaceSearch)
  }

  onProgress?.('Context: preparing attachments')
  const references = await getReferenceContext(request, settings.maxContextTokens, token)

  if (references) {
    sections.push(references)
  }

  if (options.mode) {
    sections.unshift(`Workflow mode: ${options.mode}`)
  }

  if (options.additionalContext?.trim()) {
    sections.push(`Additional prompt context:\n${options.additionalContext.trim()}`)
  }

  return sections.join('\n\n')
}

function getRequestOptions(request: vscode.ChatRequest): GhostRequestOptions {
  const value = (request as vscode.ChatRequest & { ghost?: GhostRequestOptions }).ghost
  return value ?? {}
}

function createDefaultLlmFactory(configuration: GhostConfig): LlmFactory {
  const settings = configuration.getSettings()

  return new LlmFactory(
    {
      ollamaClient: new OllamaClient(settings.ollamaUrl, 'ollama'),
      mlxClient: new MlxClient(settings.mlxUrl),
      openaiCompatibleClient: new OllamaClient(settings.openaiUrl, 'openai-compatible')
    },
    {
      configuration: vscode.workspace.getConfiguration('ghost')
    }
  )
}

async function streamModelTurn(
  llmFactory: LlmFactory,
  options: Parameters<LlmFactory['streamChatCompletion']>[0],
  response: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  showReasoning = false,
  bufferForToolCall = false
): Promise<{ generated: string; streamed: boolean }> {
  let generated = ''
  let decided = false
  let bufferingToolCall = false
  let hidingReasoning = false
  let hiddenReasoningNotified = false

  const emitVisibleChunk = (chunk: string): void => {
    if (showReasoning) {
      response.markdown(chunk)
      return
    }
    let remaining = chunk
    while (remaining) {
      if (hidingReasoning) {
        const closing = remaining.search(/<\/(?:think|analysis)>/i)
        if (closing < 0) {
          return
        }
        remaining = remaining.slice(closing).replace(/^<\/(?:think|analysis)>/i, '')
        hidingReasoning = false
        continue
      }
      const opening = remaining.search(/<(?:think|analysis)>/i)
      if (opening < 0) {
        response.markdown(remaining)
        return
      }
      const visible = remaining.slice(0, opening)
      if (visible) {
        response.markdown(visible)
      }
      if (!hiddenReasoningNotified) {
        response.progress('Safe progress: provider reasoning hidden')
        hiddenReasoningNotified = true
      }
      remaining = remaining.slice(opening).replace(/^<(?:think|analysis)>/i, '')
      hidingReasoning = true
    }
  }

  for await (const chunk of llmFactory.streamChatCompletion(options)) {
    if (token.isCancellationRequested) {
      return { generated: '', streamed: false }
    }

    if (bufferForToolCall) {
      generated += chunk
      continue
    }

    if (decided && !bufferingToolCall) {
      emitVisibleChunk(chunk)
      continue
    }

    generated += chunk

    if (!decided) {
      const firstContent = generated.trimStart()

      if (firstContent.startsWith('{') || firstContent.startsWith('<tool_call>')) {
        decided = true
        bufferingToolCall = true
      } else if (firstContent) {
        decided = true
        emitVisibleChunk(generated)
        generated = ''
      }
    }
  }

  return { generated: generated.trim(), streamed: decided && !bufferingToolCall }
}

export function createChatParticipantHandler(
  options: ChatParticipantOptions = {}
): vscode.ChatRequestHandler {
  const configuration = options.configuration ?? ghostConfig
  const llmFactory = options.llmFactory ?? createDefaultLlmFactory(configuration)
  const toolExecutor = options.toolExecutor ?? new LocalToolExecutor()
  const statusBar = options.statusBar

  return async (request, _context, response, token) => {
    if (!request.prompt.trim()) {
      response.markdown('Ask me a coding question.')
      return
    }

    if (token.isCancellationRequested) {
      return
    }

    const settings = configuration.getSettings()
    const requestOptions = getRequestOptions(request)
    const effectiveSettings = {
      ...settings,
      maxContextTokens: Math.max(1, Math.floor(requestOptions.maxContextTokens ?? settings.maxContextTokens))
    }
    const contextPrompt = await buildContextPrompt(request, effectiveSettings, token, requestOptions, detail => response.progress(detail))

    if (token.isCancellationRequested) {
      return
    }

    const toolsEnabled = requestOptions.context?.tools !== false
    const workflowInstruction = requestOptions.mode === 'agent'
      ? '\n\nAgent mode is active. When the user asks you to implement, fix, edit, or change code, do the work in the workspace. Inspect files with tools, use ghost_apply_edit or ghost_write_file to make changes, and use ghost_run_terminal_command only for requested or useful verification. Never use the terminal to create or edit files. Do not only describe a hypothetical solution. Start with a tool call when a workspace change is needed, then continue until the task is complete.'
      : requestOptions.mode === 'edit'
        ? '\n\nEdit mode is active. When the user asks for a code change, inspect the relevant files and propose the actual workspace edit with ghost_apply_edit or ghost_write_file. Do not only describe what could be changed.'
        : ''
    const baseSystemPrompt = !toolsEnabled
      ? 'You are Ghost, a private local coding assistant. Do not use tools. Be concise and use fenced Markdown code blocks when useful.'
      : `${SYSTEM_PROMPT}${workflowInstruction}`
    const systemPrompt = requestOptions.customSystemInstructions?.trim()
      ? `${baseSystemPrompt}\n\nUser-provided system instructions:\n${requestOptions.customSystemInstructions.trim().slice(0, 8000)}`
      : baseSystemPrompt
    const messages: MlxMessage[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      { role: 'user', content: contextPrompt }
    ]
    const cancellation = createCancellationSignal(token)
    let finalStatus: 'ready' | 'offline' = 'ready'
    statusBar?.setStatus('generating')

    try {
      response.progress('Preparing model request')
      let toolCallCount = 0
      while (true) {
        const turn = await streamModelTurn(
          llmFactory,
          {
            provider: requestOptions.provider,
            model: requestOptions.model?.trim() || settings.chatModel,
            messages,
            temperature: Math.min(2, Math.max(0, requestOptions.temperature ?? settings.temperature ?? DEFAULT_TEMPERATURE)),
            maxTokens: requestOptions.maxTokens,
            signal: cancellation.signal
          },
          response,
          token,
          requestOptions.showReasoning === true,
          toolsEnabled
        )

        if (token.isCancellationRequested || turn.streamed) {
          return
        }

        const generated = turn.generated

        if (!generated) {
          response.progress('Provider returned an empty response')
          response.markdown('The provider returned no content. Check the model and connection, then retry.')
          return
        }

        const toolCall = parseLocalToolCall(generated)

        if (!toolCall) {
          response.markdown(generated)
          return
        }

        if (toolCallCount >= MAX_TOOL_ROUNDS) {
          const shouldContinue = requestOptions.confirmContinue
            ? await requestOptions.confirmContinue(toolCallCount)
            : await vscode.window.showWarningMessage(
                `Ghost reached ${MAX_TOOL_ROUNDS} tool calls. Continue working?`,
                { modal: true, detail: 'Choose Continue to allow another batch of tool calls, or Stop to end this request.' },
                'Continue',
                'Stop'
              ) === 'Continue'
          if (!shouldContinue) {
            response.markdown('Ghost stopped after reaching the tool-call limit.')
            return
          }
          toolCallCount = 0
        }
        toolCallCount += 1

        const toolArgumentError = getToolArgumentError(toolCall)
        if (toolArgumentError) {
          response.progress(`Invalid tool call: ${toolArgumentError}`)
          messages.push(
            { role: 'assistant', content: generated },
            { role: 'user', content: `Tool result for ${toolCall.name}:\n${toolArgumentError}` }
          )
          continue
        }

        response.progress(`Running ${toolCall.name}`)
        const approval = requestOptions.approveTool
          ? await requestOptions.approveTool(toolCall)
          : { decision: 'once' as const }
        if (token.isCancellationRequested) {
          return
        }
        if (approval.arguments) {
          toolCall.arguments = approval.arguments
        }
        const approvedToolArgumentError = getToolArgumentError(toolCall)
        if (approvedToolArgumentError) {
          response.progress(`Invalid tool call: ${approvedToolArgumentError}`)
          messages.push(
            { role: 'assistant', content: generated },
            { role: 'user', content: `Tool result for ${toolCall.name}:\n${approvedToolArgumentError}` }
          )
          continue
        }
        if (approval.decision === 'reject') {
          const rejection = approval.reason ?? 'User rejected this tool call.'
          response.progress(`Tool result: ${toolCall.name}: ${rejection}`)
          messages.push(
            { role: 'assistant', content: generated },
            { role: 'user', content: `Tool result for ${toolCall.name}:\n${rejection}` }
          )
          continue
        }
        let toolResult: string

        try {
          toolResult = await toolExecutor.execute(toolCall, token, {
            approved: Boolean(requestOptions.approveTool),
            expectedContent: approval.expectedContent,
            alreadyApplied: approval.alreadyApplied,
            appliedContent: approval.appliedContent,
            selectedHunkIndexes: approval.selectedHunkIndexes
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown tool error'
          toolResult = `Tool error: ${message}`
        }

        if (toolResult.length > MAX_TOOL_RESULT_CHARACTERS) {
          toolResult = `${toolResult.slice(0, MAX_TOOL_RESULT_CHARACTERS)}\n[Tool result truncated]`
        }

        response.progress(`Tool result: ${toolCall.name}: ${summarizeToolResult(toolResult)}`)

        messages.push(
          { role: 'assistant', content: generated },
          { role: 'user', content: `Tool result for ${toolCall.name}:\n${toolResult}` }
        )
      }

    } catch (error) {
      if (!token.isCancellationRequested) {
        finalStatus = 'offline'
        const message = redactSensitiveText(error instanceof Error ? error.message : 'Unknown local model error')
        response.markdown(`Ghost could not reach the local model: ${message}`)
      }
    } finally {
      cancellation.dispose()
      statusBar?.setStatus(finalStatus)
    }
  }
}

export function createChatParticipant(options: ChatParticipantOptions = {}): vscode.ChatParticipant {
  const participant = vscode.chat.createChatParticipant(
    CHAT_PARTICIPANT_ID,
    createChatParticipantHandler(options)
  )
  participant.iconPath = new vscode.ThemeIcon('hubot')
  return participant
}
