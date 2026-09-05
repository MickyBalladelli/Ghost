import type {
  GhostAutoAcceptScope,
  GhostLogLevel,
  GhostMode,
  GhostProgressPhase,
  GhostProviderQuestion,
  GhostProvider,
  GhostRequestStatus,
  GhostResponseLength,
  GhostStopReason,
  GhostViewStatus
} from './ghostProtocolTypes'

export type AutoAcceptScope = GhostAutoAcceptScope
export type ResponseLength = GhostResponseLength
export type LogLevel = GhostLogLevel
export type RequestStatus = GhostRequestStatus
export type ProgressPhase = GhostProgressPhase
export type StopReason = GhostStopReason
export type { GhostViewStatus, GhostProvider, GhostMode }

export type OpenAiProfile = 'generic' | 'anthropic' | 'gemini' | 'azure-openai' | 'lm-studio' | 'llama-cpp' | 'vllm' | 'litellm' | 'custom'
export type CustomResponseFormat = 'openai-sse' | 'json'
export type NoticeKind = 'error' | 'no-model' | 'info'
export type MessageRole = 'user' | 'assistant'
export type ModelRole = 'chat' | 'agent' | 'vision' | 'autocomplete'

export interface ModelProfile {
  provider?: GhostProvider
  model?: string
  chatModel?: string
  agentModel?: string
  visionModel?: string
  autocompleteModel?: string
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  repeatPenalty?: number
  maxContextTokens?: number
  maxTokens?: number
}

export interface Attachment {
  name: string
  path?: string
  content?: string
  mimeType?: string
}

export interface PromptPreset {
  id: string
  name: string
  prompt: string
  mode: GhostMode
  temperature: number
  maxContextTokens: number
  responseLength: ResponseLength
}

export interface ControlSettings {
  provider: GhostProvider
  ollamaUrl: string
  mlxUrl: string
  openaiUrl: string
  openaiProfile: OpenAiProfile
  openaiApiVersion: string
  openaiCustomModelsPath: string
  openaiCustomChatPath: string
  openaiCustomRequestTemplate: string
  openaiCustomResponseFormat: CustomResponseFormat
  openaiApiKeyHeader: string
  openaiApiKeyPrefix: string
  openaiOrganizationHeader: string
  openaiOrganization: string
  openaiProjectHeader: string
  openaiProject: string
  openaiProxy: string
  openaiNoProxy: string
  openaiTlsRejectUnauthorized: boolean
  openaiTlsCaFile: string
  openaiTlsCertFile: string
  openaiTlsKeyFile: string
  openrouterUrl: string
  openrouterReferer: string
  openrouterTitle: string
  openrouterAllowFallbacks: boolean
  openrouterRequireParameters: boolean
  openrouterDataCollection: 'allow' | 'deny'
  openrouterProviderOrder: string[]
  openrouterProxy: string
  openrouterNoProxy: string
  openrouterTlsRejectUnauthorized: boolean
  openrouterTlsCaFile: string
  openrouterTlsCertFile: string
  openrouterTlsKeyFile: string
  openCodeUrl: string
  openCodeUsername: string
  openCodeAgent: string
  openCodeSessionReuse: 'workspace' | 'new'
  toolAllowlist: string[]
  toolAsklist: string[]
  toolDenylist: string[]
  terminalEnvironmentAllowlist: string[]
  terminalEnvironmentAsklist: string[]
  enableDebugLogging: boolean
  logLevel: LogLevel
  networkAccess: 'local' | 'external'
  chatModel: string
  modelPerProvider: Partial<Record<GhostProvider, string>>
  autocompleteModel: string
  modelProfile: string
  modelAliases: Record<string, string>
  modelProfiles: Record<string, ModelProfile>
  maxContextTokens: number
  temperature: number
  topP: number
  topK: number
  minP: number
  presencePenalty: number
  repeatPenalty: number
  responseLength: ResponseLength
  mode: GhostMode
  autoAcceptScope: AutoAcceptScope
  fileEditApproval: AutoAcceptScope
  enableInlineCompletions: boolean
  enableConversationPersistence: boolean
}

export interface UiPreferences {
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
  promptHistoryLimit: number
  workspaceRoot: string
  firstRunSetupComplete: boolean
  workspaceOnly: boolean
}

export interface ContextData {
  workspaceName: string
  folders: string[]
  activeFile?: { name: string; path: string; languageId: string; hasSelection: boolean }
  openFiles: string[]
  tools: string[]
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  parts: MessagePart[]
  responseStats?: ResponseStats
  requestSummary?: RequestSummary
  completionRecord?: CompletionRecord
  status?: 'streaming' | 'error'
  requestStatus?: RequestStatus
  stopReason?: StopReason
  eventLog?: RequestEvent[]
  requestId?: string
  bookmarked?: boolean
  createdAt: number
  updatedAt: number
}

