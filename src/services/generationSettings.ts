export interface GenerationSettings {
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  repeatPenalty?: number
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
    ...(settings.maxTokens === undefined ? {} : { maxTokens: settings.maxTokens })
  }
}
