import * as vscode from 'vscode'
import { TextDecoder } from 'node:util'

import { LocalToolExecutor } from '../tools/localToolExecutor'
import { redactSensitiveText } from '../privacy/redact'
import { GhostPilotConfig, ghostPilotConfig } from '../config'
import { LlmFactory } from '../services/llmFactory'
import { MlxClient, MlxMessage } from '../services/mlxClient'
import { OllamaClient } from '../services/ollamaClient'
import { GhostPilotStatusBar } from '../ui/statusBar'
import { LocalToolCall, parseLocalToolCall } from './toolCallParser'

const CHAT_PARTICIPANT_ID = 'ghostpilot.agent'
const DEFAULT_TEMPERATURE = 0.2

const SYSTEM_PROMPT = [
  'You are GhostPilot, a private local coding assistant.',
  'Use the supplied editor and workspace context when it helps answer the user.',
  'Be concise. Put code in fenced Markdown blocks with the correct language when useful.',
  'Do not claim to have changed files or run commands unless a tool actually did it.',
  'When a tool is needed, output only one JSON object in this exact shape: {"tool":"tool_name","arguments":{...}}.',
  'Available tools: ghostpilot_read_file({"path":"absolute workspace path"}), ghostpilot_write_file({"path":"absolute workspace path","content":"full text"}), ghostpilot_apply_edit({"path":"absolute workspace path","hunks":[{"startLine":1,"endLine":1,"replacement":"new text"}]}), ghostpilot_run_terminal_command({"command":"bash or PowerShell command","cwd":"optional absolute workspace path"}), ghostpilot_list_directory({"path":"absolute workspace path","recursive":false}).',
  'After receiving a tool result, continue the task and provide the final answer.'
].join(' ')

const MAX_TOOL_ROUNDS = 8
const MAX_TOOL_RESULT_CHARACTERS = 16000

function summarizeToolResult(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 600 ? `${compact.slice(0, 600)}…` : compact
}

export interface ChatParticipantOptions {
  configuration?: GhostPilotConfig
  llmFactory?: LlmFactory
  toolExecutor?: LocalToolExecutor
  statusBar?: GhostPilotStatusBar
}

export interface GhostPilotContextSelection {
  workspace?: boolean
  folders?: boolean
  activeFile?: boolean
  selection?: boolean
  openFiles?: boolean
  tools?: boolean
}

export interface GhostPilotRequestOptions {
  model?: string
  temperature?: number
  maxContextTokens?: number
  maxTokens?: number
  mode?: 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
  context?: GhostPilotContextSelection
  additionalContext?: string
  showReasoning?: boolean
  customSystemInstructions?: string
  approveTool?: (call: LocalToolCall) => Promise<GhostPilotToolApproval>
}

export interface GhostPilotToolApproval {
  decision: 'once' | 'session' | 'reject'
  arguments?: Record<string, unknown>
  expectedContent?: string
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

  return `${text.slice(0, maxCharacters)}\n\n[Context truncated by GhostPilot]`
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
  settings: ReturnType<GhostPilotConfig['getSettings']>,
  token: vscode.CancellationToken,
  options: GhostPilotRequestOptions = {},
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

function getRequestOptions(request: vscode.ChatRequest): GhostPilotRequestOptions {
  const value = (request as vscode.ChatRequest & { ghostPilot?: GhostPilotRequestOptions }).ghostPilot
  return value ?? {}
}

function createDefaultLlmFactory(configuration: GhostPilotConfig): LlmFactory {
  const settings = configuration.getSettings()

  return new LlmFactory(
    {
      ollamaClient: new OllamaClient(settings.ollamaUrl),
      mlxClient: new MlxClient(settings.mlxUrl),
      openaiCompatibleClient: new OllamaClient(settings.openaiUrl, 'openai-compatible')
    },
    {
      configuration: vscode.workspace.getConfiguration('ghostpilot')
    }
  )
}

async function streamModelTurn(
  llmFactory: LlmFactory,
  options: Parameters<LlmFactory['streamChatCompletion']>[0],
  response: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  showReasoning = false
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
  const configuration = options.configuration ?? ghostPilotConfig
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

    const baseSystemPrompt = requestOptions.context?.tools === false
      ? 'You are GhostPilot, a private local coding assistant. Do not use tools. Be concise and use fenced Markdown code blocks when useful.'
      : SYSTEM_PROMPT
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
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const turn = await streamModelTurn(
          llmFactory,
          {
            model: requestOptions.model?.trim() || settings.chatModel,
            messages,
            temperature: Math.min(2, Math.max(0, requestOptions.temperature ?? settings.temperature ?? DEFAULT_TEMPERATURE)),
            maxTokens: requestOptions.maxTokens,
            signal: cancellation.signal
          },
          response,
          token,
          requestOptions.showReasoning === true
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

        if (round === MAX_TOOL_ROUNDS - 1) {
          response.markdown('GhostPilot stopped after reaching the maximum tool-call limit.')
          return
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

      response.markdown('GhostPilot stopped after reaching the maximum tool-call limit.')
    } catch (error) {
      if (!token.isCancellationRequested) {
        finalStatus = 'offline'
        const message = redactSensitiveText(error instanceof Error ? error.message : 'Unknown local model error')
        response.markdown(`GhostPilot could not reach the local model: ${message}`)
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
