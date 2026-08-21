import { isFimCompatibleProfile } from '../services/providerProfiles'
import type { ProviderId } from '../services/providerAdapter'

export function shouldFetchInlineFim(provider: ProviderId, openaiProfile?: string): boolean {
  if (provider === 'mlx-vlm') {
    return false
  }
  if (provider === 'openai-compatible') {
    return isFimCompatibleProfile(openaiProfile)
  }
  return provider === 'ollama'
}
