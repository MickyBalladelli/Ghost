import * as vscode from 'vscode'
import { TextDecoder } from 'node:util'

import { LocalToolExecutor } from '../tools/localToolExecutor'
import { LocalPilotConfig, localPilotConfig } from '../config'
import { LlmFactory } from '../services/llmFactory'
import { MlxClient, MlxMessage } from '../services/mlxClient'
import { OllamaClient } from '../services/ollamaClient'
import { LocalPilotStatusBar } from '../ui/statusBar'
import { parseLocalToolCall } from './toolCallParser'

const CHAT_PARTICIPANT_ID = 'localpilot.agent'
const DEFAULT_TEMPERATURE = 0.2

const SYSTEM_PROMPT = [
  'You are LocalPilot, a private local coding assistant.',
  'Use the supplied editor and workspace context when it helps answer the user.',
  'Be concise. Put code in fenced Markdown blocks with the correct language when useful.',
  'Do not claim to have changed files or run commands unless a tool actually did it.',
  'When a tool is needed, output only one JSON object in this exact shape: {"tool":"tool_name","arguments":{...}}.',
  'Available tools: localpilot_read_file({"path":"absolute workspace path"}), localpilot_write_file({"path":"absolute workspace path","content":"full text"}), localpilot_run_terminal_command({"command":"bash or PowerShell command","cwd":"optional absolute workspace path"}), localpilot_list_directory({"path":"absolute workspace path","recursive":false}).',
  'After receiving a tool result, continue the task and provide the final answer.'
].join(' ')

const MAX_TOOL_ROUNDS = 8
const MAX_TOOL_RESULT_CHARACTERS = 16000

export interface ChatParticipantOptions {
  configuration?: LocalPilotConfig
  llmFactory?: LlmFactory
  toolExecutor?: LocalToolExecutor
  statusBar?: LocalPilotStatusBar
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

  return `${text.slice(0, maxCharacters)}\n\n[Context truncated by LocalPilot]`
}

function getActiveEditorContext(maxContextTokens: number): EditorContext | undefined {
  const editor = vscode.window.activeTextEditor

  if (!editor) {
    return undefined
  }

  const document = editor.document
  const selectedText = document.getText(editor.selection)
  const text = selectedText || document.getText()

  return {
    text: truncateContext(text, maxContextTokens),
    filePath: document.uri.fsPath,
    languageId: document.languageId
  }
}

function getWorkspaceContext(): string {
  const workspaceName = vscode.workspace.name ?? 'untitled workspace'
  const workspaceFolders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? []
  const openTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => tab.label))
  const terminals = vscode.window.terminals.map(terminal => terminal.name)

  return [
    `Workspace: ${workspaceName}`,
    `Workspace folders: ${workspaceFolders.length > 0 ? workspaceFolders.join(', ') : 'none'}`,
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
  settings: ReturnType<LocalPilotConfig['getSettings']>,
  token: vscode.CancellationToken
): Promise<string> {
  const editor = getActiveEditorContext(settings.maxContextTokens)
  const sections = [`User request:\n${request.prompt.trim()}`]

  if (editor) {
    const selectedLabel = vscode.window.activeTextEditor?.selection.isEmpty ? 'File content' : 'Selected text'
    sections.push(
      `Active file: ${editor.filePath}\nLanguage: ${editor.languageId}\n${selectedLabel}:\n\n\`\`\`${editor.languageId}\n${editor.text}\n\`\`\``
    )
  }

  sections.push(getWorkspaceContext())

  const workspaceSearch = await getWorkspaceSearchContext(request.prompt, settings.maxContextTokens, token)

  if (workspaceSearch) {
    sections.push(workspaceSearch)
  }

  const references = await getReferenceContext(request, settings.maxContextTokens, token)

  if (references) {
    sections.push(references)
  }

  return sections.join('\n\n')
}

function createDefaultLlmFactory(configuration: LocalPilotConfig): LlmFactory {
  const settings = configuration.getSettings()

  return new LlmFactory(
    {
      ollamaClient: new OllamaClient(settings.ollamaUrl),
      mlxClient: new MlxClient(settings.mlxUrl)
    },
    {
      configuration: vscode.workspace.getConfiguration('localpilot')
    }
  )
}

async function streamModelTurn(
  llmFactory: LlmFactory,
  options: Parameters<LlmFactory['streamChatCompletion']>[0],
  response: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<{ generated: string; streamed: boolean }> {
  let generated = ''
  let decided = false
  let bufferingToolCall = false

  for await (const chunk of llmFactory.streamChatCompletion(options)) {
    if (token.isCancellationRequested) {
      return { generated: '', streamed: false }
    }

    if (decided && !bufferingToolCall) {
      response.markdown(chunk)
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
        response.markdown(generated)
        generated = ''
      }
    }
  }

  return { generated: generated.trim(), streamed: decided && !bufferingToolCall }
}

export function createChatParticipantHandler(
  options: ChatParticipantOptions = {}
): vscode.ChatRequestHandler {
  const configuration = options.configuration ?? localPilotConfig
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
    const contextPrompt = await buildContextPrompt(request, settings, token)

    if (token.isCancellationRequested) {
      return
    }

    const messages: MlxMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: contextPrompt }
    ]
    const cancellation = createCancellationSignal(token)
    let finalStatus: 'ready' | 'offline' = 'ready'
    statusBar?.setStatus('generating')

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const turn = await streamModelTurn(
          llmFactory,
          {
            model: settings.chatModel,
            messages,
            temperature: DEFAULT_TEMPERATURE,
            signal: cancellation.signal
          },
          response,
          token
        )

        if (token.isCancellationRequested || turn.streamed) {
          return
        }

        const generated = turn.generated

        if (!generated) {
          return
        }

        const toolCall = parseLocalToolCall(generated)

        if (!toolCall) {
          response.markdown(generated)
          return
        }

        if (round === MAX_TOOL_ROUNDS - 1) {
          response.markdown('LocalPilot stopped after reaching the maximum tool-call limit.')
          return
        }

        response.progress(`Running ${toolCall.name}`)
        let toolResult: string

        try {
          toolResult = await toolExecutor.execute(toolCall, token)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown tool error'
          toolResult = `Tool error: ${message}`
        }

        if (toolResult.length > MAX_TOOL_RESULT_CHARACTERS) {
          toolResult = `${toolResult.slice(0, MAX_TOOL_RESULT_CHARACTERS)}\n[Tool result truncated]`
        }

        messages.push(
          { role: 'assistant', content: generated },
          { role: 'user', content: `Tool result for ${toolCall.name}:\n${toolResult}` }
        )
      }

      response.markdown('LocalPilot stopped after reaching the maximum tool-call limit.')
    } catch (error) {
      if (!token.isCancellationRequested) {
        finalStatus = 'offline'
        const message = error instanceof Error ? error.message : 'Unknown local model error'
        response.markdown(`LocalPilot could not reach the local model: ${message}`)
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
