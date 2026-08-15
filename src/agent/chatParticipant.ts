import * as vscode from 'vscode'

import { LocalPilotConfig, localPilotConfig } from '../config'
import { LlmFactory } from '../services/llmFactory'
import { MlxClient, MlxMessage } from '../services/mlxClient'
import { OllamaClient } from '../services/ollamaClient'

const CHAT_PARTICIPANT_ID = 'localpilot.agent'
const DEFAULT_TEMPERATURE = 0.2

const SYSTEM_PROMPT = [
  'You are LocalPilot, a private local coding assistant.',
  'Use the supplied editor and workspace context when it helps answer the user.',
  'Be concise. Put code in fenced Markdown blocks with the correct language when useful.',
  'Do not claim to have changed files or run commands unless a tool actually did it.'
].join(' ')

export interface ChatParticipantOptions {
  configuration?: LocalPilotConfig
  llmFactory?: LlmFactory
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

function truncateContext(text: string, maxTokens: number): string {
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

function getReferenceContext(request: vscode.ChatRequest): string {
  if (request.references.length === 0) {
    return ''
  }

  const references = request.references.map(reference => {
    if (typeof reference.value === 'string') {
      return reference.value
    }

    if (reference.value instanceof vscode.Uri) {
      return reference.value.fsPath
    }

    if (reference.value && typeof reference.value === 'object' && 'uri' in reference.value) {
      const location = reference.value as vscode.Location
      return `${location.uri.fsPath}:${location.range.start.line + 1}`
    }

    return reference.modelDescription ?? reference.id
  })

  return `Chat references:\n${references.map(reference => `- ${reference}`).join('\n')}`
}

function buildContextPrompt(request: vscode.ChatRequest, settings: ReturnType<LocalPilotConfig['getSettings']>): string {
  const editor = getActiveEditorContext(settings.maxContextTokens)
  const sections = [`User request:\n${request.prompt.trim()}`]

  if (editor) {
    const selectedLabel = vscode.window.activeTextEditor?.selection.isEmpty ? 'File content' : 'Selected text'
    sections.push(
      `Active file: ${editor.filePath}\nLanguage: ${editor.languageId}\n${selectedLabel}:\n\n\`\`\`${editor.languageId}\n${editor.text}\n\`\`\``
    )
  }

  sections.push(getWorkspaceContext())

  const references = getReferenceContext(request)

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

export function createChatParticipantHandler(
  options: ChatParticipantOptions = {}
): vscode.ChatRequestHandler {
  const configuration = options.configuration ?? localPilotConfig
  const llmFactory = options.llmFactory ?? createDefaultLlmFactory(configuration)

  return async (request, _context, response, token) => {
    if (!request.prompt.trim()) {
      response.markdown('Ask me a coding question.')
      return
    }

    if (token.isCancellationRequested) {
      return
    }

    const settings = configuration.getSettings()
    const messages: MlxMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildContextPrompt(request, settings) }
    ]
    const cancellation = createCancellationSignal(token)

    try {
      for await (const chunk of llmFactory.streamChatCompletion({
        model: settings.chatModel,
        messages,
        temperature: DEFAULT_TEMPERATURE,
        signal: cancellation.signal
      })) {
        if (token.isCancellationRequested) {
          break
        }

        response.markdown(chunk)
      }
    } catch (error) {
      if (!token.isCancellationRequested) {
        const message = error instanceof Error ? error.message : 'Unknown local model error'
        response.markdown(`LocalPilot could not reach the local model: ${message}`)
      }
    } finally {
      cancellation.dispose()
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
