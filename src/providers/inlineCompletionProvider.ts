import * as vscode from 'vscode'

import { GhostConfig, ghostConfig } from '../config'
import type { GhostSettings } from '../config'
import { FimCompletionOptions, fetchFimCompletion } from '../services/ollamaClient'
import { createOpenAiTransportSettings } from '../services/openAiTransport'
import { isFimCompatibleProfile, resolveOpenAiProfileEndpoint } from '../services/providerProfiles'
import { resolveModelSettings } from '../services/modelProfiles'

export type FimCompletionFetcher = (
  baseUrl: string,
  options: FimCompletionOptions
) => Promise<string>

const DEFAULT_DEBOUNCE_MS = 300
const MIN_PREFIX_LENGTH = 3
const MAX_SUFFIX_CHARACTERS = 4000
const MIN_ADAPTIVE_DEBOUNCE_MS = 100
const MAX_ADAPTIVE_DEBOUNCE_MS = 900
const INLINE_CACHE_TTL_MS = 30_000
const INLINE_CACHE_MAX_ENTRIES = 64

interface InlineCompletionCacheEntry {
  completion: string
  expiresAt: number
}

function createCancellationSignal(token: vscode.CancellationToken): {
  signal: AbortSignal
  dispose: () => void
  cancel: () => void
} {
  const controller = new AbortController()
  const subscription = token.onCancellationRequested(() => controller.abort())

  if (token.isCancellationRequested) {
    controller.abort()
  }

  return {
    signal: controller.signal,
    cancel: () => controller.abort(),
    dispose: () => subscription.dispose()
  }
}

export function waitForDebounce(milliseconds: number, token: vscode.CancellationToken): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    let subscription: vscode.Disposable
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        subscription.dispose()
        resolve(true)
      }
    }, milliseconds)

    subscription = token.onCancellationRequested(() => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        subscription.dispose()
        resolve(false)
      }
    })

    if (token.isCancellationRequested) {
      clearTimeout(timeout)
      subscription.dispose()
      settled = true
      resolve(false)
    }
  })
}

function getDocumentPrefixAndSuffix(document: vscode.TextDocument, position: vscode.Position): {
  prefix: string
  suffix: string
} {
  const start = new vscode.Position(0, 0)
  const end = new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)

  return {
    prefix: document.getText(new vscode.Range(start, position)),
    suffix: document.getText(new vscode.Range(position, end)).slice(0, MAX_SUFFIX_CHARACTERS)
  }
}

function getLinePrefix(document: vscode.TextDocument, position: vscode.Position): string {
  return document.lineAt(position.line).text.slice(0, position.character)
}

