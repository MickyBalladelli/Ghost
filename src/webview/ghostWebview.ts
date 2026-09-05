import type {
  ActiveRequest,
  Attachment,
  AutoAcceptScope,
  ChatMessage,
  CompletionRecord,
  ContextData,
  ContinuationResume,
  ControlSettings,
  Conversation,
  CustomResponseFormat,
  GhostMode,
  GhostProvider,
  GhostState,
  GhostViewStatus,
  GhostWebviewApi,
  LogLevel,
  MessagePart,
  MessageRole,
  ModelMetadata,
  ModelProfile,
  ModelRole,
  NoticeKind,
  OpenAiProfile,
  ProgressPhase,
  PromptPreset,
  RequestEvent,
  RequestStatus,
  ResponseLength,
  RequestSummary,
  ResponseStats,
  StopReason,
  TaskPlan,
  ToolCall,
  UiPreferences,
  WebviewRequestOptions
} from './ghostWebviewTypes'
import type { GhostExtensionMessage } from '../ui/ghostProtocol'

type GhostHistoryStoreApi = {
  filterConversations: <T extends { title: string; messages: Array<{ content: string; bookmarked?: boolean }> }>(conversations: T[], query: string, bookmarksOnly: boolean) => T[]
  matchingMessageCount: (conversations: Array<{ messages: Array<{ content: string; bookmarked?: boolean }> }>, query: string) => number
}

type GhostAccessibilityApi = {
  focusWrapTarget: (focusableCount: number, activeIndex: number, backwards: boolean) => number | undefined
  approvalKeyboardAction: (key: string, modifiers?: boolean) => 'next-hunk' | 'previous-hunk' | 'approve' | 'reject' | undefined
  shouldAnimateStatus: (reducedMotion: boolean) => boolean
  toolStatusPresentation: (status: 'requested' | 'running' | 'completed' | 'rejected' | 'failed') => { className: string; icon: string }
}

const builtInModelProfiles: Record<string, ModelProfile> = {
  coding: { temperature: 0.2, topP: 0.9, topK: 20, minP: 0.05, repeatPenalty: 1.1, maxContextTokens: 16384, maxTokens: 2048 },
  balanced: { temperature: 0.3, topP: 0.9, topK: 20, minP: 0.05, repeatPenalty: 1.05, maxContextTokens: 8192, maxTokens: 1024 },
  creative: { temperature: 0.8, topP: 0.95, topK: 40, minP: 0.02, repeatPenalty: 1.02, maxContextTokens: 8192, maxTokens: 2048 }
}

const defaultGenerationSettings = {
  temperature: 0.3,
  topP: 0.9,
  topK: 20,
  minP: 0.05,
  presencePenalty: 0,
  repeatPenalty: 1.05,
  maxContextTokens: 8192,
  responseLength: 'balanced' as ResponseLength
}

const providerChoices: Array<{ value: GhostProvider; label: string }> = [
  { value: 'mlx-vlm', label: 'MLX / VLM' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'openrouter', label: 'OpenRouter' }
]

const renderProviderOptions = (element: HTMLSelectElement, selectedProvider: GhostProvider): void => {
  element.textContent = ''
  for (const provider of providerChoices) {
    const option = document.createElement('option')
    option.value = provider.value
    option.textContent = provider.label
    element.append(option)
  }
  element.value = providerChoices.some(provider => provider.value === selectedProvider)
    ? selectedProvider
    : providerChoices[0].value
}

const MAX_FAILED_TOOL_RETRIES = 2
const maxAttachments = 8
const maxImageAttachmentBytes = 700 * 1024
const maxTextAttachmentBytes = 1024 * 1024

const toolDescriptions: Record<string, string> = {
  ghost_read_file: 'Read a text file from the workspace.',
  ghost_search_workspace: 'Search workspace text with ripgrep and return file, line, column, and match data.',
  ghost_get_diagnostics: 'Read compiler and Problems-panel diagnostics.',
  ghost_git_context: 'Read safe Git status, diffs, branch, and file history.',
  ghost_update_task_plan: 'Persist the current multi-step task plan.',
  ghost_record_completion: 'Record changed files, checks, failures, and remaining work.',
  ghost_write_file: 'Create or replace a text file in the workspace.',
  ghost_apply_edit: 'Apply reviewed, structured edits to a workspace file.',
  ghost_apply_transaction: 'Apply and verify multiple workspace edits as one transaction.',
  ghost_run_terminal_command: 'Run a shell command in the workspace.',
  ghost_list_directory: 'List files and folders in the workspace.'
}

const terminalEnvironmentDefaults = ['PATH', 'HOME', 'USER', 'USERNAME', 'SHELL', 'ComSpec', 'SystemRoot', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'CI', 'PWD']

declare function acquireVsCodeApi(): GhostWebviewApi

const vscode = acquireVsCodeApi()
const app = document.getElementById('app')
const ghostIconUri = document.body.dataset.ghostIcon ?? ''

if (!app) {
  throw new Error('Ghost webview root is missing')
}

const conversationStore = (globalThis as typeof globalThis & { GhostConversationStore: GhostConversationStoreApi }).GhostConversationStore
const protocolClient = (globalThis as typeof globalThis & { GhostProtocolClient: GhostProtocolClientApi }).GhostProtocolClient
const settingsStore = (globalThis as typeof globalThis & { GhostSettingsStore: GhostSettingsStoreApi }).GhostSettingsStore
const historyStore = (globalThis as typeof globalThis & { GhostHistoryStore: GhostHistoryStoreApi }).GhostHistoryStore
const rendering = (globalThis as typeof globalThis & { GhostRendering: GhostRenderingApi }).GhostRendering
const ghostShell = (globalThis as typeof globalThis & { GhostShell: { createAppShell: (iconUri: string) => HTMLDivElement } }).GhostShell
const toolTimeline = (globalThis as typeof globalThis & { GhostToolTimeline: GhostToolTimelineApi }).GhostToolTimeline
const composerStore = (globalThis as typeof globalThis & { GhostComposer: GhostComposerApi }).GhostComposer
const modalStore = (globalThis as typeof globalThis & { GhostModal: GhostModalApi }).GhostModal
const accessibility = (globalThis as typeof globalThis & { GhostAccessibility: GhostAccessibilityApi }).GhostAccessibility
const createId = protocolClient.createId
const escapeHtml = rendering.escapeHtml
const escapeAttribute = rendering.escapeAttribute
const safeLink = rendering.safeLink
const persistenceSchemaVersion = conversationStore.persistenceSchemaVersion
const defaultPromptHistoryLimit = conversationStore.defaultPromptHistoryLimit
const maxPromptHistoryLimit = conversationStore.maxPromptHistoryLimit

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

const MAX_PERSISTED_STRING_CHARS = 24000
const MAX_PERSISTED_STATE_BYTES = 4 * 1024 * 1024

const compactPersistedValue = (value: unknown, key = ''): unknown => {
  if (typeof value === 'string') {
    if (value.length <= MAX_PERSISTED_STRING_CHARS) {
      return value
    }
    const marker = '\n[Older content omitted from persistence]\n'
    const available = Math.max(0, MAX_PERSISTED_STRING_CHARS - marker.length)
    const head = Math.floor(available * 0.7)
    return `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`
  }
  if (Array.isArray(value)) {
    const limit = key === 'conversations'
      ? 24
      : key === 'messages'
        ? 120
        : key === 'parts'
          ? 40
          : key === 'eventLog'
            ? 100
            : key === 'presets'
              ? 50
              : undefined
    const items = limit === undefined ? value : value.slice(-limit)
    return items.map(item => compactPersistedValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      compactPersistedValue(entryValue, entryKey)
    ]))
  }
  return value
}

const compactPersistedState = <T>(value: T): T => {
  const compacted = compactPersistedValue(value) as Record<string, unknown>
  if (JSON.stringify(compacted).length <= MAX_PERSISTED_STATE_BYTES || !Array.isArray(compacted.conversations)) {
    return compacted as T
  }
  compacted.conversations = compacted.conversations.slice(-8).map(conversation => {
    if (!conversation || typeof conversation !== 'object' || Array.isArray(conversation)) {
      return conversation
    }
    const record = conversation as Record<string, unknown>
    return {
      ...record,
      messages: Array.isArray(record.messages) ? record.messages.slice(-40) : record.messages
    }
  })
  return compacted as T
}

const createConversation = (): Conversation => conversationStore.createConversation() as Conversation
const normalizePromptHistory = conversationStore.normalizePromptHistory
const addPromptToHistory = conversationStore.addPromptToHistory

const textPart = (text: string): MessagePart => ({ kind: 'text', text })

const normalizeRequestEventLog = (value: unknown): RequestEvent[] => {
  if (!Array.isArray(value)) return []
  const statuses: RequestStatus[] = ['idle', 'preparing', 'connecting', 'thinking', 'streaming', 'waiting-for-approval', 'completed', 'cancelled', 'failed']
  const phases: ProgressPhase[] = ['context', 'provider', 'thinking', 'streaming', 'tool', 'complete', 'error']
  return value.slice(-100).flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const event = item as Record<string, unknown>
    if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp) || typeof event.elapsedMs !== 'number' || !Number.isFinite(event.elapsedMs) || typeof event.type !== 'string' || !statuses.includes(event.status as RequestStatus)) {
      return []
    }
    return [{
      timestamp: event.timestamp,
      elapsedMs: Math.max(0, event.elapsedMs),
      type: event.type.slice(0, 64),
      status: event.status as RequestStatus,
      ...(phases.includes(event.phase as ProgressPhase) ? { phase: event.phase as ProgressPhase } : {}),
      ...(typeof event.detail === 'string' ? { detail: redactSensitiveText(event.detail).slice(0, 500) } : {})
    }]
  })
}

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
  const requestSummary = value.requestSummary && Array.isArray(value.requestSummary.changedFiles) && typeof value.requestSummary.commandCount === 'number' && typeof value.requestSummary.elapsedMs === 'number' && typeof value.requestSummary.tokenCount === 'number' && typeof value.requestSummary.status === 'string'
    ? value.requestSummary
    : undefined
  const timestamp = typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  return {
    id: typeof value.id === 'string' ? value.id : createId('message'),
    role: value.role === 'assistant' ? 'assistant' : 'user',
    content,
    parts,
    ...(responseStats ? { responseStats } : {}),
    ...(requestSummary ? { requestSummary } : {}),
    ...(normalizeCompletionRecord(value.completionRecord) ? { completionRecord: normalizeCompletionRecord(value.completionRecord) } : {}),
    ...(value.status ? { status: value.status } : {}),
    ...(value.requestStatus ? { requestStatus: value.requestStatus } : {}),
    ...(value.stopReason ? { stopReason: value.stopReason } : {}),
    ...(normalizeRequestEventLog(value.eventLog).length > 0 ? { eventLog: normalizeRequestEventLog(value.eventLog) } : {}),
    ...(value.requestId ? { requestId: value.requestId } : {}),
    ...(value.bookmarked === true ? { bookmarked: true } : {}),
    createdAt: timestamp,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : timestamp
  }
}

const normalizeCompletionRecord = (value: unknown): CompletionRecord | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Partial<CompletionRecord>
  const list = (items: unknown): string[] => Array.isArray(items)
    ? items.filter((item): item is string => typeof item === 'string').slice(0, 100).map(item => item.slice(0, 2000))
    : []
  if (!Array.isArray(record.changedFiles) || !Array.isArray(record.checksRun) || !Array.isArray(record.failures) || !Array.isArray(record.remainingWork)) return undefined
  return {
    changedFiles: list(record.changedFiles),
    checksRun: list(record.checksRun),
    failures: list(record.failures),
    remainingWork: list(record.remainingWork),
    recordedAt: typeof record.recordedAt === 'number' ? record.recordedAt : Date.now()
  }
}

const normalizeConversation = (value: Partial<Conversation>): Conversation => {
  const timestamp = typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  const messages = Array.isArray(value.messages) ? value.messages.map(message => normalizeMessage(message)) : []
  const savedPromptHistory = normalizePromptHistory(value.promptHistory)
  const promptHistory = savedPromptHistory.length > 0
    ? savedPromptHistory
    : normalizePromptHistory(messages
      .filter(message => message.role === 'user' && message.content.trim().length > 0)
      .map(message => message.content)
      .reverse())
  return {
    id: typeof value.id === 'string' ? value.id : createId('conversation'),
    title: typeof value.title === 'string' ? value.title : 'New conversation',
    messages,
    draft: typeof value.draft === 'string' ? value.draft : '',
    promptHistory,
    ...(value.taskPlan && Array.isArray(value.taskPlan.steps) ? { taskPlan: value.taskPlan } : {}),
    ...(normalizeCompletionRecord(value.completionRecord) ? { completionRecord: normalizeCompletionRecord(value.completionRecord) } : {}),
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
  openaiProfile: 'generic',
  openaiApiVersion: '2024-10-21',
  openaiCustomModelsPath: '/v1/models',
  openaiCustomChatPath: '/v1/chat/completions',
  openaiCustomRequestTemplate: '{"model":"{{model}}","messages":"{{messages}}","stream":"{{stream}}","temperature":"{{temperature}}","top_p":"{{topP}}","max_tokens":"{{maxTokens}}"}',
  openaiCustomResponseFormat: 'openai-sse',
  openaiApiKeyHeader: 'Authorization',
  openaiApiKeyPrefix: 'Bearer',
  openaiOrganizationHeader: 'OpenAI-Organization',
  openaiOrganization: '',
  openaiProjectHeader: 'OpenAI-Project',
  openaiProject: '',
  openaiProxy: '',
  openaiNoProxy: 'localhost,127.0.0.1,::1',
  openaiTlsRejectUnauthorized: true,
  openaiTlsCaFile: '',
  openaiTlsCertFile: '',
  openaiTlsKeyFile: '',
  openrouterUrl: 'https://openrouter.ai/api/v1',
  openrouterReferer: '',
  openrouterTitle: 'Ghost Coding Assistant',
  openrouterAllowFallbacks: true,
  openrouterRequireParameters: false,
  openrouterDataCollection: 'allow',
  openrouterProviderOrder: [],
  openrouterProxy: '',
  openrouterNoProxy: 'localhost,127.0.0.1,::1',
  openrouterTlsRejectUnauthorized: true,
  openrouterTlsCaFile: '',
  openrouterTlsCertFile: '',
  openrouterTlsKeyFile: '',
  openCodeUrl: 'http://127.0.0.1:4096',
  openCodeUsername: 'opencode',
  openCodeAgent: '',
  openCodeSessionReuse: 'workspace',
  // Keep in sync with GHOST_TOOL_NAMES in src/config.ts (webview scripts cannot import host modules).
  toolAllowlist: [
    'ghost_read_file',
    'ghost_search_workspace',
    'ghost_get_diagnostics',
    'ghost_git_context',
    'ghost_update_task_plan',
    'ghost_record_completion',
    'ghost_write_file',
    'ghost_apply_edit',
    'ghost_apply_transaction',
    'ghost_run_terminal_command',
    'ghost_list_directory'
  ],
  toolAsklist: [],
  toolDenylist: [],
  terminalEnvironmentAsklist: [],
  enableDebugLogging: false,
  logLevel: 'off',
  networkAccess: 'local',
  chatModel: 'qwen2.5-coder:7b',
  autocompleteModel: 'qwen2.5-coder:1.5b',
  modelProfile: '',
  modelAliases: {},
  modelProfiles: {},
  maxContextTokens: 8192,
  temperature: 0.3,
  topP: 0.9,
  topK: 20,
  minP: 0.05,
  presencePenalty: 0.0,
  repeatPenalty: 1.05,
  responseLength: 'balanced',
  mode: 'agent',
  autoAcceptScope: 'confirm',
  fileEditApproval: 'confirm',
  enableInlineCompletions: true,
  enableConversationPersistence: true,
  terminalEnvironmentAllowlist: ['PATH', 'HOME', 'USER', 'USERNAME', 'SHELL', 'ComSpec', 'SystemRoot', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'CI', 'PWD']
}
let availableModels: string[] = []
let availableModelMetadata: ModelMetadata[] = [{
  id: controls.chatModel,
  label: controls.chatModel,
  provider: controls.provider,
  capabilities: ['chat']
}]
let modelRefreshPending = false
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
  promptHistoryLimit: defaultPromptHistoryLimit,
  workspaceRoot: '',
  firstRunSetupComplete: false,
  workspaceOnly: false
}

const restorePersistedState = (persisted: GhostState): void => {
  const conversations = (persisted.conversations ?? [])
    .filter(conversation => Boolean(conversation) && typeof conversation === 'object')
    .map(conversation => recoverInterruptedConversation(normalizeConversation(conversation)))
  if (conversations.length === 0) {
    conversations.push(createConversation())
  }
  const activeConversationId = conversations.some(conversation => conversation.id === persisted.activeConversationId)
    ? persisted.activeConversationId
    : conversations[0].id
  state = {
    schemaVersion: persistenceSchemaVersion,
    workspaceId: persisted.workspaceId,
    conversations,
    activeConversationId,
    promptHistory: normalizePromptHistory(persisted.promptHistory),
    presets: Array.isArray(persisted.presets) ? persisted.presets : [],
    showReasoning: persisted.showReasoning === true,
    preferences: persisted.preferences
  }
  migrateLegacyPromptHistory(conversations, activeConversationId, persisted.promptHistory)
  showReasoning = state.showReasoning === true
  const preferences = persisted.preferences ?? {}
  if (typeof preferences.assistantName === 'string') uiPreferences.assistantName = preferences.assistantName.slice(0, 40)
  if (typeof preferences.assistantAvatar === 'string') uiPreferences.assistantAvatar = preferences.assistantAvatar.slice(0, 4)
  if (typeof preferences.accentColor === 'string') uiPreferences.accentColor = preferences.accentColor
  if (typeof preferences.compactLayout === 'boolean') uiPreferences.compactLayout = preferences.compactLayout
  if (typeof preferences.showThinkingDetails === 'boolean') uiPreferences.showThinkingDetails = preferences.showThinkingDetails
  if (typeof preferences.verboseToolDetails === 'boolean') uiPreferences.showToolProgress = preferences.verboseToolDetails
  if (typeof preferences.showDiagnostics === 'boolean') uiPreferences.showDiagnostics = preferences.showDiagnostics
  if (typeof preferences.autoContext === 'boolean') uiPreferences.autoContext = preferences.autoContext
  if (typeof preferences.customSystemInstructions === 'string') uiPreferences.customSystemInstructions = preferences.customSystemInstructions.slice(0, 8000)
  if (typeof preferences.composerHeight === 'number') composerHeight = Math.min(320, Math.max(80, Math.floor(preferences.composerHeight)))
  if (typeof preferences.promptRows === 'number') promptRows = settingsStore.clampPromptRows(preferences.promptRows)
  if (typeof preferences.promptHistoryLimit === 'number') uiPreferences.promptHistoryLimit = settingsStore.clampPromptHistoryLimit(preferences.promptHistoryLimit, defaultPromptHistoryLimit)
  if (typeof preferences.workspaceRoot === 'string') uiPreferences.workspaceRoot = preferences.workspaceRoot
  if (typeof preferences.firstRunSetupComplete === 'boolean') uiPreferences.firstRunSetupComplete = preferences.firstRunSetupComplete
  if (typeof preferences.workspaceOnly === 'boolean') uiPreferences.workspaceOnly = preferences.workspaceOnly
  trimPromptHistories()
  applyUiPreferences()
}

let persistenceReady = false
let persistenceTimer: number | undefined
let settingsTimer: number | undefined
let modelRefreshTimer: number | undefined
const transientTimers = new Set<number>()
let historyIndex = -1
let pendingDeleteConversationId: string | undefined
let mentionMenu: HTMLElement | undefined
const requests = new Map<string, ActiveRequest>()
let progressTimer: number | undefined
const MESSAGE_RENDER_WINDOW = 200
const HOT_MESSAGE_COUNT = 40
let visibleMessageCount = MESSAGE_RENDER_WINDOW
let firstRunSetupOpened = false

const setTransientTimeout = (callback: () => void, milliseconds: number): number => {
  const timer = window.setTimeout(() => {
    transientTimers.delete(timer)
    callback()
  }, milliseconds)
  transientTimers.add(timer)
  return timer
}

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

app.replaceChildren(ghostShell.createAppShell(ghostIconUri))

