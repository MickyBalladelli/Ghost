type GhostPilotViewStatus = 'ready' | 'offline'
type NoticeKind = 'error' | 'no-model' | 'info'
type MessageRole = 'user' | 'assistant'
type GhostPilotProvider = 'ollama' | 'mlx-vlm' | 'openai-compatible'
type GhostPilotMode = 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
type ResponseLength = 'short' | 'balanced' | 'long' | 'unlimited'
type RequestStatus = 'idle' | 'preparing' | 'connecting' | 'thinking' | 'streaming' | 'waiting-for-approval' | 'completed' | 'cancelled' | 'failed'
type ProgressPhase = 'context' | 'provider' | 'thinking' | 'streaming' | 'tool' | 'complete' | 'error'

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
  mode: GhostPilotMode
  temperature: number
  maxContextTokens: number
  responseLength: ResponseLength
}

interface ControlSettings {
  provider: GhostPilotProvider
  ollamaUrl: string
  mlxUrl: string
  openaiUrl: string
  toolAllowlist: string[]
  toolDenylist: string[]
  enableDebugLogging: boolean
  networkAccess: 'local' | 'external'
  chatModel: string
  autocompleteModel: string
  maxContextTokens: number
  temperature: number
  responseLength: ResponseLength
  mode: GhostPilotMode
  enableConversationPersistence: boolean
}

interface UiPreferences {
  assistantName: string
  assistantAvatar: string
  accentColor: string
  compactLayout: boolean
  showThinkingDetails: boolean
  showToolProgress: boolean
  showDiagnostics: boolean
  autoContext: boolean
  customSystemInstructions: string
  composerHeight: number
  workspaceOnly: boolean
}

interface ContextData {
  workspaceName: string
  folders: string[]
  activeFile?: { name: string; path: string; languageId: string; hasSelection: boolean }
  openFiles: string[]
  tools: string[]
}

interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  parts: MessagePart[]
  status?: 'streaming' | 'error'
  requestStatus?: RequestStatus
  requestId?: string
  createdAt: number
  updatedAt: number
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
  activeRequestId?: string
  createdAt: number
  updatedAt: number
}

interface GhostPilotState {
  schemaVersion: number
  conversations: Conversation[]
  activeConversationId: string
  promptHistory?: string[]
  presets?: PromptPreset[]
  showReasoning?: boolean
  preferences?: Partial<ControlSettings> & Partial<UiPreferences>
}

type GhostPilotExtensionMessage =
  | {
      source: 'ghostpilot-extension'
      version: 1
      type: 'state'
      status: GhostPilotViewStatus
      detail: string
    }
  | {
      source: 'ghostpilot-extension'
      version: 1
      type: 'reset' | 'clear'
    }
  | {
      source: 'ghostpilot-extension'
      version: 1
      type: 'controls-state'
      settings: ControlSettings
      models: string[]
      connection: 'online' | 'offline' | 'unknown'
      context: Omit<ContextData, 'tools'>
      tools: string[]
    }
  | {
      source: 'ghostpilot-extension'
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
      source: 'ghostpilot-extension'
      version: 1
      type: 'file-picked'
      attachments: Attachment[]
    }
  | {
      source: 'ghostpilot-extension'
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
      status?: 'completed' | 'cancelled' | 'failed'
    }

interface GhostPilotWebviewApi {
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
}

interface ModelMetadata {
  id: string
  label: string
  provider: GhostPilotProvider
  contextWindow?: number
  capabilities: string[]
}