export interface ResponseStats {
  elapsedMs: number
  tokenCount: number
  tokensPerSecond: number
  model?: string
  provider?: GhostProvider
}

export interface RequestSummary {
  changedFiles: string[]
  commandCount: number
  elapsedMs: number
  model?: string
  provider?: GhostProvider
  tokenCount: number
  status: string
}

export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning' | 'progress'; text: string; phase?: ProgressPhase; elapsedMs?: number; tokenCount?: number; tokensPerSecond?: number; model?: string }
  | { kind: 'tool'; toolCall: ToolCall }
  | { kind: 'task-plan'; plan: TaskPlan }
  | { kind: 'error'; message: string; recoverable?: boolean }
  | { kind: 'warning'; message: string }

export interface ToolCall {
  id: string
  round: number
  name: string
  arguments?: string
  requiresApproval?: boolean
  approvalKind?: 'tool' | 'provider-permission' | 'provider-question'
  question?: GhostProviderQuestion
  approval?: 'pending' | 'approved' | 'rejected'
  diffPreview?: { path: string; files?: string[]; before: string; after: string; truncated?: boolean; previewKind?: 'staged' | 'text'; hunks?: Array<{ startLine: number; endLine: number; replacement: string }> }
  status: 'requested' | 'running' | 'completed' | 'rejected' | 'failed'
  result?: string
  startedAt: number
  completedAt?: number
  retryCount?: number
}

export interface TaskPlan {
  steps: Array<{ id: string; title: string; checked: boolean; evidence?: string }>
  currentStep?: string
  blockedReason?: string
  completionEvidence: string[]
  updatedAt: number
}

export interface CompletionRecord {
  changedFiles: string[]
  checksRun: string[]
  failures: string[]
  remainingWork: string[]
  recordedAt: number
}

export interface RequestEvent {
  timestamp: number
  elapsedMs: number
  type: string
  status: RequestStatus
  phase?: ProgressPhase
  detail?: string
}

export interface ContinuationResume {
  prompt: string
  lastFailure?: { tool: string; arguments?: Record<string, unknown>; result?: string }
  filePaths: string[]
  remainingPlan?: TaskPlan
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  draft: string
  promptHistory: string[]
  taskPlan?: TaskPlan
  completionRecord?: CompletionRecord
  activeRequestId?: string
  createdAt: number
  updatedAt: number
}

export interface GhostState {
  schemaVersion: number
  workspaceId?: string
  conversations: Conversation[]
  activeConversationId: string
  promptHistory?: string[]
  presets?: PromptPreset[]
  showReasoning?: boolean
  preferences?: Partial<ControlSettings> & Partial<UiPreferences>
}

export interface GhostWebviewApi {
  postMessage(message: unknown): void
  getState<T>(): T | undefined
  setState<T>(state: T): void
}

export interface ActiveRequest {
  requestId: string
  conversationId: string
  assistantMessageId: string
  lastSequence: number
  status: RequestStatus
  attempt: number
  startedAt: number
  model: string
  provider?: GhostProvider
  phase: ProgressPhase
  latestDetail: string
  tokenCount: number
  tokensPerSecond?: number
  setupTest?: boolean
  stopReason?: StopReason
  autoAcceptDisabled?: boolean
}

export interface ModelMetadata {
  id: string
  label: string
  provider: GhostProvider
  contextWindow?: number
  outputLimit?: number
  nativeApi?: string
  supportsTools?: boolean
  supportsJsonMode?: boolean
  supportsVision?: boolean
  supportsFIM?: boolean
  supportsStreaming?: boolean
  supportsSampling?: { temperature: boolean; topP: boolean; topK: boolean; minP: boolean; presencePenalty: boolean; repeatPenalty: boolean }
  displayName?: string
  pricing?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
  pricingStatus?: 'free' | 'paid' | 'unknown'
  capabilities: string[]
}

export interface WebviewRequestOptions {
  provider: GhostProvider
  model: string
  modelProfile: string
  modelRole?: ModelRole
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  repeatPenalty?: number
  maxContextTokens: number
  maxTokens?: number
  mode: GhostMode
  showReasoning?: boolean
  customSystemInstructions: string
  workspaceRoot?: string
  additionalContext?: string
  context: { workspace: boolean; folders: boolean; activeFile: boolean; selection: boolean; openFiles: boolean; tools: boolean }
}
