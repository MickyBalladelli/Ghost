import * as path from 'node:path'

import type { ModelPricing, ProviderClient } from './providerAdapter'
import type { ChatRequestOptions } from './chatTypes'
import { redactSensitiveText, redactSensitiveValue } from '../privacy/redact'

export const DEFAULT_OPEN_CODE_URL = 'http://127.0.0.1:4096'
export const MINIMUM_OPEN_CODE_VERSION = '1.0.0'

export const openCodeSessionStorageKey = (directory: string): string => `ghost.opencode.session.${path.resolve(directory)}`

export type OpenCodePermissionResponse = 'once' | 'reject'
export type OpenCodePermissionDecision = OpenCodePermissionResponse | { response: OpenCodePermissionResponse; reason?: string }

export interface OpenCodeQuestionOption {
  label: string
  description: string
}

export interface OpenCodeQuestion {
  question: string
  header: string
  options: OpenCodeQuestionOption[]
  multiple: boolean
  custom: boolean
}

export interface OpenCodeQuestionRequest {
  id: string
  sessionID: string
  questions: OpenCodeQuestion[]
}

export interface OpenCodeHealth {
  healthy: boolean
  version?: string
  compatible: boolean
  error?: string
}

export interface OpenCodeModelMetadata {
  id: string
  providerID: string
  displayName?: string
  contextWindow?: number
  outputLimit?: number
  pricing?: ModelPricing
  pricingStatus: 'free' | 'paid' | 'unknown'
}

export interface OpenCodeSession {
  id: string
  directory: string
  title: string
  version?: string
  time?: { created?: number; updated?: number }
}

export interface OpenCodePermissionRequest {
  id: string
  sessionID: string
  type: string
  title: string
  metadata: Record<string, unknown>
  pattern?: string | string[]
}

export interface OpenCodeRunOptions {
  prompt: string
  directory: string
  sessionId?: string
  title?: string
  model?: string
  agent?: string
  system?: string
  timeoutMs?: number
  signal?: AbortSignal
  onText?: (text: string) => void
  onProgress?: (detail: string) => void
  onPermission?: (permission: OpenCodePermissionRequest) => Promise<OpenCodePermissionDecision>
  onQuestion?: (question: OpenCodeQuestionRequest) => Promise<string[][] | undefined>
  requireMutationApprovals?: boolean
}

export interface OpenCodeRunResult {
  sessionId: string
  text: string
  changedFiles: string[]
  toolCount: number
}

interface OpenCodeClientOptions {
  username?: string
  password?: () => string | undefined
  fetchImpl?: typeof fetch
}

interface OpenCodeEvent {
  type?: string
  properties?: Record<string, unknown>
}

const workspaceRuns = new Map<string, Promise<void>>()

const errorText = (value: unknown): string => value instanceof Error ? value.message : String(value)

const record = (value: unknown): Record<string, unknown> | undefined => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
)

const textValue = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined

const limitErrorText = (value: string): string => value.length > 2000 ? `${value.slice(0, 2000)}…` : value

const nestedErrorMessage = (value: unknown, seen = new Set<object>()): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value instanceof Error && value.message) return value.message
  if (!value || typeof value !== 'object') return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = nestedErrorMessage(item, seen)
      if (message) return message
    }
    return undefined
  }
  const object = record(value)
  if (!object) return undefined
  for (const key of ['data', 'error', 'detail', 'cause', 'message', 'reason', 'name', 'code', 'status']) {
    const message = nestedErrorMessage(object[key], seen)
    if (message) return message
  }
  return undefined
}

const serializedErrorDetail = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  try {
    const serialized = JSON.stringify(redactSensitiveValue(value))
    return serialized && serialized !== '{}' ? serialized : undefined
  } catch {
    return undefined
  }
}

const openCodeSessionError = (event: OpenCodeEvent): string => {
  const properties = record(event.properties)
  const details = [
    properties?.error,
    properties?.message,
    properties?.detail,
    properties?.reason,
    properties?.cause,
    properties?.data
  ]
  for (const detail of details) {
    const message = nestedErrorMessage(detail)
    if (message) return `OpenCode session error: ${limitErrorText(redactSensitiveText(message))}`
    const serialized = serializedErrorDetail(detail)
    if (serialized) return `OpenCode session error: ${limitErrorText(serialized)}`
  }
  const serializedProperties = serializedErrorDetail(properties)
  return serializedProperties
    ? `OpenCode session error: ${limitErrorText(serializedProperties)}`
    : 'OpenCode session failed without an error detail. Check the OpenCode server log.'
}

