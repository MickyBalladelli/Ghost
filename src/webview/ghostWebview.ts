type GhostViewStatus = 'ready' | 'offline'
type NoticeKind = 'error' | 'no-model' | 'info'
type MessageRole = 'user' | 'assistant'
type GhostProvider = 'ollama' | 'mlx-vlm' | 'openai-compatible'
type AutoAcceptScope = 'confirm' | 'one-edit' | 'current-file' | 'request' | 'session' | 'workspace' | 'always'
type GhostMode = 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
type ResponseLength = 'short' | 'balanced' | 'long' | 'unlimited'
type RequestStatus = 'idle' | 'preparing' | 'connecting' | 'thinking' | 'streaming' | 'waiting-for-approval' | 'completed' | 'cancelled' | 'failed'
type ProgressPhase = 'context' | 'provider' | 'thinking' | 'streaming' | 'tool' | 'complete' | 'error'
type StopReason = 'failed-tool' | 'invalid-model-response' | 'cancelled' | 'timeout' | 'approval-rejected' | 'context-limit' | 'budget-limit' | 'provider-failure'

interface Attachment {
  name: string
  path?: string
  content?: string
  mimeType?: string
}

interface PromptPreset {
  id: string
  name: string
  prompt: string
  mode: GhostMode
  temperature: number
  maxContextTokens: number
  responseLength: ResponseLength
}

interface ControlSettings {
  provider: GhostProvider
  ollamaUrl: string
  mlxUrl: string
  openaiUrl: string
  toolAllowlist: string[]
  toolDenylist: string[]
  terminalEnvironmentAllowlist: string[]
  enableDebugLogging: boolean
  networkAccess: 'local' | 'external'
  chatModel: string
  autocompleteModel: string
  maxContextTokens: number
  temperature: number
  topP: number
  topK: number
  minP: number
  presencePenalty: number
  repeatPenalty: number
  responseLength: ResponseLength
  mode: GhostMode
  fileEditApproval: AutoAcceptScope
  enableConversationPersistence: boolean
}

interface UiPreferences {
  assistantName: string
  assistantAvatar: string
  accentColor: string
  compactLayout: boolean
  showThinkingDetails: boolean
  showToolProgress: boolean
  verboseToolDetails?: boolean
  showDiagnostics: boolean
  autoContext: boolean
  customSystemInstructions: string
  composerHeight: number
  promptRows: number
  workspaceOnly: boolean
}

interface ContextData {
  workspaceName: string
  folders: string[]
  activeFile?: { name: string; path: string; languageId: string; hasSelection: boolean }
  openFiles: string[]
  tools: string[]
}

const toolDescriptions: Record<string, string> = {
  ghost_read_file: 'Read a text file from the workspace.',
  ghost_search_workspace: 'Search workspace text with ripgrep and return file, line, column, and match data.',
  ghost_get_diagnostics: 'Read compiler and Problems-panel diagnostics.',
  ghost_write_file: 'Create or replace a text file in the workspace.',
  ghost_apply_edit: 'Apply reviewed, structured edits to a workspace file.',
  ghost_apply_transaction: 'Apply and verify multiple workspace edits as one transaction.',
  ghost_run_terminal_command: 'Run a shell command in the workspace.',
  ghost_list_directory: 'List files and folders in the workspace.'
}

interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  parts: MessagePart[]
  responseStats?: ResponseStats
  status?: 'streaming' | 'error'
  requestStatus?: RequestStatus
  stopReason?: StopReason
  requestId?: string
  createdAt: number
  updatedAt: number
}

interface ResponseStats {
  elapsedMs: number
  tokenCount: number
  tokensPerSecond: number
  model?: string
}

type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning' | 'progress'; text: string; phase?: ProgressPhase; elapsedMs?: number; tokenCount?: number; tokensPerSecond?: number; model?: string }
  | { kind: 'tool'; toolCall: ToolCall }
  | { kind: 'error'; message: string; recoverable?: boolean }
  | { kind: 'warning'; message: string }

interface ToolCall {
  id: string
  round: number
  name: string
  arguments?: string
  requiresApproval?: boolean
  approval?: 'pending' | 'approved' | 'rejected'
  diffPreview?: { path: string; before: string; after: string; truncated?: boolean; hunks?: Array<{ startLine: number; endLine: number; replacement: string }> }
  status: 'requested' | 'running' | 'completed' | 'rejected' | 'failed'
  result?: string
  startedAt: number
  completedAt?: number
}

interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  draft: string
  promptHistory: string[]
  activeRequestId?: string
  createdAt: number
  updatedAt: number
}

interface GhostState {
  schemaVersion: number
  conversations: Conversation[]
  activeConversationId: string
  promptHistory?: string[]
  presets?: PromptPreset[]
  showReasoning?: boolean
  preferences?: Partial<ControlSettings> & Partial<UiPreferences>
}

type GhostExtensionMessage =
  | {
      source: 'ghost-extension'
      version: 1
      type: 'state'
      status: GhostViewStatus
      detail: string
    }
  | {
      source: 'ghost-extension'
      version: 1
      type: 'reset' | 'clear'
    }
  | {
      source: 'ghost-extension'
      version: 1
      type: 'controls-state'
      settings: Omit<ControlSettings, 'fileEditApproval'> & { autoAcceptScope: AutoAcceptScope }
      models: string[]
      connection: 'online' | 'offline' | 'unknown'
      context: Omit<ContextData, 'tools'>
      tools: string[]
    }
  | {
      source: 'ghost-extension'
      version: 1
      type: 'persisted-state'
      state: {
        schemaVersion: number
        conversations?: unknown[]
        activeConversationId?: string
        promptHistory?: string[]
        presets?: unknown[]
        showReasoning?: boolean
        preferences?: Record<string, unknown>
      }
    }
  | {
      source: 'ghost-extension'
      version: 1
      type: 'file-picked'
      attachments: Attachment[]
    }
  | {
      source: 'ghost-extension'
      version: 1
      type: 'request-started' | 'thinking' | 'text-delta' | 'code-delta' | 'tool-requested' | 'tool-result' | 'warning' | 'error' | 'request-completed'
      requestId: string
      conversationId: string
      sequence: number
      state?: RequestStatus
      phase?: ProgressPhase
      elapsedMs?: number
      model?: string
      tokenCount?: number
      tokensPerSecond?: number
      startedAt?: number
      detail?: string
      delta?: string
      tool?: string
      toolCallId?: string
      arguments?: Record<string, unknown>
      requiresApproval?: boolean
      diffPreview?: { path: string; before: string; after: string; truncated?: boolean; hunks?: Array<{ startLine: number; endLine: number; replacement: string }> }
      message?: string
      resultStatus?: 'completed' | 'rejected' | 'failed'
      status?: 'completed' | 'cancelled' | 'failed'
      stopReason?: StopReason
    }

interface GhostWebviewApi {
  postMessage(message: unknown): void
  getState<T>(): T | undefined
  setState<T>(state: T): void
}

interface ActiveRequest {
  requestId: string
  conversationId: string
  assistantMessageId: string
  lastSequence: number
  status: RequestStatus
  attempt: number
  startedAt: number
  model: string
  phase: ProgressPhase
  latestDetail: string
  tokenCount: number
  tokensPerSecond?: number
  stopReason?: StopReason
}

interface ModelMetadata {
  id: string
  label: string
  provider: GhostProvider
  contextWindow?: number
  capabilities: string[]
}

interface WebviewRequestOptions {
  provider: GhostProvider
  model: string
  temperature: number
  topP: number
  topK: number
  minP: number
  presencePenalty: number
  repeatPenalty: number
  maxContextTokens: number
  maxTokens?: number
  mode: GhostMode
  showReasoning: boolean
  customSystemInstructions: string
  context: {
    workspace: boolean
    folders: boolean
    activeFile: boolean
    selection: boolean
    openFiles: boolean
    tools: boolean
  }
}

declare function acquireVsCodeApi(): GhostWebviewApi

const vscode = acquireVsCodeApi()
const app = document.getElementById('app')
const ghostIconUri = document.body.dataset.ghostIcon ?? ''

if (!app) {
  throw new Error('Ghost webview root is missing')
}

const createId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
const persistenceSchemaVersion = 2

