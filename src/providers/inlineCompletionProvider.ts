import * as vscode from 'vscode'

import { GhostConfig, ghostConfig } from '../config'
import { FimCompletionOptions, fetchFimCompletion } from '../services/ollamaClient'
import { createOpenAiTransportSettings } from '../services/openAiTransport'
import { isFimCompatibleProfile, resolveOpenAiProfileEndpoint } from '../services/providerProfiles'
import { resolveModelSettings } from '../services/modelProfiles'

export type FimCompletionFetcher = (
  baseUrl: string,
  options: FimCompletionOptions
) => Promise<string>

const DEFAULT_DEBOUNCE_MS = 300

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
    suffix: document.getText(new vscode.Range(position, end))
  }
}

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private readonly configuration: GhostConfig
  private readonly fetchCompletion: FimCompletionFetcher
  private readonly apiKeyProvider?: () => string | undefined
  private readonly debounceMs: number
  private requestSequence = 0

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
    const { prefix, suffix } = getDocumentPrefixAndSuffix(document, position)

    if (!prefix && !suffix) {
      return []
    }

    const debounceCompleted = await waitForDebounce(this.debounceMs, token)

    if (!debounceCompleted || requestId !== this.requestSequence || token.isCancellationRequested) {
      return []
    }

    const cancellation = createCancellationSignal(token)

    try {
      const useOpenAiCompatible = modelSettings.provider === 'openai-compatible' && isFimCompatibleProfile(settings.openaiProfile)
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
          ...(useOpenAiCompatible && this.apiKeyProvider?.() ? { apiKey: this.apiKeyProvider() } : {}),
          ...(useOpenAiCompatible ? { openAiTransport: createOpenAiTransportSettings(settings) } : {}),
          signal: cancellation.signal
        }
      )

      if (!completion || token.isCancellationRequested || requestId !== this.requestSequence) {
        return []
      }

      return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))]
    } catch {
      return []
    } finally {
      cancellation.dispose()
    }
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