const finiteValue = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined

const modelPricing = (value: Record<string, unknown> | undefined): Pick<OpenCodeModelMetadata, 'pricing' | 'pricingStatus'> => {
  const rawCost = value?.cost
  const costEntries = Array.isArray(rawCost) ? rawCost : [rawCost]
  const entries = costEntries
    .map(entry => record(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
  const values = entries.flatMap(entry => {
    const cache = record(entry.cache)
    return [
      finiteValue(entry.input),
      finiteValue(entry.output),
      finiteValue(cache?.read),
      finiteValue(cache?.write)
    ].filter((item): item is number => item !== undefined)
  })
  if (values.length === 0) {
    return { pricingStatus: 'unknown' }
  }
  const first = entries[0]
  const firstCache = record(first?.cache)
  const input = finiteValue(first?.input)
  const output = finiteValue(first?.output)
  const cacheRead = finiteValue(firstCache?.read)
  const cacheWrite = finiteValue(firstCache?.write)
  const pricing: ModelPricing = {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(cacheRead === undefined ? {} : { cacheRead }),
    ...(cacheWrite === undefined ? {} : { cacheWrite })
  }
  return {
    pricing,
    pricingStatus: values.some(item => item > 0) ? 'paid' : 'free'
  }
}

const versionParts = (version: string): number[] => version
  .replace(/^v/i, '')
  .split(/[.-]/)
  .slice(0, 3)
  .map(value => Number.parseInt(value, 10))
  .map(value => Number.isFinite(value) ? value : 0)

export function isSupportedOpenCodeVersion(version: string, minimum = MINIMUM_OPEN_CODE_VERSION): boolean {
  const actual = versionParts(version)
  const required = versionParts(minimum)
  if (actual[0] !== required[0]) return false
  for (let index = 0; index < 3; index += 1) {
    if ((actual[index] ?? 0) > (required[index] ?? 0)) return true
    if ((actual[index] ?? 0) < (required[index] ?? 0)) return false
  }
  return true
}

function modelSelection(model: string | undefined): { providerID: string; modelID: string } | undefined {
  const normalized = model?.trim()
  if (!normalized) return undefined
  const separator = normalized.indexOf('/')
  if (separator <= 0 || separator === normalized.length - 1) return undefined
  return {
    providerID: normalized.slice(0, separator),
    modelID: normalized.slice(separator + 1)
  }
}

function messageText(payload: unknown): string {
  const body = record(payload)
  const parts = Array.isArray(body?.parts) ? body.parts : []
  return parts
    .map(part => record(part))
    .filter((part): part is Record<string, unknown> => Boolean(part))
    .filter(part => part.type === 'text')
    .map(part => textValue(part.text) ?? '')
    .join('')
}

function permissionFromEvent(event: OpenCodeEvent): OpenCodePermissionRequest | undefined {
  if (event.type !== 'permission.asked' && event.type !== 'permission.updated' && event.type !== 'permission.v2.asked') {
    return undefined
  }
  const properties = record(event.properties)
  return properties ? permissionFromRecord(properties) : undefined
}

function permissionFromRecord(properties: Record<string, unknown>): OpenCodePermissionRequest | undefined {
  if (!properties) return undefined
  const id = textValue(properties.id) ?? textValue(properties.permissionID) ?? textValue(properties.requestID)
  const sessionID = textValue(properties.sessionID)
  if (!id || !sessionID) return undefined
  return {
    id,
    sessionID,
    type: textValue(properties.type) ?? textValue(properties.permission) ?? textValue(properties.tool) ?? 'unknown',
    title: textValue(properties.title) ?? 'OpenCode requests permission',
    metadata: record(properties.metadata) ?? {},
    ...(typeof properties.pattern === 'string' || Array.isArray(properties.pattern)
      ? { pattern: properties.pattern as string | string[] }
      : {})
  }
}

function questionFromEvent(event: OpenCodeEvent): OpenCodeQuestionRequest | undefined {
  if (event.type !== 'question.asked' && event.type !== 'question.v2.asked') return undefined
  const properties = record(event.properties)
  if (!properties) return undefined
  const id = textValue(properties.id) ?? textValue(properties.requestID) ?? textValue(properties.questionID)
  const sessionID = textValue(properties.sessionID)
  const questions = Array.isArray(properties.questions)
    ? properties.questions.flatMap(value => {
        const question = record(value)
        const text = textValue(question?.question)
        const header = textValue(question?.header)
        if (!text || !header || !Array.isArray(question?.options)) return []
        const options = question.options.flatMap(optionValue => {
          const option = record(optionValue)
          const label = textValue(option?.label)
          const description = textValue(option?.description) ?? ''
          return label ? [{ label, description }] : []
        })
        return options.length > 0 || question.custom === true
          ? [{
              question: text,
              header,
              options,
              multiple: question.multiple === true,
              custom: question.custom === true
            }]
          : []
      })
    : []
  if (!id || !sessionID || questions.length === 0) return undefined
  return { id, sessionID, questions }
}

function eventSessionId(event: OpenCodeEvent): string | undefined {
  const properties = record(event.properties)
  return textValue(properties?.sessionID)
    ?? textValue(record(properties?.part)?.sessionID)
    ?? textValue(record(properties?.info)?.sessionID)
}

function eventSessionStatus(event: OpenCodeEvent): 'idle' | 'busy' | 'retry' | undefined {
  if (event.type === 'session.idle') return 'idle'
  if (event.type !== 'session.status') return undefined
  const status = record(record(event.properties)?.status)
  const type = textValue(status?.type)
  return type === 'idle' || type === 'busy' || type === 'retry' ? type : undefined
}

function eventTextDelta(event: OpenCodeEvent): string | undefined {
  const properties = record(event.properties)
  if (!properties) return undefined
  if (event.type === 'message.part.delta' && properties.field === 'text') {
    return textValue(properties.delta)
  }
  if (event.type !== 'message.part.updated') return undefined
  const part = record(properties.part)
  if (part?.type !== 'text') return undefined
  return textValue(properties.delta)
}

function eventToolProgress(event: OpenCodeEvent): string | undefined {
  if (event.type !== 'message.part.updated') return undefined
  const part = record(record(event.properties)?.part)
  if (part?.type !== 'tool') return undefined
  const tool = textValue(part.tool) ?? textValue(part.name) ?? 'tool'
  const state = record(part.state)
  const status = textValue(state?.status) ?? textValue(part.status) ?? 'running'
  return `OpenCode ${tool}: ${status}`
}

function eventToolError(event: OpenCodeEvent, permissionRejectionReason?: string): string | undefined {
  if (event.type !== 'message.part.updated') return undefined
  const part = record(record(event.properties)?.part)
  if (part?.type !== 'tool') return undefined
  const state = record(part.state)
  const status = textValue(state?.status) ?? textValue(part.status)
  if (status !== 'error' && status !== 'failed') return undefined
  const tool = textValue(part.tool) ?? textValue(part.name) ?? 'tool'
  const detail = nestedErrorMessage(state?.error)
    ?? nestedErrorMessage(state?.output)
    ?? nestedErrorMessage(part.error)
    ?? nestedErrorMessage(part.output)
  const safeDetail = permissionRejectionReason && /user rejected permission/i.test(detail ?? '')
    ? permissionRejectionReason
    : detail
      ? limitErrorText(redactSensitiveText(detail))
      : undefined
  return `OpenCode ${tool} failed${safeDetail ? `: ${safeDetail}` : '.'}`
}

function changedFilesFromEvent(event: OpenCodeEvent): string[] {
  const properties = record(event.properties)
  if (event.type === 'file.edited') {
    const file = textValue(properties?.file)
    return file ? [file] : []
  }
  if (event.type !== 'session.diff') return []
  const diff = Array.isArray(properties?.diff) ? properties.diff : []
  return diff.flatMap(item => {
    const entry = record(item)
    const file = textValue(entry?.file) ?? textValue(entry?.path) ?? textValue(entry?.filename)
    return file ? [file] : []
  })
}

function permissionDecision(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const rules = record(value)
  if (!rules) return undefined
  const decisions = Object.values(rules).filter(item => typeof item === 'string') as string[]
  if (decisions.includes('allow')) return 'allow'
  if (decisions.includes('ask')) return 'ask'
  if (decisions.length > 0 && decisions.every(item => item === 'deny')) return 'deny'
  return undefined
}

function guardedPermission(config: Record<string, unknown>, agent: string | undefined, action: string): boolean {
  const root = config.permission
  const rootRecord = record(root)
  let value = typeof root === 'string' ? root : rootRecord?.[action] ?? rootRecord?.['*']
  if (agent) {
    const agentConfig = record(record(config.agent)?.[agent])
    const agentPermission = agentConfig?.permission
    const agentPermissionRecord = record(agentPermission)
    value = typeof agentPermission === 'string'
      ? agentPermission
      : agentPermissionRecord?.[action] ?? agentPermissionRecord?.['*'] ?? value
  }
  const decision = permissionDecision(value)
  return decision === 'ask' || decision === 'deny'
}

export class OpenCodeClient implements ProviderClient {
  private readonly username: string
  private readonly password?: () => string | undefined
  private readonly fetchImpl: typeof fetch

  constructor(private readonly baseUrl: string = DEFAULT_OPEN_CODE_URL, options: OpenCodeClientOptions = {}) {
    const endpoint = new URL(baseUrl)
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
      throw new Error('OpenCode URL must use HTTP or HTTPS')
    }
    if (endpoint.username || endpoint.password) {
      throw new Error('Do not put OpenCode credentials in the URL. Use VS Code SecretStorage.')
    }
    this.username = options.username?.trim() || 'opencode'
    this.password = options.password
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async health(timeoutMs = 3000, signal?: AbortSignal): Promise<OpenCodeHealth> {
    try {
      const payload = await this.request('/global/health', { method: 'GET', timeoutMs, signal })
      const body = record(payload)
      const version = textValue(body?.version)
      const healthy = body?.healthy === true
      return {
        healthy,
        version,
        compatible: healthy && Boolean(version && isSupportedOpenCodeVersion(version))
      }
    } catch (error) {
      return { healthy: false, compatible: false, error: errorText(error) }
    }
  }

  async checkHealth(timeoutMs = 3000): Promise<boolean> {
    const health = await this.health(timeoutMs)
    return health.healthy && health.compatible
  }

  async listModelsWithMetadata(signal?: AbortSignal): Promise<OpenCodeModelMetadata[]> {
    const payload = await this.request('/provider', { method: 'GET', signal })
    const body = record(payload)
    const providers = Array.isArray(body?.all) ? body.all : Array.isArray(body?.providers) ? body.providers : []
    const connected = new Set(Array.isArray(body?.connected) ? body.connected.filter(item => typeof item === 'string') as string[] : [])
    const models: OpenCodeModelMetadata[] = []
    for (const value of providers) {
      const provider = record(value)
      const providerID = textValue(provider?.id) ?? textValue(provider?.providerID)
      if (!providerID || (connected.size > 0 && !connected.has(providerID))) continue
      const providerModels = provider?.models
      if (Array.isArray(providerModels)) {
        for (const modelValue of providerModels) {
          const model = record(modelValue)
          const modelID = textValue(model?.id) ?? textValue(model?.modelID) ?? textValue(modelValue)
          if (modelID) {
            const limit = record(model?.limit)
            models.push({
              id: `${providerID}/${modelID}`,
              providerID,
              ...(textValue(model?.name) ? { displayName: textValue(model?.name) } : {}),
              ...(finiteValue(limit?.context) === undefined ? {} : { contextWindow: finiteValue(limit?.context) }),
              ...(finiteValue(limit?.output) === undefined ? {} : { outputLimit: finiteValue(limit?.output) }),
              ...modelPricing(model)
            })
          }
        }
      } else {
        const modelRecord = record(providerModels)
        if (modelRecord) {
          for (const [modelID, modelValue] of Object.entries(modelRecord)) {
            const model = record(modelValue)
            const resolvedID = textValue(model?.id) ?? textValue(model?.modelID) ?? modelID
            if (resolvedID) {
              const limit = record(model?.limit)
              models.push({
                id: `${providerID}/${resolvedID}`,
                providerID,
                ...(textValue(model?.name) ? { displayName: textValue(model?.name) } : {}),
                ...(finiteValue(limit?.context) === undefined ? {} : { contextWindow: finiteValue(limit?.context) }),
                ...(finiteValue(limit?.output) === undefined ? {} : { outputLimit: finiteValue(limit?.output) }),
                ...modelPricing(model)
              })
            }
          }
        }
      }
    }
    return [...new Map(models.map(model => [model.id, model])).values()].sort((left, right) => left.id.localeCompare(right.id))
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const models = await this.listModelsWithMetadata(signal)
    return models.map(model => model.id)
  }

  async *streamChatCompletion(options: ChatRequestOptions): AsyncGenerator<string> {
    const prompt = options.messages
      .filter(message => message.role !== 'system')
      .map(message => typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'))
      .join('\n\n')
    const system = options.messages
      .filter(message => message.role === 'system')
      .map(message => typeof message.content === 'string' ? message.content : '')
      .join('\n\n')
    const result = await this.run({
      prompt,
      system,
      model: options.model,
      directory: process.cwd(),
      timeoutMs: options.timeoutMs,
      signal: options.signal
    })
    if (result.text) yield result.text
  }

  async createSession(directory: string, title?: string, signal?: AbortSignal): Promise<OpenCodeSession> {
    const payload = await this.request('/session', {
      method: 'POST',
      directory,
      signal,
      body: title?.trim() ? { title: title.trim() } : {}
    })
    const session = record(payload)
    const id = textValue(session?.id)
    if (!id) throw new Error('OpenCode returned a session without an id')
    return {
      id,
      directory: textValue(session?.directory) ?? directory,
      title: textValue(session?.title) ?? title ?? 'Ghost session',
      version: textValue(session?.version),
      time: record(session?.time) as OpenCodeSession['time']
    }
  }

  async getSession(sessionId: string, directory: string, signal?: AbortSignal): Promise<OpenCodeSession | undefined> {
    try {
      const payload = await this.request(`/session/${encodeURIComponent(sessionId)}`, { method: 'GET', directory, signal })
      const session = record(payload)
      const id = textValue(session?.id)
      if (!id) return undefined
      return {
        id,
        directory: textValue(session?.directory) ?? directory,
        title: textValue(session?.title) ?? 'Ghost session',
        version: textValue(session?.version),
        time: record(session?.time) as OpenCodeSession['time']
      }
    } catch (error) {
      if (/\b404\b|not found/i.test(errorText(error))) return undefined
      throw error
    }
  }

  async listSessions(directory: string, signal?: AbortSignal): Promise<OpenCodeSession[]> {
    const payload = await this.request('/session', { method: 'GET', directory, signal })
    if (!Array.isArray(payload)) return []
    return payload.flatMap(value => {
      const session = record(value)
      const id = textValue(session?.id)
      if (!id) return []
      return [{
        id,
        directory: textValue(session?.directory) ?? directory,
        title: textValue(session?.title) ?? 'Untitled session',
        version: textValue(session?.version),
        time: record(session?.time) as OpenCodeSession['time']
      }]
    })
  }

  async listAgents(directory: string, signal?: AbortSignal): Promise<Array<{ id: string; description?: string }>> {
    const payload = await this.request('/agent', { method: 'GET', directory, signal })
    if (!Array.isArray(payload)) return []
    return payload.flatMap(value => {
      const agent = record(value)
      const id = textValue(agent?.name) ?? textValue(agent?.id)
      if (!id) return []
      return [{ id, description: textValue(agent?.description) }]
    })
  }

  async deleteSession(sessionId: string, directory: string, signal?: AbortSignal): Promise<void> {
    await this.request(`/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE', directory, signal })
  }

  async renameSession(sessionId: string, directory: string, title: string, signal?: AbortSignal): Promise<void> {
    await this.request(`/session/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      directory,
      signal,
      body: { title: title.trim() }
    })
  }

  async forkSession(sessionId: string, directory: string, signal?: AbortSignal): Promise<OpenCodeSession> {
    const payload = await this.request(`/session/${encodeURIComponent(sessionId)}/fork`, {
      method: 'POST',
      directory,
      signal,
      body: {}
    })
    const session = record(payload)
    const id = textValue(session?.id)
    if (!id) throw new Error('OpenCode returned a fork without an id')
    return {
      id,
      directory: textValue(session?.directory) ?? directory,
      title: textValue(session?.title) ?? 'Forked Ghost session',
      version: textValue(session?.version),
      time: record(session?.time) as OpenCodeSession['time']
    }
  }

  async abortSession(sessionId: string, directory: string): Promise<void> {
    await this.request(`/session/${encodeURIComponent(sessionId)}/abort`, {
      method: 'POST',
      directory,
      timeoutMs: 3000
    }).catch(() => undefined)
  }

  async run(options: OpenCodeRunOptions): Promise<OpenCodeRunResult> {
    const workspaceKey = path.resolve(options.directory)
    const previous = workspaceRuns.get(workspaceKey) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => current)
    workspaceRuns.set(workspaceKey, tail)
    try {
      await this.waitForTurn(previous, options.signal)
      return await this.runInWorkspace(options)
    } finally {
      release?.()
      if (workspaceRuns.get(workspaceKey) === tail) workspaceRuns.delete(workspaceKey)
    }
  }

  private async runInWorkspace(options: OpenCodeRunOptions): Promise<OpenCodeRunResult> {
    const health = await this.health(Math.min(options.timeoutMs ?? 5000, 5000), options.signal)
    if (!health.healthy) throw new Error(health.error ?? `OpenCode is offline at ${this.baseUrl}`)
    if (!health.compatible) {
      throw new Error(`Unsupported OpenCode version ${health.version ?? 'unknown'}. Ghost requires ${MINIMUM_OPEN_CODE_VERSION} through the latest compatible 1.x release.`)
    }
    if (options.requireMutationApprovals !== false) {
      let config = record(await this.request('/config', {
        method: 'GET',
        directory: options.directory,
        signal: options.signal
      })) ?? {}
      const agent = options.agent?.trim() || undefined
      let editGuarded = guardedPermission(config, agent, 'edit')
      let bashGuarded = guardedPermission(config, agent, 'bash')
      let externalDirectoryGuarded = guardedPermission(config, agent, 'external_directory')
      if (!editGuarded || !bashGuarded || !externalDirectoryGuarded) {
        throw new Error(`OpenCode safety setup failed for ${options.directory}. Ghost requires guarded edit, bash, and external-directory permissions in ~/.config/opencode/opencode.json. Restart opencode serve after changing that file. Ghost will not create a project opencode.json.`)
      }
    }

    let session = options.sessionId
      ? await this.getSession(options.sessionId, options.directory, options.signal)
      : undefined
    if (session && path.resolve(session.directory) !== path.resolve(options.directory)) {
      session = undefined
    }
    session ??= await this.createSession(options.directory, options.title, options.signal)

    const changedFiles = new Set<string>()
    const permissionReplies = new Set<string>()
    let streamedText = ''
    let toolCount = 0
    let streamError: Error | undefined
    const streamController = new AbortController()
    const messageController = new AbortController()
    let markSessionFinished: ((status: 'idle' | 'error') => void) | undefined
    const onAbort = (): void => {
      markSessionFinished?.('error')
      streamController.abort()
      messageController.abort()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    let permissionRejectionReason: string | undefined
    const handlePermission = async (permission: OpenCodePermissionRequest): Promise<void> => {
      if (permission.sessionID !== session.id || permissionReplies.has(permission.id)) return
      permissionReplies.add(permission.id)
      const decision = options.onPermission ? await options.onPermission(permission) : 'reject'
      const response = typeof decision === 'string' ? decision : decision.response
      permissionRejectionReason = response === 'reject' && typeof decision !== 'string' ? decision.reason : undefined
      await this.replyPermission(permission, response, options.directory, options.signal)
    }
    const questionReplies = new Set<string>()
    const handleQuestion = async (question: OpenCodeQuestionRequest): Promise<void> => {
      if (question.sessionID !== session.id || questionReplies.has(question.id)) return
      questionReplies.add(question.id)
      const answers = options.onQuestion ? await options.onQuestion(question) : undefined
      if (answers) {
        await this.replyQuestion(question, answers, options.directory, options.signal)
      } else {
        await this.rejectQuestion(question, options.directory, options.signal)
      }
    }
    let markStreamConnected: (() => void) | undefined
    const streamConnected = new Promise<void>(resolve => { markStreamConnected = resolve })
    const sessionFinished = new Promise<'idle' | 'error'>(resolve => { markSessionFinished = resolve })
    let sawSessionActivity = false
    const streamPromise = this.consumeEvents(session.id, options.directory, streamController.signal, async event => {
      const status = eventSessionStatus(event)
      if (status === 'busy' || status === 'retry') sawSessionActivity = true
      const delta = eventTextDelta(event)
      if (delta) {
        sawSessionActivity = true
        streamedText += delta
        options.onText?.(delta)
      }
      const progress = eventToolProgress(event)
      if (progress) {
        sawSessionActivity = true
        toolCount += 1
        options.onProgress?.(progress)
      }
      const toolError = eventToolError(event, permissionRejectionReason)
      if (toolError) {
        streamError = new Error(toolError)
        markSessionFinished?.('error')
        streamController.abort()
      }
      const eventFiles = changedFilesFromEvent(event)
      if (eventFiles.length > 0) sawSessionActivity = true
      for (const file of eventFiles) changedFiles.add(file)
      const permission = permissionFromEvent(event)
      if (permission) {
        sawSessionActivity = true
        await handlePermission(permission)
      }
      const question = questionFromEvent(event)
      if (question) {
        sawSessionActivity = true
        await handleQuestion(question)
      }
      if (event.type === 'session.error' && eventSessionId(event) === session.id) {
        streamError = new Error(openCodeSessionError(event))
        markSessionFinished?.('error')
      }
      if (!streamError && status === 'idle' && sawSessionActivity) markSessionFinished?.('idle')
    }, () => markStreamConnected?.()).catch(error => {
      markStreamConnected?.()
      if (!streamController.signal.aborted) {
        streamError = error instanceof Error ? error : new Error(errorText(error))
        markSessionFinished?.('error')
        streamController.abort()
      }
    })
    try {
      let connectionTimeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          streamConnected,
          new Promise<void>((_resolve, reject) => {
            connectionTimeout = setTimeout(() => reject(new Error('OpenCode event stream did not connect within 5000ms')), 5000)
          })
        ])
      } finally {
        if (connectionTimeout) clearTimeout(connectionTimeout)
      }
      if (streamError) throw streamError
      const body: Record<string, unknown> = {
        parts: [{ type: 'text', text: options.prompt }],
        ...(options.system?.trim() ? { system: options.system.trim() } : {}),
        ...(options.agent?.trim() ? { agent: options.agent.trim() } : {})
      }
      const model = modelSelection(options.model)
      if (model) body.model = model
      options.onProgress?.(`OpenCode session ${session.id}`)
      type MessageOutcome = { type: 'message'; payload: unknown } | { type: 'message-error'; error: Error }
      type SessionOutcome = { type: 'session'; status: 'idle' | 'error' }
      const messageRequest = this.request(`/session/${encodeURIComponent(session.id)}/message`, {
        method: 'POST',
        directory: options.directory,
        timeoutMs: options.timeoutMs,
        signal: messageController.signal,
        body
      }).then(payload => ({ type: 'message', payload }) as MessageOutcome).catch(error => ({
        type: 'message-error',
        error: error instanceof Error ? error : new Error(errorText(error))
      }) as MessageOutcome)
      const firstOutcome = await Promise.race<MessageOutcome | SessionOutcome>([
        messageRequest,
        sessionFinished.then(status => ({ type: 'session', status }))
      ])
      let payload: unknown
      if (firstOutcome.type === 'message') {
        payload = firstOutcome.payload
      } else {
        const status = firstOutcome.type === 'session'
          ? firstOutcome.status
          : await sessionFinished
        if (status === 'error') {
          throw streamError ?? (firstOutcome.type === 'message-error'
            ? firstOutcome.error
            : new Error('OpenCode session failed without an error detail. Check the OpenCode server log.'))
        }
        messageController.abort()
        await messageRequest
        payload = await this.latestAssistantMessage(session.id, options.directory, options.signal)
      }
      if (streamError) throw streamError
      const finalText = messageText(payload)
      if (!streamedText && finalText) {
        streamedText = finalText
        options.onText?.(finalText)
      } else if (finalText.startsWith(streamedText) && finalText.length > streamedText.length) {
        const suffix = finalText.slice(streamedText.length)
        streamedText = finalText
        options.onText?.(suffix)
      } else if (finalText && finalText !== streamedText) {
        streamedText = finalText
      }
      const diffs = await this.request(`/session/${encodeURIComponent(session.id)}/diff`, {
        method: 'GET',
        directory: options.directory,
        signal: options.signal
      }).catch(() => [])
      if (Array.isArray(diffs)) {
        for (const item of diffs) {
          const entry = record(item)
          const file = textValue(entry?.file) ?? textValue(entry?.path) ?? textValue(entry?.filename)
          if (file) changedFiles.add(file)
        }
      }
      return { sessionId: session.id, text: streamedText || finalText, changedFiles: [...changedFiles], toolCount }
    } catch (error) {
      await this.abortSession(session.id, options.directory)
      throw error
    } finally {
      messageController.abort()
      streamController.abort()
      options.signal?.removeEventListener('abort', onAbort)
      await streamPromise
    }
  }

  private async waitForTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      await previous
      return
    }
    if (signal.aborted) throw new Error('OpenCode request cancelled')
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error('OpenCode request cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      previous.then(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, reject)
    })
  }

  private async replyPermission(
    permission: OpenCodePermissionRequest,
    response: OpenCodePermissionResponse,
    directory: string,
    signal?: AbortSignal
  ): Promise<void> {
    await this.request(`/session/${encodeURIComponent(permission.sessionID)}/permissions/${encodeURIComponent(permission.id)}`, {
      method: 'POST',
      directory,
      signal,
      body: { response }
    })
  }

  private async replyQuestion(
    question: OpenCodeQuestionRequest,
    answers: string[][],
    directory: string,
    signal?: AbortSignal
  ): Promise<void> {
    await this.request(`/question/${encodeURIComponent(question.id)}/reply`, {
      method: 'POST',
      directory,
      signal,
      body: { answers }
    })
  }

  private async rejectQuestion(
    question: OpenCodeQuestionRequest,
    directory: string,
    signal?: AbortSignal
  ): Promise<void> {
    await this.request(`/question/${encodeURIComponent(question.id)}/reject`, {
      method: 'POST',
      directory,
      signal
    })
  }

  private async latestAssistantMessage(sessionId: string, directory: string, signal?: AbortSignal): Promise<unknown> {
    const payload = await this.request(`/session/${encodeURIComponent(sessionId)}/message?limit=20`, {
      method: 'GET',
      directory,
      signal
    })
    if (!Array.isArray(payload)) return undefined
    return [...payload].reverse().find(value => textValue(record(record(value)?.info)?.role) === 'assistant')
  }

  private async consumeEvents(
    sessionId: string,
    directory: string,
    signal: AbortSignal,
    onEvent: (event: OpenCodeEvent) => Promise<void>,
    onConnected?: () => void
  ): Promise<void> {
    const response = await this.fetchImpl(this.url('/event', directory), {
      method: 'GET',
      headers: this.headers(false),
      signal
    })
    if (!response.ok || !response.body) {
      throw new Error(`OpenCode event stream returned HTTP ${response.status}`)
    }
    onConnected?.()
    const reader = response.body.getReader()
    const cancelReader = (): void => { void reader.cancel().catch(() => undefined) }
    signal.addEventListener('abort', cancelReader, { once: true })
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (!signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n')
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = frame.split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n')
          if (data) {
            let event: OpenCodeEvent | undefined
            try {
              event = JSON.parse(data) as OpenCodeEvent
            } catch {
              // Ignore malformed or forward-incompatible events; the final message remains authoritative.
            }
            const eventSession = event ? eventSessionId(event) : undefined
            if (event && (!eventSession || eventSession === sessionId)) await onEvent(event)
          }
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch (error) {
      if (!signal.aborted) throw error
    } finally {
      signal.removeEventListener('abort', cancelReader)
      if (signal.aborted) await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }

  private url(resource: string, directory?: string): string {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`
    const url = new URL(resource.replace(/^\//, ''), base)
    if (directory) url.searchParams.set('directory', directory)
    return url.toString()
  }

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : { Accept: 'text/event-stream' }
    const password = this.password?.()
    if (password) {
      const endpoint = new URL(this.baseUrl)
      const loopback = endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1' || endpoint.hostname === '[::1]' || endpoint.hostname === '::1'
      if (endpoint.protocol !== 'https:' && !loopback) {
        throw new Error('Ghost will not send an OpenCode password over non-loopback HTTP. Use HTTPS or a loopback URL.')
      }
      headers.Authorization = `Basic ${Buffer.from(`${this.username}:${password}`).toString('base64')}`
    }
    return headers
  }

  private async request(resource: string, options: {
    method: string
    directory?: string
    timeoutMs?: number
    signal?: AbortSignal
    body?: Record<string, unknown>
  }): Promise<unknown> {
    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs ?? 15000))
    try {
      const response = await this.fetchImpl(this.url(resource, options.directory), {
        method: options.method,
        headers: this.headers(options.body !== undefined),
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal
      })
      const text = await response.text()
      if (!response.ok) {
        const detail = text ? redactSensitiveText(text.slice(0, 500)) : ''
        throw new Error(`OpenCode returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
      }
      if (!text.trim()) return undefined
      try {
        return JSON.parse(text) as unknown
      } catch {
        return text
      }
    } catch (error) {
      if (controller.signal.aborted && !options.signal?.aborted) {
        throw new Error(`OpenCode request timed out after ${options.timeoutMs ?? 15000}ms`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }
}