interface WebviewRequestOptions {
  model: string
  temperature: number
  maxContextTokens: number
  maxTokens?: number
  mode: GhostPilotMode
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

declare function acquireVsCodeApi(): GhostPilotWebviewApi

const vscode = acquireVsCodeApi()
const app = document.getElementById('app')

if (!app) {
  throw new Error('GhostPilot webview root is missing')
}

const createId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
const persistenceSchemaVersion = 2

const redactSensitiveText = (value: string): string => value
  .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
  .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
  .replace(/(token\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
  .replace(/(password\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
  .replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, '[REDACTED]')
  .replace(/-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g, '[REDACTED]')

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
    createdAt: timestamp,
    updatedAt: timestamp
  }
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
  const timestamp = typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  return {
    id: typeof value.id === 'string' ? value.id : createId('message'),
    role: value.role === 'assistant' ? 'assistant' : 'user',
    content,
    parts,
    ...(value.status ? { status: value.status } : {}),
    ...(value.requestStatus ? { requestStatus: value.requestStatus } : {}),
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
    ...(value.activeRequestId ? { activeRequestId: value.activeRequestId } : {}),
    createdAt: timestamp,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : timestamp
  }
}

const recoverInterruptedConversation = (conversation: Conversation): Conversation => {
  for (const message of conversation.messages) {
    if (message.status === 'streaming' || message.requestStatus === 'streaming' || message.requestStatus === 'waiting-for-approval') {
      message.status = 'error'
      message.requestStatus = 'failed'
      message.parts.push({ kind: 'error', message: 'Request interrupted while GhostPilot was reloading.', recoverable: true })
      message.updatedAt = Date.now()
    }
  }
  conversation.activeRequestId = undefined
  return conversation
}

const getInitialState = (): GhostPilotState => {
  const stored = vscode.getState<Partial<GhostPilotState>>()
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
let viewStatus: GhostPilotViewStatus = 'ready'
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
  temperature: 0.2,
  responseLength: 'balanced',
  mode: 'ask',
  enableConversationPersistence: false
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
let uiPreferences: UiPreferences = {
  assistantName: 'GhostPilot',
  assistantAvatar: '✦',
  accentColor: '',
  compactLayout: false,
  showThinkingDetails: true,
  showToolProgress: true,
  showDiagnostics: false,
  autoContext: true,
  customSystemInstructions: '',
  composerHeight,
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
        <span class="brand-mark" aria-hidden="true">✦</span>
        <div>
          <div class="title">GhostPilot</div>
          <div class="subtitle">Local-first coding assistant</div>
        </div>
      </div>
      <div class="header-actions">
        <button type="button" class="icon-button" id="import" aria-label="Import conversations" title="Import conversations">⇩</button>
        <button type="button" class="icon-button" id="export" aria-label="Export conversations" title="Export conversations">⇧</button>
        <button type="button" class="icon-button" id="reset" aria-label="Reset interface" title="Reset interface">↻</button>
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
      <button type="button" class="control-button" id="settings" aria-haspopup="dialog">Controls</button>
    </section>
    <div class="chat-layout">
      <aside class="sidebar" aria-label="Conversations">
        <div class="sidebar-header">
          <span class="sidebar-title">Conversations</span>
          <button type="button" class="icon-button" id="new-chat" aria-label="New conversation" title="New conversation">+</button>
        </div>
        <div class="conversation-list" id="conversation-list" role="list"></div>
      </aside>
      <main class="chat-main">
        <section class="messages" id="messages" role="log" aria-label="Conversation messages" aria-live="polite"></section>
        <div class="screen-reader-status" id="screen-reader-status" role="status" aria-live="polite"></div>
        <form class="composer" id="composer">
          <label class="screen-reader-only" for="prompt">Message GhostPilot</label>
          <div class="context-row">
            <div class="context-chips" id="context-chips" aria-label="Prompt context"></div>
            <button type="button" class="context-button" id="context-preview">Context</button>
            <button type="button" class="context-button" id="attach">Attach</button>
            <input id="file-input" type="file" multiple hidden>
          </div>
          <div class="attachment-list" id="attachment-list" aria-label="Attachments"></div>
          <div class="prompt-wrap">
            <textarea id="prompt" rows="1" placeholder="Ask GhostPilot anything..." aria-describedby="composer-hint composer-count"></textarea>
            <div class="mention-menu" id="mention-menu" role="listbox" hidden></div>
          </div>
          <div class="composer-footer">
            <span class="composer-hint" id="composer-hint">Enter to send · Shift+Enter for a new line</span>
            <span class="composer-count" id="composer-count">0 chars · ~0 tokens</span>
            <button type="button" class="context-button" id="history" aria-haspopup="dialog">History</button>
            <button type="button" class="stop-button" id="stop" hidden>Stop</button>
            <button type="submit" id="send">Send</button>
          </div>
        </form>
        <footer class="status-footer" id="status-footer">
          <span class="status-dot" aria-hidden="true"></span>
          <span id="status-text">Ready</span>
        </footer>
      </main>
    </div>
    <div class="modal-backdrop" id="settings-modal" hidden>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="modal-header"><h2 id="settings-title">Composer controls</h2><button type="button" class="icon-button" data-close-modal="settings-modal" aria-label="Close controls">×</button></div>
        <div class="settings-grid">
          <label for="temperature">Temperature <output id="temperature-value">0.2</output></label>
          <input id="temperature" type="range" min="0" max="2" step="0.1" value="0.2">
          <label for="max-context">Max context tokens</label>
          <input id="max-context" type="number" min="1" step="256" value="8192">
          <label for="response-length">Response length</label>
          <select id="response-length"><option value="short">Short</option><option value="balanced">Balanced</option><option value="long">Long</option><option value="unlimited">Unlimited</option></select>
          <label for="mode">Workflow mode</label>
          <select id="mode"><option value="ask">Ask</option><option value="edit">Edit</option><option value="agent">Agent</option><option value="explain">Explain</option><option value="inline">Inline / Completion</option></select>
          <label for="composer-height">Composer size</label>
          <input id="composer-height" type="range" min="80" max="320" step="10" value="180">
          <label for="provider-endpoint">Provider endpoint</label>
          <input id="provider-endpoint" type="url" placeholder="http://localhost:11434">
          <p class="settings-help" id="provider-help">Endpoint for the selected provider.</p>
          <button type="button" id="test-provider">Test provider connection</button>
          <label for="tool-allowlist">Allowed tools</label>
          <input id="tool-allowlist" type="text" placeholder="ghostpilot_read_file, ghostpilot_apply_edit">
          <label for="tool-denylist">Denied tools</label>
          <input id="tool-denylist" type="text" placeholder="ghostpilot_run_terminal_command">
          <label for="assistant-name">Assistant name</label>
          <input id="assistant-name" type="text" maxlength="40" value="GhostPilot">
          <label for="assistant-avatar">Assistant avatar</label>
          <input id="assistant-avatar" type="text" maxlength="4" value="✦">
          <label for="accent-color">Accent color</label>
          <input id="accent-color" type="color" value="#3794ff">
          <label class="settings-checkbox" for="show-reasoning"><input id="show-reasoning" type="checkbox"> Show provider reasoning when explicitly returned</label>
          <label class="settings-checkbox" for="persist-conversations"><input id="persist-conversations" type="checkbox"> Save conversations and preferences in VS Code storage</label>
          <label class="settings-checkbox" for="compact-layout"><input id="compact-layout" type="checkbox"> Compact conversation layout</label>
          <label class="settings-checkbox" for="show-thinking"><input id="show-thinking" type="checkbox"> Show thinking details</label>
          <label class="settings-checkbox" for="show-tool-progress"><input id="show-tool-progress" type="checkbox"> Show tool progress</label>
          <label class="settings-checkbox" for="show-diagnostics"><input id="show-diagnostics" type="checkbox"> Show telemetry-free diagnostics</label>
          <label class="settings-checkbox" for="debug-logging"><input id="debug-logging" type="checkbox"> Enable local debug logging</label>
          <label class="settings-checkbox" for="auto-context"><input id="auto-context" type="checkbox"> Collect context automatically</label>
          <label class="settings-checkbox" for="workspace-settings"><input id="workspace-settings" type="checkbox"> Use workspace-specific settings</label>
          <label for="system-instructions">Custom system instructions</label>
          <textarea id="system-instructions" rows="4" maxlength="8000" placeholder="Optional instructions for GhostPilot"></textarea>
          <button type="button" class="secondary" id="reset-system-instructions">Reset system instructions</button>
          <p class="settings-help">These instructions are sent to the selected model. Do not put secrets here.</p>
        </div>
        <div class="preset-section">
          <div class="modal-subheader"><h3>Prompt presets</h3><button type="button" class="context-button" id="new-preset">New</button></div>
          <div class="preset-row"><select id="preset-select" aria-label="Prompt preset"><option value="">Choose a preset</option></select><button type="button" class="context-button" id="delete-preset">Delete</button></div>
          <input id="preset-name" type="text" placeholder="Preset name" aria-label="Preset name">
          <textarea id="preset-prompt" rows="3" placeholder="Reusable prompt text" aria-label="Preset prompt"></textarea>
          <button type="button" id="save-preset">Save preset</button>
        </div>
        <div class="modal-footer"><button type="button" class="secondary" data-close-modal="settings-modal">Close</button></div>
      </section>
    </div>
    <div class="modal-backdrop" id="context-modal" hidden>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="context-title">
        <div class="modal-header"><h2 id="context-title">Prompt context</h2><button type="button" class="icon-button" data-close-modal="context-modal" aria-label="Close context">×</button></div>
        <p class="modal-description">Choose what GhostPilot may include when you submit this prompt.</p>
        <div class="context-preview" id="context-preview-list"></div>
        <div class="modal-footer"><button type="button" class="secondary" data-close-modal="context-modal">Done</button></div>
      </section>
    </div>
    <div class="modal-backdrop" id="history-modal" hidden>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <div class="modal-header"><h2 id="history-title">Prompt history</h2><button type="button" class="icon-button" data-close-modal="history-modal" aria-label="Close history">×</button></div>
        <input id="history-search" type="search" placeholder="Search prompts" aria-label="Search prompt history">
        <div class="history-list" id="history-list"></div>
      </section>
    </div>
  </div>
`

const messagesElement = document.getElementById('messages') as HTMLElement
const conversationListElement = document.getElementById('conversation-list') as HTMLElement
const promptElement = document.getElementById('prompt') as HTMLTextAreaElement
const composerElement = document.getElementById('composer') as HTMLFormElement
const sendElement = document.getElementById('send') as HTMLButtonElement
const stopElement = document.getElementById('stop') as HTMLButtonElement
const statusTextElement = document.getElementById('status-text') as HTMLElement
const statusFooterElement = document.getElementById('status-footer') as HTMLElement
const screenReaderStatusElement = document.getElementById('screen-reader-status') as HTMLElement
const composerCountElement = document.getElementById('composer-count') as HTMLElement
const providerElement = document.getElementById('provider') as HTMLSelectElement
const modelElement = document.getElementById('model') as HTMLSelectElement
const connectionIndicatorElement = document.getElementById('connection-indicator') as HTMLElement
const connectionTextElement = document.getElementById('connection-text') as HTMLElement
const contextChipsElement = document.getElementById('context-chips') as HTMLElement
const attachmentListElement = document.getElementById('attachment-list') as HTMLElement
const fileInputElement = document.getElementById('file-input') as HTMLInputElement
const mentionMenuElement = document.getElementById('mention-menu') as HTMLElement
const temperatureElement = document.getElementById('temperature') as HTMLInputElement
const temperatureValueElement = document.getElementById('temperature-value') as HTMLOutputElement
const maxContextElement = document.getElementById('max-context') as HTMLInputElement
const responseLengthElement = document.getElementById('response-length') as HTMLSelectElement
const modeElement = document.getElementById('mode') as HTMLSelectElement
const composerHeightElement = document.getElementById('composer-height') as HTMLInputElement
const providerEndpointElement = document.getElementById('provider-endpoint') as HTMLInputElement
const providerHelpElement = document.getElementById('provider-help') as HTMLElement
const testProviderElement = document.getElementById('test-provider') as HTMLButtonElement
const toolAllowlistElement = document.getElementById('tool-allowlist') as HTMLInputElement
const toolDenylistElement = document.getElementById('tool-denylist') as HTMLInputElement
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
const contextModalElement = document.getElementById('context-modal') as HTMLElement
const historyModalElement = document.getElementById('history-modal') as HTMLElement
const contextPreviewElement = document.getElementById('context-preview-list') as HTMLElement
const historySearchElement = document.getElementById('history-search') as HTMLInputElement
const historyListElement = document.getElementById('history-list') as HTMLElement
const presetSelectElement = document.getElementById('preset-select') as HTMLSelectElement
const presetNameElement = document.getElementById('preset-name') as HTMLInputElement
const presetPromptElement = document.getElementById('preset-prompt') as HTMLTextAreaElement

const post = (type: string, details: Record<string, unknown> = {}) => {
  vscode.postMessage({
    source: 'ghostpilot-webview',
    version: 1,
    type,
    ...details
  })
}

const createPersistedState = () => ({
  schemaVersion: persistenceSchemaVersion,
  conversations: redactPersistedValue(state.conversations) as Conversation[],
  activeConversationId: state.activeConversationId,
  promptHistory: (redactPersistedValue(state.promptHistory ?? []) as string[]),
  presets: redactPersistedValue(state.presets ?? []) as PromptPreset[],
  showReasoning,
  preferences: {
    provider: controls.provider,
    ollamaUrl: controls.ollamaUrl,
    mlxUrl: controls.mlxUrl,
    openaiUrl: controls.openaiUrl,
    toolAllowlist: controls.toolAllowlist,
    toolDenylist: controls.toolDenylist,
    chatModel: controls.chatModel,
    autocompleteModel: controls.autocompleteModel,
    maxContextTokens: controls.maxContextTokens,
    temperature: controls.temperature,
    responseLength: controls.responseLength,
    mode: controls.mode,
    enableConversationPersistence: controls.enableConversationPersistence,
    composerHeight,
    assistantName: uiPreferences.assistantName,
    assistantAvatar: uiPreferences.assistantAvatar,
    accentColor: uiPreferences.accentColor,
    compactLayout: uiPreferences.compactLayout,
    showThinkingDetails: uiPreferences.showThinkingDetails,
    showToolProgress: uiPreferences.showToolProgress,
    showDiagnostics: uiPreferences.showDiagnostics,
    autoContext: uiPreferences.autoContext,
    customSystemInstructions: uiPreferences.customSystemInstructions,
    workspaceOnly: uiPreferences.workspaceOnly,
    enableDebugLogging: controls.enableDebugLogging
  }
})

const saveState = () => {
  if (controls.enableConversationPersistence) {
    vscode.setState(redactPersistedValue(state) as GhostPilotState)
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

const promptHistory = (): string[] => state.promptHistory ?? []

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
        chatModel: controls.chatModel,
        maxContextTokens: controls.maxContextTokens,
        temperature: controls.temperature,
        responseLength: controls.responseLength,
        mode: controls.mode,
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
  document.documentElement.style.setProperty('--ghostpilot-accent', accent || 'var(--vscode-textLink-foreground, #3794ff)')
  document.body.classList.toggle('compact-layout', uiPreferences.compactLayout)
  document.title = uiPreferences.assistantName || 'GhostPilot'
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
  maxContextElement.value = String(controls.maxContextTokens)
  responseLengthElement.value = controls.responseLength
  modeElement.value = controls.mode
  composerHeightElement.value = String(composerHeight)
  providerEndpointElement.value = providerEndpoint()
  providerHelpElement.textContent = controls.provider === 'mlx-vlm'
    ? 'MLX VLM OpenAI-compatible endpoint.'
    : controls.provider === 'openai-compatible'
      ? 'OpenAI-compatible endpoint. Keep the /v1 suffix when required.'
      : 'Ollama endpoint.'
  toolAllowlistElement.value = controls.toolAllowlist.join(', ')
  toolDenylistElement.value = controls.toolDenylist.join(', ')
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

  contextChipsElement.textContent = ''
  const chips: Array<{ key: keyof typeof contextEnabled; label: string }> = []
  if (contextData.workspaceName) {
    chips.push({ key: 'workspace', label: contextData.workspaceName })
  }
  if (contextData.folders.length > 0) {
    chips.push({ key: 'folders', label: `${contextData.folders.length} folder${contextData.folders.length === 1 ? '' : 's'}` })
  }
  if (contextData.activeFile) {
    chips.push({ key: 'activeFile', label: contextData.activeFile.name })
    if (contextData.activeFile.hasSelection) {
      chips.push({ key: 'selection', label: 'Selection' })
    }
  }
  if (contextData.openFiles.length > 0) {
    chips.push({ key: 'openFiles', label: `${contextData.openFiles.length} open file${contextData.openFiles.length === 1 ? '' : 's'}` })
  }
  if (contextData.tools.length > 0) {
    chips.push({ key: 'tools', label: `${contextData.tools.length} tools` })
  }
  for (const chip of chips) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `context-chip${contextEnabled[chip.key] ? '' : ' removed'}`
    button.textContent = `${contextEnabled[chip.key] ? '✓ ' : '＋ '}${chip.label}`
    button.title = contextEnabled[chip.key] ? `Remove ${chip.label} from prompt context` : `Add ${chip.label} to prompt context`
    button.dataset.contextKey = chip.key
    contextChipsElement.append(button)
  }

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
}

const renderHistory = () => {
  const query = historySearchElement.value.trim().toLowerCase()
  historyListElement.textContent = ''
  const entries = promptHistory().filter(prompt => prompt.toLowerCase().includes(query))
  if (entries.length === 0) {
    historyListElement.innerHTML = '<p class="modal-description">No matching prompts.</p>'
    return
  }
  for (const prompt of entries) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'history-item'
    button.textContent = prompt
    button.title = 'Use this prompt'
    button.dataset.historyPrompt = prompt
    historyListElement.append(button)
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
  model: controls.chatModel,
  temperature: controls.temperature,
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
  promptElement.value = getActiveConversation().draft
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
  return output.join('') || '<p class="message-placeholder">No response yet.</p>'
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

const createMessageElement = (message: ChatMessage): HTMLElement => {
  const article = document.createElement('article')
  article.className = `message ${message.role}${message.status === 'error' ? ' error' : ''}`
  article.dataset.messageId = message.id
  const partSummary = renderMessagePartSummary(message)
  const messageState = message.status === 'streaming'
    ? 'Thinking...'
    : message.requestStatus === 'waiting-for-approval'
      ? 'Waiting for approval...'
      : ''
  article.innerHTML = `
    <div class="message-header"><strong>${message.role === 'user' ? 'You' : `${escapeHtml(uiPreferences.assistantAvatar)} ${escapeHtml(uiPreferences.assistantName || 'GhostPilot')}`}</strong><span class="message-state">${messageState}</span></div>
    <div class="message-body">${renderMarkdown(message.content)}</div>
    ${partSummary}
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
  const renderedTools = uiPreferences.showToolProgress ? toolParts.map(part => {
    const result = part.toolCall.result ? `: ${part.toolCall.result}` : ''
    const durationEnd = part.toolCall.completedAt ?? (part.toolCall.status === 'running' ? Date.now() : undefined)
    const duration = durationEnd ? ` · ${((durationEnd - part.toolCall.startedAt) / 1000).toFixed(1)}s` : ''
    const argumentsBlock = part.toolCall.arguments
      ? `<details class="tool-details"><summary>Arguments</summary><pre>${escapeHtml(part.toolCall.arguments)}</pre></details>`
      : ''
    const diffBlock = part.toolCall.diffPreview
      ? `<details class="tool-details"><summary>Diff preview · ${escapeHtml(part.toolCall.diffPreview.path)}${part.toolCall.diffPreview.truncated ? ' · truncated' : ''}</summary>${part.toolCall.diffPreview.hunks?.length ? `<div class="tool-hunk-list">${part.toolCall.diffPreview.hunks.map((hunk, index) => `<label><input type="checkbox" data-tool-hunk="${index}" data-tool-call-id="${escapeAttribute(part.toolCall.id)}" checked> Lines ${hunk.startLine}-${hunk.endLine}<button type="button" class="secondary" data-tool-action="open-hunk" data-tool-line="${hunk.startLine}" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Open line</button></label>`).join('')}</div>` : ''}<pre>--- before\n+++ after\n${escapeHtml(part.toolCall.diffPreview.before)}\n--- proposed replacement ---\n${escapeHtml(part.toolCall.diffPreview.after)}</pre></details>`
      : ''
    const resultBlock = part.toolCall.result
      ? `<details class="tool-details"><summary>Result</summary><pre>${escapeHtml(part.toolCall.result)}</pre></details>`
      : ''
    const approvalControls = part.toolCall.requiresApproval && part.toolCall.status === 'requested'
      ? `<div class="tool-approval-actions"><button type="button" data-tool-action="approve" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Approve once</button><button type="button" data-tool-action="approve-session" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Always this session</button><button type="button" data-tool-action="edit" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Edit arguments</button><button type="button" class="secondary" data-tool-action="reject" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Reject</button><button type="button" class="secondary" data-tool-action="cancel" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Cancel request</button></div>`
      : ''
    const selectedHunkAction = part.toolCall.status === 'requested' && part.toolCall.diffPreview?.hunks?.length
      ? `<button type="button" data-tool-action="approve-selected" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Apply selected hunks</button>`
      : ''
    const fileAction = part.toolCall.diffPreview
      ? `<button type="button" class="secondary" data-tool-action="open-file" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Open file</button>`
      : ''
    const restoreAction = part.toolCall.status === 'completed' && (part.toolCall.name === 'ghostpilot_write_file' || part.toolCall.name === 'ghostpilot_apply_edit')
      ? `<button type="button" class="secondary" data-tool-action="restore" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Restore</button>`
      : ''
    const resultActions = part.toolCall.result || fileAction || restoreAction
      ? `<div class="tool-result-actions">${fileAction}${restoreAction}${selectedHunkAction}${part.toolCall.result ? `<button type="button" class="secondary" data-tool-action="copy-result" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Copy result</button><button type="button" class="secondary" data-tool-action="rerun" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Rerun request</button>` : ''}</div>`
      : ''
    return `<div class="message-progress tool-progress"><strong>${escapeHtml(part.toolCall.name)}</strong> · ${escapeHtml(part.toolCall.status)}${escapeHtml(duration)}${escapeHtml(result)}${argumentsBlock}${diffBlock}${resultBlock}${approvalControls}${resultActions}</div>`
  }).join('') : ''
  const renderedWarnings = warningParts.map(part => `<div class="message-progress warning-progress">Warning: ${escapeHtml(part.message)}</div>`).join('')
  const renderedErrors = errorParts.map(part => `<div class="message-progress error-progress">${escapeHtml(part.message)}</div>`).join('')
  return `<div class="message-part-summary">${renderedProgress}${renderedTools}${renderedWarnings}${renderedErrors}</div>`
}

const stateCard = (): string => {
  if (viewStatus === 'offline') {
    return '<div class="state-card"><div class="state-icon">!</div><h1>Provider offline</h1><p>GhostPilot cannot reach the configured local model. Check the connection, then try again.</p><button type="button" data-state-action="check">Check connection</button></div>'
  }
  if (notice?.kind === 'no-model') {
    return `<div class="state-card"><div class="state-icon">↓</div><h1>No model installed</h1><p>${escapeHtml(notice.message)}</p><p class="state-help">Pull the configured model, then retry your prompt.</p></div>`
  }
  if (notice?.kind === 'error') {
    return `<div class="state-card"><div class="state-icon">!</div><h1>Something went wrong</h1><p>${escapeHtml(notice.message)}</p></div>`
  }
  return '<div class="state-card"><div class="state-icon">✦</div><h1>Start a conversation</h1><p>Ask about your code, explain an error, or let GhostPilot help with a task.</p></div>'
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
    body?.insertAdjacentHTML('afterend', summary)
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

const renderConversationList = () => {
  conversationListElement.textContent = ''
  for (const conversation of state.conversations) {
    const item = document.createElement('div')
    item.className = `conversation-item${conversation.id === state.activeConversationId ? ' active' : ''}`
    item.setAttribute('role', 'listitem')
    const select = document.createElement('button')
    select.type = 'button'
    select.className = 'conversation-select'
    select.textContent = conversation.title
    select.title = conversation.title
    select.dataset.conversationId = conversation.id
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
    item.append(select, actions)
    conversationListElement.append(item)
  }
}

const updateComposer = () => {
  const length = promptElement.value.length
  composerCountElement.textContent = `${length} chars · ~${Math.ceil(length / 4)} tokens`
  promptElement.style.height = 'auto'
  promptElement.style.height = `${Math.min(promptElement.scrollHeight, composerHeight)}px`
  promptElement.style.overflowY = promptElement.scrollHeight > composerHeight ? 'auto' : 'hidden'
  const busy = Boolean(activeRequest && !['completed', 'cancelled', 'failed'].includes(activeRequest.status))
  sendElement.disabled = busy || promptElement.value.trim().length === 0
  stopElement.hidden = !busy
  promptElement.disabled = busy
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
      thinking: 'GhostPilot is thinking…',
      streaming: 'GhostPilot is writing…',
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
  renderConversationList()
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
  state.promptHistory = [prompt, ...promptHistory().filter(item => item !== prompt)].slice(0, 100)
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

const handleToolAction = (action: string, toolCallId: string, line?: number): void => {
  const found = findToolCall(toolCallId)
  if (!found) {
    return
  }
  if (action === 'rerun') {
    retryMessage(found.message.id)
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

const handleExtensionMessage = (message: GhostPilotExtensionMessage) => {
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
        preferences: message.state.preferences as Partial<ControlSettings> | undefined
      }
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
      if (preferences.responseLength === 'short' || preferences.responseLength === 'balanced' || preferences.responseLength === 'long' || preferences.responseLength === 'unlimited') {
        controls.responseLength = preferences.responseLength
      }
      if (preferences.mode === 'ask' || preferences.mode === 'edit' || preferences.mode === 'agent' || preferences.mode === 'explain' || preferences.mode === 'inline') {
        controls.mode = preferences.mode
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
      if (typeof preferences.enableDebugLogging === 'boolean') {
        controls.enableDebugLogging = preferences.enableDebugLogging
      }
      if (typeof preferences.composerHeight === 'number' && Number.isFinite(preferences.composerHeight)) {
        composerHeight = Math.min(320, Math.max(80, Math.floor(preferences.composerHeight)))
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
      if (typeof preferences.showToolProgress === 'boolean') {
        uiPreferences.showToolProgress = preferences.showToolProgress
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
    controls = message.settings
    availableModels = message.models
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
  if (!('sequence' in message) || typeof message.sequence !== 'number' || message.sequence <= request.lastSequence || ['completed', 'cancelled', 'failed'].includes(request.status)) {
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
    const detail = message.detail ?? 'GhostPilot is working'
    appendProgressPart(assistantMessage, detail, {
      phase: message.phase,
      elapsedMs: message.elapsedMs,
      tokenCount: message.tokenCount,
      tokensPerSecond: message.tokensPerSecond,
      model: message.model
    })
    screenReaderStatusElement.textContent = message.detail ?? 'GhostPilot is working'
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
      const failed = /rejected|denied|cancelled|error|failed/i.test(detail)
      toolPart.toolCall.status = failed
        ? /rejected|denied/i.test(detail) ? 'rejected' : 'failed'
        : 'completed'
      toolPart.toolCall.approval = toolPart.toolCall.approval === 'rejected' ? 'rejected' : 'approved'
      toolPart.toolCall.result = detail
      toolPart.toolCall.completedAt = Date.now()
    }
    request.status = 'thinking'
    assistantMessage.requestStatus = request.status
    if (assistantMessage.content) {
      const nextAssistant = createMessage('assistant', '', message.requestId)
      nextAssistant.status = 'streaming'
      nextAssistant.requestStatus = request.status
      conversation.messages.push(nextAssistant)
      request.assistantMessageId = nextAssistant.id
      assistantMessage = nextAssistant
    }
    screenReaderStatusElement.textContent = message.detail ?? message.tool ?? 'Tool completed'
    updateMessageElement(assistantMessage)
    renderMessages(false)
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
    const warning = message.message ?? 'GhostPilot returned a warning'
    appendWarningPart(assistantMessage, warning)
    notice = { kind: 'info', message: warning }
    screenReaderStatusElement.textContent = warning
    updateMessageElement(assistantMessage)
    updateStatus()
    return
  }
  if (message.type === 'error') {
    request.status = 'failed'
    assistantMessage.status = 'error'
    assistantMessage.requestStatus = request.status
    const error = message.message ?? 'GhostPilot request failed'
    appendErrorPart(assistantMessage, error, true)
    notice = { kind: 'error', message: error }
    updateMessageElement(assistantMessage)
    return
  }
  if (message.type === 'request-completed') {
    const status = message.status ?? 'failed'
    request.status = status
    assistantMessage.requestStatus = status
    assistantMessage.status = status === 'failed' ? 'error' : undefined
    if (status === 'cancelled' && assistantMessage.content.length === 0) {
      appendErrorPart(assistantMessage, 'Request cancelled.')
    }
    if (status === 'failed' && assistantMessage.content.length === 0) {
      appendErrorPart(assistantMessage, 'GhostPilot request failed.')
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

const isExtensionMessage = (value: unknown): value is GhostPilotExtensionMessage => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const message = value as Record<string, unknown>
  if (message.source !== 'ghostpilot-extension' || message.version !== 1 || typeof message.type !== 'string') {
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
    (message.startedAt === undefined || typeof message.startedAt === 'number')
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

contextChipsElement.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-context-key]')
  const key = target?.dataset.contextKey as keyof typeof contextEnabled | undefined
  if (!key) {
    return
  }
  contextEnabled[key] = !contextEnabled[key]
  if (!contextEnabled[key]) {
    post('remove-context', {
      ...lifecycleEnvelope('remove-context'),
      contextKey: key
    })
  }
  renderControls()
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

conversationListElement.addEventListener('click', event => {
  const target = event.target as HTMLElement
  const action = target.closest<HTMLButtonElement>('[data-conversation-action]')
  if (action?.dataset.conversationAction && action.dataset.conversationId) {
    handleConversationAction(action.dataset.conversationAction, action.dataset.conversationId)
    return
  }
  const select = target.closest<HTMLButtonElement>('[data-conversation-id]')
  if (select?.dataset.conversationId) {
    saveDraft()
    state.activeConversationId = select.dataset.conversationId
    notice = undefined
    render(true)
    restoreDraft()
  }
})

providerElement.addEventListener('change', () => {
  controls.provider = providerElement.value as GhostPilotProvider
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

modelElement.addEventListener('change', () => {
  controls.chatModel = modelElement.value
  sendSettingsUpdate()
})

temperatureElement.addEventListener('input', () => {
  controls.temperature = Number(temperatureElement.value)
  temperatureValueElement.value = controls.temperature.toFixed(1)
})
temperatureElement.addEventListener('change', sendSettingsUpdate)
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
  controls.mode = modeElement.value as GhostPilotMode
  sendSettingsUpdate()
})
composerHeightElement.addEventListener('input', () => {
  composerHeight = Math.min(320, Math.max(80, Number(composerHeightElement.value) || 180))
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
historySearchElement.addEventListener('input', renderHistory)
historyListElement.addEventListener('click', event => {
  const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-history-prompt]')
  if (!item?.dataset.historyPrompt) {
    return
  }
  promptElement.value = item.dataset.historyPrompt
  saveDraft()
  setModalVisibility(historyModalElement, false)
  promptElement.focus()
  updateComposer()
})

document.getElementById('new-preset')?.addEventListener('click', () => {
  presetSelectElement.value = ''
  presetNameElement.value = ''
  presetPromptElement.value = ''
})
presetSelectElement.addEventListener('change', () => {
  const preset = presets().find(item => item.id === presetSelectElement.value)
  if (!preset) {
    return
  }
  presetNameElement.value = preset.name
  presetPromptElement.value = preset.prompt
  controls.mode = preset.mode
  controls.temperature = preset.temperature
  controls.maxContextTokens = preset.maxContextTokens
  controls.responseLength = preset.responseLength
  renderControls()
  sendSettingsUpdate()
})
document.getElementById('save-preset')?.addEventListener('click', () => {
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
})
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
  if (event.key === 'ArrowUp' && promptElement.selectionStart === 0 && !mentionMenu) {
    const entries = promptHistory()
    if (entries.length > 0) {
      historyIndex = Math.min(historyIndex + 1, entries.length - 1)
      promptElement.value = entries[historyIndex]
      saveDraft()
      updateComposer()
      event.preventDefault()
    }
  } else if (event.key === 'ArrowDown' && historyIndex >= 0 && !mentionMenu) {
    const entries = promptHistory()
    historyIndex -= 1
    promptElement.value = historyIndex >= 0 ? entries[historyIndex] : ''
    saveDraft()
    updateComposer()
    event.preventDefault()
  }
})

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
  saveDraft()
  updateComposer()
})
promptElement.addEventListener('keydown', event => {
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