const messagesElement = document.getElementById('messages') as HTMLElement
const promptElement = document.getElementById('prompt') as HTMLTextAreaElement
const composerElement = document.getElementById('composer') as HTMLFormElement
const sendElement = document.getElementById('send') as HTMLButtonElement
const stopElement = document.getElementById('stop') as HTMLButtonElement
const searchPromptHistoryElement = document.getElementById('search-prompt-history') as HTMLButtonElement
const previousPromptElement = document.getElementById('previous-prompt') as HTMLButtonElement
const nextPromptElement = document.getElementById('next-prompt') as HTMLButtonElement
const statusTextElement = document.getElementById('status-text') as HTMLElement
const statusFooterElement = document.getElementById('status-footer') as HTMLElement
const screenReaderStatusElement = document.getElementById('screen-reader-status') as HTMLElement
const composerCountElement = document.getElementById('composer-count') as HTMLElement
const persistenceStatusElement = document.getElementById('persistence-status') as HTMLElement
const providerAreaToggleElement = document.getElementById('toggle-provider-area') as HTMLButtonElement
const providerAreaContentElement = document.getElementById('provider-area-content') as HTMLElement
const providerElement = document.getElementById('provider') as HTMLSelectElement
const modelElement = document.getElementById('model') as HTMLInputElement
const modelAutocompleteElement = document.getElementById('model-autocomplete') as HTMLElement
const modelOptionsElement = document.getElementById('model-options') as HTMLElement
const modelOptionsToggleElement = document.getElementById('model-options-toggle') as HTMLButtonElement
const modelProfileElement = document.getElementById('model-profile') as HTMLSelectElement
const modelProfileEffectiveElement = document.getElementById('model-profile-effective') as HTMLElement
const modelCapabilitiesElement = document.getElementById('model-capabilities') as HTMLElement
const connectionIndicatorElement = document.getElementById('connection-indicator') as HTMLElement
const connectionTextElement = document.getElementById('connection-text') as HTMLElement
const autoAcceptIndicatorElement = document.getElementById('auto-accept-indicator') as HTMLElement
const attachmentListElement = document.getElementById('attachment-list') as HTMLElement
const attachmentLimitElement = document.getElementById('attachment-limit') as HTMLElement
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
const enableInlineCompletionsElement = document.getElementById('enable-inline-completions') as HTMLInputElement
const restoreGenerationDefaultsElement = document.getElementById('restore-generation-defaults') as HTMLButtonElement
const composerHeightElement = document.getElementById('composer-height') as HTMLInputElement
const promptRowsElement = document.getElementById('prompt-rows') as HTMLInputElement
const promptHistoryLimitElement = document.getElementById('prompt-history-limit') as HTMLInputElement
const providerEndpointElement = document.getElementById('provider-endpoint') as HTMLInputElement
const providerHelpElement = document.getElementById('provider-help') as HTMLElement
const openCodeUsernameElement = document.getElementById('opencode-username') as HTMLInputElement
const openCodeAgentElement = document.getElementById('opencode-agent') as HTMLInputElement
const openCodeSessionReuseElement = document.getElementById('opencode-session-reuse') as HTMLSelectElement
const setOpenCodePasswordElement = document.getElementById('set-opencode-password') as HTMLButtonElement
const setOpenRouterApiKeyElement = document.getElementById('set-openrouter-api-key') as HTMLButtonElement
const openAiProfileElement = document.getElementById('openai-profile') as HTMLSelectElement
const openAiApiVersionElement = document.getElementById('openai-api-version') as HTMLInputElement
const openAiCustomModelsPathElement = document.getElementById('openai-custom-models-path') as HTMLInputElement
const openAiCustomChatPathElement = document.getElementById('openai-custom-chat-path') as HTMLInputElement
const openAiCustomResponseFormatElement = document.getElementById('openai-custom-response-format') as HTMLSelectElement
const openAiCustomRequestTemplateElement = document.getElementById('openai-custom-request-template') as HTMLTextAreaElement
const openAiApiKeyHeaderElement = document.getElementById('openai-api-key-header') as HTMLInputElement
const openAiApiKeyPrefixElement = document.getElementById('openai-api-key-prefix') as HTMLInputElement
const openAiOrganizationHeaderElement = document.getElementById('openai-organization-header') as HTMLInputElement
const openAiOrganizationElement = document.getElementById('openai-organization') as HTMLInputElement
const openAiProjectHeaderElement = document.getElementById('openai-project-header') as HTMLInputElement
const openAiProjectElement = document.getElementById('openai-project') as HTMLInputElement
const openAiProxyElement = document.getElementById('openai-proxy') as HTMLInputElement
const openAiNoProxyElement = document.getElementById('openai-no-proxy') as HTMLInputElement
const openAiTlsRejectUnauthorizedElement = document.getElementById('openai-tls-reject-unauthorized') as HTMLInputElement
const openAiTlsCaFileElement = document.getElementById('openai-tls-ca-file') as HTMLInputElement
const openAiTlsCertFileElement = document.getElementById('openai-tls-cert-file') as HTMLInputElement
const openAiTlsKeyFileElement = document.getElementById('openai-tls-key-file') as HTMLInputElement
const openRouterRefererElement = document.getElementById('openrouter-referer') as HTMLInputElement
const openRouterTitleElement = document.getElementById('openrouter-title') as HTMLInputElement
const openRouterAllowFallbacksElement = document.getElementById('openrouter-allow-fallbacks') as HTMLInputElement
const openRouterRequireParametersElement = document.getElementById('openrouter-require-parameters') as HTMLInputElement
const openRouterDataCollectionElement = document.getElementById('openrouter-data-collection') as HTMLSelectElement
const openRouterProviderOrderElement = document.getElementById('openrouter-provider-order') as HTMLInputElement
const openRouterProxyElement = document.getElementById('openrouter-proxy') as HTMLInputElement
const openRouterNoProxyElement = document.getElementById('openrouter-no-proxy') as HTMLInputElement
const openRouterTlsRejectUnauthorizedElement = document.getElementById('openrouter-tls-reject-unauthorized') as HTMLInputElement
const openRouterTlsCaFileElement = document.getElementById('openrouter-tls-ca-file') as HTMLInputElement
const openRouterTlsCertFileElement = document.getElementById('openrouter-tls-cert-file') as HTMLInputElement
const openRouterTlsKeyFileElement = document.getElementById('openrouter-tls-key-file') as HTMLInputElement
const testProviderElement = document.getElementById('test-provider') as HTMLButtonElement
const refreshModelsElement = document.getElementById('refresh-models') as HTMLButtonElement
const openToolPermissionsElement = document.getElementById('open-tool-permissions') as HTMLButtonElement
const toolPermissionsSummaryElement = document.getElementById('tool-permissions-summary') as HTMLElement
const toolPermissionsModalElement = document.getElementById('tool-permissions-modal') as HTMLElement
const toolPermissionsListElement = document.getElementById('tool-permissions-list') as HTMLElement
const openTerminalEnvironmentPermissionsElement = document.getElementById('open-terminal-environment-permissions') as HTMLButtonElement
const terminalEnvironmentPermissionsSummaryElement = document.getElementById('terminal-environment-permissions-summary') as HTMLElement
const terminalEnvironmentPermissionsModalElement = document.getElementById('terminal-environment-permissions-modal') as HTMLElement
const terminalEnvironmentPermissionsListElement = document.getElementById('terminal-environment-permissions-list') as HTMLElement
const terminalEnvironmentNameElement = document.getElementById('terminal-environment-name') as HTMLInputElement
const addTerminalEnvironmentElement = document.getElementById('add-terminal-environment') as HTMLButtonElement
const fileEditApprovalElement = document.getElementById('file-edit-approval') as HTMLSelectElement
const openCodeFileEditApprovalElement = document.getElementById('opencode-file-edit-approval') as HTMLSelectElement
const assistantNameElement = document.getElementById('assistant-name') as HTMLInputElement
const assistantAvatarElement = document.getElementById('assistant-avatar') as HTMLInputElement
const accentColorElement = document.getElementById('accent-color') as HTMLInputElement
const showReasoningElement = document.getElementById('show-reasoning') as HTMLInputElement
const persistenceElement = document.getElementById('persist-conversations') as HTMLInputElement
const compactLayoutElement = document.getElementById('compact-layout') as HTMLInputElement
const showThinkingElement = document.getElementById('show-thinking') as HTMLInputElement
const showToolProgressElement = document.getElementById('show-tool-progress') as HTMLInputElement
const showDiagnosticsElement = document.getElementById('show-diagnostics') as HTMLInputElement
const logLevelElement = document.getElementById('log-level') as HTMLSelectElement
const autoContextElement = document.getElementById('auto-context') as HTMLInputElement
const workspaceSettingsElement = document.getElementById('workspace-settings') as HTMLInputElement
const workspaceRootElement = document.getElementById('workspace-root') as HTMLSelectElement
const systemInstructionsElement = document.getElementById('system-instructions') as HTMLTextAreaElement
const resetSystemInstructionsElement = document.getElementById('reset-system-instructions') as HTMLButtonElement
const settingsModalElement = document.getElementById('settings-modal') as HTMLElement
const privacyModalElement = document.getElementById('privacy-modal') as HTMLElement
const contextModalElement = document.getElementById('context-modal') as HTMLElement
const historyModalElement = document.getElementById('history-modal') as HTMLElement
const deleteConversationModalElement = document.getElementById('delete-conversation-modal') as HTMLElement
const deleteConversationDescriptionElement = document.getElementById('delete-conversation-description') as HTMLElement
const promptHistoryModalElement = document.getElementById('prompt-history-modal') as HTMLElement
const editToolModalElement = document.getElementById('edit-tool-modal') as HTMLElement
const editToolFormElement = document.getElementById('edit-tool-form') as HTMLFormElement
const editToolArgumentsElement = document.getElementById('edit-tool-arguments') as HTMLTextAreaElement
const editToolErrorElement = document.getElementById('edit-tool-error') as HTMLElement
const contextPreviewElement = document.getElementById('context-preview-list') as HTMLElement
const historySearchElement = document.getElementById('history-search') as HTMLInputElement
const historyBookmarksOnlyElement = document.getElementById('history-bookmarks-only') as HTMLInputElement
const historySearchSummaryElement = document.getElementById('history-search-summary') as HTMLElement
const historyListElement = document.getElementById('history-list') as HTMLElement
const firstRunModalElement = document.getElementById('first-run-modal') as HTMLElement
const setupProviderStatusElement = document.getElementById('setup-provider-status') as HTMLElement
const setupCheckProviderElement = document.getElementById('setup-check-provider') as HTMLButtonElement
const setupModelStatusElement = document.getElementById('setup-model-status') as HTMLElement
const setupModelListElement = document.getElementById('setup-model-list') as HTMLElement
const setupTestStatusElement = document.getElementById('setup-test-status') as HTMLElement
const setupTestRequestElement = document.getElementById('setup-test-request') as HTMLButtonElement
const setupCapabilitiesElement = document.getElementById('setup-capabilities') as HTMLElement
const finishFirstRunElement = document.getElementById('finish-first-run') as HTMLButtonElement
const settingsSearchElement = document.getElementById('settings-search') as HTMLInputElement
const settingsGridElement = document.querySelector<HTMLElement>('.settings-grid') as HTMLElement
const providerSettingsToggleElement = document.getElementById('toggle-provider-settings') as HTMLButtonElement
const providerSettingsFieldsElement = document.getElementById('provider-settings-fields') as HTMLElement
let providerSettingsExpanded = true
const promptHistorySearchElement = document.getElementById('prompt-history-search') as HTMLInputElement
const promptHistoryListElement = document.getElementById('prompt-history-list') as HTMLElement
const presetSelectElement = document.getElementById('preset-select') as HTMLSelectElement
const presetNameElement = document.getElementById('preset-name') as HTMLInputElement
const presetPromptElement = document.getElementById('preset-prompt') as HTMLTextAreaElement
const savePresetElement = document.getElementById('save-preset') as HTMLButtonElement

const setPresetSaveState = (saved: boolean): void => {
  savePresetElement.classList.toggle('pressed', saved)
  savePresetElement.setAttribute('aria-pressed', String(saved))
  savePresetElement.textContent = saved ? 'Saved' : 'Save'
}

let ghostWanderTimer: number | undefined
let ghostIdleTimer: number | undefined

const setGhostEyeOffset = (face: HTMLElement, horizontal: number, vertical: number): void => {
  const bounds = face.getBoundingClientRect()
  if (bounds.width === 0 || bounds.height === 0) {
    return
  }
  const clamp = (value: number): number => Math.max(-1, Math.min(1, value))
  face.style.setProperty('--ghost-eye-x', `${clamp(horizontal) * bounds.width * 0.08}px`)
  face.style.setProperty('--ghost-eye-y', `${clamp(vertical) * bounds.height * 0.08}px`)
}

const stopGhostWandering = (): void => {
  if (ghostIdleTimer !== undefined) {
    window.clearTimeout(ghostIdleTimer)
    ghostIdleTimer = undefined
  }
  if (ghostWanderTimer !== undefined) {
    window.clearInterval(ghostWanderTimer)
    ghostWanderTimer = undefined
  }
  document.querySelectorAll<HTMLElement>('.ghost-face').forEach(face => face.classList.remove('idle-wandering'))
}

const wanderGhostEyes = (): void => {
  document.querySelectorAll<HTMLElement>('.ghost-face').forEach(face => {
    setGhostEyeOffset(face, Math.random() * 2 - 1, Math.random() * 2 - 1)
  })
}

const startGhostWandering = (): void => {
  if (ghostIdleTimer !== undefined) {
    window.clearTimeout(ghostIdleTimer)
    ghostIdleTimer = undefined
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || ghostWanderTimer !== undefined) {
    return
  }
  document.querySelectorAll<HTMLElement>('.ghost-face').forEach(face => face.classList.add('idle-wandering'))
  wanderGhostEyes()
  ghostWanderTimer = window.setInterval(wanderGhostEyes, 1800)
}

const scheduleGhostIdle = (): void => {
  if (ghostIdleTimer !== undefined) {
    window.clearTimeout(ghostIdleTimer)
  }
  ghostIdleTimer = window.setTimeout(() => {
    ghostIdleTimer = undefined
    startGhostWandering()
  }, 1000)
}

const updateGhostEyes = (event: PointerEvent): void => {
  stopGhostWandering()
  document.querySelectorAll<HTMLElement>('.ghost-face').forEach(face => {
    const bounds = face.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) {
      return
    }
    const horizontal = (event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2)
    const vertical = (event.clientY - (bounds.top + bounds.height / 2)) / (bounds.height / 2)
    setGhostEyeOffset(face, horizontal, vertical)
  })
  scheduleGhostIdle()
}

window.addEventListener('pointermove', updateGhostEyes, { passive: true })
window.addEventListener('blur', startGhostWandering)
window.addEventListener('focus', scheduleGhostIdle)
document.documentElement.addEventListener('pointerleave', startGhostWandering, { passive: true })

const post = (type: string, details: Record<string, unknown> = {}): void => {
  protocolClient.post(vscode, type, details)
}

const createPersistedState = () => compactPersistedState({
  schemaVersion: persistenceSchemaVersion,
  workspaceId: state.workspaceId,
  conversations: redactPersistedValue(state.conversations) as Conversation[],
  activeConversationId: state.activeConversationId,
  promptHistory: (redactPersistedValue(promptHistory()) as string[]),
  presets: redactPersistedValue(state.presets ?? []) as PromptPreset[],
  showReasoning,
  preferences: {
    provider: controls.provider,
    modelProfile: controls.modelProfile,
    ollamaUrl: controls.ollamaUrl,
    mlxUrl: controls.mlxUrl,
    openaiUrl: controls.openaiUrl,
    openaiProfile: controls.openaiProfile,
    openaiApiVersion: controls.openaiApiVersion,
    openaiCustomModelsPath: controls.openaiCustomModelsPath,
    openaiCustomChatPath: controls.openaiCustomChatPath,
    openaiCustomRequestTemplate: controls.openaiCustomRequestTemplate,
    openaiCustomResponseFormat: controls.openaiCustomResponseFormat,
    openaiApiKeyHeader: controls.openaiApiKeyHeader,
    openaiApiKeyPrefix: controls.openaiApiKeyPrefix,
    openaiOrganizationHeader: controls.openaiOrganizationHeader,
    openaiOrganization: controls.openaiOrganization,
    openaiProjectHeader: controls.openaiProjectHeader,
    openaiProject: controls.openaiProject,
    openaiProxy: controls.openaiProxy,
    openaiNoProxy: controls.openaiNoProxy,
    openaiTlsRejectUnauthorized: controls.openaiTlsRejectUnauthorized,
    openaiTlsCaFile: controls.openaiTlsCaFile,
    openaiTlsCertFile: controls.openaiTlsCertFile,
    openaiTlsKeyFile: controls.openaiTlsKeyFile,
    openrouterUrl: controls.openrouterUrl,
    openrouterReferer: controls.openrouterReferer,
    openrouterTitle: controls.openrouterTitle,
    openrouterAllowFallbacks: controls.openrouterAllowFallbacks,
    openrouterRequireParameters: controls.openrouterRequireParameters,
    openrouterDataCollection: controls.openrouterDataCollection,
    openrouterProviderOrder: controls.openrouterProviderOrder,
    openrouterProxy: controls.openrouterProxy,
    openrouterNoProxy: controls.openrouterNoProxy,
    openrouterTlsRejectUnauthorized: controls.openrouterTlsRejectUnauthorized,
    openrouterTlsCaFile: controls.openrouterTlsCaFile,
    openrouterTlsCertFile: controls.openrouterTlsCertFile,
    openrouterTlsKeyFile: controls.openrouterTlsKeyFile,
    openCodeUrl: controls.openCodeUrl,
    openCodeUsername: controls.openCodeUsername,
    openCodeAgent: controls.openCodeAgent,
    openCodeSessionReuse: controls.openCodeSessionReuse,
    toolAllowlist: controls.toolAllowlist,
    toolAsklist: controls.toolAsklist,
    toolDenylist: controls.toolDenylist,
    terminalEnvironmentAllowlist: controls.terminalEnvironmentAllowlist,
    terminalEnvironmentAsklist: controls.terminalEnvironmentAsklist,
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
    enableInlineCompletions: controls.enableInlineCompletions,
    autoAcceptScope: controls.fileEditApproval,
    enableConversationPersistence: controls.enableConversationPersistence,
    composerHeight,
    promptRows,
    promptHistoryLimit: uiPreferences.promptHistoryLimit,
    assistantName: uiPreferences.assistantName,
    assistantAvatar: uiPreferences.assistantAvatar,
    accentColor: uiPreferences.accentColor,
    compactLayout: uiPreferences.compactLayout,
    showThinkingDetails: uiPreferences.showThinkingDetails,
    verboseToolDetails: uiPreferences.showToolProgress,
    showDiagnostics: uiPreferences.showDiagnostics,
    autoContext: uiPreferences.autoContext,
    customSystemInstructions: uiPreferences.customSystemInstructions,
    workspaceRoot: uiPreferences.workspaceRoot,
    firstRunSetupComplete: uiPreferences.firstRunSetupComplete,
    workspaceOnly: uiPreferences.workspaceOnly,
    enableDebugLogging: controls.enableDebugLogging,
    logLevel: controls.logLevel
  }
})

const saveState = () => {
  if (!controls.enableConversationPersistence) {
    return
  }
  vscode.setState(compactPersistedState(redactPersistedValue(state)) as GhostState)
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

const maxTokensForLength = settingsStore.maxTokensForLength

const promptHistory = (): string[] => getActiveConversation().promptHistory

const trimPromptHistories = (): void => {
  for (const conversation of state.conversations) {
    conversation.promptHistory = normalizePromptHistory(conversation.promptHistory, uiPreferences.promptHistoryLimit)
  }
  state.promptHistory = promptHistory()
}

const renderPromptHistorySearch = (): void => {
  const query = promptHistorySearchElement.value.trim().toLowerCase()
  promptHistoryListElement.textContent = ''
  const entries = promptHistory().filter(prompt => !query || prompt.toLowerCase().includes(query))
  if (entries.length === 0) {
    promptHistoryListElement.textContent = query ? 'No matching prompts.' : 'No prompts saved yet.'
    return
  }
  entries.forEach(prompt => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'prompt-history-entry'
    button.dataset.promptHistoryIndex = String(promptHistory().indexOf(prompt))
    button.textContent = prompt.replace(/\s+/g, ' ').trim()
    button.title = 'Use this prompt'
    promptHistoryListElement.append(button)
  })
}

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
        openaiProfile: controls.openaiProfile,
        openaiApiVersion: controls.openaiApiVersion,
        openaiCustomModelsPath: controls.openaiCustomModelsPath,
        openaiCustomChatPath: controls.openaiCustomChatPath,
        openaiCustomRequestTemplate: controls.openaiCustomRequestTemplate,
        openaiCustomResponseFormat: controls.openaiCustomResponseFormat,
        openaiApiKeyHeader: controls.openaiApiKeyHeader,
        openaiApiKeyPrefix: controls.openaiApiKeyPrefix,
        openaiOrganizationHeader: controls.openaiOrganizationHeader,
        openaiOrganization: controls.openaiOrganization,
        openaiProjectHeader: controls.openaiProjectHeader,
        openaiProject: controls.openaiProject,
        openaiProxy: controls.openaiProxy,
        openaiNoProxy: controls.openaiNoProxy,
        openaiTlsRejectUnauthorized: controls.openaiTlsRejectUnauthorized,
        openaiTlsCaFile: controls.openaiTlsCaFile,
        openaiTlsCertFile: controls.openaiTlsCertFile,
        openaiTlsKeyFile: controls.openaiTlsKeyFile,
        openrouterUrl: controls.openrouterUrl,
        openrouterReferer: controls.openrouterReferer,
        openrouterTitle: controls.openrouterTitle,
        openrouterAllowFallbacks: controls.openrouterAllowFallbacks,
        openrouterRequireParameters: controls.openrouterRequireParameters,
        openrouterDataCollection: controls.openrouterDataCollection,
        openrouterProviderOrder: controls.openrouterProviderOrder,
        openrouterProxy: controls.openrouterProxy,
        openrouterNoProxy: controls.openrouterNoProxy,
        openrouterTlsRejectUnauthorized: controls.openrouterTlsRejectUnauthorized,
        openrouterTlsCaFile: controls.openrouterTlsCaFile,
        openrouterTlsCertFile: controls.openrouterTlsCertFile,
        openrouterTlsKeyFile: controls.openrouterTlsKeyFile,
        openCodeUrl: controls.openCodeUrl,
        openCodeUsername: controls.openCodeUsername,
        openCodeAgent: controls.openCodeAgent,
        openCodeSessionReuse: controls.openCodeSessionReuse,
        toolAllowlist: controls.toolAllowlist,
        toolAsklist: controls.toolAsklist,
        toolDenylist: controls.toolDenylist,
        terminalEnvironmentAllowlist: controls.terminalEnvironmentAllowlist,
        terminalEnvironmentAsklist: controls.terminalEnvironmentAsklist,
        chatModel: controls.chatModel,
        autocompleteModel: controls.autocompleteModel,
        modelProfile: controls.modelProfile,
        modelAliases: controls.modelAliases,
        modelProfiles: controls.modelProfiles,
        maxContextTokens: controls.maxContextTokens,
        temperature: controls.temperature,
        topP: controls.topP,
        topK: controls.topK,
        minP: controls.minP,
        presencePenalty: controls.presencePenalty,
        repeatPenalty: controls.repeatPenalty,
        responseLength: controls.responseLength,
        mode: controls.mode,
        enableInlineCompletions: controls.enableInlineCompletions,
        autoAcceptScope: controls.fileEditApproval,
        enableConversationPersistence: controls.enableConversationPersistence,
        workspaceOnly: uiPreferences.workspaceOnly,
        enableDebugLogging: controls.enableDebugLogging,
        logLevel: controls.logLevel
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
    : controls.provider === 'openrouter'
      ? controls.openrouterUrl
    : controls.provider === 'opencode'
      ? controls.openCodeUrl
      : controls.ollamaUrl