const redactSensitiveText = (value: string): string => value
  .replace(/(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s,;]+/gi, '$1[REDACTED]')
  .replace(/((?:proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|session[_-]?token|refresh[_-]?token|id[_-]?token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
  .replace(/((?:token|secret|password|passwd|credential|private[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
  .replace(/((?:["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|session[_-]?token|refresh[_-]?token|password|credential)["']?)\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
  .replace(/((?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
  .replace(/([?&](?:api[_-]?key|access[_-]?token|client[_-]?secret|secret|token|password|credential|sig|signature)=)[^&#\s]*/gi, '$1[REDACTED]')
  .replace(/([a-z][a-z\d+.-]*:\/\/[^/\s:@]+:)[^@\s]+(@)/gi, '$1[REDACTED]$2')
  .replace(/\b(?:AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AZURE_CLIENT_SECRET|GOOGLE_APPLICATION_CREDENTIALS|GITHUB_TOKEN|NPM_TOKEN|HF_TOKEN|HUGGINGFACEHUB_API_TOKEN)\s*=\s*[^\s]+/gi, '[REDACTED]')
  .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED]')
  .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|xapp-[A-Za-z0-9-]{16,}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|SG\.[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})\b/g, '[REDACTED]')
  .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]')
  .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g, '[REDACTED]')

const redactPersistedValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return redactSensitiveText(value)
  }
  if (Array.isArray(value)) {
    return value.map(item => redactPersistedValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactPersistedValue(item)]))
  }
  return value
}

const createConversation = (): Conversation => {
  const timestamp = Date.now()
  return {
    id: createId('conversation'),
    title: 'New conversation',
    messages: [],
    draft: '',
    promptHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

const normalizePromptHistory = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 100)
    : []
)

const addPromptToHistory = (history: readonly string[], prompt: string): string[] => {
  const normalized = prompt.trim()
  if (!normalized) {
    return normalizePromptHistory(history)
  }
  return [normalized, ...history.filter(item => item !== normalized)].slice(0, 100)
}

const textPart = (text: string): MessagePart => ({ kind: 'text', text })

const createMessage = (role: MessageRole, content = '', requestId?: string): ChatMessage => {
  const timestamp = Date.now()
  return {
    id: createId('message'),
    role,
    content,
    parts: content ? [textPart(content)] : [],
    ...(requestId ? { requestId } : {}),
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

const normalizeMessage = (value: Partial<ChatMessage>): ChatMessage => {
  const parts = Array.isArray(value.parts) && value.parts.length > 0
    ? value.parts
    : typeof value.content === 'string' && value.content
      ? [textPart(value.content)]
      : []
  const content = typeof value.content === 'string' && value.content
    ? value.content
    : parts
      .filter((part): part is Extract<MessagePart, { kind: 'text' }> => part.kind === 'text')
      .map(part => part.text)
      .join('')
  const responseStats = value.responseStats && typeof value.responseStats.elapsedMs === 'number' && typeof value.responseStats.tokenCount === 'number' && typeof value.responseStats.tokensPerSecond === 'number'
    ? value.responseStats
    : undefined
  const timestamp = typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  return {
    id: typeof value.id === 'string' ? value.id : createId('message'),
    role: value.role === 'assistant' ? 'assistant' : 'user',
    content,
    parts,
    ...(responseStats ? { responseStats } : {}),
    ...(value.status ? { status: value.status } : {}),
    ...(value.requestStatus ? { requestStatus: value.requestStatus } : {}),
    ...(value.stopReason ? { stopReason: value.stopReason } : {}),
    ...(value.requestId ? { requestId: value.requestId } : {}),
    createdAt: timestamp,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : timestamp
  }
}

const normalizeConversation = (value: Partial<Conversation>): Conversation => {
  const timestamp = typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  return {
    id: typeof value.id === 'string' ? value.id : createId('conversation'),
    title: typeof value.title === 'string' ? value.title : 'New conversation',
    messages: Array.isArray(value.messages) ? value.messages.map(message => normalizeMessage(message)) : [],
    draft: typeof value.draft === 'string' ? value.draft : '',
    promptHistory: normalizePromptHistory(value.promptHistory),
    ...(value.activeRequestId ? { activeRequestId: value.activeRequestId } : {}),
    createdAt: timestamp,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : timestamp
  }
}

const migrateLegacyPromptHistory = (conversations: Conversation[], activeConversationId: string | undefined, legacyHistory: unknown): void => {
  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId)
  const history = normalizePromptHistory(legacyHistory)
  if (activeConversation && activeConversation.promptHistory.length === 0 && history.length > 0) {
    activeConversation.promptHistory = history
  }
}

const recoverInterruptedConversation = (conversation: Conversation): Conversation => {
  for (const message of conversation.messages) {
    if (message.status === 'streaming' || message.requestStatus === 'streaming' || message.requestStatus === 'waiting-for-approval') {
      message.status = 'error'
      message.requestStatus = 'failed'
      message.parts.push({ kind: 'error', message: 'Request interrupted while Ghost was reloading.', recoverable: true })
      message.updatedAt = Date.now()
    }
  }
  conversation.activeRequestId = undefined
  return conversation
}

const getInitialState = (): GhostState => {
  const stored = vscode.getState<Partial<GhostState>>()
  if (
    stored &&
    Array.isArray(stored.conversations) &&
    stored.conversations.length > 0 &&
    typeof stored.activeConversationId === 'string'
  ) {
    const conversations = stored.conversations.map(conversation => recoverInterruptedConversation(normalizeConversation(conversation)))
    const activeConversationId = conversations.some(conversation => conversation.id === stored.activeConversationId)
      ? stored.activeConversationId
      : conversations[0].id
    migrateLegacyPromptHistory(conversations, activeConversationId, stored.promptHistory)
    return {
      schemaVersion: persistenceSchemaVersion,
      conversations,
      activeConversationId,
      ...(Array.isArray(stored.promptHistory) ? { promptHistory: stored.promptHistory.filter(item => typeof item === 'string').slice(0, 100) } : {}),
      ...(Array.isArray(stored.presets) ? { presets: stored.presets } : {}),
      ...(typeof stored.showReasoning === 'boolean' ? { showReasoning: stored.showReasoning } : {}),
      ...(stored.preferences ? { preferences: stored.preferences } : {})
    }
  }

  const conversation = createConversation()
  return {
    schemaVersion: persistenceSchemaVersion,
    conversations: [conversation],
    activeConversationId: conversation.id
  }
}

let state = getInitialState()
let showReasoning = state.showReasoning === true
let viewStatus: GhostViewStatus = 'ready'
let activeRequest: ActiveRequest | undefined
let notice: { kind: NoticeKind; message: string } | undefined
let userIsAtBottom = true
let controls: ControlSettings = {
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  mlxUrl: 'http://localhost:8000',
  openaiUrl: 'http://localhost:8001/v1',
  toolAllowlist: [],
  toolDenylist: [],
  enableDebugLogging: false,
  networkAccess: 'local',
  chatModel: 'qwen2.5-coder:7b',
  autocompleteModel: 'qwen2.5-coder:1.5b',
  maxContextTokens: 8192,
  temperature: 0.3,
  topP: 0.9,
  topK: 20,
  minP: 0.05,
  presencePenalty: 0.0,
  repeatPenalty: 1.05,
  responseLength: 'balanced',
  mode: 'agent',
  fileEditApproval: 'confirm',
  enableConversationPersistence: false,
  terminalEnvironmentAllowlist: ['PATH', 'HOME', 'USER', 'USERNAME', 'SHELL', 'ComSpec', 'SystemRoot', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'CI', 'PWD']
}
let availableModels: string[] = [controls.chatModel]
let availableModelMetadata: ModelMetadata[] = [{
  id: controls.chatModel,
  label: controls.chatModel,
  provider: controls.provider,
  capabilities: ['chat']
}]
let connection: 'online' | 'offline' | 'unknown' = 'unknown'
let contextData: ContextData = {
  workspaceName: 'Untitled workspace',
  folders: [],
  openFiles: [],
  tools: []
}
let contextEnabled = {
  workspace: true,
  folders: true,
  activeFile: true,
  selection: true,
  openFiles: true,
  tools: true
}
let attachments: Attachment[] = []
let composerHeight = 180
let promptRows = 3
let uiPreferences: UiPreferences = {
  assistantName: 'Ghost',
  assistantAvatar: '✦',
  accentColor: '',
  compactLayout: false,
  showThinkingDetails: true,
  showToolProgress: false,
  showDiagnostics: false,
  autoContext: true,
  customSystemInstructions: '',
  composerHeight,
  promptRows,
  workspaceOnly: false
}
let persistenceReady = false
let persistenceTimer: number | undefined
let settingsTimer: number | undefined
let modelRefreshTimer: number | undefined
let historyIndex = -1
let mentionMenu: HTMLElement | undefined
const requests = new Map<string, ActiveRequest>()
let progressTimer: number | undefined
let visibleMessageCount = 200

const formatElapsed = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

const stopProgressTimer = (): void => {
  if (progressTimer !== undefined) {
    window.clearInterval(progressTimer)
    progressTimer = undefined
  }
}

const startProgressTimer = (): void => {
  stopProgressTimer()
  progressTimer = window.setInterval(() => {
    if (activeRequest) {
      updateStatus()
    } else {
      stopProgressTimer()
    }
  }, 1000)
}

app.innerHTML = `
  <div class="app">
    <header class="header">
      <div class="brand">
        <span class="brand-mark ghost-face" aria-hidden="true"><img src="${ghostIconUri}" alt=""><span class="ghost-eye ghost-eye-left"><span class="ghost-pupil"></span></span><span class="ghost-eye ghost-eye-right"><span class="ghost-pupil"></span></span></span>
        <div>
          <div class="title">Ghost</div>
          <div class="subtitle">AI coding assistant</div>
        </div>
      </div>
      <div class="header-actions">
        <button type="button" class="icon-button history-button" id="history" aria-haspopup="dialog" aria-label="History" title="History"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
        <button type="button" class="icon-button" id="new-chat" aria-label="New conversation" title="New conversation">+</button>
        <button type="button" class="icon-button" id="import" aria-label="Import conversations" title="Import conversations">⇩</button>
        <button type="button" class="icon-button" id="export" aria-label="Export conversations" title="Export conversations">⇧</button>
        <button type="button" class="icon-button danger-button" id="reset" aria-label="Delete all conversation history and preferences" title="Delete all conversation history and preferences"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Zm3-3h6l1 2H8l1-2Zm-1 7v6m4-6v6m4-6v6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg></button>
      </div>
    </header>
    <section class="control-strip" aria-label="Prompt controls">
      <label class="control-label" for="provider">Provider</label>
      <select id="provider" aria-label="Model provider">
        <option value="ollama">Ollama</option>
        <option value="mlx-vlm">MLX / VLM</option>
        <option value="openai-compatible">OpenAI-compatible</option>
      </select>
      <label class="control-label" for="model">Model</label>
      <select id="model" aria-label="Chat model"></select>
      <span class="connection-indicator" id="connection-indicator"><span class="status-dot" aria-hidden="true"></span><span id="connection-text">Checking…</span></span>
      <button type="button" class="control-button settings-button" id="settings" aria-haspopup="dialog" aria-label="Settings" title="Settings"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13.5a7.8 7.8 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14.1 2h-4.2l-.3 3.1A8 8 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.3 3.1h4.2l.3-3.1a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" fill="currentColor"/></svg></button>
    </section>
    <div class="chat-layout">
      <main class="chat-main">
        <section class="messages" id="messages" role="log" aria-label="Conversation messages" aria-live="polite"></section>
        <div class="screen-reader-status" id="screen-reader-status" role="status" aria-live="polite"></div>
        <form class="composer" id="composer">
          <label class="screen-reader-only" for="prompt">Message Ghost</label>
          <div class="context-row">
            <button type="button" class="context-button" id="context-preview" aria-haspopup="dialog" title="View prompt context and available tools">Context</button>
            <button type="button" class="context-button" id="attach">Attach</button>
            <input id="file-input" type="file" multiple hidden>
          </div>
          <div class="attachment-list" id="attachment-list" aria-label="Attachments"></div>
          <div class="prompt-wrap">
            <textarea id="prompt" rows="3" placeholder="Ask Ghost anything..." aria-describedby="composer-hint composer-count"></textarea>
            <div class="mention-menu" id="mention-menu" role="listbox" hidden></div>
          </div>
          <div class="composer-footer">
            <span class="composer-hint" id="composer-hint">Enter to send · Shift+Enter for a new line</span>
            <span class="composer-count" id="composer-count">0 chars · ~0 tokens</span>
            <span class="prompt-history-actions" aria-label="Prompt history"><button type="button" class="secondary prompt-history-button" id="previous-prompt" aria-label="Previous prompt" title="Previous prompt">↑</button><button type="button" class="secondary prompt-history-button" id="next-prompt" aria-label="Next prompt" title="Next prompt">↓</button></span>
            <button type="button" class="stop-button" id="stop" hidden>Stop</button>
            <button type="submit" id="send">Send</button>
          </div>
        </form>
        <footer class="status-footer" id="status-footer">
          <span class="thinking-ghost ghost-face" aria-hidden="true"><img src="${ghostIconUri}" alt=""><span class="ghost-eye ghost-eye-left"><span class="ghost-pupil"></span></span><span class="ghost-eye ghost-eye-right"><span class="ghost-pupil"></span></span></span>
          <span class="status-dot" aria-hidden="true"></span>
          <span id="status-text">Ready</span>
        </footer>
      </main>
    </div>
    <div class="modal-backdrop" id="settings-modal" hidden>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="modal-header"><h2 id="settings-title">Composer controls</h2><div><button type="button" class="secondary" id="privacy-page">Privacy</button><button type="button" class="icon-button" data-close-modal="settings-modal" aria-label="Close controls">×</button></div></div>
        <div class="modal-scroll">
          <div class="settings-grid">
          <label for="temperature" title="Temperature controls randomness. Lower values make answers more predictable; higher values make them more varied. Range: 0 to 2.">Temperature <output id="temperature-value">0.3</output></label>
          <input id="temperature" type="range" min="0" max="2" step="0.1" value="0.3" title="Temperature: 0 is most focused, 1 is balanced, and 2 is most varied.">
          <label for="top-p" title="Top P, or nucleus sampling, keeps only the smallest group of likely tokens whose probabilities add up to this value. Lower values focus the answer. Range: 0 to 1.">Top P</label>
          <input id="top-p" type="number" min="0" max="1" step="0.01" value="0.9" title="Top P: 0 is very focused; 0.9 keeps the likely 90% probability mass; 1 disables this limit.">
          <label for="top-k" title="Top K limits each next token to the K most likely choices. Lower values focus the answer. Range: 0 or higher.">Top K</label>
          <input id="top-k" type="number" min="0" step="1" value="20" title="Top K: 20 keeps the 20 most likely choices; 0 disables this limit.">
          <label for="min-p" title="Min P removes tokens whose probability is below this fraction of the most likely token. Range: 0 to 1.">Min P</label>
          <input id="min-p" type="number" min="0" max="1" step="0.01" value="0.05" title="Min P: 0 disables this filter; 0.05 is a light filter; higher values keep fewer low-probability choices.">
          <label for="presence-penalty" title="Presence penalty discourages tokens that already appeared. Positive values encourage new topics; negative values allow reuse. Range: -2 to 2.">Presence penalty</label>
          <input id="presence-penalty" type="number" min="-2" max="2" step="0.1" value="0" title="Presence penalty: 0 disables it; positive values reduce repeated topics; negative values make reuse more likely.">
          <label for="repeat-penalty" title="Repeat penalty discourages repeated text. Range: 0 to 3.">Repeat penalty</label>
          <input id="repeat-penalty" type="number" min="0" max="3" step="0.05" value="1.05" title="Repeat penalty: 1 disables it; 1.05 is a light penalty; higher values penalize repetition more.">
          <label for="max-context">Max context tokens</label>
          <input id="max-context" type="number" min="1" step="256" value="8192">
          <label for="response-length">Response length</label>
          <select id="response-length"><option value="short">Short</option><option value="balanced">Balanced</option><option value="long">Long</option><option value="unlimited">Unlimited</option></select>
          <label for="mode">Workflow mode</label>
          <select id="mode"><option value="ask">Ask</option><option value="edit">Edit</option><option value="agent">Agent — implement changes</option><option value="explain">Explain</option><option value="inline">Inline / Completion</option></select>
          <label for="file-edit-approval">File edit approval</label>
          <select id="file-edit-approval"><option value="confirm">Confirm each edit</option><option value="one-edit">Auto-accept one edit</option><option value="current-file">Auto-accept current file</option><option value="request">Auto-accept this request</option><option value="session">Auto-accept this session</option><option value="workspace">Auto-accept this workspace</option><option value="always">Always auto-accept file edits</option></select>
          <p class="settings-help">Auto-accept can change files without asking. Terminal and other dangerous tools always need approval.</p>
          <label for="composer-height">Composer size</label>
          <input id="composer-height" type="range" min="80" max="320" step="10" value="180">
          <label for="prompt-rows">Prompt rows</label>
          <input id="prompt-rows" type="number" min="1" max="12" step="1" value="3">
          <label for="provider-endpoint">Provider endpoint</label>
          <input id="provider-endpoint" type="url" placeholder="http://localhost:11434">
          <p class="settings-help" id="provider-help">Endpoint for the selected provider.</p>
          <button type="button" id="test-provider">Test provider connection</button>
          <label for="tool-allowlist">Allowed tools</label>
          <input id="tool-allowlist" type="text" placeholder="ghost_read_file, ghost_apply_edit">
          <label for="tool-denylist">Denied tools</label>
          <input id="tool-denylist" type="text" placeholder="ghost_run_terminal_command">
          <label for="terminal-environment-allowlist">Terminal environment allowlist</label>
          <input id="terminal-environment-allowlist" type="text" placeholder="PATH, HOME, LANG">
          <p class="settings-help">Names only. Secret-looking variables are always blocked and values are masked before Ghost sees command output.</p>
          <label for="assistant-name">Assistant name</label>
          <input id="assistant-name" type="text" maxlength="40" value="Ghost">
          <label for="assistant-avatar">Assistant avatar</label>
          <input id="assistant-avatar" type="text" maxlength="4" value="✦">
          <label for="accent-color">Accent color</label>
          <input id="accent-color" type="color" value="#3794ff">
          <label class="settings-checkbox" for="show-reasoning"><input id="show-reasoning" type="checkbox"> Show provider reasoning when explicitly returned</label>
          <label class="settings-checkbox" for="persist-conversations"><input id="persist-conversations" type="checkbox"> Save conversations and preferences in VS Code storage</label>
          <label class="settings-checkbox" for="compact-layout"><input id="compact-layout" type="checkbox"> Compact conversation layout</label>
          <label class="settings-checkbox" for="show-thinking"><input id="show-thinking" type="checkbox"> Show thinking details</label>
          <label class="settings-checkbox" for="show-tool-progress" title="When enabled, show tool arguments, results, timings, and detailed previews. When disabled, show only a short action such as ‘I'm reading file…’."><input id="show-tool-progress" type="checkbox"> Show verbose tool details</label>
          <label class="settings-checkbox" for="show-diagnostics"><input id="show-diagnostics" type="checkbox"> Show telemetry-free diagnostics</label>
          <label class="settings-checkbox" for="debug-logging"><input id="debug-logging" type="checkbox"> Enable local debug logging</label>
          <label class="settings-checkbox" for="auto-context"><input id="auto-context" type="checkbox"> Collect context automatically</label>
          <label class="settings-checkbox" for="workspace-settings"><input id="workspace-settings" type="checkbox"> Use workspace-specific settings</label>
          <label for="system-instructions">Custom system instructions</label>
          <textarea id="system-instructions" rows="4" maxlength="8000" placeholder="Optional instructions for Ghost"></textarea>
          <button type="button" class="secondary" id="reset-system-instructions">Reset system instructions</button>
          <p class="settings-help">These instructions are sent to the selected model. Do not put secrets here.</p>
          </div>
          <div class="preset-section">
          <div class="modal-subheader"><h3>Prompt presets</h3><button type="button" class="context-button" id="new-preset">New</button></div>
          <div class="preset-row"><select id="preset-select" aria-label="Prompt preset"><option value="">Choose a preset</option></select><button type="button" class="context-button" id="delete-preset">Delete</button></div>
          <input id="preset-name" type="text" placeholder="Preset name" aria-label="Preset name">
          <textarea id="preset-prompt" rows="3" placeholder="Reusable prompt text" aria-label="Preset prompt"></textarea>
          </div>
        </div>
        <div class="modal-footer"><button type="button" id="save-preset">Save</button><button type="button" class="secondary" data-close-modal="settings-modal">Close</button></div>
      </section>
    </div>
    <div class="modal-backdrop" id="privacy-modal" hidden>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
        <div class="modal-header"><h2 id="privacy-title">Ghost privacy</h2><button type="button" class="icon-button" data-close-modal="privacy-modal" aria-label="Close privacy page">×</button></div>
        <div class="modal-scroll privacy-content">
          <h3>Providers</h3>
          <p>Ollama and MLX/VLM use the configured local server by default. An OpenAI-compatible provider may be local or external. Ghost sends your prompt and the context you enable to that provider.</p>
          <h3>Provider keys</h3>
          <p>Provider API keys are stored in VS Code SecretStorage. Ghost does not put them in settings, URLs, webview messages, logs, exports, or saved conversations.</p>
          <h3>Workspace and terminal access</h3>
          <p>Ghost can read the active file, selected files, workspace context, and attachments when those context controls are enabled. File changes require approval unless you choose an auto-accept scope. Terminal commands are audited, use a masked environment, have bounded output, and dangerous commands still require approval.</p>
          <h3>Storage</h3>
          <p>Conversation persistence is off by default. When enabled, VS Code stores redacted conversations and preferences in its global and workspace storage. Turning it off clears the saved Ghost state.</p>
          <h3>Exports</h3>
          <p>Export creates a JSON file at the location you choose. Ghost redacts detected secrets before export, but you should review the file before sharing it.</p>
          <h3>Redaction</h3>
          <p>Ghost redacts common API keys, bearer tokens, cookies, secret URLs, cloud credentials, JWTs, and private keys before model context, display, diagnostics, persistence, and export. Redaction cannot guarantee detection of every secret, so do not paste credentials into prompts.</p>
        </div>
        <div class="modal-footer"><button type="button" class="secondary" data-close-modal="privacy-modal">Close</button></div>
      </section>
    </div>
    <div class="modal-backdrop" id="context-modal" hidden>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="context-title">
        <div class="modal-header"><h2 id="context-title">Prompt context</h2><button type="button" class="icon-button" data-close-modal="context-modal" aria-label="Close context">×</button></div>
        <div class="modal-scroll">
          <p class="modal-description">Choose what Ghost may include when you submit this prompt.</p>
          <div class="context-preview" id="context-preview-list"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary" data-close-modal="context-modal">Done</button></div>
      </section>
    </div>
    <div class="modal-backdrop" id="history-modal" hidden>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <div class="modal-header"><h2 id="history-title">Conversation history</h2><button type="button" class="icon-button" data-close-modal="history-modal" aria-label="Close conversation history">×</button></div>
        <div class="modal-scroll">
          <p class="modal-description">Choose a previous conversation to continue.</p>
          <input id="history-search" type="search" placeholder="Search conversations" aria-label="Search conversation history">
          <div class="history-list" id="history-list"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary" id="new-history-chat">New conversation</button><button type="button" class="secondary" data-close-modal="history-modal">Close</button></div>
      </section>
    </div>
  </div>
`

const messagesElement = document.getElementById('messages') as HTMLElement
const promptElement = document.getElementById('prompt') as HTMLTextAreaElement
const composerElement = document.getElementById('composer') as HTMLFormElement
const sendElement = document.getElementById('send') as HTMLButtonElement
const stopElement = document.getElementById('stop') as HTMLButtonElement
const previousPromptElement = document.getElementById('previous-prompt') as HTMLButtonElement
const nextPromptElement = document.getElementById('next-prompt') as HTMLButtonElement
const statusTextElement = document.getElementById('status-text') as HTMLElement
const statusFooterElement = document.getElementById('status-footer') as HTMLElement
const screenReaderStatusElement = document.getElementById('screen-reader-status') as HTMLElement
const composerCountElement = document.getElementById('composer-count') as HTMLElement
const providerElement = document.getElementById('provider') as HTMLSelectElement
const modelElement = document.getElementById('model') as HTMLSelectElement
const connectionIndicatorElement = document.getElementById('connection-indicator') as HTMLElement
const connectionTextElement = document.getElementById('connection-text') as HTMLElement
const attachmentListElement = document.getElementById('attachment-list') as HTMLElement
const fileInputElement = document.getElementById('file-input') as HTMLInputElement
const mentionMenuElement = document.getElementById('mention-menu') as HTMLElement
const temperatureElement = document.getElementById('temperature') as HTMLInputElement
const temperatureValueElement = document.getElementById('temperature-value') as HTMLOutputElement
const topPElement = document.getElementById('top-p') as HTMLInputElement
const topKElement = document.getElementById('top-k') as HTMLInputElement
const minPElement = document.getElementById('min-p') as HTMLInputElement
const presencePenaltyElement = document.getElementById('presence-penalty') as HTMLInputElement
const repeatPenaltyElement = document.getElementById('repeat-penalty') as HTMLInputElement
const maxContextElement = document.getElementById('max-context') as HTMLInputElement
const responseLengthElement = document.getElementById('response-length') as HTMLSelectElement
const modeElement = document.getElementById('mode') as HTMLSelectElement
const composerHeightElement = document.getElementById('composer-height') as HTMLInputElement
const promptRowsElement = document.getElementById('prompt-rows') as HTMLInputElement
const providerEndpointElement = document.getElementById('provider-endpoint') as HTMLInputElement
const providerHelpElement = document.getElementById('provider-help') as HTMLElement
const testProviderElement = document.getElementById('test-provider') as HTMLButtonElement
const toolAllowlistElement = document.getElementById('tool-allowlist') as HTMLInputElement
const toolDenylistElement = document.getElementById('tool-denylist') as HTMLInputElement
const terminalEnvironmentAllowlistElement = document.getElementById('terminal-environment-allowlist') as HTMLInputElement
const fileEditApprovalElement = document.getElementById('file-edit-approval') as HTMLSelectElement
const assistantNameElement = document.getElementById('assistant-name') as HTMLInputElement
const assistantAvatarElement = document.getElementById('assistant-avatar') as HTMLInputElement
const accentColorElement = document.getElementById('accent-color') as HTMLInputElement
const showReasoningElement = document.getElementById('show-reasoning') as HTMLInputElement
const persistenceElement = document.getElementById('persist-conversations') as HTMLInputElement
const compactLayoutElement = document.getElementById('compact-layout') as HTMLInputElement
const showThinkingElement = document.getElementById('show-thinking') as HTMLInputElement
const showToolProgressElement = document.getElementById('show-tool-progress') as HTMLInputElement
const showDiagnosticsElement = document.getElementById('show-diagnostics') as HTMLInputElement
const debugLoggingElement = document.getElementById('debug-logging') as HTMLInputElement
const autoContextElement = document.getElementById('auto-context') as HTMLInputElement
const workspaceSettingsElement = document.getElementById('workspace-settings') as HTMLInputElement
const systemInstructionsElement = document.getElementById('system-instructions') as HTMLTextAreaElement
const resetSystemInstructionsElement = document.getElementById('reset-system-instructions') as HTMLButtonElement
const settingsModalElement = document.getElementById('settings-modal') as HTMLElement
const privacyModalElement = document.getElementById('privacy-modal') as HTMLElement
const contextModalElement = document.getElementById('context-modal') as HTMLElement
const historyModalElement = document.getElementById('history-modal') as HTMLElement
const contextPreviewElement = document.getElementById('context-preview-list') as HTMLElement
const historySearchElement = document.getElementById('history-search') as HTMLInputElement
const historyListElement = document.getElementById('history-list') as HTMLElement
const presetSelectElement = document.getElementById('preset-select') as HTMLSelectElement
const presetNameElement = document.getElementById('preset-name') as HTMLInputElement
const presetPromptElement = document.getElementById('preset-prompt') as HTMLTextAreaElement
const savePresetElement = document.getElementById('save-preset') as HTMLButtonElement

const setPresetSaveState = (saved: boolean): void => {
  savePresetElement.classList.toggle('pressed', saved)
  savePresetElement.setAttribute('aria-pressed', String(saved))
  savePresetElement.textContent = saved ? 'Saved' : 'Save'
}

const updateGhostEyes = (event: PointerEvent): void => {
  document.querySelectorAll<HTMLElement>('.ghost-face').forEach(face => {
    const bounds = face.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) {
      return
    }
    const horizontal = (event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2)
    const vertical = (event.clientY - (bounds.top + bounds.height / 2)) / (bounds.height / 2)
    const clamp = (value: number): number => Math.max(-1, Math.min(1, value))
    face.style.setProperty('--ghost-eye-x', `${clamp(horizontal) * bounds.width * 0.08}px`)
    face.style.setProperty('--ghost-eye-y', `${clamp(vertical) * bounds.height * 0.08}px`)
  })
}

window.addEventListener('pointermove', updateGhostEyes, { passive: true })

const post = (type: string, details: Record<string, unknown> = {}) => {
  vscode.postMessage({
    source: 'ghost-webview',
    version: 1,
    type,
    ...details
  })
}

const createPersistedState = () => ({
  schemaVersion: persistenceSchemaVersion,
  conversations: redactPersistedValue(state.conversations) as Conversation[],
  activeConversationId: state.activeConversationId,
  promptHistory: (redactPersistedValue(promptHistory()) as string[]),
  presets: redactPersistedValue(state.presets ?? []) as PromptPreset[],
  showReasoning,
  preferences: {
    provider: controls.provider,
    ollamaUrl: controls.ollamaUrl,
    mlxUrl: controls.mlxUrl,
    openaiUrl: controls.openaiUrl,
    toolAllowlist: controls.toolAllowlist,
    toolDenylist: controls.toolDenylist,
    terminalEnvironmentAllowlist: controls.terminalEnvironmentAllowlist,
    chatModel: controls.chatModel,
    autocompleteModel: controls.autocompleteModel,
    maxContextTokens: controls.maxContextTokens,
    temperature: controls.temperature,
    topP: controls.topP,
    topK: controls.topK,
    minP: controls.minP,
    presencePenalty: controls.presencePenalty,
    repeatPenalty: controls.repeatPenalty,
    responseLength: controls.responseLength,
    mode: controls.mode,
    autoAcceptScope: controls.fileEditApproval,
    enableConversationPersistence: controls.enableConversationPersistence,
    composerHeight,
    promptRows,
    assistantName: uiPreferences.assistantName,
    assistantAvatar: uiPreferences.assistantAvatar,
    accentColor: uiPreferences.accentColor,
    compactLayout: uiPreferences.compactLayout,
    showThinkingDetails: uiPreferences.showThinkingDetails,
    verboseToolDetails: uiPreferences.showToolProgress,
    showDiagnostics: uiPreferences.showDiagnostics,
    autoContext: uiPreferences.autoContext,
    customSystemInstructions: uiPreferences.customSystemInstructions,
    workspaceOnly: uiPreferences.workspaceOnly,
    enableDebugLogging: controls.enableDebugLogging
  }
})

const saveState = () => {
  if (controls.enableConversationPersistence) {
    vscode.setState(redactPersistedValue(state) as GhostState)
  } else {
    vscode.setState({
      schemaVersion: persistenceSchemaVersion,
      conversations: [createConversation()],
      activeConversationId: '',
      promptHistory: [],
      presets: [],
      showReasoning: false
    })
  }
  if (persistenceReady) {
    if (persistenceTimer !== undefined) {
      window.clearTimeout(persistenceTimer)
    }
    persistenceTimer = window.setTimeout(() => {
      persistenceTimer = undefined
      post('persist-state', { state: createPersistedState() })
    }, 250)
  }
}

const maxTokensForLength = (length: ResponseLength): number | undefined => {
  if (length === 'short') {
    return 512
  }
  if (length === 'balanced') {
    return 1024
  }
  if (length === 'long') {
    return 2048
  }
  return undefined
}

const promptHistory = (): string[] => getActiveConversation().promptHistory

const restorePromptHistoryEntry = (index: number): void => {
  const entries = promptHistory()
  historyIndex = Math.max(-1, Math.min(index, entries.length - 1))
  promptElement.value = historyIndex >= 0 ? entries[historyIndex] : ''
  promptElement.focus()
  promptElement.setSelectionRange(promptElement.value.length, promptElement.value.length)
  saveDraft()
  updateComposer()
}

const browsePromptHistory = (direction: 'previous' | 'next'): void => {
  const entries = promptHistory()
  if (entries.length === 0) {
    return
  }
  const nextIndex = direction === 'previous' ? historyIndex + 1 : historyIndex - 1
  restorePromptHistoryEntry(nextIndex)
}

const presets = (): PromptPreset[] => state.presets ?? []

const lifecycleEnvelope = (prefix: string) => ({
  requestId: createId(prefix),
  conversationId: state.activeConversationId
})

const sendSettingsUpdate = () => {
  if (settingsTimer !== undefined) {
    window.clearTimeout(settingsTimer)
  }
  settingsTimer = window.setTimeout(() => {
    settingsTimer = undefined
    post('update-settings', {
      ...lifecycleEnvelope('settings'),
      settings: {
        provider: controls.provider,
        ollamaUrl: controls.ollamaUrl,
        mlxUrl: controls.mlxUrl,
        openaiUrl: controls.openaiUrl,
        toolAllowlist: controls.toolAllowlist,
        toolDenylist: controls.toolDenylist,
        terminalEnvironmentAllowlist: controls.terminalEnvironmentAllowlist,
        chatModel: controls.chatModel,
        maxContextTokens: controls.maxContextTokens,
        temperature: controls.temperature,
        topP: controls.topP,
        topK: controls.topK,
        minP: controls.minP,
        presencePenalty: controls.presencePenalty,
        repeatPenalty: controls.repeatPenalty,
        responseLength: controls.responseLength,
        mode: controls.mode,
        autoAcceptScope: controls.fileEditApproval,
        enableConversationPersistence: controls.enableConversationPersistence,
        workspaceOnly: uiPreferences.workspaceOnly,
        enableDebugLogging: controls.enableDebugLogging
      }
    })
  }, 200)
}

const queueModelRefresh = () => {
  if (modelRefreshTimer !== undefined) {
    window.clearTimeout(modelRefreshTimer)
  }
  modelRefreshTimer = window.setTimeout(() => {
    modelRefreshTimer = undefined
    post('refresh-models')
  }, 300)
}

const providerEndpoint = (): string => controls.provider === 'mlx-vlm'
  ? controls.mlxUrl
  : controls.provider === 'openai-compatible'
    ? controls.openaiUrl
    : controls.ollamaUrl

const applyUiPreferences = () => {
  const accent = /^#[0-9a-f]{6}$/i.test(uiPreferences.accentColor) ? uiPreferences.accentColor : ''
  document.documentElement.style.setProperty('--ghost-accent', accent || 'var(--vscode-textLink-foreground, #3794ff)')
  document.body.classList.toggle('compact-layout', uiPreferences.compactLayout)
  document.title = uiPreferences.assistantName || 'Ghost'
}

const renderControls = () => {
  providerElement.value = controls.provider
  modelElement.textContent = ''
  for (const model of Array.from(new Set([controls.chatModel, ...availableModels]))) {
    const option = document.createElement('option')
    option.value = model
    option.textContent = model
    modelElement.append(option)
  }
  modelElement.value = controls.chatModel
  temperatureElement.value = String(controls.temperature)
  temperatureValueElement.value = controls.temperature.toFixed(1)
  topPElement.value = String(controls.topP)
  topKElement.value = String(controls.topK)
  minPElement.value = String(controls.minP)
  presencePenaltyElement.value = String(controls.presencePenalty)
  repeatPenaltyElement.value = String(controls.repeatPenalty)
  maxContextElement.value = String(controls.maxContextTokens)
  responseLengthElement.value = controls.responseLength
  modeElement.value = controls.mode
  fileEditApprovalElement.value = controls.fileEditApproval
  composerHeightElement.value = String(composerHeight)
  promptRowsElement.value = String(promptRows)
  promptElement.rows = promptRows
  providerEndpointElement.value = providerEndpoint()
  providerHelpElement.textContent = controls.provider === 'mlx-vlm'
    ? 'MLX VLM OpenAI-compatible endpoint.'
    : controls.provider === 'openai-compatible'
      ? 'OpenAI-compatible endpoint. Keep the /v1 suffix when required.'
      : 'Ollama endpoint.'
  toolAllowlistElement.value = controls.toolAllowlist.join(', ')
  toolDenylistElement.value = controls.toolDenylist.join(', ')
  terminalEnvironmentAllowlistElement.value = controls.terminalEnvironmentAllowlist.join(', ')
  debugLoggingElement.checked = controls.enableDebugLogging
  showReasoningElement.checked = showReasoning
  persistenceElement.checked = controls.enableConversationPersistence
  assistantNameElement.value = uiPreferences.assistantName
  assistantAvatarElement.value = uiPreferences.assistantAvatar
  accentColorElement.value = /^#[0-9a-f]{6}$/i.test(uiPreferences.accentColor) ? uiPreferences.accentColor : '#3794ff'
  compactLayoutElement.checked = uiPreferences.compactLayout
  showThinkingElement.checked = uiPreferences.showThinkingDetails
  showToolProgressElement.checked = uiPreferences.showToolProgress
  showDiagnosticsElement.checked = uiPreferences.showDiagnostics
  autoContextElement.checked = uiPreferences.autoContext
  systemInstructionsElement.value = uiPreferences.customSystemInstructions
  workspaceSettingsElement.checked = uiPreferences.workspaceOnly
  applyUiPreferences()
  connectionIndicatorElement.classList.toggle('online', connection === 'online')
  connectionIndicatorElement.classList.toggle('offline', connection === 'offline')
  connectionIndicatorElement.classList.toggle('external', controls.networkAccess === 'external')
  connectionTextElement.textContent = connection === 'online'
    ? controls.networkAccess === 'external' ? 'Connected · external endpoint' : 'Connected'
    : connection === 'offline'
      ? controls.networkAccess === 'external' ? 'Offline · external endpoint' : 'Offline'
      : 'Checking…'

  attachmentListElement.textContent = ''
  for (const attachment of attachments) {
    const chip = document.createElement('span')
    chip.className = 'attachment-chip'
    chip.textContent = attachment.name
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '×'
    remove.setAttribute('aria-label', `Remove ${attachment.name}`)
    remove.dataset.attachmentName = attachment.name
    chip.append(remove)
    attachmentListElement.append(chip)
  }
  renderPresets()
}

const renderContextPreview = () => {
  contextPreviewElement.textContent = ''
  const items: Array<{ key: keyof typeof contextEnabled; label: string; detail: string }> = [
    { key: 'workspace', label: 'Workspace', detail: contextData.workspaceName },
    { key: 'folders', label: 'Folders', detail: `${contextData.folders.length} folder${contextData.folders.length === 1 ? '' : 's'}` },
    { key: 'activeFile', label: 'Active editor', detail: contextData.activeFile?.name ?? 'No active file' },
    { key: 'selection', label: 'Selection', detail: contextData.activeFile?.hasSelection ? 'Selected text' : 'No selection' },
    { key: 'openFiles', label: 'Open files', detail: `${contextData.openFiles.length} file${contextData.openFiles.length === 1 ? '' : 's'}` },
    { key: 'tools', label: 'Available tools', detail: `${contextData.tools.length} tools` }
  ]
  for (const item of items) {
    const label = document.createElement('label')
    label.className = 'context-preview-item'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = contextEnabled[item.key]
    checkbox.disabled = item.detail.startsWith('No ') || item.detail === '0 files' || item.detail === '0 tools'
    checkbox.dataset.contextKey = item.key
    const text = document.createElement('span')
    text.innerHTML = `<strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small>`
    label.append(checkbox, text)
    contextPreviewElement.append(label)
  }

  const toolsSection = document.createElement('section')
  toolsSection.className = 'tools-preview'
  const toolsHeading = document.createElement('h3')
  toolsHeading.textContent = `Available tools (${contextData.tools.length})`
  toolsSection.append(toolsHeading)

  if (contextData.tools.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'modal-description'
    empty.textContent = 'No tools are available.'
    toolsSection.append(empty)
  } else {
    const toolsList = document.createElement('ul')
    for (const tool of contextData.tools) {
      const toolItem = document.createElement('li')
      const name = document.createElement('code')
      name.textContent = tool
      const description = document.createElement('small')
      description.textContent = toolDescriptions[tool] ?? 'Workspace tool available to Ghost.'
      toolItem.append(name, description)
      toolsList.append(toolItem)
    }
    toolsSection.append(toolsList)
  }

  contextPreviewElement.append(toolsSection)
}

const renderHistory = () => {
  const query = historySearchElement.value.trim().toLowerCase()
  historyListElement.textContent = ''
  const entries = state.conversations.filter(conversation => (
    conversation.title.toLowerCase().includes(query) ||
    conversation.messages.some(message => message.content.toLowerCase().includes(query))
  ))
  if (entries.length === 0) {
    historyListElement.innerHTML = '<p class="modal-description">No matching conversations.</p>'
    return
  }
  for (const conversation of entries) {
    const item = document.createElement('div')
    item.className = `conversation-item${conversation.id === state.activeConversationId ? ' active' : ''}`
    const select = document.createElement('button')
    select.type = 'button'
    select.className = 'conversation-select'
    select.textContent = conversation.title
    select.title = `Open ${conversation.title}`
    select.dataset.historyConversation = conversation.id
    const meta = document.createElement('small')
    meta.className = 'conversation-meta'
    meta.textContent = `${conversation.messages.length} message${conversation.messages.length === 1 ? '' : 's'}`
    const actions = document.createElement('span')
    actions.className = 'conversation-actions'
    const rename = document.createElement('button')
    rename.type = 'button'
    rename.className = 'conversation-action'
    rename.textContent = '…'
    rename.title = 'Rename conversation'
    rename.setAttribute('aria-label', `Rename ${conversation.title}`)
    rename.dataset.conversationAction = 'rename'
    rename.dataset.conversationId = conversation.id
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'conversation-action'
    remove.textContent = '×'
    remove.title = 'Delete conversation'
    remove.setAttribute('aria-label', `Delete ${conversation.title}`)
    remove.dataset.conversationAction = 'delete'
    remove.dataset.conversationId = conversation.id
    actions.append(rename, remove)
    item.append(select, meta, actions)
    historyListElement.append(item)
  }
}

const renderPresets = () => {
  const selected = presetSelectElement.value
  presetSelectElement.textContent = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = 'Choose a preset'
  presetSelectElement.append(placeholder)
  for (const preset of presets()) {
    const option = document.createElement('option')
    option.value = preset.id
    option.textContent = preset.name
    presetSelectElement.append(option)
  }
  presetSelectElement.value = presets().some(preset => preset.id === selected) ? selected : ''
}

const setModalVisibility = (modal: HTMLElement, visible: boolean) => {
  modal.hidden = !visible
  if (visible) {
    const focusable = modal.querySelector<HTMLElement>('button, input, select, textarea')
    focusable?.focus()
  }
}

const buildRequestOptions = (): WebviewRequestOptions => ({
  provider: controls.provider,
  model: controls.chatModel,
  temperature: controls.temperature,
  topP: controls.topP,
  topK: controls.topK,
  minP: controls.minP,
  presencePenalty: controls.presencePenalty,
  repeatPenalty: controls.repeatPenalty,
  maxContextTokens: controls.maxContextTokens,
  maxTokens: maxTokensForLength(controls.responseLength),
  mode: controls.mode,
  showReasoning,
  customSystemInstructions: uiPreferences.customSystemInstructions,
  context: uiPreferences.autoContext ? { ...contextEnabled } : {
    workspace: false,
    folders: false,
    activeFile: false,
    selection: false,
    openFiles: false,
    tools: contextEnabled.tools
  }
})

const addAttachment = (attachment: Attachment) => {
  if (!attachments.some(existing => existing.name === attachment.name && existing.path === attachment.path)) {
    attachments = [...attachments, attachment]
    post('attach', { ...lifecycleEnvelope('attach'), attachments: [attachment] })
    renderControls()
  }
}

const readDroppedFile = async (file: File) => {
  if (file.size > 1024 * 1024) {
    setNotice('error', `${file.name} is larger than 1 MB.`)
    return
  }
  const content = await file.text()
  addAttachment({ name: file.name, content, mimeType: file.type })
}

const getActiveConversation = (): Conversation => {
  const existing = state.conversations.find(conversation => conversation.id === state.activeConversationId)
  if (existing) {
    return existing
  }

  const conversation = createConversation()
  state = {
    schemaVersion: persistenceSchemaVersion,
    conversations: [...state.conversations, conversation],
    activeConversationId: conversation.id
  }
  saveState()
  return conversation
}

const saveDraft = (): void => {
  const conversation = state.conversations.find(item => item.id === state.activeConversationId)
  if (!conversation) {
    return
  }
  conversation.draft = promptElement.value
  conversation.updatedAt = Date.now()
}

const restoreDraft = (): void => {
  const conversation = getActiveConversation()
  promptElement.value = conversation.draft || conversation.promptHistory[0] || ''
  historyIndex = -1
  updateComposer()
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const escapeAttribute = (value: string): string => escapeHtml(value).replace(/\n/g, '&#10;')

const safeLink = (value: string): string | undefined => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const inlineMarkdown = (value: string): string => {
  let html = escapeHtml(value)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, url: string) => {
    const safeUrl = safeLink(url)
    return safeUrl
      ? `<a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noreferrer">${label}</a>`
      : label
  })
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>')
  return html.replace(/\n/g, '<br>')
}

const codeTokenClass = (token: string): string => {
  if (/^(\/\/|#|\/\*)/.test(token)) {
    return 'code-comment'
  }
  if (/^["'`]/.test(token)) {
    return 'code-string'
  }
  if (/^\d/.test(token)) {
    return 'code-number'
  }
  return 'code-keyword'
}

const highlightCode = (code: string): string => {
  const tokenPattern = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b(?:const|let|var|function|return|if|else|for|while|class|interface|type|import|from|export|async|await|new|true|false|null|undefined|public|private|extends|implements|def|in|with|try|catch|throw)\b)/g
  let html = ''
  let lastIndex = 0

  for (const match of code.matchAll(tokenPattern)) {
    const token = match[0]
    const index = match.index ?? 0
    html += escapeHtml(code.slice(lastIndex, index))
    html += `<span class="${codeTokenClass(token)}">${escapeHtml(token)}</span>`
    lastIndex = index + token.length
  }

  return html + escapeHtml(code.slice(lastIndex))
}

const codeBlock = (code: string, language: string): string => {
  const encodedCode = encodeURIComponent(code)
  const label = language || 'code'
  return `<div class="code-block">
    <div class="code-header"><span>${escapeHtml(label)}</span><button type="button" class="code-copy" data-code="${encodedCode}" aria-label="Copy code">Copy</button></div>
    <pre><code>${highlightCode(code)}</code></pre>
  </div>`
}

const tableCells = (line: string): string[] => line
  .trim()
  .replace(/^\|/, '')
  .replace(/\|$/, '')
  .split('|')
  .map(cell => cell.trim())

const isTableSeparator = (line: string): boolean => {
  const cells = tableCells(line)
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))
}

const renderMarkdown = (markdown: string): string => {
  const lines = redactSensitiveText(markdown).slice(0, 120000).replace(/\r\n/g, '\n').split('\n')
  const output: string[] = []
  let paragraph: string[] = []
  let listOpen = false
  let codeLines: string[] = []
  let codeLanguage = ''
  let inCode = false

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      output.push(`<p>${inlineMarkdown(paragraph.join('\n'))}</p>`)
      paragraph = []
    }
  }

  const closeList = () => {
    if (listOpen) {
      output.push('</ul>')
      listOpen = false
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        output.push(codeBlock(codeLines.join('\n'), codeLanguage))
        codeLines = []
        codeLanguage = ''
        inCode = false
      } else {
        flushParagraph()
        closeList()
        inCode = true
        codeLanguage = line.trim().slice(3).trim()
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      closeList()
      continue
    }

    if (line.startsWith('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushParagraph()
      closeList()
      const headers = tableCells(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      index -= 1
      output.push(`<table><thead><tr>${headers.map(header => `<th>${inlineMarkdown(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      closeList()
      const level = heading[1].length
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    const listItem = /^\s*[-*]\s+(.+)$/.exec(line)
    if (listItem) {
      flushParagraph()
      if (!listOpen) {
        output.push('<ul>')
        listOpen = true
      }
      output.push(`<li>${inlineMarkdown(listItem[1])}</li>`)
      continue
    }

    closeList()
    paragraph.push(line)
  }

  if (inCode) {
    output.push(codeBlock(codeLines.join('\n'), codeLanguage))
  }
  flushParagraph()
  closeList()
  return output.join('') || '<p class="message-placeholder">Ghost is thinking…</p>'
}

const findMessage = (conversation: Conversation, messageId: string): ChatMessage | undefined => (
  conversation.messages.find(message => message.id === messageId)
)

const messageText = (message: ChatMessage): string => (
  message.parts
    .filter((part): part is Extract<MessagePart, { kind: 'text' }> => part.kind === 'text')
    .map(part => part.text)
    .join('')
)

const appendTextPart = (message: ChatMessage, delta: string): void => {
  delta = redactSensitiveText(delta).slice(0, Math.max(0, 120000 - message.content.length))
  const lastPart = message.parts[message.parts.length - 1]
  if (lastPart?.kind === 'text') {
    lastPart.text += delta
  } else {
    message.parts.push(textPart(delta))
  }
  message.content = messageText(message)
  message.updatedAt = Date.now()
}

const appendProgressPart = (message: ChatMessage, text: string, metadata: {
  phase?: ProgressPhase
  elapsedMs?: number
  tokenCount?: number
  tokensPerSecond?: number
  model?: string
} = {}): void => {
  const lastPart = message.parts[message.parts.length - 1]
  if ((lastPart?.kind === 'progress' || lastPart?.kind === 'reasoning') && lastPart.text === text) {
    Object.assign(lastPart, metadata)
  } else {
    message.parts.push({ kind: 'progress', text, ...metadata })
  }
  message.updatedAt = Date.now()
}

const appendWarningPart = (message: ChatMessage, warning: string): void => {
  message.parts.push({ kind: 'warning', message: warning })
  message.updatedAt = Date.now()
}

const appendErrorPart = (message: ChatMessage, error: string, recoverable = false): void => {
  message.parts.push({ kind: 'error', message: error, recoverable })
  message.updatedAt = Date.now()
}

const findMessageElement = (messageId: string): HTMLElement | undefined => (
  Array.from(messagesElement.querySelectorAll<HTMLElement>('[data-message-id]'))
    .find(element => element.dataset.messageId === messageId)
)

const copyText = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const input = document.createElement('textarea')
    input.value = text
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.append(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  screenReaderStatusElement.textContent = 'Copied to clipboard'
}

const addAction = (container: HTMLElement, label: string, action: string, messageId: string) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'message-action'
  button.textContent = label
  button.setAttribute('aria-label', `${label} message`)
  button.dataset.action = action
  button.dataset.messageId = messageId
  container.append(button)
}

const stopReasonLabels: Record<StopReason, string> = {
  'failed-tool': 'Tool failed',
  'invalid-model-response': 'Invalid model response',
  cancelled: 'Request cancelled',
  timeout: 'Request timed out',
  'approval-rejected': 'Approval rejected',
  'context-limit': 'Context limit reached',
  'budget-limit': 'Request budget reached',
  'provider-failure': 'Provider failed'
}

const stopReasonLabel = (reason: StopReason | undefined): string => (
  reason ? stopReasonLabels[reason] : 'Ghost request failed'
)

const createMessageElement = (message: ChatMessage): HTMLElement => {
  const article = document.createElement('article')
  article.className = `message ${message.role}${message.status === 'error' ? ' error' : ''}`
  article.dataset.messageId = message.id
  const partSummary = renderMessagePartSummary(message)
  const responseStats = renderResponseStats(message)
  const messageState = message.status === 'streaming'
    ? 'Thinking...'
    : message.requestStatus === 'waiting-for-approval'
      ? 'Waiting for approval...'
      : message.stopReason
        ? stopReasonLabel(message.stopReason)
      : ''
  article.innerHTML = `
    <div class="message-header"><strong>${message.role === 'user' ? 'You' : `${escapeHtml(uiPreferences.assistantAvatar)} ${escapeHtml(uiPreferences.assistantName || 'Ghost')}`}</strong><span class="message-state">${messageState}</span></div>
    ${partSummary}
    <div class="message-body">${renderMarkdown(message.content)}</div>
    ${responseStats}
    <div class="message-actions" aria-label="Message actions"></div>
  `
  const actions = article.querySelector<HTMLElement>('.message-actions')
  if (actions && message.role === 'assistant' && message.content) {
    addAction(actions, 'Copy', 'copy', message.id)
    addAction(actions, 'Retry', 'retry', message.id)
    addAction(actions, 'Regenerate', 'regenerate', message.id)
    addAction(actions, 'Edit & resend', 'edit-resend', message.id)
  }
  if (actions && message.role === 'user') {
    addAction(actions, 'Edit', 'edit', message.id)
  }
  return article
}

const renderResponseStats = (message: ChatMessage): string => {
  if (message.role !== 'assistant' || !message.responseStats) {
    return ''
  }
  const { elapsedMs, model, tokenCount, tokensPerSecond } = message.responseStats
  const modelLabel = model ? ` · ${escapeHtml(model)}` : ''
  return `<div class="message-response-stats">${formatElapsed(elapsedMs)} · ${tokenCount} tok · ${tokensPerSecond.toFixed(1)} tok/s${modelLabel}</div>`
}

const toolActionText = (toolCall: ToolCall): string => {
  let args: Record<string, unknown> = {}
  if (toolCall.arguments) {
    try {
      const parsed = JSON.parse(toolCall.arguments) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>
      }
    } catch {
      // Keep the short tool description when arguments are malformed.
    }
  }

  const path = typeof args.path === 'string' ? args.path.trim() : ''
  const command = typeof args.command === 'string' ? args.command.trim() : ''
  const target = path || command
  const displayedTarget = target.length > 180 ? `${target.slice(0, 177)}…` : target
  const base = toolCall.name === 'ghost_read_file'
    ? `I'm reading file${displayedTarget ? ` ${displayedTarget}` : ''}`
    : toolCall.name === 'ghost_write_file'
      ? `I'm writing file${displayedTarget ? ` ${displayedTarget}` : ''}`
      : toolCall.name === 'ghost_apply_edit'
        ? `I'm editing file${displayedTarget ? ` ${displayedTarget}` : ''}`
        : toolCall.name === 'ghost_apply_transaction'
          ? `I'm applying a file transaction${displayedTarget ? `: ${displayedTarget}` : ''}`
        : toolCall.name === 'ghost_run_terminal_command'
          ? `I'm executing command${displayedTarget ? `: ${displayedTarget}` : ''}`
          : toolCall.name === 'ghost_list_directory'
            ? `I'm listing directory${displayedTarget ? ` ${displayedTarget}` : ''}`
            : `I'm running ${toolCall.name}`

  if (toolCall.status === 'requested' && toolCall.requiresApproval) {
    return `Waiting for approval: ${base.replace(/^I'm /, '')}`
  }
  if (toolCall.status === 'completed') {
    return `Done: ${base.replace(/^I'm /, '')}`
  }
  if (toolCall.status === 'failed') {
    return `Failed: ${base.replace(/^I'm /, '')}`
  }
  if (toolCall.status === 'rejected') {
    return `Rejected: ${base.replace(/^I'm /, '')}`
  }
  return base
}

const renderMessagePartSummary = (message: ChatMessage): string => {
  const parts = message.parts.filter(part => part.kind !== 'text')
  if (parts.length === 0) {
    return ''
  }
  const progressParts = parts.filter((part): part is Extract<MessagePart, { kind: 'progress' | 'reasoning' }> => part.kind === 'progress' || part.kind === 'reasoning')
  const toolParts = parts.filter((part): part is Extract<MessagePart, { kind: 'tool' }> => part.kind === 'tool')
  const warningParts = parts.filter((part): part is Extract<MessagePart, { kind: 'warning' }> => part.kind === 'warning')
  const errorParts = parts.filter((part): part is Extract<MessagePart, { kind: 'error' }> => part.kind === 'error')
  const renderedProgress = uiPreferences.showThinkingDetails && progressParts.length > 0
    ? `<details class="progress-details"${message.status === 'streaming' ? ' open' : ''}><summary>Progress (${progressParts.length})</summary>${progressParts.map(part => `<div class="message-progress">${escapeHtml(part.text)}</div>`).join('')}</details>`
    : ''
  const renderedTools = toolParts.map(part => {
    const result = part.toolCall.result ? `: ${part.toolCall.result}` : ''
    const durationEnd = part.toolCall.completedAt ?? (part.toolCall.status === 'running' ? Date.now() : undefined)
    const duration = durationEnd ? ` · ${((durationEnd - part.toolCall.startedAt) / 1000).toFixed(1)}s` : ''
    const argumentsBlock = uiPreferences.showToolProgress && part.toolCall.arguments
      ? `<details class="tool-details"><summary>Arguments</summary><pre>${escapeHtml(part.toolCall.arguments)}</pre></details>`
      : ''
    const diffBlock = part.toolCall.diffPreview
      ? `<details class="tool-details"><summary>Diff preview · ${escapeHtml(part.toolCall.diffPreview.path)}${part.toolCall.diffPreview.truncated ? ' · truncated' : ''}</summary>${part.toolCall.diffPreview.hunks?.length ? `<div class="tool-hunk-list">${part.toolCall.diffPreview.hunks.map((hunk, index) => `<label><input type="checkbox" data-tool-hunk="${index}" data-tool-call-id="${escapeAttribute(part.toolCall.id)}" checked> Lines ${hunk.startLine}-${hunk.endLine}<button type="button" class="secondary" data-tool-action="open-hunk" data-tool-line="${hunk.startLine}" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Open line</button></label>`).join('')}</div>` : ''}<pre>--- before\n+++ after\n${escapeHtml(part.toolCall.diffPreview.before)}\n--- proposed replacement ---\n${escapeHtml(part.toolCall.diffPreview.after)}</pre></details>`
      : ''
    const resultBlock = uiPreferences.showToolProgress && part.toolCall.result
      ? `<details class="tool-details"><summary>Result</summary><pre>${escapeHtml(part.toolCall.result)}</pre></details>`
      : ''
    const approvalControls = part.toolCall.requiresApproval && part.toolCall.status === 'requested'
      ? `<div class="tool-approval-actions"><button type="button" data-tool-action="approve" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Approve now</button><button type="button" data-tool-action="approve-session" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">${part.toolCall.name === 'ghost_write_file' || part.toolCall.name === 'ghost_apply_edit' || part.toolCall.name === 'ghost_apply_transaction' ? 'Apply to all files' : 'Approve for session'}</button><button type="button" data-tool-action="edit" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Edit arguments…</button><button type="button" class="secondary" data-tool-action="reject" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Reject</button><button type="button" class="secondary" data-tool-action="cancel" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Cancel request</button></div>`
      : ''
    const selectedHunkAction = part.toolCall.status === 'requested' && part.toolCall.diffPreview?.hunks?.length
      ? `<button type="button" data-tool-action="approve-selected" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Apply selected hunks</button>`
      : ''
    const fileAction = part.toolCall.diffPreview
      ? `<button type="button" class="secondary" data-tool-action="open-file" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Open file</button>`
      : ''
    const restoreAction = part.toolCall.status === 'completed' && (part.toolCall.name === 'ghost_write_file' || part.toolCall.name === 'ghost_apply_edit' || part.toolCall.name === 'ghost_apply_transaction')
      ? `<button type="button" class="secondary" data-tool-action="restore" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Restore</button>`
      : ''
    const retryToolAction = part.toolCall.result && (part.toolCall.status === 'failed' || part.toolCall.status === 'rejected') && part.toolCall.arguments
      ? `<button type="button" data-tool-action="retry-tool" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Retry tool</button>`
      : ''
    const rerunRequestAction = part.toolCall.result && part.toolCall.status !== 'failed' && part.toolCall.status !== 'rejected'
      ? `<button type="button" class="secondary" data-tool-action="rerun" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Rerun request</button>`
      : ''
    const resultActions = part.toolCall.result || fileAction || restoreAction
      ? `<div class="tool-result-actions">${fileAction}${restoreAction}${selectedHunkAction}${retryToolAction}${part.toolCall.result ? `<button type="button" class="secondary" data-tool-action="copy-result" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Copy result</button>${rerunRequestAction}` : ''}</div>`
      : ''
    const verboseStatus = uiPreferences.showToolProgress ? ` · ${escapeHtml(part.toolCall.status)}${escapeHtml(duration)}${escapeHtml(result)}` : ''
    const compactFailure = !uiPreferences.showToolProgress && part.toolCall.result && (part.toolCall.status === 'failed' || part.toolCall.status === 'rejected')
      ? ` — ${escapeHtml(part.toolCall.result.replace(/^Tool error:\s*/i, '').replace(/\s+/g, ' ').slice(0, 240))}`
      : ''
    const toolStatusClass = part.toolCall.status === 'completed'
      ? 'tool-success'
      : part.toolCall.status === 'failed' || part.toolCall.status === 'rejected'
        ? 'tool-failure'
        : ''
    const toolStatusIcon = part.toolCall.status === 'completed'
      ? '✓'
      : part.toolCall.status === 'failed' || part.toolCall.status === 'rejected'
        ? '✕'
        : '•'
    return `<div class="message-progress tool-progress ${toolStatusClass}"><span class="tool-status-icon" aria-hidden="true">${toolStatusIcon}</span><strong>${escapeHtml(toolActionText(part.toolCall))}${compactFailure}</strong>${verboseStatus}${argumentsBlock}${diffBlock}${resultBlock}${approvalControls}${resultActions}</div>`
  }).join('')
  const renderedWarnings = warningParts.map(part => `<div class="message-progress warning-progress">Warning: ${escapeHtml(part.message)}</div>`).join('')
  const renderedErrors = errorParts.map(part => `<div class="message-progress error-progress">${escapeHtml(part.message)}</div>`).join('')
  return `<div class="message-part-summary">${renderedProgress}${renderedTools}${renderedWarnings}${renderedErrors}</div>`
}

const stateCard = (): string => {
  if (viewStatus === 'offline') {
    return '<div class="state-card"><div class="state-icon">!</div><h1>Provider offline</h1><p>Ghost cannot reach the configured local model. Check the connection, then try again.</p><button type="button" data-state-action="check">Check connection</button></div>'
  }
  if (notice?.kind === 'no-model') {
    return `<div class="state-card"><div class="state-icon">↓</div><h1>No model installed</h1><p>${escapeHtml(notice.message)}</p><p class="state-help">Pull the configured model, then retry your prompt.</p></div>`
  }
  if (notice?.kind === 'error') {
    return `<div class="state-card"><div class="state-icon">!</div><h1>Something went wrong</h1><p>${escapeHtml(notice.message)}</p></div>`
  }
  return '<div class="state-card"><div class="state-icon">✦</div><h1>Start a conversation</h1><p>Ask about your code, explain an error, or let Ghost help with a task.</p></div>'
}

const updateMessageElement = (message: ChatMessage) => {
  const element = findMessageElement(message.id)
  if (!element) {
    renderMessages(false)
    return
  }
  const body = element.querySelector<HTMLElement>('.message-body')
  const status = element.querySelector<HTMLElement>('.message-state')
  if (body) {
    body.innerHTML = renderMarkdown(message.content)
  }
  if (status) {
    status.textContent = message.status === 'streaming'
      ? 'Thinking...'
      : message.requestStatus === 'waiting-for-approval'
        ? 'Waiting for approval...'
        : ''
  }
  const existingSummary = element.querySelector<HTMLElement>('.message-part-summary')
  const summary = renderMessagePartSummary(message)
  if (existingSummary) {
    existingSummary.outerHTML = summary || '<div class="message-part-summary" hidden></div>'
  } else if (summary) {
    body?.insertAdjacentHTML('beforebegin', summary)
  }
  const existingStats = element.querySelector<HTMLElement>('.message-response-stats')
  const stats = renderResponseStats(message)
  if (existingStats) {
    existingStats.outerHTML = stats || '<div class="message-response-stats" hidden></div>'
  } else if (stats) {
    element.querySelector<HTMLElement>('.message-actions')?.insertAdjacentHTML('beforebegin', stats)
  }
  element.classList.toggle('error', message.status === 'error')
}

const scrollMessages = (force: boolean) => {
  requestAnimationFrame(() => {
    if (force || userIsAtBottom) {
      messagesElement.scrollTop = messagesElement.scrollHeight
    }
  })
}

const updateComposer = () => {
  const length = promptElement.value.length
  composerCountElement.textContent = `${length} chars · ~${Math.ceil(length / 4)} tokens`
  promptElement.rows = promptRows
  promptElement.style.height = 'auto'
  promptElement.style.height = `${Math.min(promptElement.scrollHeight, composerHeight)}px`
  promptElement.style.overflowY = promptElement.scrollHeight > composerHeight ? 'auto' : 'hidden'
  const busy = Boolean(activeRequest && !['completed', 'cancelled', 'failed'].includes(activeRequest.status))
  sendElement.disabled = busy || promptElement.value.trim().length === 0
  const entries = promptHistory()
  previousPromptElement.disabled = busy || entries.length === 0 || historyIndex >= entries.length - 1
  nextPromptElement.disabled = busy || historyIndex < 0
  stopElement.hidden = !busy
  promptElement.disabled = busy
  composerElement.classList.toggle('busy', busy)
  statusFooterElement.classList.toggle('busy', busy)
  statusFooterElement.classList.toggle('offline', viewStatus === 'offline')
}

const renderMessages = (forceScroll: boolean) => {
  const conversation = getActiveConversation()
  const previousScrollTop = messagesElement.scrollTop
  messagesElement.textContent = ''
  if (conversation.messages.length === 0) {
    messagesElement.innerHTML = stateCard()
  } else {
    const firstVisibleIndex = Math.max(0, conversation.messages.length - visibleMessageCount)
    if (firstVisibleIndex > 0) {
      const older = document.createElement('button')
      older.type = 'button'
      older.className = 'context-button load-older'
      older.textContent = `Load ${Math.min(200, firstVisibleIndex)} older messages`
      older.dataset.loadOlder = 'true'
      messagesElement.append(older)
    }
    for (const message of conversation.messages.slice(firstVisibleIndex)) {
      messagesElement.append(createMessageElement(message))
    }
  }
  if (!forceScroll && !userIsAtBottom) {
    requestAnimationFrame(() => {
      messagesElement.scrollTop = previousScrollTop
    })
  } else {
    scrollMessages(forceScroll)
  }
}

const updateStatus = () => {
  if (activeRequest) {
    const statusLabels: Record<RequestStatus, string> = {
      idle: 'Ready',
      preparing: 'Preparing context…',
      connecting: 'Connecting to provider…',
      thinking: 'Ghost is thinking…',
      streaming: 'Ghost is writing…',
      'waiting-for-approval': 'Waiting for approval…',
      completed: 'Complete',
      cancelled: 'Cancelled',
      failed: 'Request failed'
    }
    const elapsed = formatElapsed(Date.now() - activeRequest.startedAt)
    const telemetry = activeRequest.tokenCount > 0
      ? ` · ~${activeRequest.tokenCount} tok${activeRequest.tokensPerSecond ? ` · ~${activeRequest.tokensPerSecond.toFixed(1)} tok/s` : ''}`
      : ''
    const diagnostics = uiPreferences.showDiagnostics && activeRequest.latestDetail ? ` · ${activeRequest.latestDetail}` : ''
    statusTextElement.textContent = `${statusLabels[activeRequest.status]} · ${activeRequest.model} · ${elapsed}${telemetry}${diagnostics}`
    screenReaderStatusElement.textContent = activeRequest.latestDetail || statusLabels[activeRequest.status]
  } else if (viewStatus === 'offline') {
    statusTextElement.textContent = 'Offline'
  } else if (notice) {
    statusTextElement.textContent = notice.kind === 'no-model' ? 'Model not installed' : 'Error'
  } else {
    statusTextElement.textContent = 'Ready'
  }
  updateComposer()
}

const render = (forceScroll = false) => {
  renderControls()
  renderMessages(forceScroll)
  updateStatus()
  saveState()
}

const setNotice = (kind: NoticeKind, message: string) => {
  notice = { kind, message }
  render(false)
}

const startNewConversation = () => {
  saveDraft()
  const conversation = createConversation()
  state = {
    schemaVersion: persistenceSchemaVersion,
    conversations: [conversation, ...state.conversations],
    activeConversationId: conversation.id
  }
  notice = undefined
  render(true)
  restoreDraft()
  promptElement.focus()
}

const applySlashCommand = (prompt: string): string | undefined => {
  const command = /^\/(clear|model|explain|fix|summarize)\b\s*(.*)$/i.exec(prompt)
  if (!command) {
    return prompt
  }
  const name = command[1].toLowerCase()
  const rest = command[2].trim()
  if (name === 'clear') {
    post('clear')
    const conversation = getActiveConversation()
    conversation.messages = []
    attachments = []
    notice = undefined
    activeRequest = undefined
    stopProgressTimer()
    requests.clear()
    render(true)
    return undefined
  }
  if (name === 'model') {
    setModalVisibility(settingsModalElement, true)
    return undefined
  }
  if (name === 'explain') {
    controls.mode = 'explain'
  } else if (name === 'fix') {
    controls.mode = 'edit'
  } else if (name === 'summarize') {
    return rest ? `Summarize this for me:\n\n${rest}` : 'Summarize the current context for me.'
  }
  renderControls()
  sendSettingsUpdate()
  return rest || prompt
}

const submitPrompt = (rawPrompt: string) => {
  const prompt = applySlashCommand(rawPrompt.trim())?.trim().slice(0, 20000) ?? ''
  if (!prompt || activeRequest) {
    return
  }

  const conversation = getActiveConversation()
  const userMessage = createMessage('user', prompt)
  const requestId = createId('request')
  const assistantMessage = createMessage('assistant', '', requestId)
  assistantMessage.status = 'streaming'
  assistantMessage.requestStatus = 'preparing'
  if (conversation.messages.length === 0) {
    conversation.title = prompt.length > 32 ? `${prompt.slice(0, 32)}…` : prompt
  }
  conversation.messages.push(userMessage, assistantMessage)
  conversation.draft = ''
  conversation.updatedAt = Date.now()
  conversation.activeRequestId = requestId
  activeRequest = {
    requestId,
    conversationId: conversation.id,
    assistantMessageId: assistantMessage.id,
    lastSequence: 0,
    status: 'preparing',
    attempt: 0,
    startedAt: Date.now(),
    model: controls.chatModel,
    phase: 'context',
    latestDetail: 'Preparing context',
    tokenCount: 0
  }
  requests.set(requestId, activeRequest)
  startProgressTimer()
  notice = undefined
  conversation.promptHistory = addPromptToHistory(conversation.promptHistory, prompt)
  state.promptHistory = conversation.promptHistory
  promptElement.value = ''
  const submittedAttachments = attachments
  attachments = []
  render(true)
  post('submit', {
    requestId,
    conversationId: conversation.id,
    prompt,
    options: buildRequestOptions(),
    attachments: submittedAttachments
  })
}

const editMessage = (messageId: string) => {
  const conversation = getActiveConversation()
  const message = findMessage(conversation, messageId)
  if (!message) {
    return
  }
  promptElement.value = message.content
  saveDraft()
  updateComposer()
  promptElement.focus()
  promptElement.setSelectionRange(promptElement.value.length, promptElement.value.length)
}

const retryMessage = (messageId: string) => {
  if (activeRequest) {
    return
  }
  const conversation = getActiveConversation()
  const assistantIndex = conversation.messages.findIndex(message => message.id === messageId)
  const userMessage = assistantIndex > 0 ? conversation.messages[assistantIndex - 1] : undefined
  if (!userMessage || userMessage.role !== 'user') {
    return
  }
  conversation.messages = conversation.messages.slice(0, assistantIndex - 1)
  submitPrompt(userMessage.content)
}

const editAndResendMessage = (messageId: string) => {
  if (activeRequest) {
    return
  }
  const conversation = getActiveConversation()
  const assistantIndex = conversation.messages.findIndex(message => message.id === messageId)
  const userMessage = assistantIndex > 0 ? conversation.messages[assistantIndex - 1] : undefined
  if (!userMessage || userMessage.role !== 'user') {
    return
  }
  const editedPrompt = window.prompt('Edit prompt and resend', userMessage.content)?.trim()
  if (!editedPrompt) {
    return
  }
  conversation.messages = conversation.messages.slice(0, assistantIndex - 1)
  submitPrompt(editedPrompt)
}

const findToolCall = (toolCallId: string): { message: ChatMessage; toolCall: ToolCall } | undefined => {
  for (const message of getActiveConversation().messages) {
    const part = message.parts.find((item): item is Extract<MessagePart, { kind: 'tool' }> => item.kind === 'tool' && item.toolCall.id === toolCallId)
    if (part) {
      return { message, toolCall: part.toolCall }
    }
  }
  return undefined
}

const submitToolRetry = (found: { message: ChatMessage; toolCall: ToolCall }): void => {
  if (activeRequest || !found.toolCall.arguments) {
    return
  }
  let argumentsPayload: unknown
  try {
    argumentsPayload = JSON.parse(found.toolCall.arguments)
  } catch {
    setNotice('error', 'Ghost cannot retry this tool because its saved arguments are not valid JSON.')
    return
  }
  if (!argumentsPayload || typeof argumentsPayload !== 'object' || Array.isArray(argumentsPayload)) {
    setNotice('error', 'Ghost cannot retry this tool because its saved arguments are not a JSON object.')
    return
  }
  const retryableTools = ['ghost_read_file', 'ghost_search_workspace', 'ghost_get_diagnostics', 'ghost_write_file', 'ghost_apply_edit', 'ghost_apply_transaction', 'ghost_run_terminal_command', 'ghost_list_directory']
  if (!retryableTools.includes(found.toolCall.name)) {
    setNotice('error', 'Ghost cannot retry this unknown tool.')
    return
  }
  const conversation = getActiveConversation()
  const requestId = createId('request')
  const assistantMessage = createMessage('assistant', '', requestId)
  assistantMessage.status = 'streaming'
  assistantMessage.requestStatus = 'preparing'
  conversation.messages.push(assistantMessage)
  conversation.activeRequestId = requestId
  conversation.updatedAt = Date.now()
  activeRequest = {
    requestId,
    conversationId: conversation.id,
    assistantMessageId: assistantMessage.id,
    lastSequence: 0,
    status: 'preparing',
    attempt: 1,
    startedAt: Date.now(),
    model: controls.chatModel,
    phase: 'context',
    latestDetail: `Retrying ${found.toolCall.name}`,
    tokenCount: 0
  }
  requests.set(requestId, activeRequest)
  startProgressTimer()
  notice = undefined
  render(true)
  post('retry-tool', {
    requestId,
    conversationId: conversation.id,
    toolCallId: found.toolCall.id,
    tool: found.toolCall.name,
    arguments: argumentsPayload
  })
}

const handleToolAction = (action: string, toolCallId: string, line?: number): void => {
  const found = findToolCall(toolCallId)
  if (!found) {
    return
  }
  if (action === 'rerun') {
    retryMessage(found.message.id)
    return
  }
  if (action === 'retry-tool') {
    submitToolRetry(found)
    return
  }
  const requestId = found.message.requestId ?? activeRequest?.requestId
  if (!requestId) {
    return
  }
  const conversationId = getActiveConversation().id
  if (action === 'copy-result' && found.toolCall.result) {
    void copyText(found.toolCall.result)
    return
  }
  if ((action === 'open-file' || action === 'open-hunk') && found.toolCall.diffPreview) {
    post('open-file', {
      requestId,
      conversationId,
      path: found.toolCall.diffPreview.path,
      ...(line !== undefined ? { line } : {})
    })
    return
  }
  if (action === 'restore') {
    post('restore-tool', { requestId, conversationId, toolCallId })
    found.toolCall.result = 'Restore requested.'
    renderMessages(false)
    return
  }
  if (action === 'cancel') {
    found.toolCall.approval = 'rejected'
    found.toolCall.status = 'rejected'
    post('cancel-tool', { requestId, conversationId, toolCallId })
    renderMessages(false)
    return
  }
  if (action === 'edit') {
    const edited = window.prompt('Edit tool arguments as JSON', found.toolCall.arguments ?? '{}')
    if (edited === null) {
      return
    }
    try {
      const parsed = JSON.parse(edited) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Arguments must be a JSON object')
      }
      found.toolCall.arguments = JSON.stringify(parsed, null, 2)
      post('edit-tool', { requestId, conversationId, toolCallId, arguments: parsed })
      renderMessages(false)
    } catch {
      setNotice('error', 'Tool arguments must be a JSON object.')
    }
    return
  }
  if (action === 'approve' || action === 'approve-session' || action === 'approve-selected') {
    found.toolCall.approval = 'approved'
    found.toolCall.status = 'running'
    const selectedHunkIndexes = action === 'approve-selected'
      ? Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-tool-call-id="${CSS.escape(toolCallId)}"][data-tool-hunk]`))
        .filter(input => input.checked)
        .map(input => Number(input.dataset.toolHunk))
        .filter(index => Number.isInteger(index))
      : undefined
    post('approve-tool', {
      requestId,
      conversationId,
      toolCallId,
      decision: action === 'approve-session' ? 'session' : 'once',
      ...(selectedHunkIndexes ? { selectedHunkIndexes } : {})
    })
  } else if (action === 'reject') {
    found.toolCall.approval = 'rejected'
    found.toolCall.status = 'rejected'
    post('reject-tool', { requestId, conversationId, toolCallId })
  }
  renderMessages(false)
}

const handleMessageAction = (action: string, messageId: string) => {
  const conversation = getActiveConversation()
  const message = findMessage(conversation, messageId)
  if (!message) {
    return
  }
  if (action === 'copy') {
    void copyText(message.content)
  } else if (action === 'edit') {
    post('edit', { ...lifecycleEnvelope('edit'), messageId, prompt: message.content })
    editMessage(messageId)
  } else if (action === 'edit-resend') {
    post('edit', { ...lifecycleEnvelope('edit'), messageId, prompt: message.content })
    editAndResendMessage(messageId)
  } else if (action === 'retry' || action === 'regenerate') {
    post(action, { ...lifecycleEnvelope(action), messageId })
    retryMessage(messageId)
  }
}

const handleConversationAction = (action: string, conversationId: string) => {
  const conversation = state.conversations.find(item => item.id === conversationId)
  if (!conversation) {
    return
  }
  if (action === 'rename') {
    const title = window.prompt('Conversation name', conversation.title)?.trim()
    if (title) {
      conversation.title = title
      render(false)
    }
  } else if (action === 'delete') {
    if (!window.confirm(`Delete “${conversation.title}”?`)) {
      return
    }
    state.conversations = state.conversations.filter(item => item.id !== conversationId)
    if (state.conversations.length === 0) {
      state.conversations.push(createConversation())
    }
    if (state.activeConversationId === conversationId) {
      state.activeConversationId = state.conversations[0].id
      restoreDraft()
    }
    notice = undefined
    render(true)
  }
}

const handleExtensionMessage = (message: GhostExtensionMessage) => {
  if (message.type === 'persisted-state') {
    if (Array.isArray(message.state.conversations) && message.state.conversations.length > 0) {
      const conversations = message.state.conversations.map(value => recoverInterruptedConversation(normalizeConversation(value as Partial<Conversation>)))
      state = {
        schemaVersion: persistenceSchemaVersion,
        conversations,
        activeConversationId: conversations.some(conversation => conversation.id === message.state.activeConversationId)
          ? message.state.activeConversationId as string
          : conversations[0].id,
        promptHistory: message.state.promptHistory?.filter(item => typeof item === 'string').slice(0, 100),
        presets: message.state.presets as PromptPreset[] | undefined,
        showReasoning: message.state.showReasoning === true,
        preferences: message.state.preferences as Partial<ControlSettings> & Partial<UiPreferences> | undefined
      }
      migrateLegacyPromptHistory(conversations, state.activeConversationId, message.state.promptHistory)
      state.promptHistory = state.conversations.find(conversation => conversation.id === state.activeConversationId)?.promptHistory ?? []
      showReasoning = state.showReasoning === true
      const preferences = message.state.preferences ?? {}
      if (preferences.provider === 'ollama' || preferences.provider === 'mlx-vlm' || preferences.provider === 'openai-compatible') {
        controls.provider = preferences.provider
      }
      if (typeof preferences.chatModel === 'string' && preferences.chatModel.trim()) {
        controls.chatModel = preferences.chatModel
      }
      if (typeof preferences.autocompleteModel === 'string' && preferences.autocompleteModel.trim()) {
        controls.autocompleteModel = preferences.autocompleteModel
      }
      if (typeof preferences.maxContextTokens === 'number' && Number.isFinite(preferences.maxContextTokens)) {
        controls.maxContextTokens = Math.max(1, Math.floor(preferences.maxContextTokens))
      }
      if (typeof preferences.temperature === 'number' && Number.isFinite(preferences.temperature)) {
        controls.temperature = Math.min(2, Math.max(0, preferences.temperature))
      }
      if (typeof preferences.topP === 'number' && Number.isFinite(preferences.topP)) {
        controls.topP = Math.min(1, Math.max(0, preferences.topP))
      }
      if (typeof preferences.topK === 'number' && Number.isFinite(preferences.topK)) {
        controls.topK = Math.max(0, Math.floor(preferences.topK))
      }
      if (typeof preferences.minP === 'number' && Number.isFinite(preferences.minP)) {
        controls.minP = Math.min(1, Math.max(0, preferences.minP))
      }
      if (typeof preferences.presencePenalty === 'number' && Number.isFinite(preferences.presencePenalty)) {
        controls.presencePenalty = Math.min(2, Math.max(-2, preferences.presencePenalty))
      }
      if (typeof preferences.repeatPenalty === 'number' && Number.isFinite(preferences.repeatPenalty)) {
        controls.repeatPenalty = Math.min(3, Math.max(0, preferences.repeatPenalty))
      }
      if (preferences.responseLength === 'short' || preferences.responseLength === 'balanced' || preferences.responseLength === 'long' || preferences.responseLength === 'unlimited') {
        controls.responseLength = preferences.responseLength
      }
      if (preferences.mode === 'ask' || preferences.mode === 'edit' || preferences.mode === 'agent' || preferences.mode === 'explain' || preferences.mode === 'inline') {
        controls.mode = preferences.mode
      }
      if (preferences.autoAcceptScope === 'confirm' || preferences.autoAcceptScope === 'one-edit' || preferences.autoAcceptScope === 'current-file' || preferences.autoAcceptScope === 'request' || preferences.autoAcceptScope === 'session' || preferences.autoAcceptScope === 'workspace' || preferences.autoAcceptScope === 'always') {
        controls.fileEditApproval = preferences.autoAcceptScope
      } else if (preferences.fileEditApproval === 'confirm' || preferences.fileEditApproval === 'auto') {
        controls.fileEditApproval = preferences.fileEditApproval === 'auto' ? 'always' : 'confirm'
      }
      if (typeof preferences.enableConversationPersistence === 'boolean') {
        controls.enableConversationPersistence = preferences.enableConversationPersistence
      }
      if (typeof preferences.ollamaUrl === 'string') {
        controls.ollamaUrl = preferences.ollamaUrl
      }
      if (typeof preferences.mlxUrl === 'string') {
        controls.mlxUrl = preferences.mlxUrl
      }
      if (typeof preferences.openaiUrl === 'string') {
        controls.openaiUrl = preferences.openaiUrl
      }
      if (Array.isArray(preferences.toolAllowlist)) {
        controls.toolAllowlist = preferences.toolAllowlist.filter((item): item is string => typeof item === 'string')
      }
      if (Array.isArray(preferences.toolDenylist)) {
        controls.toolDenylist = preferences.toolDenylist.filter((item): item is string => typeof item === 'string')
      }
      if (Array.isArray(preferences.terminalEnvironmentAllowlist)) {
        controls.terminalEnvironmentAllowlist = preferences.terminalEnvironmentAllowlist
          .filter((item): item is string => typeof item === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item))
      }
      if (typeof preferences.enableDebugLogging === 'boolean') {
        controls.enableDebugLogging = preferences.enableDebugLogging
      }
      if (typeof preferences.composerHeight === 'number' && Number.isFinite(preferences.composerHeight)) {
        composerHeight = Math.min(320, Math.max(80, Math.floor(preferences.composerHeight)))
      }
      if (typeof preferences.promptRows === 'number' && Number.isFinite(preferences.promptRows)) {
        promptRows = Math.min(12, Math.max(1, Math.floor(preferences.promptRows)))
      }
      if (typeof preferences.assistantName === 'string') {
        uiPreferences.assistantName = preferences.assistantName.slice(0, 40)
      }
      if (typeof preferences.assistantAvatar === 'string') {
        uiPreferences.assistantAvatar = preferences.assistantAvatar.slice(0, 4)
      }
      if (typeof preferences.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test(preferences.accentColor)) {
        uiPreferences.accentColor = preferences.accentColor
      }
      if (typeof preferences.compactLayout === 'boolean') {
        uiPreferences.compactLayout = preferences.compactLayout
      }
      if (typeof preferences.showThinkingDetails === 'boolean') {
        uiPreferences.showThinkingDetails = preferences.showThinkingDetails
      }
      if (typeof preferences.verboseToolDetails === 'boolean') {
        uiPreferences.showToolProgress = preferences.verboseToolDetails
      }
      if (typeof preferences.showDiagnostics === 'boolean') {
        uiPreferences.showDiagnostics = preferences.showDiagnostics
      }
      if (typeof preferences.autoContext === 'boolean') {
        uiPreferences.autoContext = preferences.autoContext
      }
      if (typeof preferences.customSystemInstructions === 'string') {
        uiPreferences.customSystemInstructions = preferences.customSystemInstructions.slice(0, 8000)
      }
      if (typeof preferences.workspaceOnly === 'boolean') {
        uiPreferences.workspaceOnly = preferences.workspaceOnly
      }
      uiPreferences.composerHeight = composerHeight
      uiPreferences.promptRows = promptRows
    } else if (!controls.enableConversationPersistence) {
      state = {
        schemaVersion: persistenceSchemaVersion,
        conversations: [createConversation()],
        activeConversationId: '',
        promptHistory: [],
        presets: [],
        showReasoning: false
      }
      state.activeConversationId = state.conversations[0].id
      showReasoning = false
    }
    persistenceReady = true
    render(false)
    restoreDraft()
    return
  }
  if (message.type === 'state') {
    viewStatus = message.status
    if (message.status === 'offline' && activeRequest) {
      activeRequest.status = 'failed'
      activeRequest.phase = 'error'
      activeRequest.latestDetail = 'Provider disconnected'
      stopProgressTimer()
    }
    render(false)
    return
  }
  if (message.type === 'controls-state') {
    controls = {
      ...message.settings,
      fileEditApproval: message.settings.autoAcceptScope
    }
    availableModels = message.models
    const configuredModel = controls.chatModel
    if (availableModels.length > 0 && !availableModels.includes(configuredModel)) {
      controls.chatModel = availableModels[0]
      sendSettingsUpdate()
    }
    availableModelMetadata = message.models.map(model => ({
      id: model,
      label: model,
      provider: controls.provider,
      capabilities: ['chat']
    }))
    connection = message.connection
    viewStatus = connection === 'offline' ? 'offline' : 'ready'
    contextData = { ...message.context, tools: message.tools }
    render(false)
    return
  }
  if (message.type === 'file-picked') {
    for (const attachment of message.attachments) {
      addAttachment(attachment)
    }
    return
  }
  if (message.type === 'reset') {
    state = {
      schemaVersion: persistenceSchemaVersion,
      conversations: [createConversation()],
      activeConversationId: '',
      showReasoning: false
    }
    state.activeConversationId = state.conversations[0].id
    showReasoning = false
    activeRequest = undefined
    stopProgressTimer()
    requests.clear()
    notice = undefined
    render(true)
    restoreDraft()
    return
  }
  if (message.type === 'clear') {
    const conversation = getActiveConversation()
    conversation.messages = []
    conversation.updatedAt = Date.now()
    activeRequest = undefined
    stopProgressTimer()
    requests.clear()
    notice = undefined
    render(true)
    return
  }

  if (!('requestId' in message) || !('conversationId' in message)) {
    return
  }

  const request = requests.get(message.requestId)
  if (!request || request.conversationId !== message.conversationId) {
    return
  }
  if (!('sequence' in message) || typeof message.sequence !== 'number' || message.sequence <= request.lastSequence || (['completed', 'cancelled', 'failed'].includes(request.status) && message.type !== 'request-completed')) {
    return
  }
  request.lastSequence = message.sequence
  const conversation = state.conversations.find(item => item.id === request.conversationId)
  let assistantMessage = conversation ? findMessage(conversation, request.assistantMessageId) : undefined
  if (!conversation || !assistantMessage) {
    return
  }

  if (message.state) {
    request.status = message.state
    assistantMessage.requestStatus = message.state
  }
  if (message.stopReason) {
    request.stopReason = message.stopReason
    assistantMessage.stopReason = message.stopReason
  }
  if (message.phase) {
    request.phase = message.phase
  }
  if (message.model) {
    request.model = message.model
  }
  if (typeof message.tokenCount === 'number') {
    request.tokenCount = message.tokenCount
  }
  if (typeof message.tokensPerSecond === 'number') {
    request.tokensPerSecond = message.tokensPerSecond
  }
  if (typeof message.elapsedMs === 'number' && typeof message.tokenCount === 'number' && typeof message.tokensPerSecond === 'number') {
    assistantMessage.responseStats = {
      elapsedMs: message.elapsedMs,
      tokenCount: message.tokenCount,
      tokensPerSecond: message.tokensPerSecond,
      ...(message.model ? { model: message.model } : {})
    }
  }
  if (typeof message.startedAt === 'number' && message.type === 'request-started') {
    request.startedAt = message.startedAt
  }
  if (message.detail) {
    request.latestDetail = message.detail
  }
  if (message.type === 'request-started') {
    request.status = message.state ?? 'preparing'
    assistantMessage.requestStatus = request.status
    startProgressTimer()
    updateStatus()
    return
  }
  if (message.type === 'thinking') {
    request.status = message.state ?? (message.phase === 'context' ? 'preparing' : message.phase === 'provider' ? 'connecting' : 'thinking')
    const detail = message.detail ?? 'Ghost is working'
    appendProgressPart(assistantMessage, detail, {
      phase: message.phase,
      elapsedMs: message.elapsedMs,
      tokenCount: message.tokenCount,
      tokensPerSecond: message.tokensPerSecond,
      model: message.model
    })
    screenReaderStatusElement.textContent = message.detail ?? 'Ghost is working'
    updateMessageElement(assistantMessage)
    updateStatus()
    return
  }
  if (message.type === 'tool-requested') {
    request.status = 'waiting-for-approval'
    const toolCallId = message.toolCallId ?? createId('tool')
    const existingTool = assistantMessage.parts
      .map(part => part.kind === 'tool' ? part.toolCall : undefined)
      .find(toolCall => toolCall?.id === toolCallId)
    const toolCall = existingTool ?? {
      id: toolCallId,
      round: assistantMessage.parts.filter(part => part.kind === 'tool').length + 1,
      name: message.tool ?? 'Unknown tool',
      arguments: message.arguments ? JSON.stringify(message.arguments, null, 2) : undefined,
      requiresApproval: message.requiresApproval !== false,
      diffPreview: message.diffPreview,
      approval: message.requiresApproval === false ? 'approved' as const : 'pending' as const,
      status: 'requested' as const,
      startedAt: Date.now()
    }
    if (existingTool) {
      existingTool.name = message.tool ?? existingTool.name
      existingTool.arguments = message.arguments ? JSON.stringify(message.arguments, null, 2) : existingTool.arguments
      existingTool.requiresApproval = message.requiresApproval !== false
      existingTool.diffPreview = message.diffPreview ?? existingTool.diffPreview
      existingTool.status = existingTool.approval === 'approved' ? 'running' : 'requested'
    } else {
      assistantMessage.parts.push({ kind: 'tool', toolCall })
    }
    assistantMessage.requestStatus = request.status
    screenReaderStatusElement.textContent = message.detail ?? toolCall.name
    updateMessageElement(assistantMessage)
    updateStatus()
    return
  }
  if (message.type === 'tool-result') {
    const toolPart = [...assistantMessage.parts]
      .reverse()
      .find((part): part is Extract<MessagePart, { kind: 'tool' }> => part.kind === 'tool' && (message.toolCallId ? part.toolCall.id === message.toolCallId : part.toolCall.status !== 'completed'))
    if (toolPart) {
      const detail = redactSensitiveText(message.detail ?? 'Tool completed').slice(0, 16000)
      const failed = message.resultStatus === 'failed' || /rejected|denied|cancelled|error|failed/i.test(detail)
      toolPart.toolCall.status = message.resultStatus === 'rejected' || /rejected|denied/i.test(detail)
        ? 'rejected'
        : failed
          ? 'failed'
          : 'completed'
      toolPart.toolCall.approval = toolPart.toolCall.approval === 'rejected' ? 'rejected' : 'approved'
      toolPart.toolCall.result = detail
      toolPart.toolCall.completedAt = Date.now()
    }
    request.status = 'thinking'
    assistantMessage.requestStatus = request.status
    assistantMessage.status = 'streaming'
    screenReaderStatusElement.textContent = message.detail ?? message.tool ?? 'Tool completed'
    updateMessageElement(assistantMessage)
    updateStatus()
    return
  }
  if (message.type === 'text-delta' || message.type === 'code-delta') {
    request.status = 'streaming'
    assistantMessage.status = 'streaming'
    assistantMessage.requestStatus = request.status
    appendTextPart(assistantMessage, message.delta ?? '')
    updateMessageElement(assistantMessage)
    scrollMessages(false)
    return
  }
  if (message.type === 'warning') {
    const warning = message.message ?? 'Ghost returned a warning'
    appendWarningPart(assistantMessage, warning)
    notice = { kind: 'info', message: warning }
    screenReaderStatusElement.textContent = warning
    updateMessageElement(assistantMessage)
    updateStatus()
    return
  }
  if (message.type === 'error') {
    request.status = message.stopReason === 'cancelled' ? 'cancelled' : 'failed'
    assistantMessage.status = 'error'
    assistantMessage.requestStatus = request.status
    const error = message.message ?? 'Ghost request failed'
    if (message.stopReason) {
      request.stopReason = message.stopReason
      assistantMessage.stopReason = message.stopReason
    }
    const displayedError = message.stopReason ? `${stopReasonLabel(message.stopReason)}: ${error}` : error
    appendErrorPart(assistantMessage, displayedError, true)
    notice = { kind: 'error', message: displayedError }
    updateMessageElement(assistantMessage)
    return
  }
  if (message.type === 'request-completed') {
    const status = message.status ?? 'failed'
    request.status = status
    assistantMessage.requestStatus = status
    assistantMessage.status = status === 'failed' ? 'error' : undefined
    if (message.stopReason) {
      request.stopReason = message.stopReason
      assistantMessage.stopReason = message.stopReason
    }
    if (message.stopReason && message.message) {
      const displayedError = `${stopReasonLabel(message.stopReason)}: ${message.message}`
      const alreadyShown = assistantMessage.parts.some(part => part.kind === 'error' && part.message === displayedError)
      if (!alreadyShown) {
        appendErrorPart(assistantMessage, displayedError, true)
      }
    } else if (status === 'cancelled' && assistantMessage.content.length === 0) {
      appendErrorPart(assistantMessage, 'Request cancelled.')
    } else if (status === 'failed' && assistantMessage.content.length === 0) {
      appendErrorPart(assistantMessage, 'Ghost request failed.')
    }
    if (/model.*(not found|missing)|ollama pull/i.test(assistantMessage.content)) {
      notice = { kind: 'no-model', message: assistantMessage.content }
    }
    if (activeRequest?.requestId === message.requestId) {
      activeRequest = undefined
      stopProgressTimer()
    }
    conversation.activeRequestId = undefined
    conversation.updatedAt = Date.now()
    requests.delete(message.requestId)
    updateMessageElement(assistantMessage)
    render(false)
  }
}

const isExtensionMessage = (value: unknown): value is GhostExtensionMessage => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const message = value as Record<string, unknown>
  if (message.source !== 'ghost-extension' || message.version !== 1 || typeof message.type !== 'string') {
    return false
  }
  if (message.type === 'state') {
    return (message.status === 'ready' || message.status === 'offline') && typeof message.detail === 'string'
  }
  if (message.type === 'reset' || message.type === 'clear') {
    return true
  }
  if (message.type === 'persisted-state') {
    const state = message.state as { schemaVersion?: unknown }
    return Boolean(state && typeof state === 'object' && (state.schemaVersion === 1 || state.schemaVersion === 2))
  }
  if (message.type === 'controls-state') {
    return (
      message.settings !== undefined &&
      typeof message.settings === 'object' &&
      Array.isArray(message.models) &&
      (message.connection === 'online' || message.connection === 'offline' || message.connection === 'unknown')
    )
  }
  if (message.type === 'file-picked') {
    return Array.isArray(message.attachments)
  }
  if (!['request-started', 'thinking', 'text-delta', 'code-delta', 'tool-requested', 'tool-result', 'warning', 'error', 'request-completed'].includes(message.type)) {
    return false
  }
  return (
    'requestId' in message &&
    'conversationId' in message &&
    'sequence' in message &&
    typeof message.requestId === 'string' &&
    typeof message.conversationId === 'string' &&
    typeof message.sequence === 'number' &&
    (message.state === undefined || ['idle', 'preparing', 'connecting', 'thinking', 'streaming', 'waiting-for-approval', 'completed', 'cancelled', 'failed'].includes(message.state as string)) &&
    (message.phase === undefined || ['context', 'provider', 'thinking', 'streaming', 'tool', 'complete', 'error'].includes(message.phase as string)) &&
    (message.elapsedMs === undefined || typeof message.elapsedMs === 'number') &&
    (message.model === undefined || typeof message.model === 'string') &&
    (message.tokenCount === undefined || typeof message.tokenCount === 'number') &&
    (message.tokensPerSecond === undefined || typeof message.tokensPerSecond === 'number') &&
    (message.startedAt === undefined || typeof message.startedAt === 'number') &&
    (message.stopReason === undefined || ['failed-tool', 'invalid-model-response', 'cancelled', 'timeout', 'approval-rejected', 'context-limit', 'budget-limit', 'provider-failure'].includes(message.stopReason as string))
  )
}

messagesElement.addEventListener('scroll', () => {
  userIsAtBottom = messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight < 40
})

messagesElement.addEventListener('click', event => {
  const target = event.target as HTMLElement
  const loadOlder = target.closest<HTMLButtonElement>('[data-load-older]')
  if (loadOlder) {
    visibleMessageCount += 200
    renderMessages(false)
    return
  }
  const codeCopy = target.closest<HTMLButtonElement>('.code-copy')
  if (codeCopy) {
    void copyText(decodeURIComponent(codeCopy.dataset.code ?? ''))
    return
  }
  const toolAction = target.closest<HTMLButtonElement>('[data-tool-action]')
  if (toolAction?.dataset.toolAction && toolAction.dataset.toolCallId) {
    const line = toolAction.dataset.toolLine ? Number(toolAction.dataset.toolLine) : undefined
    handleToolAction(toolAction.dataset.toolAction, toolAction.dataset.toolCallId, Number.isFinite(line) ? line : undefined)
    return
  }
  const stateAction = target.closest<HTMLButtonElement>('[data-state-action]')
  if (stateAction?.dataset.stateAction === 'check') {
    post('check-status')
    return
  }
  const action = target.closest<HTMLButtonElement>('[data-action]')
  if (action?.dataset.action && action.dataset.messageId) {
    handleMessageAction(action.dataset.action, action.dataset.messageId)
  }
})

contextPreviewElement.addEventListener('change', event => {
  const checkbox = event.target as HTMLInputElement
  const key = checkbox.dataset.contextKey as keyof typeof contextEnabled | undefined
  if (!key) {
    return
  }
  contextEnabled[key] = checkbox.checked
  renderControls()
})

const updateMentionMenu = () => {
  const beforeCursor = promptElement.value.slice(0, promptElement.selectionStart ?? promptElement.value.length)
  const match = /(?:^|\s)@([a-zA-Z0-9._/-]*)$/.exec(beforeCursor)
  if (!match) {
    mentionMenuElement.hidden = true
    mentionMenu = undefined
    return
  }
  const query = match[1].toLowerCase()
  const candidates = [
    '@workspace',
    ...contextData.openFiles.map(file => `@${file}`),
    ...contextData.folders.map(folder => `@${folder.split(/[\\/]/).pop() ?? folder}`),
    ...contextData.tools.map(tool => `@${tool}`)
  ].filter(item => item.toLowerCase().includes(query)).slice(0, 8)
  if (candidates.length === 0) {
    mentionMenuElement.hidden = true
    mentionMenu = undefined
    return
  }
  mentionMenuElement.textContent = ''
  for (const candidate of candidates) {
    const option = document.createElement('button')
    option.type = 'button'
    option.className = 'mention-option'
    option.setAttribute('role', 'option')
    option.textContent = candidate
    option.dataset.mention = candidate
    mentionMenuElement.append(option)
  }
  mentionMenuElement.hidden = false
  mentionMenu = mentionMenuElement
}

mentionMenuElement.addEventListener('click', event => {
  const option = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mention]')
  const mention = option?.dataset.mention
  if (!mention) {
    return
  }
  const cursor = promptElement.selectionStart ?? promptElement.value.length
  const before = promptElement.value.slice(0, cursor)
  const after = promptElement.value.slice(cursor)
  const replaced = before.replace(/@([a-zA-Z0-9._/-]*)$/, mention)
  promptElement.value = `${replaced} ${after}`
  saveDraft()
  promptElement.focus()
  promptElement.setSelectionRange(replaced.length + 1, replaced.length + 1)
  mentionMenuElement.hidden = true
  mentionMenu = undefined
  updateComposer()
})

providerElement.addEventListener('change', () => {
  controls.provider = providerElement.value as GhostProvider
  availableModels = []
  renderControls()
  sendSettingsUpdate()
  queueModelRefresh()
})

providerEndpointElement.addEventListener('change', () => {
  const endpoint = providerEndpointElement.value.trim()
  if (!endpoint) {
    renderControls()
    return
  }
  if (controls.provider === 'mlx-vlm') {
    controls.mlxUrl = endpoint
  } else if (controls.provider === 'openai-compatible') {
    controls.openaiUrl = endpoint
  } else {
    controls.ollamaUrl = endpoint
  }
  sendSettingsUpdate()
  queueModelRefresh()
})
testProviderElement.addEventListener('click', () => post('test-provider'))
const readToolNames = (value: string): string[] => [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))].slice(0, 20)
const updateToolPermissions = () => {
  controls.toolAllowlist = readToolNames(toolAllowlistElement.value)
  controls.toolDenylist = readToolNames(toolDenylistElement.value)
  sendSettingsUpdate()
  saveState()
}
toolAllowlistElement.addEventListener('change', updateToolPermissions)
toolDenylistElement.addEventListener('change', updateToolPermissions)
const updateTerminalEnvironmentAllowlist = () => {
  controls.terminalEnvironmentAllowlist = [...new Set(terminalEnvironmentAllowlistElement.value
    .split(',')
    .map(item => item.trim())
    .filter(item => /^[A-Za-z_][A-Za-z0-9_]*$/.test(item)))].slice(0, 40)
  sendSettingsUpdate()
  saveState()
}
terminalEnvironmentAllowlistElement.addEventListener('change', updateTerminalEnvironmentAllowlist)

modelElement.addEventListener('change', () => {
  controls.chatModel = modelElement.value
  sendSettingsUpdate()
})

temperatureElement.addEventListener('input', () => {
  controls.temperature = Number(temperatureElement.value)
  temperatureValueElement.value = controls.temperature.toFixed(1)
})
temperatureElement.addEventListener('change', sendSettingsUpdate)
const updateGenerationSettings = () => {
  const topP = Number(topPElement.value)
  const topK = Number(topKElement.value)
  const minP = Number(minPElement.value)
  const presencePenalty = Number(presencePenaltyElement.value)
  const repeatPenalty = Number(repeatPenaltyElement.value)
  controls.topP = Number.isFinite(topP) ? Math.min(1, Math.max(0, topP)) : 0.9
  controls.topK = Number.isFinite(topK) ? Math.max(0, Math.floor(topK)) : 20
  controls.minP = Number.isFinite(minP) ? Math.min(1, Math.max(0, minP)) : 0.05
  controls.presencePenalty = Number.isFinite(presencePenalty) ? Math.min(2, Math.max(-2, presencePenalty)) : 0
  controls.repeatPenalty = Number.isFinite(repeatPenalty) ? Math.min(3, Math.max(0, repeatPenalty)) : 1.05
  renderControls()
  sendSettingsUpdate()
  saveState()
}
topPElement.addEventListener('change', updateGenerationSettings)
topKElement.addEventListener('change', updateGenerationSettings)
minPElement.addEventListener('change', updateGenerationSettings)
presencePenaltyElement.addEventListener('change', updateGenerationSettings)
repeatPenaltyElement.addEventListener('change', updateGenerationSettings)
maxContextElement.addEventListener('change', () => {
  controls.maxContextTokens = Math.max(1, Number(maxContextElement.value) || 8192)
  maxContextElement.value = String(controls.maxContextTokens)
  sendSettingsUpdate()
})
responseLengthElement.addEventListener('change', () => {
  controls.responseLength = responseLengthElement.value as ResponseLength
  sendSettingsUpdate()
})
modeElement.addEventListener('change', () => {
  controls.mode = modeElement.value as GhostMode
  sendSettingsUpdate()
})
fileEditApprovalElement.addEventListener('change', () => {
  const value = fileEditApprovalElement.value
  controls.fileEditApproval = value === 'one-edit' || value === 'current-file' || value === 'request' || value === 'session' || value === 'workspace' || value === 'always' ? value : 'confirm'
  sendSettingsUpdate()
  saveState()
})
composerHeightElement.addEventListener('input', () => {
  composerHeight = Math.min(320, Math.max(80, Number(composerHeightElement.value) || 180))
  updateComposer()
  saveState()
})
promptRowsElement.addEventListener('input', () => {
  promptRows = Math.min(12, Math.max(1, Math.floor(Number(promptRowsElement.value) || 3)))
  promptRowsElement.value = String(promptRows)
  uiPreferences.promptRows = promptRows
  updateComposer()
  saveState()
})
showReasoningElement.addEventListener('change', () => {
  showReasoning = showReasoningElement.checked
  state.showReasoning = showReasoning
  saveState()
})
persistenceElement.addEventListener('change', () => {
  controls.enableConversationPersistence = persistenceElement.checked
  sendSettingsUpdate()
  saveState()
})
assistantNameElement.addEventListener('input', () => {
  uiPreferences.assistantName = assistantNameElement.value.slice(0, 40)
  renderMessages(false)
  saveState()
})
assistantAvatarElement.addEventListener('input', () => {
  uiPreferences.assistantAvatar = assistantAvatarElement.value.slice(0, 4)
  renderMessages(false)
  saveState()
})
accentColorElement.addEventListener('input', () => {
  uiPreferences.accentColor = accentColorElement.value
  applyUiPreferences()
  saveState()
})
compactLayoutElement.addEventListener('change', () => {
  uiPreferences.compactLayout = compactLayoutElement.checked
  applyUiPreferences()
  saveState()
})
showThinkingElement.addEventListener('change', () => {
  uiPreferences.showThinkingDetails = showThinkingElement.checked
  renderMessages(false)
  saveState()
})
showToolProgressElement.addEventListener('change', () => {
  uiPreferences.showToolProgress = showToolProgressElement.checked
  renderMessages(false)
  saveState()
})
showDiagnosticsElement.addEventListener('change', () => {
  uiPreferences.showDiagnostics = showDiagnosticsElement.checked
  updateStatus()
  saveState()
})
debugLoggingElement.addEventListener('change', () => {
  controls.enableDebugLogging = debugLoggingElement.checked
  sendSettingsUpdate()
  saveState()
})
autoContextElement.addEventListener('change', () => {
  uiPreferences.autoContext = autoContextElement.checked
  renderControls()
  saveState()
})
systemInstructionsElement.addEventListener('input', () => {
  uiPreferences.customSystemInstructions = systemInstructionsElement.value.slice(0, 8000)
  saveState()
})
resetSystemInstructionsElement.addEventListener('click', () => {
  uiPreferences.customSystemInstructions = ''
  systemInstructionsElement.value = ''
  saveState()
})
workspaceSettingsElement.addEventListener('change', () => {
  uiPreferences.workspaceOnly = workspaceSettingsElement.checked
  sendSettingsUpdate()
  saveState()
})

document.getElementById('settings')?.addEventListener('click', () => {
  setModalVisibility(settingsModalElement, true)
})
document.getElementById('privacy-page')?.addEventListener('click', () => {
  setModalVisibility(settingsModalElement, false)
  setModalVisibility(privacyModalElement, true)
})
document.getElementById('context-preview')?.addEventListener('click', () => {
  renderContextPreview()
  setModalVisibility(contextModalElement, true)
})
document.getElementById('history')?.addEventListener('click', () => {
  renderHistory()
  setModalVisibility(historyModalElement, true)
})
document.querySelectorAll<HTMLElement>('[data-close-modal]').forEach(button => {
  button.addEventListener('click', () => {
    const modalId = button.dataset.closeModal
    if (modalId) {
      const modal = document.getElementById(modalId)
      if (modal) {
        setModalVisibility(modal, false)
      }
    }
  })
})
document.querySelectorAll<HTMLElement>('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) {
      setModalVisibility(backdrop, false)
    }
  })
})
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') {
    return
  }
  const visibleModal = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop'))
    .find(modal => !modal.hidden)
  if (visibleModal) {
    setModalVisibility(visibleModal, false)
    event.preventDefault()
  }
})
historySearchElement.addEventListener('input', renderHistory)
historyListElement.addEventListener('click', event => {
  const target = event.target as HTMLElement
  const action = target.closest<HTMLButtonElement>('[data-conversation-action]')
  if (action?.dataset.conversationAction && action.dataset.conversationId) {
    handleConversationAction(action.dataset.conversationAction, action.dataset.conversationId)
    renderHistory()
    return
  }
  const item = target.closest<HTMLButtonElement>('[data-history-conversation]')
  if (!item?.dataset.historyConversation) {
    return
  }
  saveDraft()
  state.activeConversationId = item.dataset.historyConversation
  notice = undefined
  setModalVisibility(historyModalElement, false)
  render(true)
  restoreDraft()
})

document.getElementById('new-history-chat')?.addEventListener('click', () => {
  setModalVisibility(historyModalElement, false)
  startNewConversation()
})

document.getElementById('new-preset')?.addEventListener('click', () => {
  presetSelectElement.value = ''
  presetNameElement.value = ''
  presetPromptElement.value = ''
  setPresetSaveState(false)
})
presetSelectElement.addEventListener('change', () => {
  const preset = presets().find(item => item.id === presetSelectElement.value)
  if (!preset) {
    setPresetSaveState(false)
    return
  }
  presetNameElement.value = preset.name
  presetPromptElement.value = preset.prompt
  controls.mode = preset.mode
  controls.temperature = preset.temperature
  controls.maxContextTokens = preset.maxContextTokens
  controls.responseLength = preset.responseLength
  setPresetSaveState(true)
  renderControls()
  sendSettingsUpdate()
})
savePresetElement.addEventListener('click', () => {
  const name = presetNameElement.value.trim()
  if (!name) {
    return
  }
  const existingId = presetSelectElement.value
  const preset: PromptPreset = {
    id: existingId || createId('preset'),
    name,
    prompt: presetPromptElement.value,
    mode: controls.mode,
    temperature: controls.temperature,
    maxContextTokens: controls.maxContextTokens,
    responseLength: controls.responseLength
  }
  const next = presets().filter(item => item.id !== preset.id)
  state.presets = [preset, ...next]
  presetSelectElement.value = preset.id
  saveState()
  renderPresets()
  presetSelectElement.value = preset.id
  setPresetSaveState(true)
  setModalVisibility(settingsModalElement, false)
})
for (const element of [presetNameElement, presetPromptElement]) {
  element.addEventListener('input', () => setPresetSaveState(false))
}
document.getElementById('delete-preset')?.addEventListener('click', () => {
  const id = presetSelectElement.value
  if (!id) {
    return
  }
  state.presets = presets().filter(preset => preset.id !== id)
  presetNameElement.value = ''
  presetPromptElement.value = ''
  renderPresets()
  saveState()
})

document.getElementById('attach')?.addEventListener('click', () => fileInputElement.click())
fileInputElement.addEventListener('change', () => {
  for (const file of Array.from(fileInputElement.files ?? [])) {
    void readDroppedFile(file)
  }
  fileInputElement.value = ''
})
composerElement.addEventListener('dragover', event => {
  event.preventDefault()
  composerElement.classList.add('dragging')
})
composerElement.addEventListener('dragleave', () => composerElement.classList.remove('dragging'))
composerElement.addEventListener('drop', event => {
  event.preventDefault()
  composerElement.classList.remove('dragging')
  for (const file of Array.from(event.dataTransfer?.files ?? [])) {
    void readDroppedFile(file)
  }
})

promptElement.addEventListener('keyup', updateMentionMenu)
promptElement.addEventListener('keydown', event => {
  const canBrowseHistory = !mentionMenu && (historyIndex >= 0 || !promptElement.value.trim())
  if (event.key === 'ArrowUp' && canBrowseHistory) {
    browsePromptHistory('previous')
    event.preventDefault()
  } else if (event.key === 'ArrowDown' && historyIndex >= 0 && !mentionMenu) {
    browsePromptHistory('next')
    event.preventDefault()
  }
})

previousPromptElement.addEventListener('click', () => browsePromptHistory('previous'))
nextPromptElement.addEventListener('click', () => browsePromptHistory('next'))

document.getElementById('new-chat')?.addEventListener('click', startNewConversation)
document.getElementById('import')?.addEventListener('click', () => post('import'))
document.getElementById('export')?.addEventListener('click', () => post('export', { state: createPersistedState() }))
document.getElementById('reset')?.addEventListener('click', () => post('reset'))
stopElement.addEventListener('click', () => {
  if (activeRequest) {
    post('cancel', {
      requestId: activeRequest.requestId,
      conversationId: activeRequest.conversationId
    })
  }
})
promptElement.addEventListener('input', () => {
  if (promptElement.value.trim()) {
    historyIndex = -1
  }
  saveDraft()
  updateComposer()
})
promptElement.addEventListener('keydown', event => {
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'n') {
    event.preventDefault()
    startNewConversation()
    return
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    composerElement.requestSubmit()
  }
})
composerElement.addEventListener('submit', event => {
  event.preventDefault()
  submitPrompt(promptElement.value)
})
window.addEventListener('message', event => {
  if (event.origin === window.location.origin && isExtensionMessage(event.data)) {
    handleExtensionMessage(event.data)
  }
})

render(false)
restoreDraft()
post('ready')
