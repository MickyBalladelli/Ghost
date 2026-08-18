export interface GenerationSettings {
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  repeatPenalty?: number
  seed?: number
  stop?: string[]
  contextWindow?: number
  grammar?: string
  maxTokens?: number
}

export function normalizeGenerationSettings(settings?: GenerationSettings): GenerationSettings {
  if (!settings) return {}
  return {
    ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
    ...(settings.topP === undefined ? {} : { topP: settings.topP }),
    ...(settings.topK === undefined ? {} : { topK: settings.topK }),
    ...(settings.minP === undefined ? {} : { minP: settings.minP }),
    ...(settings.presencePenalty === undefined ? {} : { presencePenalty: settings.presencePenalty }),
    ...(settings.repeatPenalty === undefined ? {} : { repeatPenalty: settings.repeatPenalty }),
    ...(settings.seed === undefined ? {} : { seed: settings.seed }),
    ...(settings.stop === undefined ? {} : { stop: [...settings.stop] }),
    ...(settings.contextWindow === undefined ? {} : { contextWindow: settings.contextWindow }),
    ...(settings.grammar === undefined ? {} : { grammar: settings.grammar }),
    ...(settings.maxTokens === undefined ? {} : { maxTokens: settings.maxTokens })
  }
}