const openAiDefaultEndpoints: Record<OpenAiProfile, string> = {
  generic: 'http://localhost:8001/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  'azure-openai': '',
  'lm-studio': 'http://localhost:1234/v1',
  'llama-cpp': 'http://localhost:8080/v1',
  vllm: 'http://localhost:8000/v1',
  litellm: 'http://localhost:4000/v1',
  custom: 'http://localhost:8001'
}

const applyUiPreferences = () => {
  const accent = /^#[0-9a-f]{6}$/i.test(uiPreferences.accentColor) ? uiPreferences.accentColor : ''
  document.documentElement.style.setProperty('--ghost-accent', accent || 'var(--vscode-textLink-foreground, #3794ff)')
  document.body.classList.toggle('compact-layout', uiPreferences.compactLayout)
  document.title = uiPreferences.assistantName || 'Ghost'
}

const getToolPolicy = (tool: string): 'allow' | 'ask' | 'deny' => {
  if (controls.toolDenylist.includes(tool)) {
    return 'deny'
  }
  if (controls.toolAsklist.includes(tool)) {
    return 'ask'
  }
  if (!controls.toolAllowlist.includes(tool)) {
    return 'ask'
  }
  return 'allow'
}

const getEnvironmentPolicy = (name: string): 'allow' | 'ask' | 'deny' => {
  if (controls.terminalEnvironmentAsklist.includes(name)) {
    return 'ask'
  }
  if (controls.terminalEnvironmentAllowlist.includes(name)) {
    return 'allow'
  }
  return 'deny'
}

const setToolPolicy = (tool: string, policy: 'allow' | 'ask' | 'deny'): void => {
  controls.toolAllowlist = controls.toolAllowlist.filter(item => item !== tool)
  controls.toolAsklist = controls.toolAsklist.filter(item => item !== tool)
  controls.toolDenylist = controls.toolDenylist.filter(item => item !== tool)
  if (policy === 'allow') {
    controls.toolAllowlist.push(tool)
  } else if (policy === 'ask') {
    controls.toolAsklist.push(tool)
  } else {
    controls.toolDenylist.push(tool)
  }
}

const setEnvironmentPolicy = (name: string, policy: 'allow' | 'ask' | 'deny'): void => {
  controls.terminalEnvironmentAllowlist = controls.terminalEnvironmentAllowlist.filter(item => item !== name)
  controls.terminalEnvironmentAsklist = controls.terminalEnvironmentAsklist.filter(item => item !== name)
  if (policy === 'allow') {
    controls.terminalEnvironmentAllowlist.push(name)
  } else if (policy === 'ask') {
    controls.terminalEnvironmentAsklist.push(name)
  }
}

const renderPermissionControls = (): void => {
  toolPermissionsListElement.textContent = ''
  const policyTools = controls.provider === 'opencode'
    ? ['ghost_read_file', 'ghost_search_workspace', 'ghost_git_context', 'ghost_apply_edit', 'ghost_run_terminal_command', 'ghost_list_directory']
    : Object.keys(toolDescriptions)
  for (const tool of policyTools) {
    const row = document.createElement('div')
    row.className = 'permission-row'
    const details = document.createElement('div')
    details.className = 'permission-details'
    const title = document.createElement('strong')
    title.textContent = tool
    const description = document.createElement('small')
    description.textContent = toolDescriptions[tool]
    details.append(title, document.createElement('br'), description)
    const options = document.createElement('div')
    options.className = 'permission-options'
    for (const policy of ['allow', 'ask', 'deny'] as const) {
      const label = document.createElement('label')
      label.className = 'permission-choice'
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = `tool-policy-${tool}`
      input.value = policy
      input.checked = getToolPolicy(tool) === policy
      input.addEventListener('change', () => {
        setToolPolicy(tool, policy)
        sendSettingsUpdate()
        saveState()
        renderPermissionControls()
      })
      label.append(input, document.createTextNode(` ${policy[0].toUpperCase()}${policy.slice(1)}`))
      options.append(label)
    }
    row.append(details, options)
    toolPermissionsListElement.append(row)
  }
  const toolAllowCount = policyTools.filter(tool => getToolPolicy(tool) === 'allow').length
  const toolAskCount = policyTools.filter(tool => getToolPolicy(tool) === 'ask').length
  const toolDenyCount = policyTools.filter(tool => getToolPolicy(tool) === 'deny').length
  toolPermissionsSummaryElement.textContent = `${toolAllowCount} allowed · ${toolAskCount} ask first · ${toolDenyCount} denied`

  terminalEnvironmentPermissionsListElement.textContent = ''
  const environmentNames = [...new Set([
    ...terminalEnvironmentDefaults,
    ...controls.terminalEnvironmentAllowlist,
    ...controls.terminalEnvironmentAsklist
  ])]
  for (const name of environmentNames) {
    const row = document.createElement('div')
    row.className = 'permission-row'
    const details = document.createElement('div')
    details.className = 'permission-details'
    const title = document.createElement('strong')
    title.textContent = name
    details.append(title)
    const options = document.createElement('div')
    options.className = 'permission-options'
    for (const policy of ['allow', 'ask', 'deny'] as const) {
      const label = document.createElement('label')
      label.className = 'permission-choice'
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = `environment-policy-${name}`
      input.value = policy
      input.checked = getEnvironmentPolicy(name) === policy
      input.addEventListener('change', () => {
        setEnvironmentPolicy(name, policy)
        sendSettingsUpdate()
        saveState()
        renderPermissionControls()
      })
      label.append(input, document.createTextNode(` ${policy[0].toUpperCase()}${policy.slice(1)}`))
      options.append(label)
    }
    row.append(details, options)
    terminalEnvironmentPermissionsListElement.append(row)
  }
  const environmentAllowCount = environmentNames.filter(name => getEnvironmentPolicy(name) === 'allow').length
  const environmentAskCount = environmentNames.filter(name => getEnvironmentPolicy(name) === 'ask').length
  const environmentDenyCount = environmentNames.filter(name => getEnvironmentPolicy(name) === 'deny').length
  terminalEnvironmentPermissionsSummaryElement.textContent = `${environmentAllowCount} passed · ${environmentAskCount} after approval · ${environmentDenyCount} blocked`
}

const renderModelCapabilities = (metadata: ModelMetadata | undefined): void => {
  if (!metadata) {
    modelCapabilitiesElement.textContent = 'Model capabilities are not available yet. Refresh models to check the provider.'
    modelCapabilitiesElement.title = ''
    modelCapabilitiesElement.classList.remove('warning')
    return
  }

  const formatLimit = (value: number | undefined): string => {
    if (value === undefined) return 'unknown'
    return value >= 1024 ? `${Math.round(value / 1024)}k` : String(value)
  }
  const sampling = metadata.supportsSampling
  const samplingLabels: Array<[boolean | undefined, string]> = [
    [sampling?.temperature, 'temperature'],
    [sampling?.topP, 'top P'],
    [sampling?.topK, 'top K'],
    [sampling?.minP, 'min P'],
    [sampling?.presencePenalty, 'presence penalty'],
    [sampling?.repeatPenalty, 'repeat penalty']
  ]
  const supportedSampling = samplingLabels.filter(([supported]) => supported === true).map(([, label]) => label)
  const unsupportedSettings = samplingLabels.filter(([supported]) => supported === false).map(([, label]) => label)
  const features = [
    metadata.supportsStreaming ? 'streaming' : 'no streaming',
    metadata.supportsVision ? 'vision' : 'no vision',
    metadata.supportsTools ? 'native tools' : 'native tools unavailable; Agent and Plan modes unreliable',
    metadata.supportsJsonMode ? 'JSON mode' : 'JSON mode unavailable',
    metadata.supportsFIM ? 'FIM' : 'FIM unavailable'
  ]
  const summary = [
    `${metadata.provider} · ${metadata.nativeApi ?? 'unknown API'}`,
    `${formatLimit(metadata.contextWindow)} context`,
    `${formatLimit(metadata.outputLimit)} output`,
    ...features,
    supportedSampling.length > 0 ? `sampling: ${supportedSampling.join(', ')}` : '',
    unsupportedSettings.length > 0 ? `⚠ Unsupported settings will be skipped: ${unsupportedSettings.join(', ')}` : ''
  ].filter(Boolean).join(' · ')
  modelCapabilitiesElement.textContent = summary
  modelCapabilitiesElement.title = summary
  modelCapabilitiesElement.classList.toggle('warning', unsupportedSettings.length > 0)
}

const renderFirstRunSetup = (): void => {
  const connectionLabel = connection === 'online' ? 'Connected' : connection === 'offline' ? 'Offline' : 'Checking…'
  setupProviderStatusElement.textContent = `${connectionLabel} · ${controls.provider} · ${providerEndpoint()}`
  setupModelStatusElement.textContent = availableModels.length > 0
    ? `${availableModels.length} model${availableModels.length === 1 ? '' : 's'} available`
    : 'No models reported yet'
  setupModelListElement.textContent = ''
  for (const model of availableModels.slice(0, 12)) {
    const chip = document.createElement('span')
    chip.className = 'setup-model-name'
    chip.textContent = model
    setupModelListElement.append(chip)
  }
  if (availableModels.length > 12) {
    const more = document.createElement('span')
    more.className = 'setup-model-name'
    more.textContent = `+${availableModels.length - 12} more`
    setupModelListElement.append(more)
  }
  const metadata = availableModelMetadata.find(item => item.id === controls.chatModel)
  setupCapabilitiesElement.textContent = metadata
    ? `Selected model: ${controls.chatModel}. ${metadata.supportsTools ? 'Tools supported.' : 'Tools unavailable; Agent and Plan modes are unreliable here because Ghost must parse JSON from the reply. Prefer Ollama or an OpenAI-compatible server for workspace tools. Ghost can still chat.'} ${metadata.supportsVision ? 'Vision supported.' : 'Vision unavailable.'} ${metadata.supportsStreaming ? 'Streaming supported.' : 'Streaming unavailable.'}`
    : 'Capability details will appear after model discovery.'
  setupTestRequestElement.disabled = Boolean(activeRequest) || connection === 'offline' || !controls.chatModel
}

const renderSettingsSearch = (): void => {
  const query = settingsSearchElement.value.trim().toLowerCase()
  const children = Array.from(settingsGridElement.children) as HTMLElement[]
  const sections: HTMLElement[][] = []
  let current: HTMLElement[] = []
  const flush = (): void => {
    if (current.length > 0) {
      sections.push(current)
      current = []
    }
  }
  for (const child of children) {
    if (child.dataset.settingsSectionHeading !== undefined) {
      flush()
    }
    current.push(child)
  }
  flush()
  for (const section of sections) {
    const matches = !query || section.some(item => item.textContent?.toLowerCase().includes(query) || Array.from(item.querySelectorAll('[id]')).some(element => element.id.toLowerCase().includes(query)))
    for (const item of section) {
      item.hidden = !matches || !providerScopeMatches(item.dataset.providerScope) || (item === providerSettingsFieldsElement && !providerSettingsExpanded)
    }
  }
  const presetSection = document.querySelector<HTMLElement>('.preset-section')
  if (presetSection) {
    presetSection.hidden = Boolean(query) && !presetSection.textContent?.toLowerCase().includes(query)
  }
}

const providerScopeMatches = (scope: string | undefined): boolean => (
  !scope || (scope === 'not-opencode' ? controls.provider !== 'opencode' : scope === controls.provider)
)

const updateProviderScopedElements = (): void => {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-provider-scope]'))) {
    element.hidden = !providerScopeMatches(element.dataset.providerScope)
  }
}

const updateProviderSettingsVisibility = (): void => {
  providerSettingsFieldsElement.hidden = !providerSettingsExpanded
  providerSettingsToggleElement.setAttribute('aria-expanded', String(providerSettingsExpanded))
  providerSettingsToggleElement.textContent = `Provider settings: ${providerSettingsExpanded ? 'Collapse' : 'Expand'}`
}

providerSettingsToggleElement.addEventListener('click', () => {
  providerSettingsExpanded = !providerSettingsExpanded
  updateProviderSettingsVisibility()
})

let providerAreaExpanded = true
const updateProviderAreaVisibility = (): void => {
  providerAreaContentElement.hidden = !providerAreaExpanded
  providerAreaToggleElement.setAttribute('aria-expanded', String(providerAreaExpanded))
  const label = `${providerAreaExpanded ? 'Collapse' : 'Expand'} provider controls`
  providerAreaToggleElement.setAttribute('aria-label', label)
  providerAreaToggleElement.dataset.tooltip = label
  providerAreaToggleElement.removeAttribute('title')
}

providerAreaToggleElement.addEventListener('click', () => {
  providerAreaExpanded = !providerAreaExpanded
  updateProviderAreaVisibility()
})

let activeModelOptionIndex = -1

const modelChoices = (): string[] => Array.from(new Set([controls.chatModel, ...availableModels].filter(Boolean)))
const modelMetadataFor = (model: string): ModelMetadata | undefined => availableModelMetadata.find(metadata => metadata.id === model)

const formatModelPrice = (value: number | undefined): string => {
  if (value === undefined) return 'unknown'
  if (value === 0) return 'free'
  return `$${value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} / 1M tokens`
}

const formatModelPricing = (metadata: ModelMetadata | undefined): string[] => {
  if (!metadata || metadata.pricingStatus === undefined || metadata.pricingStatus === 'unknown') {
    return ['Cost: unknown']
  }
  if (metadata.pricingStatus === 'free') {
    return ['Cost: free']
  }
  const pricing = metadata.pricing
  return [
    `Input: ${formatModelPrice(pricing?.input)}`,
    `Output: ${formatModelPrice(pricing?.output)}`,
    ...(pricing?.cacheRead === undefined ? [] : [`Cache read: ${formatModelPrice(pricing.cacheRead)}`]),
    ...(pricing?.cacheWrite === undefined ? [] : [`Cache write: ${formatModelPrice(pricing.cacheWrite)}`])
  ]
}

const formatModelHover = (model: string): string => {
  const metadata = modelMetadataFor(model)
  if (!metadata) {
    return `${model}\nMetadata unavailable`
  }
  return [
    metadata.displayName && metadata.displayName !== model ? metadata.displayName : model,
    ...formatModelPricing(metadata),
    metadata.contextWindow ? `Context: ${metadata.contextWindow.toLocaleString()} tokens` : '',
    metadata.outputLimit ? `Output: ${metadata.outputLimit.toLocaleString()} tokens` : '',
    metadata.capabilities && metadata.capabilities.length > 0 ? `Capabilities: ${metadata.capabilities.join(', ')}` : ''
  ].filter(Boolean).join('\n')
}

const closeModelOptions = (restoreSelection = false): void => {
  modelOptionsElement.hidden = true
  modelElement.setAttribute('aria-expanded', 'false')
  modelElement.removeAttribute('aria-activedescendant')
  activeModelOptionIndex = -1
  if (restoreSelection) modelElement.value = controls.chatModel
}

const setActiveModelOption = (index: number): void => {
  const options = Array.from(modelOptionsElement.querySelectorAll<HTMLElement>('[role="option"]'))
  if (options.length === 0) return
  activeModelOptionIndex = (index + options.length) % options.length
  options.forEach((option, optionIndex) => {
    const active = optionIndex === activeModelOptionIndex
    option.classList.toggle('active', active)
  })
  const activeOption = options[activeModelOptionIndex]
  modelElement.setAttribute('aria-activedescendant', activeOption.id)
  activeOption.scrollIntoView({ block: 'nearest' })
}

const renderModelOptions = (show = true): void => {
  const rawQuery = modelElement.value.trim()
  const query = rawQuery === controls.chatModel ? '' : rawQuery.toLocaleLowerCase()
  const filteredChoices = modelChoices()
    .filter(model => !query || model.toLocaleLowerCase().includes(query))
    .sort((left, right) => {
      const leftGroup = modelMetadataFor(left)?.pricingStatus === 'free' ? 0 : 1
      const rightGroup = modelMetadataFor(right)?.pricingStatus === 'free' ? 0 : 1
      if (leftGroup !== rightGroup) return leftGroup - rightGroup
      const leftStarts = left.toLocaleLowerCase().startsWith(query)
      const rightStarts = right.toLocaleLowerCase().startsWith(query)
      return leftStarts === rightStarts ? left.localeCompare(right) : leftStarts ? -1 : 1
    })
  const freeChoices = filteredChoices.filter(model => modelMetadataFor(model)?.pricingStatus === 'free').slice(0, 100)
  const otherChoices = filteredChoices.filter(model => modelMetadataFor(model)?.pricingStatus !== 'free').slice(0, Math.max(0, 100 - freeChoices.length))
  const choices = [...freeChoices, ...otherChoices]
  modelOptionsElement.replaceChildren()
  let optionIndex = 0
  const appendModelOption = (model: string): void => {
    const option = document.createElement('button')
    option.type = 'button'
    option.id = `model-option-${optionIndex}`
    option.className = 'model-option'
    option.dataset.model = model
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', String(model === controls.chatModel))
    option.title = formatModelHover(model)
    option.textContent = model
    modelOptionsElement.append(option)
    optionIndex += 1
  }
  freeChoices.forEach(appendModelOption)
  if (freeChoices.length > 0 && otherChoices.length > 0) {
    const separator = document.createElement('div')
    separator.className = 'model-options-separator'
    separator.setAttribute('role', 'separator')
    separator.textContent = 'Other models'
    modelOptionsElement.append(separator)
  }
  otherChoices.forEach(appendModelOption)
  if (filteredChoices.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'model-option-empty'
    empty.textContent = 'No matching models'
    modelOptionsElement.append(empty)
  } else if (filteredChoices.length > 100) {
    const more = document.createElement('div')
    more.className = 'model-option-empty'
    more.textContent = `${filteredChoices.length - choices.length} more matches — keep typing`
    modelOptionsElement.append(more)
  }
  modelOptionsElement.hidden = !show
  modelElement.setAttribute('aria-expanded', String(show))
  activeModelOptionIndex = -1
  modelElement.removeAttribute('aria-activedescendant')
}

const selectChatModel = (model: string): void => {
  if (!modelChoices().includes(model)) return
  controls.chatModel = model
  modelElement.value = model
  closeModelOptions()
  renderControls()
  sendSettingsUpdate()
  saveState()
}