function getInlineCompletionCacheKey(
  document: vscode.TextDocument,
  position: vscode.Position,
  prefix: string,
  suffix: string,
  settings: GhostSettings,
  modelSettings: ReturnType<typeof resolveModelSettings>
): string {
  const endpoint = modelSettings.provider === 'openai-compatible'
    ? resolveOpenAiProfileEndpoint(settings.openaiProfile, settings.openaiUrl)
    : settings.ollamaUrl
  return JSON.stringify({
    document: {
      uri: document.uri.toString(),
      version: document.version,
      language: document.languageId
    },
    position: { line: position.line, character: position.character },
    prefix,
    suffix,
    endpoint,
    timeoutMs: settings.inlineCompletionTimeoutMs,
    provider: modelSettings.provider,
    model: modelSettings.model,
    profile: modelSettings.profileName,
    generation: {
      temperature: modelSettings.temperature,
      topP: modelSettings.topP,
      topK: modelSettings.topK,
      minP: modelSettings.minP,
      presencePenalty: modelSettings.presencePenalty,
      repeatPenalty: modelSettings.repeatPenalty,
      seed: modelSettings.seed,
      stopSequences: modelSettings.stopSequences,
      contextWindow: modelSettings.contextWindow,
      grammar: modelSettings.grammar,
      maxTokens: modelSettings.maxTokens
    },
    transport: {
      openaiProfile: settings.openaiProfile,
      openaiApiVersion: settings.openaiApiVersion,
      openaiApiKeyHeader: settings.openaiApiKeyHeader,
      openaiApiKeyPrefix: settings.openaiApiKeyPrefix,
      openaiOrganizationHeader: settings.openaiOrganizationHeader,
      openaiOrganization: settings.openaiOrganization,
      openaiProjectHeader: settings.openaiProjectHeader,
      openaiProject: settings.openaiProject,
      openaiProxy: settings.openaiProxy,
      openaiNoProxy: settings.openaiNoProxy,
      openaiTlsRejectUnauthorized: settings.openaiTlsRejectUnauthorized,
      openaiTlsCaFile: settings.openaiTlsCaFile,
      openaiTlsCertFile: settings.openaiTlsCertFile,
      openaiTlsKeyFile: settings.openaiTlsKeyFile
    }
  })
}

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private readonly configuration: GhostConfig
  private readonly fetchCompletion: FimCompletionFetcher
  private readonly apiKeyProvider?: () => string | undefined
  private readonly debounceMs: number
  private readonly completionCache = new Map<string, InlineCompletionCacheEntry>()
  private readonly configurationListener: vscode.Disposable
  private requestSequence = 0
  private latencyEstimateMs?: number
  private activeCancellation?: { requestId: number; cancellation: ReturnType<typeof createCancellationSignal> }

  constructor(
    configuration: GhostConfig = ghostConfig,
    fetchCompletion: FimCompletionFetcher = fetchFimCompletion,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    apiKeyProvider?: () => string | undefined
  ) {
    this.configuration = configuration
    this.fetchCompletion = fetchCompletion
    this.debounceMs = debounceMs
    this.apiKeyProvider = apiKeyProvider
    this.configurationListener = configuration.onDidChange(() => {
      this.activeCancellation?.cancellation.cancel()
      this.completionCache.clear()
    })
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    const settings = this.configuration.getSettings()
    const modelSettings = resolveModelSettings(settings, 'autocomplete')

    if (!settings.enableInlineCompletions || token.isCancellationRequested) {
      return []
    }

    if (modelSettings.provider === 'openai-compatible' && !isFimCompatibleProfile(settings.openaiProfile)) {
      return []
    }

    const requestId = ++this.requestSequence
    this.activeCancellation?.cancellation.cancel()
    const { prefix, suffix } = getDocumentPrefixAndSuffix(document, position)
    const linePrefix = getLinePrefix(document, position)

    if (linePrefix.trim().length < MIN_PREFIX_LENGTH && !suffix.trim()) {
      return []
    }

    const cancellation = createCancellationSignal(token)
    this.activeCancellation = { requestId, cancellation }
    const cacheKey = getInlineCompletionCacheKey(document, position, prefix, suffix, settings, modelSettings)
    const cached = this.getCachedCompletion(cacheKey)
    if (cached) {
      cancellation.dispose()
      if (this.activeCancellation?.requestId === requestId) {
        this.activeCancellation = undefined
      }
      return [new vscode.InlineCompletionItem(cached, new vscode.Range(position, position))]
    }

    const debounceCompleted = await waitForDebounce(this.getAdaptiveDebounceMs(linePrefix, suffix), token)

    if (!debounceCompleted || requestId !== this.requestSequence || token.isCancellationRequested) {
      cancellation.dispose()
      if (this.activeCancellation?.requestId === requestId) {
        this.activeCancellation = undefined
      }
      return []
    }

    const startedAt = Date.now()
    try {
      const useOpenAiCompatible = modelSettings.provider === 'openai-compatible' && isFimCompatibleProfile(settings.openaiProfile)
      const inlineTimeoutMs = Number.isFinite(settings.inlineCompletionTimeoutMs)
        ? Math.max(1000, Math.min(120000, Math.floor(settings.inlineCompletionTimeoutMs)))
        : 30000
      const completion = await this.fetchCompletion(
        useOpenAiCompatible ? resolveOpenAiProfileEndpoint(settings.openaiProfile, settings.openaiUrl) : settings.ollamaUrl,
        {
          model: modelSettings.model,
          prefix,
          suffix,
          generation: {
            temperature: modelSettings.temperature,
            topP: modelSettings.topP,
            topK: modelSettings.topK,
            minP: modelSettings.minP,
            presencePenalty: modelSettings.presencePenalty,
            repeatPenalty: modelSettings.repeatPenalty,
            seed: modelSettings.seed,
            stop: modelSettings.stopSequences,
            contextWindow: modelSettings.contextWindow,
            grammar: modelSettings.grammar,
            maxTokens: modelSettings.maxTokens
          },
          mode: useOpenAiCompatible ? 'openai-compatible' : 'ollama',
          timeoutMs: inlineTimeoutMs,
          ...(useOpenAiCompatible && this.apiKeyProvider?.() ? { apiKey: this.apiKeyProvider() } : {}),
          ...(useOpenAiCompatible ? { openAiTransport: createOpenAiTransportSettings(settings) } : {}),
          signal: cancellation.signal
        }
      )

      if (!completion || token.isCancellationRequested || requestId !== this.requestSequence) {
        return []
      }

      this.cacheCompletion(cacheKey, completion)
      return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))]
    } catch {
      return []
    } finally {
      this.latencyEstimateMs = this.latencyEstimateMs === undefined
        ? Date.now() - startedAt
        : Math.round(this.latencyEstimateMs * 0.7 + (Date.now() - startedAt) * 0.3)
      cancellation.dispose()
      if (this.activeCancellation?.requestId === requestId) {
        this.activeCancellation = undefined
      }
    }
  }

  private getAdaptiveDebounceMs(linePrefix: string, suffix: string): number {
    const shortLineAdjustment = linePrefix.trim().length < 12 ? 80 : 0
    const contextAdjustment = Math.min(160, Math.floor(suffix.length / 500) * 20)
    const latencyAdjustment = Math.min(360, Math.floor((this.latencyEstimateMs ?? 0) / 1000) * 40)
    return Math.max(
      MIN_ADAPTIVE_DEBOUNCE_MS,
      Math.min(MAX_ADAPTIVE_DEBOUNCE_MS, this.debounceMs + shortLineAdjustment + contextAdjustment + latencyAdjustment)
    )
  }

  private getCachedCompletion(key: string): string | undefined {
    const entry = this.completionCache.get(key)
    if (!entry) {
      return undefined
    }
    if (entry.expiresAt <= Date.now()) {
      this.completionCache.delete(key)
      return undefined
    }
    this.completionCache.delete(key)
    this.completionCache.set(key, entry)
    return entry.completion
  }

  private cacheCompletion(key: string, completion: string): void {
    this.completionCache.delete(key)
    this.completionCache.set(key, {
      completion,
      expiresAt: Date.now() + INLINE_CACHE_TTL_MS
    })
    while (this.completionCache.size > INLINE_CACHE_MAX_ENTRIES) {
      const oldestKey = this.completionCache.keys().next().value
      if (!oldestKey) {
        break
      }
      this.completionCache.delete(oldestKey)
    }
  }

  dispose(): void {
    this.configurationListener.dispose()
    this.activeCancellation?.cancellation.cancel()
    this.activeCancellation = undefined
    this.completionCache.clear()
  }
}

export function createInlineCompletionProvider(
  configuration?: GhostConfig,
  fetchCompletion?: FimCompletionFetcher,
  debounceMs?: number,
  apiKeyProvider?: () => string | undefined
): InlineCompletionProvider {
  return new InlineCompletionProvider(configuration, fetchCompletion, debounceMs, apiKeyProvider)
}