const renderControls = () => {
  renderProviderOptions(providerElement, controls.provider)
  modelElement.value = controls.chatModel
  modelElement.title = formatModelHover(controls.chatModel)
  closeModelOptions()
  modelProfileElement.textContent = ''
  const defaultProfileOption = document.createElement('option')
  defaultProfileOption.value = ''
  defaultProfileOption.textContent = 'Default'
  modelProfileElement.append(defaultProfileOption)
  const profileNames = [...new Set([...Object.keys(builtInModelProfiles), ...Object.keys(controls.modelProfiles)])].sort()
  for (const profileName of profileNames) {
    const option = document.createElement('option')
    option.value = profileName
    option.textContent = builtInModelProfiles[profileName] ? `${profileName[0].toUpperCase()}${profileName.slice(1)} · built-in` : profileName
    modelProfileElement.append(option)
  }
  modelProfileElement.value = controls.modelProfile
  const activeProfile = builtInModelProfiles[controls.modelProfile] ?? controls.modelProfiles[controls.modelProfile]
  const effective = activeProfile ?? defaultGenerationSettings
  const profileLabel = controls.modelProfile ? `${controls.modelProfile} · ` : 'Default · '
  modelProfileEffectiveElement.textContent = `${profileLabel}temp ${effective.temperature ?? controls.temperature} · top P ${effective.topP ?? controls.topP} · context ${effective.maxContextTokens ?? controls.maxContextTokens} · output ${effective.maxTokens ?? maxTokensForLength(controls.responseLength) ?? 'unlimited'}`
  modelProfileEffectiveElement.title = 'Effective generation values. A selected profile overrides matching settings.'
  renderModelCapabilities(availableModelMetadata.find(metadata => metadata.id === controls.chatModel))
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
  enableInlineCompletionsElement.checked = controls.enableInlineCompletions
  fileEditApprovalElement.value = controls.fileEditApproval
  const openCodeFileEditScope = controls.fileEditApproval === 'request' || controls.fileEditApproval === 'workspace' || controls.fileEditApproval === 'always'
    ? controls.fileEditApproval
    : 'confirm'
  openCodeFileEditApprovalElement.value = openCodeFileEditScope
  const autoAcceptLabels: Record<AutoAcceptScope, string> = {
    confirm: 'Auto-accept off',
    'one-edit': 'Auto-accept: one edit',
    'current-file': 'Auto-accept: current file',
    request: 'Auto-accept: request',
    session: 'Auto-accept: session',
    workspace: 'Auto-accept: workspace',
    always: 'Auto-accept: always'
  }
  const autoAcceptPaused = activeRequest?.autoAcceptDisabled === true
  const displayedAutoAcceptScope = controls.provider === 'opencode' ? openCodeFileEditScope : controls.fileEditApproval
  autoAcceptIndicatorElement.textContent = autoAcceptPaused ? 'Auto-accept paused for request' : autoAcceptLabels[displayedAutoAcceptScope]
  autoAcceptIndicatorElement.classList.toggle('enabled', displayedAutoAcceptScope !== 'confirm' && !autoAcceptPaused)
  autoAcceptIndicatorElement.classList.toggle('paused', autoAcceptPaused)
  autoAcceptIndicatorElement.title = autoAcceptPaused ? 'Future file edits will ask for approval in this request.' : 'File edit approval scope'
  composerHeightElement.value = String(composerHeight)
  promptRowsElement.value = String(promptRows)
  promptHistoryLimitElement.value = String(uiPreferences.promptHistoryLimit)
  workspaceRootElement.textContent = ''
  for (const folder of contextData.folders) {
    const option = document.createElement('option')
    option.value = folder
    option.textContent = `${folder.split(/[\\/]/).pop() ?? folder} · ${folder}`
    workspaceRootElement.append(option)
  }
  workspaceRootElement.value = contextData.folders.includes(uiPreferences.workspaceRoot)
    ? uiPreferences.workspaceRoot
    : contextData.folders[0] ?? ''
  uiPreferences.workspaceRoot = workspaceRootElement.value
  workspaceRootElement.disabled = contextData.folders.length <= 1
  layoutComposer()
  providerEndpointElement.value = providerEndpoint()
  openCodeUsernameElement.value = controls.openCodeUsername
  openCodeAgentElement.value = controls.openCodeAgent
  openCodeSessionReuseElement.value = controls.openCodeSessionReuse
  openAiApiKeyHeaderElement.value = controls.openaiApiKeyHeader
  openAiProfileElement.value = controls.openaiProfile
  openAiApiVersionElement.value = controls.openaiApiVersion
  openAiCustomModelsPathElement.value = controls.openaiCustomModelsPath
  openAiCustomChatPathElement.value = controls.openaiCustomChatPath
  openAiCustomResponseFormatElement.value = controls.openaiCustomResponseFormat
  openAiCustomRequestTemplateElement.value = controls.openaiCustomRequestTemplate
  openAiApiKeyPrefixElement.value = controls.openaiApiKeyPrefix
  openAiOrganizationHeaderElement.value = controls.openaiOrganizationHeader
  openAiOrganizationElement.value = controls.openaiOrganization
  openAiProjectHeaderElement.value = controls.openaiProjectHeader
  openAiProjectElement.value = controls.openaiProject
  openAiProxyElement.value = controls.openaiProxy
  openAiNoProxyElement.value = controls.openaiNoProxy
  openAiTlsRejectUnauthorizedElement.checked = controls.openaiTlsRejectUnauthorized
  openAiTlsCaFileElement.value = controls.openaiTlsCaFile
  openAiTlsCertFileElement.value = controls.openaiTlsCertFile
  openAiTlsKeyFileElement.value = controls.openaiTlsKeyFile
  openRouterRefererElement.value = controls.openrouterReferer
  openRouterTitleElement.value = controls.openrouterTitle
  openRouterAllowFallbacksElement.checked = controls.openrouterAllowFallbacks
  openRouterRequireParametersElement.checked = controls.openrouterRequireParameters
  openRouterDataCollectionElement.value = controls.openrouterDataCollection
  openRouterProviderOrderElement.value = controls.openrouterProviderOrder.join(', ')
  openRouterProxyElement.value = controls.openrouterProxy
  openRouterNoProxyElement.value = controls.openrouterNoProxy
  openRouterTlsRejectUnauthorizedElement.checked = controls.openrouterTlsRejectUnauthorized
  openRouterTlsCaFileElement.value = controls.openrouterTlsCaFile
  openRouterTlsCertFileElement.value = controls.openrouterTlsCertFile
  openRouterTlsKeyFileElement.value = controls.openrouterTlsKeyFile
  const openAiSettingsEnabled = controls.provider === 'openai-compatible'
  for (const element of [
    openAiApiKeyHeaderElement,
    openAiProfileElement,
    openAiApiVersionElement,
    openAiCustomModelsPathElement,
    openAiCustomChatPathElement,
    openAiCustomResponseFormatElement,
    openAiCustomRequestTemplateElement,
    openAiApiKeyPrefixElement,
    openAiOrganizationHeaderElement,
    openAiOrganizationElement,
    openAiProjectHeaderElement,
    openAiProjectElement,
    openAiProxyElement,
    openAiNoProxyElement,
    openAiTlsRejectUnauthorizedElement,
    openAiTlsCaFileElement,
    openAiTlsCertFileElement,
    openAiTlsKeyFileElement
  ]) {
    element.disabled = !openAiSettingsEnabled
  }
  for (const element of [
    openRouterRefererElement,
    openRouterTitleElement,
    openRouterAllowFallbacksElement,
    openRouterRequireParametersElement,
    openRouterDataCollectionElement,
    openRouterProviderOrderElement,
    openRouterProxyElement,
    openRouterNoProxyElement,
    openRouterTlsRejectUnauthorizedElement,
    openRouterTlsCaFileElement,
    openRouterTlsCertFileElement,
    openRouterTlsKeyFileElement
  ]) {
    element.disabled = controls.provider !== 'openrouter'
  }
  providerHelpElement.textContent = controls.provider === 'mlx-vlm'
    ? 'MLX VLM OpenAI-compatible endpoint.'
    : controls.provider === 'openai-compatible'
      ? 'OpenAI-compatible endpoint. Keep the /v1 suffix when required.'
      : controls.provider === 'openrouter'
        ? 'OpenRouter remote model catalog and OpenAI-compatible chat endpoint.'
      : controls.provider === 'opencode'
        ? 'OpenCode headless server. Ghost connects to it but never starts or stops it.'
        : 'Ollama endpoint.'
  updateProviderScopedElements()
  renderPermissionControls()
  logLevelElement.value = controls.logLevel
  showReasoningElement.checked = showReasoning
  persistenceElement.checked = controls.enableConversationPersistence
  persistenceStatusElement.textContent = controls.enableConversationPersistence ? 'Autosave on · history saved' : 'Autosave off · memory only'
  persistenceStatusElement.title = controls.enableConversationPersistence
    ? 'Drafts, prompt history, and conversations are saved in VS Code storage.'
    : 'Drafts, prompt history, and conversations remain in memory until this view closes.'
  persistenceStatusElement.classList.toggle('enabled', controls.enableConversationPersistence)
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
  renderFirstRunSetup()

  attachmentListElement.textContent = ''
  attachmentLimitElement.textContent = `${attachments.length}/${maxAttachments} attachments · max 1 MB text · 700 KB images`
  attachmentLimitElement.title = 'You can attach up to 8 files. Text files are limited to 1 MB and images to 700 KB.'
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

const workspaceFolderLabel = (filePath: string): string => {
  const root = contextData.folders.find(folder => filePath === folder || filePath.startsWith(`${folder}/`) || filePath.startsWith(`${folder}\\`))
  return root ? root.split(/[\\/]/).pop() ?? root : 'Outside workspace roots'
}

const renderContextPreview = () => {
  contextPreviewElement.textContent = ''
  const items: Array<{ key: keyof typeof contextEnabled; label: string; detail: string }> = [
    { key: 'workspace', label: 'Workspace', detail: `${contextData.workspaceName} · root: ${uiPreferences.workspaceRoot ? workspaceFolderLabel(uiPreferences.workspaceRoot) : 'all roots'}` },
    { key: 'folders', label: 'Folders', detail: contextData.folders.length > 0 ? contextData.folders.map(folder => folder.split(/[\\/]/).pop() ?? folder).join(', ') : '0 folders' },
    { key: 'activeFile', label: 'Active editor', detail: contextData.activeFile ? `${contextData.activeFile.name} · ${workspaceFolderLabel(contextData.activeFile.path)}` : 'No active file' },
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
    const labelText = document.createElement('strong')
    labelText.textContent = item.label
    const detailText = document.createElement('small')
    detailText.textContent = item.detail
    text.append(labelText, detailText)
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
  const bookmarksOnly = historyBookmarksOnlyElement.checked
  historyListElement.textContent = ''
  const entries = historyStore.filterConversations(state.conversations, query, bookmarksOnly)
  const matchingMessages = historyStore.matchingMessageCount(entries, query)
  historySearchSummaryElement.textContent = query || bookmarksOnly
    ? `${entries.length} conversation${entries.length === 1 ? '' : 's'} · ${matchingMessages} matching message${matchingMessages === 1 ? '' : 's'}`
    : ''
  if (entries.length === 0) {
    historyListElement.textContent = bookmarksOnly ? 'No bookmarked conversations.' : 'No matching conversations.'
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
    const bookmarkCount = conversation.messages.filter(message => message.bookmarked).length
    meta.textContent = `${conversation.messages.length} message${conversation.messages.length === 1 ? '' : 's'}${bookmarkCount ? ` · ${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'}` : ''}`
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
    const duplicate = document.createElement('button')
    duplicate.type = 'button'
    duplicate.className = 'conversation-action'
    duplicate.textContent = '⧉'
    duplicate.title = 'Duplicate conversation'
    duplicate.setAttribute('aria-label', `Duplicate ${conversation.title}`)
    duplicate.dataset.conversationAction = 'duplicate'
    duplicate.dataset.conversationId = conversation.id
    const branch = document.createElement('button')
    branch.type = 'button'
    branch.className = 'conversation-action'
    branch.textContent = '⑂'
    branch.title = 'Branch conversation'
    branch.setAttribute('aria-label', `Branch ${conversation.title}`)
    branch.dataset.conversationAction = 'branch'
    branch.dataset.conversationId = conversation.id
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'conversation-action'
    remove.textContent = '×'
    remove.title = 'Delete conversation'
    remove.setAttribute('aria-label', `Delete ${conversation.title}`)
    remove.dataset.conversationAction = 'delete'
    remove.dataset.conversationId = conversation.id
    actions.append(rename, duplicate, branch, remove)
    item.append(select, meta, actions)
    historyListElement.append(item)
    if (query) {
      for (const message of conversation.messages.filter(item => item.content.toLowerCase().includes(query)).slice(0, 8)) {
        const result = document.createElement('button')
        result.type = 'button'
        result.className = 'history-message-result'
        result.dataset.historyMessage = message.id
        result.dataset.historyConversation = conversation.id
        const role = message.role === 'user' ? 'You' : uiPreferences.assistantName || 'Ghost'
        result.textContent = `${role}: ${message.content.replace(/\s+/g, ' ').trim().slice(0, 180)}${message.content.length > 180 ? '…' : ''}`
        result.title = 'Open matching message'
        historyListElement.append(result)
      }
    }
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

const modalReturnFocus = new WeakMap<HTMLElement, HTMLElement>()

const setModalVisibility = (modal: HTMLElement, visible: boolean): void => {
  modalStore.setVisibility(modal, visible, modalReturnFocus)
}

const closeDeleteConversationConfirmation = (): void => {
  pendingDeleteConversationId = undefined
  setModalVisibility(deleteConversationModalElement, false)
  setModalVisibility(historyModalElement, true)
  renderHistory()
}

const deleteConversation = (conversationId: string): void => {
  const conversation = state.conversations.find(item => item.id === conversationId)
  if (!conversation) {
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
  renderHistory()
}

const validateEditedToolArguments = (toolCall: ToolCall, value: Record<string, unknown>): string | undefined => {
  const pathTools = new Set(['ghost_read_file', 'ghost_write_file', 'ghost_apply_edit', 'ghost_list_directory'])
  const requiredArgument = pathTools.has(toolCall.name)
    ? 'path'
    : toolCall.name === 'ghost_run_terminal_command'
      ? 'command'
      : undefined
  if (requiredArgument && (typeof value[requiredArgument] !== 'string' || !String(value[requiredArgument]).trim())) {
    return `${toolCall.name} needs a non-empty '${requiredArgument}'.`
  }
  if (toolCall.name === 'ghost_apply_transaction' && (!Array.isArray(value.edits) || value.edits.length < 2)) {
    return 'ghost_apply_transaction needs at least two edits.'
  }
  return undefined
}

const openToolArgumentsEditor = (found: { message: ChatMessage; toolCall: ToolCall }, requestId: string, conversationId: string): void => {
  editToolModalElement.dataset.toolCallId = found.toolCall.id
  editToolModalElement.dataset.requestId = requestId
  editToolModalElement.dataset.conversationId = conversationId
  editToolArgumentsElement.value = found.toolCall.arguments ?? '{}'
  editToolErrorElement.textContent = ''
  setModalVisibility(editToolModalElement, true)
  editToolArgumentsElement.focus()
}

editToolFormElement.addEventListener('submit', event => {
  event.preventDefault()
  const toolCallId = editToolModalElement.dataset.toolCallId
  const requestId = editToolModalElement.dataset.requestId
  const conversationId = editToolModalElement.dataset.conversationId
  if (!toolCallId || !requestId || !conversationId) {
    setModalVisibility(editToolModalElement, false)
    return
  }
  const found = findToolCall(toolCallId)
  if (!found) {
    editToolErrorElement.textContent = 'This tool request is no longer waiting for approval.'
    return
  }
  try {
    const parsed = JSON.parse(editToolArgumentsElement.value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Arguments must be a JSON object.')
    }
    const validationError = validateEditedToolArguments(found.toolCall, parsed as Record<string, unknown>)
    if (validationError) {
      throw new Error(validationError)
    }
    found.toolCall.arguments = JSON.stringify(parsed, null, 2)
    post('edit-tool', { requestId, conversationId, toolCallId, arguments: parsed })
    setModalVisibility(editToolModalElement, false)
    renderMessages(false)
  } catch (error) {
    editToolErrorElement.textContent = error instanceof Error ? error.message : 'Arguments must be valid JSON.'
  }
})

const buildRequestOptions = (): WebviewRequestOptions => {
  const common: WebviewRequestOptions = {
    provider: controls.provider,
    model: controls.chatModel,
    modelProfile: controls.provider === 'opencode' ? '' : controls.modelProfile,
    modelRole: controls.mode === 'agent' || controls.mode === 'plan' ? 'agent' : 'chat',
    maxContextTokens: controls.maxContextTokens,
    mode: controls.mode,
    customSystemInstructions: uiPreferences.customSystemInstructions,
    workspaceRoot: uiPreferences.workspaceRoot || undefined,
    context: uiPreferences.autoContext ? { ...contextEnabled } : {
      workspace: false,
      folders: false,
      activeFile: false,
      selection: false,
      openFiles: false,
      tools: contextEnabled.tools
    }
  }
  if (controls.provider === 'opencode') return common
  return {
    ...common,
    temperature: controls.temperature,
    topP: controls.topP,
    topK: controls.topK,
    minP: controls.minP,
    presencePenalty: controls.presencePenalty,
    repeatPenalty: controls.repeatPenalty,
    maxTokens: maxTokensForLength(controls.responseLength),
    showReasoning
  }
}

const addAttachment = (attachment: Attachment) => {
  if (attachments.length >= maxAttachments && !attachments.some(existing => existing.name === attachment.name && existing.path === attachment.path)) {
    setNotice('error', `You can attach up to ${maxAttachments} files.`)
    return
  }
  if (!attachments.some(existing => existing.name === attachment.name && existing.path === attachment.path)) {
    attachments = [...attachments, attachment]
    post('attach', { ...lifecycleEnvelope('attach'), attachments: [attachment] })
    renderControls()
  }
}

const readDroppedFile = async (file: File) => {
  const isImage = file.type.toLowerCase().startsWith('image/')
  const maximumSize = isImage ? maxImageAttachmentBytes : maxTextAttachmentBytes
  if (file.size > maximumSize) {
    setNotice('error', `${file.name} is larger than ${isImage ? '700 KB' : '1 MB'}.`)
    return
  }
  let content: string
  if (isImage) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    content = `data:${file.type};base64,${btoa(binary)}`
  } else {
    content = await file.text()
  }
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
    workspaceId: state.workspaceId,
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

const animatedStatusLabel = (value: string): string => {
  const characters = Array.from(value).map((character, index) => (
    `<span class="animated-status-character" style="--character-index:${index}">${character === ' ' ? '&nbsp;' : escapeHtml(character)}</span>`
  )).join('')
  return `<span class="animated-status-label" aria-hidden="true">${characters}</span><span class="screen-reader-only">${escapeHtml(value)}</span>`
}

let animatedStatusFrame: number | undefined
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

const clearAnimatedStatusHighlights = (): void => {
  document.querySelectorAll<HTMLElement>('.animated-status-character.highlighted').forEach(character => {
    character.classList.remove('highlighted')
  })
}

const updateAnimatedStatusLabels = (timestamp: number): void => {
  if (!accessibility.shouldAnimateStatus(reducedMotionQuery.matches)) {
    clearAnimatedStatusHighlights()
    animatedStatusFrame = undefined
    return
  }
  const labels = Array.from(document.querySelectorAll<HTMLElement>('.animated-status-label'))
  if (labels.length === 0) {
    animatedStatusFrame = undefined
    return
  }
  const stepMs = 120
  for (const label of labels) {
    const characters = Array.from(label.querySelectorAll<HTMLElement>('.animated-status-character'))
    const highlightWidth = Math.min(3, characters.length)
    const travelSteps = Math.max(1, characters.length - highlightWidth + 1)
    const cycleSteps = Math.max(1, travelSteps * 2 - 2)
    const phase = Math.floor(timestamp / stepMs) % cycleSteps
    const highlightedIndex = phase < travelSteps ? phase : cycleSteps - phase
    characters.forEach((character, index) => {
      character.classList.toggle('highlighted', index >= highlightedIndex && index < highlightedIndex + highlightWidth)
    })
  }
  animatedStatusFrame = requestAnimationFrame(updateAnimatedStatusLabels)
}

const ensureAnimatedStatusLabels = (): void => {
  if (!accessibility.shouldAnimateStatus(reducedMotionQuery.matches)) {
    clearAnimatedStatusHighlights()
    return
  }
  if (animatedStatusFrame === undefined) {
    animatedStatusFrame = requestAnimationFrame(updateAnimatedStatusLabels)
  }
}

const handleReducedMotionChange = (): void => {
  if (!accessibility.shouldAnimateStatus(reducedMotionQuery.matches)) {
    if (animatedStatusFrame !== undefined) {
      cancelAnimationFrame(animatedStatusFrame)
      animatedStatusFrame = undefined
    }
    clearAnimatedStatusHighlights()
  } else {
    ensureAnimatedStatusLabels()
  }
}

reducedMotionQuery.addEventListener('change', handleReducedMotionChange)

const createMarkupFragment = rendering.createSafeFragment

const replaceMarkup = (element: Element, markup: string): void => {
  element.replaceChildren(createMarkupFragment(markup))
}

const replaceElementMarkup = (element: Element, markup: string): void => {
  element.replaceWith(createMarkupFragment(markup))
}

const insertMarkupBefore = (target: Element, markup: string): void => {
  target.before(createMarkupFragment(markup))
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

const copyButton = (text: string, label: string, className = 'copy-button'): string => (
`<button type="button" class="${className}" data-copy-text="${escapeAttribute(encodeURIComponent(text))}" aria-label="${escapeAttribute(label)}">Copy</button>`
)

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

const renderMarkdown = (markdown: string, showThinkingPlaceholder = true): string => {
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
  return output.join('') || (showThinkingPlaceholder ? `<p class="message-placeholder">${animatedStatusLabel('Ghost is thinking…')}</p>` : '')
}

const renderMarkdownFragment = (markdown: string, showThinkingPlaceholder = true): DocumentFragment => (
  createMarkupFragment(renderMarkdown(markdown, showThinkingPlaceholder))
)

const findMessage = (conversation: Conversation, messageId: string): ChatMessage | undefined => (
  conversation.messages.find(message => message.id === messageId)
)

const messageText = (message: ChatMessage): string => (
  message.parts
    .filter((part): part is Extract<MessagePart, { kind: 'text' }> => part.kind === 'text')
    .map(part => part.text)
    .join('')
)

const buildConversationContext = (messages: ChatMessage[]): string => {
  const history = messages
    .map(message => {
      const text = messageText(message).trim()
      const toolResults = message.parts
        .filter((part): part is Extract<MessagePart, { kind: 'tool' }> => part.kind === 'tool')
        .map(part => {
          const result = part.toolCall.result?.trim()
          return result
            ? `Tool ${part.toolCall.name} result:\n${result}`
            : `Tool ${part.toolCall.name} status: ${part.toolCall.status}`
        })
      const content = [text, ...toolResults].filter(Boolean).join('\n\n')
      return content ? `${message.role === 'assistant' ? 'Ghost' : 'User'}:\n${content}` : ''
    })
    .filter(Boolean)
    .slice(-12)

  if (history.length === 0) {
    return ''
  }

  const context = `Previous conversation (use this to understand follow-up prompts):\n\n${history.join('\n\n')}`
  return redactSensitiveText(context).slice(-24000)
}

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
  const safeText = redactSensitiveText(text)
  try {
    await navigator.clipboard.writeText(safeText)
  } catch {
    const input = document.createElement('textarea')
    input.value = safeText
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

const syncMessageActions = (article: HTMLElement, message: ChatMessage): void => {
  const actions = article.querySelector<HTMLElement>('.message-actions')
  if (!actions) {
    return
  }
  actions.replaceChildren()
  addAction(actions, message.bookmarked ? 'Unbookmark' : 'Bookmark', 'toggle-bookmark', message.id)
  addAction(actions, 'Branch', 'branch-message', message.id)
  if (message.role === 'assistant') {
    const stopped = requestIsStopped(message)
    if (message.content) {
      addAction(actions, 'Copy', 'copy', message.id)
    }
    if (!stopped && message.content) {
      addAction(actions, 'Retry', 'retry', message.id)
      addAction(actions, 'Regenerate', 'regenerate', message.id)
    }
    if (message.content) {
      addAction(actions, 'Edit & resend', 'edit-resend', message.id)
    }
  }
  if (message.role === 'user') {
    addAction(actions, 'Edit', 'edit', message.id)
  }
}

const appendCopyControl = (container: HTMLElement, text: string, label: string): void => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'copy-button'
  button.textContent = 'Copy'
  button.setAttribute('aria-label', label)
  button.dataset.copyText = encodeURIComponent(text)
  button.dataset.messageCopyControl = 'true'
  container.append(button)
}

const addMessageCopyControls = (article: HTMLElement, message: ChatMessage): void => {
  article.querySelectorAll<HTMLElement>('[data-message-copy-control]').forEach(control => control.remove())

  const toolParts = message.parts.filter((part): part is Extract<MessagePart, { kind: 'tool' }> => part.kind === 'tool')
  for (const part of toolParts) {
    const progress = article.querySelector<HTMLElement>('[data-tool-call-id="' + CSS.escape(part.toolCall.id) + '"]')
    if (!progress) {
      continue
    }
    const args = parseToolArguments(part.toolCall)
    const command = part.toolCall.name === 'ghost_run_terminal_command' && typeof args.command === 'string'
      ? args.command.trim()
      : ''
    const path = typeof args.path === 'string'
      ? args.path.trim()
      : part.toolCall.diffPreview?.path ?? ''
    const target = command || path
    if (target) {
      appendCopyControl(progress, target, command ? 'Copy command' : 'Copy path')
    }
  }

  const errorParts = message.parts.filter((part): part is Extract<MessagePart, { kind: 'error' }> => part.kind === 'error')
  article.querySelectorAll<HTMLElement>('.error-progress').forEach((element, index) => {
    const error = errorParts[index]
    if (error) {
      appendCopyControl(element, error.message, 'Copy error')
    }
  })
  if (requestIsStopped(message)) {
    const reason = article.querySelector<HTMLElement>('.request-action-card-reason')
    const detail = reason?.textContent?.trim()
    if (reason && detail) {
      appendCopyControl(reason, detail, 'Copy error')
    }
  }
}

const stopReasonLabels: Record<StopReason, string> = {
  'failed-tool': 'Tool failed',
  'invalid-model-response': 'Invalid model response',
  cancelled: 'Request cancelled',
  timeout: 'Provider HTTP timeout',
  'approval-rejected': 'Approval rejected',
  'context-limit': 'Context limit reached',
  'budget-limit': 'Agent request time limit or budget reached',
  'provider-failure': 'Provider failed'
}

const stopReasonLabel = (reason: StopReason | undefined): string => (
  reason ? stopReasonLabels[reason] : 'Ghost request failed'
)

const stopReasonFallback = (reason: StopReason | undefined): string => {
  if (reason === 'failed-tool') return 'A workspace tool failed.'
  if (reason === 'invalid-model-response') return 'The model response could not be used.'
  if (reason === 'cancelled') return 'The request was cancelled.'
  if (reason === 'timeout') return 'The provider HTTP request timed out (ghost.providerRequestTimeoutMinutes).'
  if (reason === 'approval-rejected') return 'A requested tool approval was denied.'
  if (reason === 'context-limit') return 'The request reached the available context limit.'
  if (reason === 'budget-limit') return 'The agent request time limit or tool budget expired (ghost.requestTimeLimitMinutes).'
  if (reason === 'provider-failure') return 'The configured provider failed to complete the request.'
  return 'Ghost stopped without additional details.'
}

const stopReasonDetail = (message: ChatMessage): string => {
  const errorPart = [...message.parts].reverse().find((part): part is Extract<MessagePart, { kind: 'error' }> => part.kind === 'error')
  const detail = errorPart?.message?.trim()
  if (!detail) {
    return stopReasonFallback(message.stopReason)
  }
  const prefix = `${stopReasonLabel(message.stopReason)}:`
  const withoutPrefix = detail.startsWith(prefix) ? detail.slice(prefix.length).trim() : detail
  return withoutPrefix.slice(0, 800)
}

const stopReasonHint = (reason: StopReason | undefined): string => {
  if (reason === 'failed-tool') return 'Review the tool result and arguments, then retry.'
  if (reason === 'invalid-model-response') return 'Retry or regenerate to request a fresh model response.'
  if (reason === 'cancelled') return 'Continue to resume from the saved request state.'
  if (reason === 'timeout') return 'Retry with a smaller request or check the provider.'
  if (reason === 'approval-rejected') return 'Continue after reviewing the denied tool request.'
  if (reason === 'context-limit') return 'Retry with less context or a shorter request.'
  if (reason === 'budget-limit') return 'Continue with a fresh budget window or retry a smaller request.'
  if (reason === 'provider-failure') return 'Check the provider connection, then retry.'
  return 'Retry the request or continue from the saved state.'
}

const requestIsActive = (message: ChatMessage): boolean => (
  message.status === 'streaming' || ['preparing', 'connecting', 'thinking', 'streaming', 'waiting-for-approval'].includes(message.requestStatus ?? '')
)

const requestIsStopped = (message: ChatMessage): boolean => (
  message.status === 'error' || ['cancelled', 'failed'].includes(message.requestStatus ?? '') || Boolean(message.stopReason)
)

const messageDiffPath = (message: ChatMessage): string | undefined => {
  const diffPart = [...message.parts].reverse().find(part => part.kind === 'tool' && part.toolCall.diffPreview?.path)
  if (diffPart?.kind === 'tool' && diffPart.toolCall.diffPreview?.path) {
    return diffPart.toolCall.diffPreview.path
  }
  return message.requestSummary?.changedFiles[0]
}

const renderRequestActionCard = (message: ChatMessage): string => {
  const active = requestIsActive(message)
  const stopped = requestIsStopped(message)
  if (message.role !== 'assistant' || active || !stopped) {
    return ''
  }
  const diffPath = messageDiffPath(message)
  const title = `Ghost stopped: ${stopReasonLabel(message.stopReason)}`
  const detail = stopReasonDetail(message)
  const hint = stopReasonHint(message.stopReason)
  const actions = `<button type="button" class="request-card-button" data-action="retry" data-message-id="${escapeAttribute(message.id)}">Retry</button><button type="button" class="request-card-button" data-action="continue" data-message-id="${escapeAttribute(message.id)}">Continue</button><button type="button" class="request-card-button secondary" data-action="regenerate" data-message-id="${escapeAttribute(message.id)}">Regenerate</button>${diffPath ? `<button type="button" class="request-card-button secondary" data-action="open-diff" data-message-id="${escapeAttribute(message.id)}">Open Diff</button>` : ''}`
  return `<section class="request-action-card stopped" aria-label="Stopped request actions"><div class="request-action-card-heading"><strong>${escapeHtml(title)}</strong><span class="request-action-card-reason">${escapeHtml(detail)}</span><small>${escapeHtml(hint)}</small></div><div class="request-action-card-actions">${actions}</div></section>`
}

const createMessageElement = (message: ChatMessage, _deferMarkdown = false): HTMLElement => {
  const article = document.createElement('article')
  article.className = `message ${message.role}${message.status === 'error' ? ' error' : ''}`
  article.dataset.messageId = message.id
  const partSummary = renderMessagePartSummary(message)
  const responseStats = renderResponseStats(message)
  const messageState = message.requestStatus === 'waiting-for-approval'
    ? 'Waiting for approval...'
    : message.status === 'streaming'
      ? 'Thinking...'
      : message.stopReason
        ? stopReasonLabel(message.stopReason)
      : ''
  const showThinkingPlaceholder = message.role === 'assistant' && (
    message.status === 'streaming' ||
    ['preparing', 'connecting', 'thinking', 'streaming'].includes(message.requestStatus ?? '')
  ) && message.requestStatus !== 'waiting-for-approval'
  const thinkingStatus = showThinkingPlaceholder
    ? `<div class="message-thinking-status message-placeholder">${animatedStatusLabel('Ghost is thinking…')}</div>`
    : ''
  replaceMarkup(article, `
    <div class="message-header"><strong>${message.role === 'user' ? 'You' : `${escapeHtml(uiPreferences.assistantAvatar)} ${escapeHtml(uiPreferences.assistantName || 'Ghost')}`}</strong><span class="message-state">${messageState}</span></div>
    ${partSummary}
    ${thinkingStatus}
    ${responseStats}
    ${renderRequestSummary(message)}
    ${renderRequestActionCard(message)}
    <div class="message-actions" aria-label="Message actions"></div>
  `)
  const actions = article.querySelector<HTMLElement>('.message-actions')
  if (actions) syncMessageActions(article, message)
  addMessageCopyControls(article, message)
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

const parseToolArguments = (toolCall: ToolCall): Record<string, unknown> => {
  if (!toolCall.arguments) return {}
  try {
    const value = JSON.parse(toolCall.arguments) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

const summaryChangedFiles = (message: ChatMessage): string[] => {
  const files = new Set<string>()
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.trim()) files.add(value.trim())
  }
  for (const part of message.parts) {
    if (part.kind !== 'tool' || part.toolCall.status !== 'completed' || !['ghost_write_file', 'ghost_apply_edit', 'ghost_apply_transaction'].includes(part.toolCall.name)) continue
    if (/no changes needed/i.test(part.toolCall.result ?? '')) continue
    const args = parseToolArguments(part.toolCall)
    add(args.path)
    if (Array.isArray(args.edits)) {
      for (const edit of args.edits) {
        if (edit && typeof edit === 'object' && !Array.isArray(edit)) add((edit as Record<string, unknown>).path)
      }
    }
    add(part.toolCall.diffPreview?.path)
  }
  return [...files].sort()
}

const summaryCommandCount = (message: ChatMessage): number => (
  message.parts.filter(part => part.kind === 'tool' && part.toolCall.name === 'ghost_run_terminal_command').length
)

const renderCopyablePathList = (paths: string[]): string => {
  if (paths.length === 0) {
    return '<span>None</span>'
  }
  const visiblePaths = paths.slice(0, 12)
  const items = visiblePaths.map(file => '<li><span>' + escapeHtml(file) + '</span>' + copyButton(file, 'Copy path') + '</li>').join('')
  const remaining = paths.length > visiblePaths.length ? '<li>+' + (paths.length - visiblePaths.length) + ' more</li>' : ''
  return '<ul>' + items + remaining + '</ul>'
}

const renderRequestSummary = (message: ChatMessage): string => {
  if (message.role !== 'assistant' || !message.requestSummary) return ''
  const summary = message.requestSummary
  const files = renderCopyablePathList(summary.changedFiles)
  const record = message.completionRecord
  const renderOutcomeList = (label: string, values: string[]): string => `<div class="request-summary-outcome"><span>${escapeHtml(label)}</span>${values.length > 0 ? `<ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>` : '<b>None reported</b>'}</div>`
  const outcome = record
    ? `${renderOutcomeList('Checks run', record.checksRun)}${renderOutcomeList('Failures', record.failures)}${renderOutcomeList('Remaining work', record.remainingWork)}`
    : ''
  return `<section class="request-summary" aria-label="Request outcome"><strong>${escapeHtml(summary.status)}</strong><div class="request-summary-grid"><div><span>Elapsed</span><b>${formatElapsed(summary.elapsedMs)}</b></div><div><span>Model</span><b>${summary.model ? escapeHtml(summary.model) : 'Unknown'}</b></div><div><span>Provider</span><b>${summary.provider ? escapeHtml(summary.provider) : 'Unknown'}</b></div><div><span>Tokens</span><b>${summary.tokenCount}</b></div><div><span>Commands</span><b>${summary.commandCount}</b></div></div><div class="request-summary-files"><span>Changed files</span>${files}</div>${outcome}</section>`
}

const renderRequestEventLog = (message: ChatMessage): string => {
  const events = message.eventLog?.slice(-100) ?? []
  if (events.length === 0) {
    return ''
  }
  const rows = events.map(event => {
    const timestamp = Number.isFinite(event.timestamp) ? new Date(event.timestamp).toLocaleTimeString() : '--:--:--'
    const detail = event.detail ? ` · ${escapeHtml(event.detail)}` : ''
    return `<div class="message-progress"><strong>${escapeHtml(event.status)}</strong> · ${escapeHtml(event.type)} · ${timestamp} · ${(Math.max(0, event.elapsedMs) / 1000).toFixed(1)}s${detail}</div>`
  }).join('')
  return `<details class="progress-details"><summary>Request log (${events.length})</summary>${rows}</details>`
}

const readScopeText = (args: Record<string, unknown>, result?: string): string => {
  const resultLines = result?.match(/Read mode:\s*[^,\n]+,\s*lines\s+(\d+)-(\d+)\s+of\s+(\d+)/i)
  if (resultLines) {
    return `lines ${resultLines[1]}-${resultLines[2]} of ${resultLines[3]}`
  }
  const resultBytes = result?.match(/Read mode:\s*bytes\s+(\d+)-(\d+)\s+of\s+(\d+)/i)
  if (resultBytes) {
    return `bytes ${resultBytes[1]}-${resultBytes[2]} of ${resultBytes[3]}`
  }

  const mode = typeof args.mode === 'string' ? args.mode : ''
  if (mode === 'bytes' || typeof args.startByte === 'number' || typeof args.endByte === 'number') {
    const start = typeof args.startByte === 'number' ? args.startByte : 0
    const end = typeof args.endByte === 'number' ? args.endByte : undefined
    return end === undefined ? `bytes from ${start}` : `bytes ${start}-${end}`
  }
  if (mode === 'tail') {
    return `last ${typeof args.lineCount === 'number' ? args.lineCount : 400} lines`
  }
  if (mode === 'symbol' && typeof args.symbol === 'string' && args.symbol.trim()) {
    return `symbol ${args.symbol.trim()}`
  }
  if (mode === 'matches' && typeof args.match === 'string' && args.match.trim()) {
    return `matching lines for ${args.match.trim()}`
  }
  if (mode === 'lines' || typeof args.startLine === 'number' || typeof args.endLine === 'number') {
    const start = typeof args.startLine === 'number' ? args.startLine : 1
    const end = typeof args.endLine === 'number' ? args.endLine : undefined
    return end === undefined ? `lines from ${start}` : `lines ${start}-${end}`
  }
  return ''
}

const toolInlineResult = (toolCall: ToolCall): string => {
  const result = toolCall.result?.trim()
  if (!result) return ''

  if (toolCall.name === 'ghost_read_file') {
    if (toolCall.status === 'failed' || toolCall.status === 'rejected') {
      return result.replace(/\s+/g, ' ').slice(0, 240)
    }
    return ''
  }

  return result.replace(/\s+/g, ' ').slice(0, 240)
}

const toolActionText = (toolCall: ToolCall): string => {
  const compactAction = toolTimeline.compactAction(toolCall.name)
  const args = parseToolArguments(toolCall)
  const command = typeof args.command === 'string' ? args.command.trim() : ''
  if (!uiPreferences.showToolProgress) {
    if (toolCall.name === 'ghost_run_terminal_command' && command) {
      const displayedCommand = redactSensitiveText(command).length > 180
        ? `${redactSensitiveText(command).slice(0, 177)}…`
        : redactSensitiveText(command)
      const action = `${compactAction}: ${displayedCommand}`
      return toolCall.status === 'running' ? `${action}…` : action
    }
    return toolCall.status === 'running' ? `${compactAction}…` : compactAction
  }

  const path = typeof args.path === 'string' ? args.path.trim() : ''
  const genericTarget = typeof args.target === 'string' ? args.target.trim() : ''
  const target = path || command || genericTarget
  const displayedTarget = target.length > 180 ? `${target.slice(0, 177)}…` : target
  const readScope = toolCall.name === 'ghost_read_file' ? readScopeText(args, toolCall.result) : ''
  const readScopeSuffix = readScope ? ` · ${readScope}` : ''
  const action = typeof args.action === 'string' ? args.action.trim() : ''
  const base = toolCall.name === 'opencode_question'
    ? 'OpenCode is asking a question'
    : toolCall.name === 'opencode_permission'
    ? `OpenCode wants to ${action || 'continue'}${displayedTarget ? `: ${displayedTarget}` : ''}`
    : toolCall.name === 'ghost_read_file'
    ? `I'm reading file${displayedTarget ? ` ${displayedTarget}` : ''}${readScopeSuffix}`
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

const toolDurationMs = (toolCall: ToolCall): number | undefined => {
  const end = toolCall.completedAt ?? (toolCall.status === 'running' ? Date.now() : undefined)
  return end === undefined ? undefined : Math.max(0, end - toolCall.startedAt)
}

const toolDurationText = (toolCall: ToolCall): string => {
  const duration = toolDurationMs(toolCall)
  return duration === undefined ? '' : ` · ${(duration / 1000).toFixed(1)}s`
}

const lineCount = (text: string): number => (text ? text.split(/\r?\n/).length : 0)

const diffStatsText = (diffPreview: NonNullable<ToolCall['diffPreview']>): string => {
  const hunks = diffPreview.hunks ?? []
  if (hunks.length > 0) {
    const removed = hunks.reduce((total, hunk) => total + Math.max(1, hunk.endLine - hunk.startLine + 1), 0)
    const added = hunks.reduce((total, hunk) => total + lineCount(hunk.replacement), 0)
    return `${hunks.length} hunk${hunks.length === 1 ? '' : 's'} · +${added} / -${removed} lines`
  }
  return `${lineCount(diffPreview.before)} → ${lineCount(diffPreview.after)} lines`
}

const diffFileNames = (diffPreview: NonNullable<ToolCall['diffPreview']>): string[] => (
  [...new Set((diffPreview.files?.length ? diffPreview.files : [diffPreview.path]).filter(Boolean))]
)

const renderTaskPlan = (plan: TaskPlan, messageId: string): string => {
  const steps = plan.steps.map(step => `<li${step.id === plan.currentStep ? ' class="current"' : ''}${step.evidence ? ` title="${escapeAttribute(step.evidence)}"` : ''}><span class="task-plan-step-icon ${step.checked ? 'complete' : 'pending'}" aria-hidden="true">${step.checked ? '✓' : '○'}</span> ${escapeHtml(step.title)}</li>`).join('')
  const blocked = plan.blockedReason ? `<div>Blocked: ${escapeHtml(plan.blockedReason)}</div>` : ''
  const evidence = plan.completionEvidence.length > 0 ? `<div>Evidence: ${plan.completionEvidence.map(escapeHtml).join(' · ')}</div>` : ''
  const implement = !activeRequest && plan.steps.some(step => !step.checked)
    ? `<button type="button" class="task-plan-action" data-action="implement-plan" data-message-id="${escapeAttribute(messageId)}">Implement plan</button>`
    : ''
  return `<section class="task-plan"><strong>Task plan</strong><ol>${steps}</ol>${blocked}${evidence}${implement}</section>`
}

const renderMessagePartSummary = (message: ChatMessage): string => {
  const parts = message.parts
  const renderToolCallProgress = (part: Extract<MessagePart, { kind: 'tool' }>): string => {
    const actionText = toolActionText(part.toolCall)
    const requestActive = ['preparing', 'connecting', 'thinking', 'streaming', 'waiting-for-approval'].includes(message.requestStatus ?? '')
    const animatedAction = requestActive && (part.toolCall.status === 'running' || part.toolCall.status === 'requested')
    const inlineResult = toolInlineResult(part.toolCall)
    const result = inlineResult ? `: ${inlineResult}` : ''
    const duration = toolDurationText(part.toolCall)
    const argumentsBlock = uiPreferences.showToolProgress && part.toolCall.arguments
      ? `<details class="tool-details"><summary>Arguments</summary><pre>${escapeHtml(part.toolCall.arguments)}</pre></details>`
      : ''
    const diff = part.toolCall.diffPreview
    const files = diff ? diffFileNames(diff) : []
    const diffStats = diff ? diffStatsText(diff) : ''
    const diffFiles = files.length > 1
      ? `<ul class="tool-diff-files" aria-label="Files in this change">${files.map(file => `<li>${escapeHtml(file)}</li>`).join('')}</ul>`
      : ''
    const hunkNavigation = diff?.hunks?.length
      ? `<div class="tool-hunk-toolbar" role="toolbar" aria-label="Hunk navigation"><span>${diff.hunks.length} hunk${diff.hunks.length === 1 ? '' : 's'}</span><button type="button" class="secondary" data-tool-action="previous-hunk" data-tool-call-id="${escapeAttribute(part.toolCall.id)}" aria-label="Focus previous hunk">Previous</button><button type="button" class="secondary" data-tool-action="next-hunk" data-tool-call-id="${escapeAttribute(part.toolCall.id)}" aria-label="Focus next hunk">Next</button></div>`
      : ''
    const diffBlock = part.toolCall.diffPreview
      ? `<details class="tool-details tool-diff-details"><summary>${part.toolCall.diffPreview.previewKind === 'text' ? 'Text preview only' : 'Diff preview'} · ${escapeHtml(files[0] ?? part.toolCall.diffPreview.path)} · ${escapeHtml(diffStats)}${part.toolCall.diffPreview.truncated ? ' · truncated' : ''}${part.toolCall.diffPreview.previewKind === 'text' ? ' · files are not staged in the editor' : ''}</summary>${diffFiles}${hunkNavigation}${part.toolCall.diffPreview.hunks?.length ? `<div class="tool-hunk-list" role="list" aria-label="Changed hunks">${part.toolCall.diffPreview.hunks.map((hunk, index) => `<div class="tool-hunk" data-tool-hunk-card data-tool-hunk-index="${index}" role="listitem" tabindex="-1"><span>Hunk ${index + 1} · Lines ${hunk.startLine}-${hunk.endLine}</span><button type="button" class="secondary" data-tool-action="open-hunk" data-tool-line="${hunk.startLine}" data-tool-call-id="${escapeAttribute(part.toolCall.id)}" aria-label="Open hunk ${index + 1} at line ${hunk.startLine}">Open line</button></div>`).join('')}</div>` : ''}<pre>--- before\n+++ after\n${escapeHtml(part.toolCall.diffPreview.before)}\n--- proposed replacement ---\n${escapeHtml(part.toolCall.diffPreview.after)}</pre></details>`
      : ''
    const questionBlock = part.toolCall.question && part.toolCall.status === 'requested'
      ? `<div class="opencode-question-list">${part.toolCall.question.questions.map((question, questionIndex) => {
          const inputType = question.multiple ? 'checkbox' : 'radio'
          const options = question.options.map(option => `<label class="opencode-question-option"><input type="${inputType}" name="opencode-question-${escapeAttribute(part.toolCall.id)}-${questionIndex}" data-question-option data-question-index="${questionIndex}" value="${escapeAttribute(option.label)}"><span><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ''}</span></label>`).join('')
          const custom = question.custom ? `<label class="opencode-question-custom"><span>Other answer</span><input type="text" data-question-custom data-question-index="${questionIndex}" maxlength="2000" placeholder="Type your answer"></label>` : ''
          return `<fieldset><legend>${escapeHtml(question.header)}</legend><p>${escapeHtml(question.question)}</p>${options}${custom}</fieldset>`
        }).join('')}</div>`
      : ''
    const resultBlock = uiPreferences.showToolProgress && part.toolCall.result
      ? `<details class="tool-details"><summary>Result</summary><pre>${escapeHtml(part.toolCall.result)}</pre></details>`
      : ''
    const approvalControls = part.toolCall.requiresApproval && part.toolCall.status === 'requested'
      ? part.toolCall.approvalKind === 'provider-permission'
        ? `<div class="tool-approval-actions" aria-label="Approval options"><button type="button" data-tool-action="approve" data-tool-call-id="${escapeAttribute(part.toolCall.id)}" aria-label="Approve this permission once">Approve now</button><button type="button" data-tool-action="approve-session" data-tool-call-id="${escapeAttribute(part.toolCall.id)}" aria-label="Approve this permission for the session">Approve for session</button><button type="button" class="secondary" data-tool-action="reject" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Reject</button><button type="button" class="secondary" data-tool-action="cancel" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Cancel request</button></div>`
        : part.toolCall.approvalKind === 'provider-question'
          ? `<div class="tool-approval-actions" aria-label="Question options"><button type="button" data-tool-action="answer-question" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Send answer</button><button type="button" class="secondary" data-tool-action="reject" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Reject question</button><button type="button" class="secondary" data-tool-action="cancel" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Cancel request</button></div>`
        : `<div class="tool-approval-actions" aria-label="Approval options"><button type="button" data-tool-action="approve" data-tool-call-id="${escapeAttribute(part.toolCall.id)}" aria-label="Approve this tool call once">Approve now</button><button type="button" data-tool-action="approve-session" data-tool-call-id="${escapeAttribute(part.toolCall.id)}" aria-label="Approve this tool for the session">Approve for session</button><button type="button" data-tool-action="approve-forever" data-tool-call-id="${escapeAttribute(part.toolCall.id)}" aria-label="Always approve this tool">Approve forever</button><button type="button" data-tool-action="edit" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Edit arguments…</button><button type="button" class="secondary" data-tool-action="reject" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Reject</button><button type="button" class="secondary" data-tool-action="cancel" data-tool-call-id="${escapeAttribute(part.toolCall.id)}">Cancel request</button></div>`
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
    const resultActions = fileAction || restoreAction || retryToolAction || rerunRequestAction
      ? `<div class="tool-result-actions">${fileAction}${restoreAction}${retryToolAction}${rerunRequestAction}</div>`
      : ''
    const verboseStatus = uiPreferences.showToolProgress ? ` · ${escapeHtml(part.toolCall.status)}${escapeHtml(duration)}${escapeHtml(result)}` : escapeHtml(duration)
    const compactFailure = !uiPreferences.showToolProgress && part.toolCall.result && (part.toolCall.status === 'failed' || part.toolCall.status === 'rejected')
      ? ` — ${escapeHtml(part.toolCall.result.replace(/^Tool error:\s*/i, '').replace(/\s+/g, ' ').slice(0, 240))}`
      : ''
    const toolStatus = accessibility.toolStatusPresentation(part.toolCall.status)
    const toolStatusClass = toolStatus.className
    const toolStatusIcon = toolStatus.icon
    const approvalCardClass = part.toolCall.requiresApproval && part.toolCall.status === 'requested' ? ' tool-approval-card' : ''
    return `<div class="message-progress tool-progress ${toolStatusClass}${approvalCardClass}" data-tool-call-id="${escapeAttribute(part.toolCall.id)}"><span class="tool-status-icon" aria-hidden="true">${toolStatusIcon}</span><strong>${animatedAction ? animatedStatusLabel(actionText) : escapeHtml(actionText)}${compactFailure}</strong>${verboseStatus}${argumentsBlock}${questionBlock}${diffBlock}${resultBlock}${approvalControls}${resultActions}</div>`
  }
  const renderedParts: string[] = []
  let progressParts: Array<Extract<MessagePart, { kind: 'progress' | 'reasoning' }>> = []
  const flushProgress = (): void => {
    if (uiPreferences.showThinkingDetails && progressParts.length > 0) {
      renderedParts.push(`<details class="progress-details"${message.status === 'streaming' ? ' open' : ''}><summary>Progress (${progressParts.length})</summary>${progressParts.map(part => `<div class="message-progress">${escapeHtml(part.text)}</div>`).join('')}</details>`)
    }
    progressParts = []
  }
  for (const part of parts) {
    if (part.kind === 'progress' || part.kind === 'reasoning') {
      progressParts.push(part)
      continue
    }
    flushProgress()
    if (part.kind === 'text') {
      renderedParts.push(`<div class="message-body message-timeline-text">${renderMarkdown(part.text, false)}</div>`)
    } else if (part.kind === 'tool') {
      renderedParts.push(renderToolCallProgress(part))
    } else if (part.kind === 'task-plan') {
      renderedParts.push(renderTaskPlan(part.plan, message.id))
    } else if (part.kind === 'warning') {
      renderedParts.push(`<div class="message-progress warning-progress">Warning: ${escapeHtml(part.message)}</div>`)
    } else if (part.kind === 'error') {
      renderedParts.push(`<div class="message-progress error-progress">${escapeHtml(part.message)}</div>`)
    }
  }
  flushProgress()
  if (!parts.some(part => part.kind === 'text') && message.content) {
    renderedParts.push(`<div class="message-body message-timeline-text">${renderMarkdown(message.content, false)}</div>`)
  }
  const eventLog = renderRequestEventLog(message)
  return `<div class="message-part-summary message-timeline">${renderedParts.join('')}${eventLog}</div>`
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

interface MessagePaneScrollState {
  top: number
  atBottom: boolean
}

const captureMessagePaneScroll = (): MessagePaneScrollState => ({
  top: messagesElement.scrollTop,
  atBottom: messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight < 40
})

const restoreMessagePaneScroll = (scrollState: MessagePaneScrollState): void => {
  const maximum = Math.max(0, messagesElement.scrollHeight - messagesElement.clientHeight)
  const top = scrollState.atBottom ? maximum : Math.min(scrollState.top, maximum)
  messagesElement.scrollTo({ top, behavior: 'auto' })
  userIsAtBottom = scrollState.atBottom || maximum - top < 40
}

const updateMessageElement = (message: ChatMessage, existingElement?: HTMLElement, scrollOverride?: MessagePaneScrollState) => {
  const element = existingElement ?? findMessageElement(message.id)
  if (!element) {
    renderMessages(false)
    return
  }
  const scrollState = scrollOverride ?? captureMessagePaneScroll()
  const status = element.querySelector<HTMLElement>('.message-state')
  const showThinkingPlaceholder = message.role === 'assistant' && (
    message.status === 'streaming' ||
    ['preparing', 'connecting', 'thinking', 'streaming'].includes(message.requestStatus ?? '')
  ) && message.requestStatus !== 'waiting-for-approval'
  if (status) {
    status.textContent = message.requestStatus === 'waiting-for-approval'
      ? 'Waiting for approval...'
      : message.status === 'streaming'
        ? 'Thinking...'
        : ''
  }
  const existingSummary = element.querySelector<HTMLElement>('.message-part-summary')
  const summary = renderMessagePartSummary(message)
  if (existingSummary) {
    replaceElementMarkup(existingSummary, summary)
  } else if (summary) {
    const header = element.querySelector<HTMLElement>('.message-header')
    header?.after(createMarkupFragment(summary))
  }
  const thinkingStatus = showThinkingPlaceholder
    ? `<div class="message-thinking-status message-placeholder">${animatedStatusLabel('Ghost is thinking…')}</div>`
    : ''
  const existingThinkingStatus = element.querySelector<HTMLElement>('.message-thinking-status')
  if (existingThinkingStatus) {
    if (thinkingStatus) {
      const replacement = createMarkupFragment(thinkingStatus)
      const replacementStatus = replacement.firstElementChild
      existingThinkingStatus.replaceWith(replacement)
      const summaryAnchor = element.querySelector<HTMLElement>('.message-part-summary')
      if (summaryAnchor && replacementStatus) {
        summaryAnchor.after(replacementStatus)
      }
    } else {
      existingThinkingStatus.remove()
    }
  } else if (thinkingStatus) {
    const summaryAnchor = element.querySelector<HTMLElement>('.message-part-summary')
    summaryAnchor?.after(createMarkupFragment(thinkingStatus))
  }
  const existingStats = element.querySelector<HTMLElement>('.message-response-stats')
  const stats = renderResponseStats(message)
  if (existingStats) {
    replaceElementMarkup(existingStats, stats || '<div class="message-response-stats" hidden></div>')
  } else if (stats) {
    const actions = element.querySelector<HTMLElement>('.message-actions')
    if (actions) insertMarkupBefore(actions, stats)
  }
  const existingRequestSummary = element.querySelector<HTMLElement>('.request-summary')
  const requestSummary = renderRequestSummary(message)
  if (existingRequestSummary) {
    replaceElementMarkup(existingRequestSummary, requestSummary || '<section class="request-summary" hidden></section>')
  } else if (requestSummary) {
    const actions = element.querySelector<HTMLElement>('.message-actions')
    if (actions) insertMarkupBefore(actions, requestSummary)
  }
  const existingRequestActionCard = element.querySelector<HTMLElement>('.request-action-card')
  const requestActionCard = renderRequestActionCard(message)
  if (existingRequestActionCard) {
    replaceElementMarkup(existingRequestActionCard, requestActionCard || '<section class="request-action-card" hidden></section>')
  } else if (requestActionCard) {
    const actions = element.querySelector<HTMLElement>('.message-actions')
    if (actions) insertMarkupBefore(actions, requestActionCard)
  }
  element.classList.toggle('error', message.status === 'error')
  syncMessageActions(element, message)
  addMessageCopyControls(element, message)
  messagesElement.scrollTo({
    top: scrollState.atBottom ? Math.max(0, messagesElement.scrollHeight - messagesElement.clientHeight) : scrollState.top,
    behavior: 'auto'
  })
  userIsAtBottom = scrollState.atBottom || messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight < 40
  ensureAnimatedStatusLabels()
}

const lazyMessageObserver = typeof IntersectionObserver === 'undefined'
  ? undefined
  : new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue
      }
      const element = entry.target as HTMLElement
      const body = element.querySelector<HTMLElement>('.message-body')
      const messageId = element.dataset.messageId
      const message = messageId ? findMessage(getActiveConversation(), messageId) : undefined
      if (!body || !message || body.dataset.deferredMarkdown !== 'true') {
        lazyMessageObserver?.unobserve(element)
        continue
      }
      delete body.dataset.deferredMarkdown
      const showThinkingPlaceholder = message.role === 'assistant' && (
        message.status === 'streaming' ||
        ['preparing', 'connecting', 'thinking', 'streaming'].includes(message.requestStatus ?? '')
      ) && message.requestStatus !== 'waiting-for-approval'
      if (message.content.trim() || !body.textContent?.trim()) {
        body.replaceChildren(renderMarkdownFragment(message.content, false))
      }
      lazyMessageObserver?.unobserve(element)
    }
  }, { root: messagesElement, rootMargin: '600px 0px' })

const observeDeferredMessages = (): void => {
  lazyMessageObserver?.disconnect()
  if (!lazyMessageObserver) {
    return
  }
  for (const element of Array.from(messagesElement.querySelectorAll<HTMLElement>('[data-deferred-markdown="true"]'))) {
    lazyMessageObserver.observe(element)
  }
}

const scrollMessages = (force: boolean) => {
  if (force) {
    messagesElement.scrollTo({
      top: messagesElement.scrollHeight,
      behavior: 'auto'
    })
    userIsAtBottom = true
    return
  }
  requestAnimationFrame(() => {
    if (userIsAtBottom) {
      messagesElement.scrollTo({
        top: messagesElement.scrollHeight,
        behavior: 'smooth'
      })
      userIsAtBottom = true
    }
  })
}

const layoutComposer = () => {
  promptElement.rows = promptRows
  promptElement.style.height = ''
  promptElement.style.maxHeight = `${composerHeight}px`
  promptElement.style.overflowY = 'auto'
}

const updateComposer = () => {
  const length = promptElement.value.length
  composerCountElement.textContent = `${length} chars · ~${composerStore.tokenEstimate(promptElement.value)} tokens`
  composerCountElement.title = composerCountElement.textContent
  const busy = composerStore.isBusy(activeRequest?.status)
  sendElement.hidden = busy
  sendElement.disabled = busy || promptElement.value.trim().length === 0
  const entries = promptHistory()
  searchPromptHistoryElement.disabled = busy
  previousPromptElement.disabled = busy || entries.length === 0 || historyIndex >= entries.length - 1
  nextPromptElement.disabled = busy || historyIndex < 0
  stopElement.hidden = !busy
  promptElement.disabled = busy
  composerElement.classList.toggle('busy', busy)
  statusFooterElement.classList.toggle('busy', busy)
  statusFooterElement.classList.toggle('offline', viewStatus === 'offline')
}

const reconcileMessagePane = (fragment: DocumentFragment): void => {
  const desiredNodes = Array.from(fragment.childNodes)
  desiredNodes.forEach((node, index) => {
    const current = messagesElement.childNodes[index]
    if (current !== node) {
      messagesElement.insertBefore(node, current ?? null)
    }
  })
  while (messagesElement.childNodes.length > desiredNodes.length) {
    messagesElement.lastChild?.remove()
  }
}

const renderMessages = (forceScroll: boolean, preserveScroll = false) => {
  const conversation = getActiveConversation()
  const scrollState = captureMessagePaneScroll()
  const existingMessages = new Map(
    Array.from(messagesElement.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element.matches('article.message[data-message-id]'))
      .map(element => [element.dataset.messageId, element] as const)
      .filter((entry): entry is readonly [string, HTMLElement] => Boolean(entry[0]))
  )
  const fragment = document.createDocumentFragment()
  if (conversation.messages.length === 0) {
    fragment.append(createMarkupFragment(stateCard()))
  } else {
    const firstVisibleIndex = Math.max(0, conversation.messages.length - visibleMessageCount)
    if (firstVisibleIndex > 0) {
      const older = document.createElement('button')
      older.type = 'button'
      older.className = 'context-button load-older'
      older.textContent = `Load ${Math.min(200, firstVisibleIndex)} older messages`
      older.dataset.loadOlder = 'true'
      fragment.append(older)
    }
    for (const [offset, message] of conversation.messages.slice(firstVisibleIndex).entries()) {
      const existing = existingMessages.get(message.id)
      if (existing) {
        updateMessageElement(message, existing, scrollState)
        fragment.append(existing)
      } else {
        const messageIndex = firstVisibleIndex + offset
        fragment.append(createMessageElement(message, messageIndex < conversation.messages.length - HOT_MESSAGE_COUNT))
      }
    }
  }
  reconcileMessagePane(fragment)
  observeDeferredMessages()
  if (preserveScroll) {
    restoreMessagePaneScroll(scrollState)
    ensureAnimatedStatusLabels()
    return
  }
  if (!forceScroll && !scrollState.atBottom) {
    requestAnimationFrame(() => {
      messagesElement.scrollTop = scrollState.top
      userIsAtBottom = messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight < 40
    })
  } else if (!forceScroll) {
    requestAnimationFrame(() => {
      messagesElement.scrollTo({
        top: messagesElement.scrollHeight,
        behavior: 'smooth'
      })
      userIsAtBottom = true
    })
  } else {
    scrollMessages(true)
  }
  ensureAnimatedStatusLabels()
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
    const label = statusLabels[activeRequest.status]
    const suffix = ` · ${activeRequest.model} · ${elapsed}${telemetry}${diagnostics}`
    statusTextElement.textContent = `${label}${suffix}`
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

const render = (forceScroll = false, preserveScroll = false) => {
  renderControls()
  renderMessages(forceScroll, preserveScroll)
  updateStatus()
  saveState()
}

const renderInterface = () => {
  renderControls()
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
    workspaceId: state.workspaceId,
    conversations: [conversation, ...state.conversations],
    activeConversationId: conversation.id
  }
  notice = undefined
  render(true)
  restoreDraft()
  promptElement.focus()
}

const applySlashCommand = (prompt: string): string | undefined => {
  const command = /^\/(clear|model|plan|explain|fix|test|review|refactor|summarize)\b\s*(.*)$/i.exec(prompt)
  if (!command) {
    return prompt
  }
  const name = command[1].toLowerCase()
  const rest = command[2].trim()
  let resolvedPrompt = rest || prompt
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
  if (name === 'plan') {
    controls.mode = 'plan'
  } else if (name === 'explain') {
    controls.mode = 'explain'
  } else if (name === 'fix') {
    controls.mode = 'edit'
  } else if (name === 'test') {
    controls.mode = 'agent'
    resolvedPrompt = rest ? `Run tests for ${rest} and report the results.` : 'Run the relevant tests for the current workspace and report the results.'
  } else if (name === 'review') {
    controls.mode = 'explain'
    resolvedPrompt = rest ? `Review ${rest} for correctness, risks, and missing tests.` : 'Review the current workspace for correctness, risks, and missing tests.'
  } else if (name === 'refactor') {
    controls.mode = 'edit'
    resolvedPrompt = rest ? `Refactor ${rest}, preserve behavior, and explain the changes.` : 'Refactor the current workspace, preserve behavior, and explain the changes.'
  } else if (name === 'summarize') {
    resolvedPrompt = rest ? `Summarize this for me:\n\n${rest}` : 'Summarize the current context for me.'
  }
  renderControls()
  sendSettingsUpdate()
  return resolvedPrompt
}

const submitPrompt = (rawPrompt: string, options: { setupTest?: boolean } = {}) => {
  const prompt = applySlashCommand(rawPrompt.trim())?.trim().slice(0, 20000) ?? ''
  if (!prompt || activeRequest) {
    return
  }

  const conversation = getActiveConversation()
  const previousConversationContext = options.setupTest ? '' : buildConversationContext(conversation.messages)
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
    tokenCount: 0,
    ...(options.setupTest ? { setupTest: true } : {})
  }
  requests.set(requestId, activeRequest)
  startProgressTimer()
  notice = undefined
  conversation.promptHistory = addPromptToHistory(conversation.promptHistory, prompt, uiPreferences.promptHistoryLimit)
  state.promptHistory = conversation.promptHistory
  promptElement.value = ''
  const submittedAttachments = attachments
  attachments = []
  render(true)
  const requestOptions = buildRequestOptions()
  if (options.setupTest) {
    requestOptions.modelRole = 'chat'
    requestOptions.mode = 'ask'
    requestOptions.context = {
      workspace: false,
      folders: false,
      activeFile: false,
      selection: false,
      openFiles: false,
      tools: false
    }
  }
  if (previousConversationContext) {
    requestOptions.additionalContext = previousConversationContext
  }
  post('submit', {
    requestId,
    conversationId: conversation.id,
    prompt,
    options: requestOptions,
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

const getContinuationResume = (message: ChatMessage): ContinuationResume | undefined => {
  const conversation = getActiveConversation()
  const messageIndex = conversation.messages.findIndex(item => item.id === message.id)
  const previousUser = messageIndex > 0 ? conversation.messages.slice(0, messageIndex).reverse().find(item => item.role === 'user') : undefined
  if (!previousUser) {
    return undefined
  }
  const toolParts = conversation.messages
    .slice(0, messageIndex + 1)
    .flatMap(item => item.parts)
    .filter((part): part is Extract<MessagePart, { kind: 'tool' }> => part.kind === 'tool')
  const failedTool = [...toolParts].reverse().find(part => part.toolCall.status === 'failed' || part.toolCall.status === 'rejected')
  let failureArguments: Record<string, unknown> | undefined
  if (failedTool?.toolCall.arguments) {
    try {
      const parsed = JSON.parse(failedTool.toolCall.arguments) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) failureArguments = parsed as Record<string, unknown>
    } catch {
      // Keep the failure result when saved arguments are malformed.
    }
  }
  const filePaths = [...new Set(toolParts.flatMap(part => {
    const paths: string[] = []
    if (part.toolCall.diffPreview?.path) paths.push(part.toolCall.diffPreview.path)
    if (part.toolCall.arguments) {
      try {
        const parsed = JSON.parse(part.toolCall.arguments) as { path?: unknown }
        if (typeof parsed.path === 'string') paths.push(parsed.path)
      } catch {
        // Ignore malformed historical arguments.
      }
    }
    return paths
  }))].slice(-12)
  return {
    prompt: previousUser.content,
    ...(failedTool ? { lastFailure: { tool: failedTool.toolCall.name, arguments: failureArguments, result: failedTool.toolCall.result?.slice(0, 16000) } } : {
      lastFailure: { tool: 'request', result: messageText(message).slice(-16000) }
    }),
    filePaths,
    ...(conversation.taskPlan ? { remainingPlan: conversation.taskPlan } : {})
  }
}

const continueConversation = (messageId: string): void => {
  if (activeRequest) return
  const conversation = getActiveConversation()
  const message = findMessage(conversation, messageId)
  const resume = message ? getContinuationResume(message) : undefined
  if (!message || !resume) return
  const requestId = createId('continue')
  const userMessage = createMessage('user', 'Continue from the saved state.')
  const assistantMessage = createMessage('assistant', '', requestId)
  assistantMessage.status = 'streaming'
  assistantMessage.requestStatus = 'preparing'
  conversation.messages.push(userMessage, assistantMessage)
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
    latestDetail: 'Continuing from saved state',
    tokenCount: 0
  }
  requests.set(requestId, activeRequest)
  startProgressTimer()
  notice = undefined
  render(true)
  post('continue', {
    requestId,
    conversationId: conversation.id,
    resume,
    options: buildRequestOptions()
  })
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
  if ((found.toolCall.retryCount ?? 0) >= MAX_FAILED_TOOL_RETRIES) {
    setNotice('error', `Ghost stopped retrying this tool after ${MAX_FAILED_TOOL_RETRIES} attempts. Refresh the file or change the request.`)
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
  const retryableTools = ['ghost_read_file', 'ghost_search_workspace', 'ghost_get_diagnostics', 'ghost_git_context', 'ghost_update_task_plan', 'ghost_record_completion', 'ghost_write_file', 'ghost_apply_edit', 'ghost_apply_transaction', 'ghost_run_terminal_command', 'ghost_list_directory']
  if (!retryableTools.includes(found.toolCall.name)) {
    setNotice('error', 'Ghost cannot retry this unknown tool.')
    return
  }
  const conversation = getActiveConversation()
  found.toolCall.retryCount = (found.toolCall.retryCount ?? 0) + 1
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

const moveApprovalHunk = (card: HTMLElement, direction: 1 | -1): void => {
  const hunks = Array.from(card.querySelectorAll<HTMLElement>('[data-tool-hunk-card]'))
  if (hunks.length === 0) {
    return
  }
  const activeHunk = document.activeElement?.closest<HTMLElement>('[data-tool-hunk-card]')
  const activeIndex = activeHunk && card.contains(activeHunk) ? Number(activeHunk.dataset.toolHunkIndex) : direction > 0 ? -1 : 0
  const nextIndex = (activeIndex + direction + hunks.length) % hunks.length
  const nextHunk = hunks[nextIndex]
  nextHunk.scrollIntoView({ block: 'nearest' })
  const focusTarget = nextHunk.querySelector<HTMLInputElement>('input') ?? nextHunk.querySelector<HTMLButtonElement>('button')
  focusTarget?.focus()
}

const focusNextApprovalCard = (toolCallId: string): void => {
  window.requestAnimationFrame(() => {
    const toolCards = Array.from(messagesElement.querySelectorAll<HTMLElement>('.tool-progress[data-tool-call-id]'))
    const currentIndex = toolCards.findIndex(card => card.dataset.toolCallId === toolCallId)
    const nextCard = currentIndex < 0
      ? undefined
      : toolCards.slice(currentIndex + 1).find(card => card.classList.contains('tool-approval-card'))
    const focusTarget = nextCard?.querySelector<HTMLInputElement>('input') ?? nextCard?.querySelector<HTMLButtonElement>('button')
    focusTarget?.focus({ preventScroll: true })
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
  if (action === 'previous-hunk' || action === 'next-hunk') {
    const card = document.querySelector<HTMLElement>(`.tool-approval-card[data-tool-call-id="${CSS.escape(toolCallId)}"]`)
    if (card) {
      moveApprovalHunk(card, action === 'next-hunk' ? 1 : -1)
    }
    return
  }
  const requestId = found.message.requestId ?? activeRequest?.requestId
  if (!requestId) {
    return
  }
  const conversationId = getActiveConversation().id
  const refreshFoundMessage = (): void => {
    const element = findMessageElement(found.message.id)
    if (element) {
      updateMessageElement(found.message, element)
    } else {
      renderMessages(false)
    }
  }
  const disableApprovalControls = (): void => {
    const card = document.querySelector<HTMLElement>(`.tool-approval-card[data-tool-call-id="${CSS.escape(toolCallId)}"]`)
    if (!card) return
    card.setAttribute('aria-busy', 'true')
    for (const button of Array.from(card.querySelectorAll<HTMLButtonElement>('[data-tool-action]'))) {
      button.disabled = true
    }
  }
  if ((action === 'open-file' || action === 'open-hunk') && found.toolCall.diffPreview) {
    const path = found.toolCall.diffPreview.files?.[0] ?? found.toolCall.diffPreview.path
    post('open-file', {
      requestId,
      conversationId,
      path,
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
    refreshFoundMessage()
    return
  }
  if (action === 'edit') {
    openToolArgumentsEditor(found, requestId, conversationId)
    return
  }
  if (action === 'answer-question' && found.toolCall.question) {
    const card = document.querySelector<HTMLElement>(`.tool-approval-card[data-tool-call-id="${CSS.escape(toolCallId)}"]`)
    if (!card) return
    const answers = found.toolCall.question.questions.map((_question, questionIndex) => {
      const selected = Array.from(card.querySelectorAll<HTMLInputElement>(`[data-question-option][data-question-index="${questionIndex}"]:checked`)).map(input => input.value.trim()).filter(Boolean)
      const custom = card.querySelector<HTMLInputElement>(`[data-question-custom][data-question-index="${questionIndex}"]`)?.value.trim()
      return custom ? [...selected, custom] : selected
    })
    if (answers.some(answer => answer.length === 0)) {
      screenReaderStatusElement.textContent = 'Choose or enter an answer for every question.'
      return
    }
    disableApprovalControls()
    post('answer-question', { requestId, conversationId, toolCallId, answers })
    return
  }
  if (action === 'approve' || action === 'approve-session' || action === 'approve-forever') {
    disableApprovalControls()
    post('approve-tool', {
      requestId,
      conversationId,
      toolCallId,
      decision: action === 'approve-session'
        ? 'session'
        : action === 'approve-forever'
          ? 'always'
          : 'once'
    })
  } else if (action === 'reject') {
    found.toolCall.approval = 'rejected'
    found.toolCall.status = 'rejected'
    post('reject-tool', { requestId, conversationId, toolCallId })
  }
  refreshFoundMessage()
  if (action === 'reject') {
    focusNextApprovalCard(toolCallId)
  }
}

const cloneMessages = (messages: ChatMessage[]): ChatMessage[] => (
  messages.map(message => normalizeMessage(JSON.parse(JSON.stringify(message)) as Partial<ChatMessage>))
)

const deriveConversation = (conversation: Conversation, titlePrefix: string, messageIndex?: number): void => {
  const timestamp = Date.now()
  const messages = messageIndex === undefined
    ? cloneMessages(conversation.messages)
    : cloneMessages(conversation.messages.slice(0, messageIndex + 1))
  const derived: Conversation = {
    ...conversation,
    id: createId('conversation'),
    title: `${titlePrefix}${conversation.title}`,
    messages,
    draft: '',
    promptHistory: [...conversation.promptHistory],
    activeRequestId: undefined,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  state = {
    ...state,
    conversations: [derived, ...state.conversations],
    activeConversationId: derived.id
  }
  notice = undefined
  render(true)
  restoreDraft()
  promptElement.focus()
}

const openConversationMessage = (conversationId: string, messageId: string): void => {
  const conversation = state.conversations.find(item => item.id === conversationId)
  const messageIndex = conversation?.messages.findIndex(item => item.id === messageId) ?? -1
  if (!conversation || messageIndex < 0) {
    return
  }
  saveDraft()
  state.activeConversationId = conversationId
  visibleMessageCount = Math.max(200, conversation.messages.length - messageIndex)
  notice = undefined
  setModalVisibility(historyModalElement, false)
  render(false)
  restoreDraft()
  requestAnimationFrame(() => {
    const element = messagesElement.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
    element?.scrollIntoView({ block: 'center' })
    element?.classList.add('search-hit')
    setTransientTimeout(() => element?.classList.remove('search-hit'), 1600)
  })
}

const handleMessageAction = (action: string, messageId: string) => {
  const conversation = getActiveConversation()
  const message = findMessage(conversation, messageId)
  if (!message) {
    return
  }
  if (action === 'toggle-bookmark') {
    message.bookmarked = !message.bookmarked
    conversation.updatedAt = Date.now()
    saveState()
    renderMessages(false)
  } else if (action === 'branch-message') {
    const messageIndex = conversation.messages.findIndex(item => item.id === messageId)
    if (messageIndex >= 0) {
      deriveConversation(conversation, 'Branch of ', messageIndex)
    }
  } else if (action === 'copy') {
    void copyText(message.content)
  } else if (action === 'edit') {
    post('edit', { ...lifecycleEnvelope('edit'), messageId, prompt: message.content })
    editMessage(messageId)
  } else if (action === 'edit-resend') {
    post('edit', { ...lifecycleEnvelope('edit'), messageId, prompt: message.content })
    editAndResendMessage(messageId)
  } else if (action === 'cancel-request') {
    const requestId = message.requestId ?? activeRequest?.requestId
    if (requestId) {
      post('cancel', { requestId, conversationId: conversation.id })
    }
  } else if (action === 'disable-auto-accept') {
    const requestId = message.requestId ?? activeRequest?.requestId
    if (requestId && activeRequest?.requestId === requestId) {
      activeRequest.autoAcceptDisabled = true
      post('disable-auto-accept', { requestId, conversationId: conversation.id })
      screenReaderStatusElement.textContent = 'Auto-accept disabled for this request'
      render(false)
    }
  } else if (action === 'approve-all-files') {
    if (message.requestId) {
      post('approve-all-files', { requestId: message.requestId, conversationId: conversation.id })
    }
  } else if (action === 'continue') {
    continueConversation(messageId)
  } else if (action === 'implement-plan') {
    controls.mode = 'agent'
    renderControls()
    sendSettingsUpdate()
    saveState()
    continueConversation(messageId)
  } else if (action === 'open-diff') {
    const path = messageDiffPath(message)
    if (path) {
      post('open-file', {
        requestId: message.requestId ?? createId('open-diff'),
        conversationId: conversation.id,
        path
      })
    }
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
  } else if (action === 'duplicate') {
    deriveConversation(conversation, 'Copy of ')
  } else if (action === 'branch') {
    const lastMessageIndex = conversation.messages.length - 1
    deriveConversation(conversation, 'Branch of ', lastMessageIndex >= 0 ? lastMessageIndex : undefined)
  } else if (action === 'delete') {
    pendingDeleteConversationId = conversationId
    deleteConversationDescriptionElement.textContent = `Delete “${conversation.title}”? This cannot be undone.`
    setModalVisibility(historyModalElement, false)
    setModalVisibility(deleteConversationModalElement, true)
  }
}

const processExtensionMessage = (message: GhostExtensionMessage) => {
  if (message.type === 'protocol-negotiated') {
    protocolClient.setNegotiatedVersion(message.negotiatedVersion)
    return
  }
  if (message.type === 'persisted-state') {
    if (persistenceReady) {
      return
    }
    const persisted = message.state as GhostState
    const hasLocalContent = state.conversations.some(conversation => conversation.messages.length > 0 || Boolean(conversation.draft) || conversation.promptHistory.length > 0) || (state.presets?.length ?? 0) > 0
    const hasStoredContent = persisted.conversations?.some(conversation => {
      if (!conversation || typeof conversation !== 'object') return false
      const candidate = conversation as Conversation
      return Array.isArray(candidate.messages) && (candidate.messages.length > 0 || Boolean(candidate.draft) || (Array.isArray(candidate.promptHistory) && candidate.promptHistory.length > 0))
    }) || (persisted.presets?.length ?? 0) > 0
    const sameWorkspace = typeof state.workspaceId === 'string' && state.workspaceId === persisted.workspaceId
    if (sameWorkspace && hasLocalContent && !hasStoredContent) {
      persistenceReady = true
      render(true)
      restoreDraft()
      post('persist-state', { state: createPersistedState() })
      return
    }
    restorePersistedState(persisted)
    persistenceReady = true
    render(true)
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
    renderInterface()
    return
  }
  if (message.type === 'controls-state') {
    const incomingModels = message.models.filter(model => typeof model === 'string' && model.trim())
    const preserveSelection = !modelRefreshPending
    const selectedModel = preserveSelection && incomingModels.includes(message.settings.chatModel)
      ? message.settings.chatModel
      : preserveSelection ? incomingModels[0] ?? (message.settings.provider === 'opencode' ? '' : message.settings.chatModel) : ''
    modelRefreshPending = false
    controls = {
      ...message.settings,
      chatModel: selectedModel,
      fileEditApproval: message.settings.autoAcceptScope,
      autoAcceptScope: message.settings.autoAcceptScope
    }
    availableModels = incomingModels
    availableModelMetadata = message.modelMetadata?.filter(metadata => metadata && typeof metadata.id === 'string').map(metadata => ({
      ...metadata,
      provider: metadata.provider as GhostProvider,
      capabilities: Array.isArray(metadata.capabilities) ? metadata.capabilities : []
    })) ?? message.models.map(model => ({
      id: model,
      label: model,
      provider: controls.provider,
      capabilities: ['chat']
    }))
    connection = message.connection
    uiPreferences.firstRunSetupComplete = message.firstRunSetupComplete
    viewStatus = connection === 'offline' ? 'offline' : 'ready'
    contextData = { ...message.context, tools: message.tools }
    renderInterface()
    if (selectedModel !== message.settings.chatModel && incomingModels.length > 0) {
      sendSettingsUpdate()
    }
    if (!uiPreferences.firstRunSetupComplete && !firstRunSetupOpened) {
      firstRunSetupOpened = true
      renderFirstRunSetup()
      setModalVisibility(firstRunModalElement, true)
    }
    return
  }
  if (message.type === 'open-first-run') {
    firstRunSetupOpened = true
    renderFirstRunSetup()
    setModalVisibility(firstRunModalElement, true)
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
      workspaceId: state.workspaceId,
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
  if (message.provider) {
    request.provider = message.provider
  }
  if (typeof message.tokenCount === 'number') {
    request.tokenCount = message.tokenCount
  }
  if (typeof message.tokensPerSecond === 'number') {
    request.tokensPerSecond = message.tokensPerSecond
  }
  if (typeof message.elapsedMs === 'number' && typeof message.tokenCount === 'number' && (typeof message.tokensPerSecond === 'number' || message.type === 'request-completed')) {
    assistantMessage.responseStats = {
      elapsedMs: message.elapsedMs,
      tokenCount: message.tokenCount,
      tokensPerSecond: message.tokensPerSecond ?? 0,
      ...(message.model || request.model ? { model: message.model ?? request.model } : {}),
      ...(message.provider || request.provider ? { provider: message.provider ?? request.provider } : {})
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
    scrollMessages(false)
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
      approvalKind: message.approvalKind,
      question: message.question,
      diffPreview: message.diffPreview,
      approval: message.requiresApproval === false ? 'approved' as const : 'pending' as const,
      status: 'requested' as const,
      startedAt: Date.now()
    }
    if (existingTool) {
      existingTool.name = message.tool ?? existingTool.name
      existingTool.arguments = message.arguments ? JSON.stringify(message.arguments, null, 2) : existingTool.arguments
      existingTool.requiresApproval = message.requiresApproval !== false
      existingTool.approvalKind = message.approvalKind ?? existingTool.approvalKind
      existingTool.question = message.question ?? existingTool.question
      existingTool.diffPreview = message.diffPreview ?? existingTool.diffPreview
      existingTool.status = existingTool.approval === 'approved' ? 'running' : 'requested'
    } else {
      assistantMessage.parts.push({ kind: 'tool', toolCall })
    }
    assistantMessage.requestStatus = request.status
    screenReaderStatusElement.textContent = message.detail ?? toolCall.name
    updateMessageElement(assistantMessage)
    scrollMessages(false)
    updateStatus()
    return
  }
  if (message.type === 'task-plan') {
    const plan = message.plan
    if (plan && Array.isArray(plan.steps)) {
      const taskPlan: TaskPlan = {
        steps: plan.steps
          .filter(step => step && typeof step.id === 'string' && typeof step.title === 'string')
          .slice(0, 50)
          .map(step => ({ id: step.id.slice(0, 100), title: step.title.slice(0, 500), checked: step.checked === true, ...(step.evidence ? { evidence: step.evidence.slice(0, 1000) } : {}) })),
        ...(typeof plan.currentStep === 'string' ? { currentStep: plan.currentStep.slice(0, 100) } : {}),
        ...(typeof plan.blockedReason === 'string' ? { blockedReason: plan.blockedReason.slice(0, 1000) } : {}),
        completionEvidence: Array.isArray(plan.completionEvidence) ? plan.completionEvidence.filter(item => typeof item === 'string').slice(0, 10).map(item => item.slice(0, 1000)) : [],
        updatedAt: typeof plan.updatedAt === 'number' ? plan.updatedAt : Date.now()
      }
      conversation.taskPlan = taskPlan
      assistantMessage.parts = assistantMessage.parts.filter(part => part.kind !== 'task-plan')
      assistantMessage.parts.push({ kind: 'task-plan', plan: taskPlan })
      assistantMessage.updatedAt = Date.now()
      conversation.updatedAt = Date.now()
      updateMessageElement(assistantMessage)
      scrollMessages(false)
      updateStatus()
    }
    return
  }
  if (message.type === 'tool-result') {
    const toolPart = [...assistantMessage.parts]
      .reverse()
      .find((part): part is Extract<MessagePart, { kind: 'tool' }> => part.kind === 'tool' && (message.toolCallId ? part.toolCall.id === message.toolCallId : part.toolCall.status !== 'completed'))
    if (toolPart) {
      const detail = redactSensitiveText(message.detail ?? 'Tool completed').slice(0, 16000)
      const inferredFailure = message.resultStatus === undefined && /rejected|denied|cancelled|error|failed/i.test(detail)
      const failed = message.resultStatus === 'failed' || inferredFailure
      const rejected = message.resultStatus === 'rejected' || (message.resultStatus === undefined && /rejected|denied/i.test(detail))
      toolPart.toolCall.status = rejected
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
    scrollMessages(false)
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
    scrollMessages(false)
    updateStatus()
    return
  }
  if (message.type === 'error') {
    const scrollState = captureMessagePaneScroll()
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
    restoreMessagePaneScroll(scrollState)
    return
  }
  if (message.type === 'request-completed') {
    const status = message.status ?? 'failed'
    const completionRecord = normalizeCompletionRecord(message.completionRecord)
    const eventLog = normalizeRequestEventLog(message.eventLog)
    const workspaceChangedFiles = summaryChangedFiles(assistantMessage)
    const workspaceCommandCount = summaryCommandCount(assistantMessage)
    const usedWorkspaceTools = assistantMessage.parts.some(part => part.kind === 'tool') || workspaceChangedFiles.length > 0 || workspaceCommandCount > 0
    const hasMeaningfulCompletionRecord = Boolean(completionRecord && (
      usedWorkspaceTools ||
      completionRecord.changedFiles.length > 0 ||
      completionRecord.checksRun.length > 0 ||
      completionRecord.failures.length > 0 ||
      completionRecord.remainingWork.length > 0
    ))
    if (request.setupTest) {
      conversation.completionRecord = undefined
      if (status === 'completed') {
        const reply = assistantMessage.content.trim().replace(/\s+/g, ' ')
        setupTestStatusElement.textContent = reply
          ? `Test passed: ${reply.slice(0, 240)}`
          : 'Test completed, but the model returned no text.'
      } else {
        setupTestStatusElement.textContent = `Test failed: ${status}.`
      }
      setModalVisibility(firstRunModalElement, true)
    } else if (status === 'completed' && completionRecord && hasMeaningfulCompletionRecord) {
      conversation.completionRecord = completionRecord
    } else if (status === 'completed' && usedWorkspaceTools) {
      conversation.completionRecord = {
        changedFiles: workspaceChangedFiles,
        checksRun: [],
        failures: [],
        remainingWork: [],
        recordedAt: Date.now()
      }
    } else {
      conversation.completionRecord = undefined
    }
    request.status = status
    assistantMessage.requestStatus = status
    assistantMessage.status = status === 'failed' ? 'error' : undefined
    assistantMessage.completionRecord = status === 'completed' && hasMeaningfulCompletionRecord ? completionRecord : undefined
    const changedFiles = [...new Set([...(status === 'completed' ? completionRecord?.changedFiles ?? [] : []), ...summaryChangedFiles(assistantMessage)])].sort()
    const hasUnfinishedWork = Boolean(completionRecord && (completionRecord.failures.length > 0 || completionRecord.remainingWork.length > 0))
    const finalStatus = status === 'completed'
      ? hasUnfinishedWork
        ? 'Finished — work remains'
        : hasMeaningfulCompletionRecord
          ? 'Task completed'
          : usedWorkspaceTools
            ? 'Changes applied — verification not reported'
            : 'Response complete'
      : message.stopReason
        ? stopReasonLabel(message.stopReason)
        : status === 'cancelled'
          ? 'Request cancelled'
          : 'Request failed'
    assistantMessage.requestSummary = {
      changedFiles,
      commandCount: summaryCommandCount(assistantMessage),
      elapsedMs: typeof message.elapsedMs === 'number' ? message.elapsedMs : Date.now() - request.startedAt,
      ...(message.model || request.model ? { model: message.model ?? request.model } : {}),
      ...(message.provider || request.provider ? { provider: message.provider ?? request.provider } : {}),
      tokenCount: typeof message.tokenCount === 'number' ? message.tokenCount : request.tokenCount,
      status: finalStatus
    }
    if (eventLog.length > 0) {
      assistantMessage.eventLog = eventLog
    }
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
    render(false, status !== 'completed')
  }
}

type StreamDeltaMessage = GhostExtensionMessage & {
  type: 'text-delta' | 'code-delta'
  delta: string
}

const pendingStreamMessages: StreamDeltaMessage[] = []
let pendingStreamFrame: number | undefined

const flushStreamMessages = (): void => {
  pendingStreamFrame = undefined
  if (pendingStreamMessages.length === 0) {
    return
  }
  const messages = pendingStreamMessages.splice(0, pendingStreamMessages.length)
  const batched: StreamDeltaMessage[] = []
  for (const message of messages) {
    const previous = batched.at(-1)
    if (previous && previous.requestId === message.requestId && previous.conversationId === message.conversationId) {
      batched[batched.length - 1] = {
        ...message,
        delta: `${previous.delta}${message.delta}`
      }
    } else {
      batched.push(message)
    }
  }
  for (const message of batched) {
    processExtensionMessage(message)
  }
}

const handleExtensionMessage = (message: GhostExtensionMessage): void => {
  if (message.type !== 'text-delta' && message.type !== 'code-delta') {
    if (pendingStreamFrame !== undefined) {
      cancelAnimationFrame(pendingStreamFrame)
      flushStreamMessages()
    }
    processExtensionMessage(message)
    return
  }
  pendingStreamMessages.push(message as StreamDeltaMessage)
  if (pendingStreamFrame === undefined) {
    pendingStreamFrame = requestAnimationFrame(flushStreamMessages)
  }
}

const isExtensionMessage = (value: unknown): value is GhostExtensionMessage => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const message = value as Record<string, unknown>
  if (message.source !== 'ghost-extension' || !protocolClient.isSupportedVersion(message.version) || typeof message.type !== 'string') {
    return false
  }
  if (message.type === 'protocol-negotiated') {
    return protocolClient.isSupportedVersion(message.negotiatedVersion) && Array.isArray(message.supportedVersions) && message.supportedVersions.length > 0
  }
  if (message.type === 'state') {
    return (message.status === 'ready' || message.status === 'offline') && typeof message.detail === 'string'
  }
  if (message.type === 'reset' || message.type === 'clear') {
    return message.action === 'explicit-user-command'
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
      (message.modelMetadata === undefined || Array.isArray(message.modelMetadata)) &&
      typeof message.firstRunSetupComplete === 'boolean' &&
      (message.connection === 'online' || message.connection === 'offline' || message.connection === 'unknown')
    )
  }
  if (message.type === 'open-first-run') {
    return true
  }
  if (message.type === 'file-picked') {
    return Array.isArray(message.attachments)
  }
  if (!['request-started', 'thinking', 'text-delta', 'code-delta', 'tool-requested', 'tool-result', 'task-plan', 'warning', 'error', 'request-completed'].includes(message.type)) {
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
    (message.stopReason === undefined || ['failed-tool', 'invalid-model-response', 'cancelled', 'timeout', 'approval-rejected', 'context-limit', 'budget-limit', 'provider-failure'].includes(message.stopReason as string)) &&
    (message.type !== 'task-plan' || Boolean(message.plan && typeof message.plan === 'object' && Array.isArray((message.plan as { steps?: unknown }).steps)))
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
  const copyTextButton = target.closest<HTMLButtonElement>('[data-copy-text]')
  if (copyTextButton) {
    void copyText(decodeURIComponent(copyTextButton.dataset.copyText ?? ''))
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
  if (controls.provider === 'opencode') {
    controls.chatModel = ''
  }
  availableModels = []
  availableModelMetadata = []
  renderControls()
  sendSettingsUpdate()
})

openAiProfileElement.addEventListener('change', () => {
  const previousDefault = openAiDefaultEndpoints[controls.openaiProfile]
  controls.openaiProfile = openAiProfileElement.value as OpenAiProfile
  if (!controls.openaiUrl || controls.openaiUrl === previousDefault || controls.openaiUrl === 'http://localhost:8001/v1') {
    controls.openaiUrl = openAiDefaultEndpoints[controls.openaiProfile]
  }
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
  } else if (controls.provider === 'openrouter') {
    controls.openrouterUrl = endpoint
  } else if (controls.provider === 'opencode') {
    controls.openCodeUrl = endpoint
  } else {
    controls.ollamaUrl = endpoint
  }
  sendSettingsUpdate()
  queueModelRefresh()
})
const updateOpenCodeSettings = (): void => {
  controls.openCodeUsername = openCodeUsernameElement.value.trim() || 'opencode'
  controls.openCodeAgent = openCodeAgentElement.value.trim()
  controls.openCodeSessionReuse = openCodeSessionReuseElement.value === 'new' ? 'new' : 'workspace'
  sendSettingsUpdate()
  saveState()
}
for (const element of [openCodeUsernameElement, openCodeAgentElement, openCodeSessionReuseElement]) {
  element.addEventListener('change', updateOpenCodeSettings)
}
setOpenCodePasswordElement.addEventListener('click', () => post('set-provider-api-key', { provider: 'opencode' }))
setOpenRouterApiKeyElement.addEventListener('click', () => post('set-provider-api-key', { provider: 'openrouter' }))
const updateOpenAiSettings = () => {
  controls.openaiApiKeyHeader = openAiApiKeyHeaderElement.value.trim()
  controls.openaiApiKeyPrefix = openAiApiKeyPrefixElement.value.trim()
  controls.openaiOrganizationHeader = openAiOrganizationHeaderElement.value.trim()
  controls.openaiOrganization = openAiOrganizationElement.value.trim()
  controls.openaiProjectHeader = openAiProjectHeaderElement.value.trim()
  controls.openaiProject = openAiProjectElement.value.trim()
  controls.openaiProxy = openAiProxyElement.value.trim()
  controls.openaiNoProxy = openAiNoProxyElement.value.trim()
  controls.openaiTlsRejectUnauthorized = openAiTlsRejectUnauthorizedElement.checked
  controls.openaiTlsCaFile = openAiTlsCaFileElement.value.trim()
  controls.openaiTlsCertFile = openAiTlsCertFileElement.value.trim()
  controls.openaiTlsKeyFile = openAiTlsKeyFileElement.value.trim()
  controls.openaiApiVersion = openAiApiVersionElement.value.trim()
  controls.openaiCustomModelsPath = openAiCustomModelsPathElement.value.trim()
  controls.openaiCustomChatPath = openAiCustomChatPathElement.value.trim()
  controls.openaiCustomResponseFormat = openAiCustomResponseFormatElement.value as CustomResponseFormat
  controls.openaiCustomRequestTemplate = openAiCustomRequestTemplateElement.value
  sendSettingsUpdate()
  saveState()
}
for (const element of [
  openAiApiKeyHeaderElement,
  openAiApiKeyPrefixElement,
  openAiOrganizationHeaderElement,
  openAiOrganizationElement,
  openAiProjectHeaderElement,
  openAiProjectElement,
  openAiProxyElement,
  openAiNoProxyElement,
  openAiTlsRejectUnauthorizedElement,
  openAiTlsCaFileElement,
  openAiTlsCertFileElement,
  openAiTlsKeyFileElement,
  openAiApiVersionElement,
  openAiCustomModelsPathElement,
  openAiCustomChatPathElement,
  openAiCustomResponseFormatElement,
  openAiCustomRequestTemplateElement
]) {
  element.addEventListener('change', updateOpenAiSettings)
}
const updateOpenRouterSettings = (): void => {
  controls.openrouterReferer = openRouterRefererElement.value.trim()
  controls.openrouterTitle = openRouterTitleElement.value.trim()
  controls.openrouterAllowFallbacks = openRouterAllowFallbacksElement.checked
  controls.openrouterRequireParameters = openRouterRequireParametersElement.checked
  controls.openrouterDataCollection = openRouterDataCollectionElement.value === 'deny' ? 'deny' : 'allow'
  controls.openrouterProviderOrder = openRouterProviderOrderElement.value.split(',').map(value => value.trim()).filter(Boolean)
  controls.openrouterProxy = openRouterProxyElement.value.trim()
  controls.openrouterNoProxy = openRouterNoProxyElement.value.trim()
  controls.openrouterTlsRejectUnauthorized = openRouterTlsRejectUnauthorizedElement.checked
  controls.openrouterTlsCaFile = openRouterTlsCaFileElement.value.trim()
  controls.openrouterTlsCertFile = openRouterTlsCertFileElement.value.trim()
  controls.openrouterTlsKeyFile = openRouterTlsKeyFileElement.value.trim()
  sendSettingsUpdate()
  saveState()
}
for (const element of [
  openRouterRefererElement,
  openRouterTitleElement,
  openRouterAllowFallbacksElement,
  openRouterRequireParametersElement,
  openRouterDataCollectionElement,
  openRouterProviderOrderElement,
  openRouterProxyElement,
  openRouterNoProxyElement,
  openRouterTlsRejectUnauthorizedElement,
  openRouterTlsCaFileElement,
  openRouterTlsCertFileElement,
  openRouterTlsKeyFileElement
]) {
  element.addEventListener('change', updateOpenRouterSettings)
}
testProviderElement.addEventListener('click', () => post('test-provider'))
refreshModelsElement.addEventListener('click', () => {
  modelRefreshPending = true
  controls.chatModel = ''
  availableModels = []
  availableModelMetadata = []
  renderControls()
  post('refresh-models')
})
openToolPermissionsElement.addEventListener('click', () => {
  renderPermissionControls()
  setModalVisibility(toolPermissionsModalElement, true)
})
openTerminalEnvironmentPermissionsElement.addEventListener('click', () => {
  renderPermissionControls()
  setModalVisibility(terminalEnvironmentPermissionsModalElement, true)
})
addTerminalEnvironmentElement.addEventListener('click', () => {
  const name = terminalEnvironmentNameElement.value.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return
  }
  setEnvironmentPolicy(name, 'ask')
  terminalEnvironmentNameElement.value = ''
  sendSettingsUpdate()
  saveState()
  renderPermissionControls()
})

modelElement.addEventListener('focus', () => {
  modelElement.select()
  renderModelOptions()
})
modelElement.addEventListener('input', () => renderModelOptions())
modelElement.addEventListener('keydown', event => {
  const options = Array.from(modelOptionsElement.querySelectorAll<HTMLElement>('[role="option"]'))
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (modelOptionsElement.hidden) renderModelOptions()
    const nextIndex = activeModelOptionIndex < 0
      ? event.key === 'ArrowDown' ? 0 : options.length - 1
      : activeModelOptionIndex + (event.key === 'ArrowDown' ? 1 : -1)
    setActiveModelOption(nextIndex)
    return
  }
  if (event.key === 'Enter') {
    const selected = options[activeModelOptionIndex]?.dataset.model
      ?? modelChoices().find(model => model.toLocaleLowerCase() === modelElement.value.trim().toLocaleLowerCase())
    if (selected) {
      event.preventDefault()
      selectChatModel(selected)
    }
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeModelOptions(true)
  }
})
modelElement.addEventListener('blur', () => {
  window.setTimeout(() => {
    if (!modelAutocompleteElement.contains(document.activeElement)) closeModelOptions(true)
  }, 0)
})
modelOptionsToggleElement.addEventListener('mousedown', event => event.preventDefault())
modelOptionsToggleElement.addEventListener('click', () => {
  if (modelOptionsElement.hidden) {
    modelElement.focus()
    modelElement.select()
    renderModelOptions()
  } else {
    closeModelOptions(true)
  }
})
modelOptionsElement.addEventListener('mousedown', event => event.preventDefault())
modelOptionsElement.addEventListener('click', event => {
  const option = (event.target as HTMLElement).closest<HTMLElement>('[data-model]')
  if (option?.dataset.model) selectChatModel(option.dataset.model)
})
modelProfileElement.addEventListener('change', () => {
  controls.modelProfile = modelProfileElement.value
  renderControls()
  sendSettingsUpdate()
  saveState()
})
restoreGenerationDefaultsElement.addEventListener('click', () => {
  controls.modelProfile = ''
  controls.temperature = defaultGenerationSettings.temperature
  controls.topP = defaultGenerationSettings.topP
  controls.topK = defaultGenerationSettings.topK
  controls.minP = defaultGenerationSettings.minP
  controls.presencePenalty = defaultGenerationSettings.presencePenalty
  controls.repeatPenalty = defaultGenerationSettings.repeatPenalty
  controls.maxContextTokens = defaultGenerationSettings.maxContextTokens
  controls.responseLength = defaultGenerationSettings.responseLength
  renderControls()
  sendSettingsUpdate()
  saveState()
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
enableInlineCompletionsElement.addEventListener('change', () => {
  controls.enableInlineCompletions = enableInlineCompletionsElement.checked
  sendSettingsUpdate()
  renderControls()
})
fileEditApprovalElement.addEventListener('change', () => {
  const value = fileEditApprovalElement.value
  controls.fileEditApproval = value === 'one-edit' || value === 'current-file' || value === 'request' || value === 'session' || value === 'workspace' || value === 'always' ? value : 'confirm'
  controls.autoAcceptScope = controls.fileEditApproval
  sendSettingsUpdate()
  saveState()
})
openCodeFileEditApprovalElement.addEventListener('change', () => {
  const value = openCodeFileEditApprovalElement.value
  controls.fileEditApproval = value === 'request' || value === 'workspace' || value === 'always' ? value : 'confirm'
  controls.autoAcceptScope = controls.fileEditApproval
  sendSettingsUpdate()
  saveState()
})
composerHeightElement.addEventListener('input', () => {
  composerHeight = Math.min(320, Math.max(80, Number(composerHeightElement.value) || 180))
  layoutComposer()
  updateComposer()
  saveState()
})
promptRowsElement.addEventListener('input', () => {
  promptRows = settingsStore.clampPromptRows(Number(promptRowsElement.value) || 3)
  promptRowsElement.value = String(promptRows)
  uiPreferences.promptRows = promptRows
  layoutComposer()
  updateComposer()
  saveState()
})
promptHistoryLimitElement.addEventListener('change', () => {
  uiPreferences.promptHistoryLimit = settingsStore.clampPromptHistoryLimit(Number(promptHistoryLimitElement.value), defaultPromptHistoryLimit)
  promptHistoryLimitElement.value = String(uiPreferences.promptHistoryLimit)
  historyIndex = -1
  trimPromptHistories()
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
  renderControls()
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
logLevelElement.addEventListener('change', () => {
  controls.logLevel = logLevelElement.value as LogLevel
  controls.enableDebugLogging = controls.logLevel === 'debug'
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
workspaceRootElement.addEventListener('change', () => {
  uiPreferences.workspaceRoot = workspaceRootElement.value
  renderContextPreview()
  saveState()
})

document.getElementById('settings')?.addEventListener('click', () => {
  renderSettingsSearch()
  setModalVisibility(settingsModalElement, true)
})
settingsSearchElement.addEventListener('input', renderSettingsSearch)
document.getElementById('privacy-page')?.addEventListener('click', () => {
  setModalVisibility(settingsModalElement, false)
  setModalVisibility(privacyModalElement, true)
})
document.getElementById('context-preview')?.addEventListener('click', () => {
  renderContextPreview()
  setModalVisibility(contextModalElement, true)
})
setupCheckProviderElement.addEventListener('click', () => {
  setupProviderStatusElement.textContent = 'Checking provider…'
  testProviderElement.click()
})
setupTestRequestElement.addEventListener('click', () => {
  if (activeRequest) {
    setupTestStatusElement.textContent = 'Finish the current request before running the setup test.'
    return
  }
  setupTestStatusElement.textContent = 'Test request sent. Watch the conversation for the result.'
  setModalVisibility(firstRunModalElement, false)
  submitPrompt('Reply with exactly READY so I can verify the selected model.', { setupTest: true })
})
finishFirstRunElement.addEventListener('click', () => {
  uiPreferences.firstRunSetupComplete = true
  post('complete-first-run')
  setModalVisibility(firstRunModalElement, false)
})
document.getElementById('history')?.addEventListener('click', () => {
  renderHistory()
  setModalVisibility(historyModalElement, true)
})
document.getElementById('confirm-delete-conversation')?.addEventListener('click', () => {
  const conversationId = pendingDeleteConversationId
  pendingDeleteConversationId = undefined
  setModalVisibility(deleteConversationModalElement, false)
  if (conversationId) {
    deleteConversation(conversationId)
  }
  setModalVisibility(historyModalElement, true)
})
document.querySelectorAll<HTMLElement>('[data-close-modal]').forEach(button => {
  button.addEventListener('click', () => {
    const modalId = button.dataset.closeModal
    if (modalId) {
      if (modalId === 'delete-conversation-modal') {
        closeDeleteConversationConfirmation()
        return
      }
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
      if (backdrop.id === 'delete-conversation-modal') {
        closeDeleteConversationConfirmation()
        return
      }
      setModalVisibility(backdrop, false)
    }
  })
})
document.addEventListener('keydown', event => {
  const activeModal = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop'))
    .find(modal => !modal.hidden)
  if (activeModal && event.key === 'Tab') {
    const focusable = Array.from(activeModal.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])'))
      .filter(element => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
    if (focusable.length > 0) {
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
      const targetIndex = accessibility.focusWrapTarget(focusable.length, activeIndex, event.shiftKey)
      if (targetIndex !== undefined) {
        focusable[targetIndex].focus()
        event.preventDefault()
      }
    }
  }
  const approvalCard = (event.target as HTMLElement).closest<HTMLElement>('.tool-approval-card')
  if (approvalCard && !event.altKey && !event.metaKey && !event.ctrlKey) {
    const approvalAction = accessibility.approvalKeyboardAction(event.key)
    if (approvalAction === 'next-hunk') {
      moveApprovalHunk(approvalCard, 1)
      event.preventDefault()
      return
    }
    if (approvalAction === 'previous-hunk') {
      moveApprovalHunk(approvalCard, -1)
      event.preventDefault()
      return
    }
    if (approvalAction === 'approve') {
      approvalCard.querySelector<HTMLButtonElement>('[data-tool-action="approve"]')?.click()
      event.preventDefault()
      return
    }
    if (approvalAction === 'reject') {
      approvalCard.querySelector<HTMLButtonElement>('[data-tool-action="reject"]')?.click()
      event.preventDefault()
      return
    }
  }
  if (event.key !== 'Escape') {
    return
  }
  const visibleModal = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop'))
    .find(modal => !modal.hidden)
  if (visibleModal) {
    if (visibleModal === deleteConversationModalElement) {
      closeDeleteConversationConfirmation()
      event.preventDefault()
      return
    }
    setModalVisibility(visibleModal, false)
    event.preventDefault()
  }
})
historySearchElement.addEventListener('input', renderHistory)
historyBookmarksOnlyElement.addEventListener('change', renderHistory)
historyListElement.addEventListener('click', event => {
  const target = event.target as HTMLElement
  const action = target.closest<HTMLButtonElement>('[data-conversation-action]')
  if (action?.dataset.conversationAction && action.dataset.conversationId) {
    handleConversationAction(action.dataset.conversationAction, action.dataset.conversationId)
    renderHistory()
    return
  }
  const result = target.closest<HTMLButtonElement>('[data-history-message]')
  if (result?.dataset.historyConversation && result.dataset.historyMessage) {
    openConversationMessage(result.dataset.historyConversation, result.dataset.historyMessage)
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
  controls.mode = preset.mode === 'inline' ? 'agent' : preset.mode
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
attachmentListElement.addEventListener('click', event => {
  const remove = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-attachment-name]')
  const name = remove?.dataset.attachmentName
  if (!name) {
    return
  }
  attachments = attachments.filter(attachment => attachment.name !== name)
  renderControls()
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
promptElement.addEventListener('paste', event => {
  const image = Array.from(event.clipboardData?.files ?? []).find(file => file.type.toLowerCase().startsWith('image/'))
  if (!image) {
    return
  }
  event.preventDefault()
  void readDroppedFile(image)
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
searchPromptHistoryElement.addEventListener('click', () => {
  promptHistorySearchElement.value = ''
  renderPromptHistorySearch()
  setModalVisibility(promptHistoryModalElement, true)
})
promptHistorySearchElement.addEventListener('input', renderPromptHistorySearch)
promptHistoryListElement.addEventListener('click', event => {
  const entry = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-prompt-history-index]')
  const index = entry?.dataset.promptHistoryIndex
  if (index === undefined) {
    return
  }
  restorePromptHistoryEntry(Number(index))
  setModalVisibility(promptHistoryModalElement, false)
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
  if (promptElement.value.trim()) {
    historyIndex = -1
  }
  saveDraft()
  saveState()
  updateComposer()
})
promptElement.addEventListener('blur', () => {
  saveDraft()
  saveState()
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
sendElement.addEventListener('click', () => {
  composerElement.requestSubmit()
})
window.addEventListener('message', event => {
  if (event.origin === window.location.origin && isExtensionMessage(event.data)) {
    handleExtensionMessage(event.data)
  }
})

const disposeWebviewResources = (): void => {
  if (persistenceTimer !== undefined) {
    window.clearTimeout(persistenceTimer)
    persistenceTimer = undefined
    if (persistenceReady && controls.enableConversationPersistence) {
      post('persist-state', { state: createPersistedState() })
    }
  }
  if (settingsTimer !== undefined) {
    window.clearTimeout(settingsTimer)
    settingsTimer = undefined
  }
  if (modelRefreshTimer !== undefined) {
    window.clearTimeout(modelRefreshTimer)
    modelRefreshTimer = undefined
  }
  for (const timer of transientTimers) {
    window.clearTimeout(timer)
  }
  transientTimers.clear()
  stopProgressTimer()
  if (animatedStatusFrame !== undefined) {
    cancelAnimationFrame(animatedStatusFrame)
    animatedStatusFrame = undefined
  }
  if (pendingStreamFrame !== undefined) {
    cancelAnimationFrame(pendingStreamFrame)
    pendingStreamFrame = undefined
  }
  pendingStreamMessages.length = 0
  lazyMessageObserver?.disconnect()
  reducedMotionQuery.removeEventListener('change', handleReducedMotionChange)
  for (const request of requests.values()) {
    post('cancel', {
      requestId: request.requestId,
      conversationId: request.conversationId
    })
  }
  requests.clear()
}

window.addEventListener('pagehide', disposeWebviewResources, { once: true })

const restoredWebviewState = vscode.getState<GhostState>()
const hasRestoredWebviewState = Boolean(restoredWebviewState && (restoredWebviewState.schemaVersion === 1 || restoredWebviewState.schemaVersion === persistenceSchemaVersion) && Array.isArray(restoredWebviewState.conversations))
if (restoredWebviewState && hasRestoredWebviewState) {
  restorePersistedState(restoredWebviewState)
}

renderControls()
updateStatus()
restoreDraft()
post('ready')
