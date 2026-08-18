import type { GhostProvider, GhostSettings } from '../config'

export type GhostModelRole = 'chat' | 'agent' | 'vision' | 'autocomplete'

export interface GhostModelProfile {
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
  seed?: number
  stopSequences?: string[]
  contextWindow?: number
  grammar?: string
  maxContextTokens?: number
  maxTokens?: number
}

export type GhostModelAliases = Record<string, string>
export type GhostModelProfiles = Record<string, GhostModelProfile>

export const BUILT_IN_MODEL_PROFILES: GhostModelProfiles = {
  coding: {
    temperature: 0.2,
    topP: 0.9,
    topK: 20,
    minP: 0.05,
    repeatPenalty: 1.1,
    maxContextTokens: 16384,
    maxTokens: 2048
  },
  balanced: {
    temperature: 0.3,
    topP: 0.9,
    topK: 20,
    minP: 0.05,
    repeatPenalty: 1.05,
    maxContextTokens: 8192,
    maxTokens: 1024
  },
  creative: {
    temperature: 0.8,
    topP: 0.95,
    topK: 40,
    minP: 0.02,
    repeatPenalty: 1.02,
    maxContextTokens: 8192,
    maxTokens: 2048
  }
}

export interface ModelSettingsOverrides {
  provider?: GhostProvider
  model?: string
  temperature?: number
  topP?: number
  topK?: number
  minP?: number
  presencePenalty?: number
  repeatPenalty?: number
  seed?: number
  stopSequences?: string[]
  contextWindow?: number
  grammar?: string
  maxContextTokens?: number
  maxTokens?: number
}

export interface ResolvedModelSettings {
  role: GhostModelRole
  profileName?: string
  provider: GhostProvider
  model: string
  temperature: number
  topP: number
  topK: number
  minP: number
  presencePenalty: number
  repeatPenalty: number
  seed?: number
  stopSequences: string[]
  contextWindow?: number
  grammar?: string
  maxContextTokens: number
  maxTokens?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isProvider = (value: unknown): value is GhostProvider => (
  value === 'ollama' || value === 'mlx-vlm' || value === 'openai-compatible'
)

const finiteNumber = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const nonEmptyString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
)

export function normalizeModelAliases(value: unknown): GhostModelAliases {
  if (!isRecord(value)) {
    return {}
  }

  return Object.entries(value).reduce<GhostModelAliases>((aliases, [key, target]) => {
    const alias = key.trim()
    const model = nonEmptyString(target)
    if (alias && model) {
      aliases[alias] = model
    }
    return aliases
  }, {})
}

function normalizeProfile(value: unknown): GhostModelProfile | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const profile: GhostModelProfile = {}
  if (isProvider(value.provider)) profile.provider = value.provider
  for (const key of ['model', 'chatModel', 'agentModel', 'visionModel', 'autocompleteModel'] as const) {
    const model = nonEmptyString(value[key])
    if (model) profile[key] = model
  }
  for (const key of ['temperature', 'topP', 'topK', 'minP', 'presencePenalty', 'repeatPenalty', 'maxContextTokens', 'maxTokens'] as const) {
    const number = finiteNumber(value[key])
    if (number !== undefined) profile[key] = number
  }
  const seed = finiteNumber(value.seed)
  if (seed !== undefined) profile.seed = Math.floor(seed)
  if (Array.isArray(value.stopSequences)) profile.stopSequences = value.stopSequences.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  const contextWindow = finiteNumber(value.contextWindow)
  if (contextWindow !== undefined) profile.contextWindow = Math.floor(contextWindow)
  const grammar = nonEmptyString(value.grammar)
  if (grammar) profile.grammar = grammar
  return profile
}

function normalizeProfiles(value: unknown): GhostModelProfiles {
  if (!isRecord(value)) {
    return {}
  }

  return Object.entries(value).reduce<GhostModelProfiles>((profiles, [name, value]) => {
    const profileName = name.trim()
    const profile = normalizeProfile(value)
    if (profileName && profile) {
      profiles[profileName] = profile
    }
    return profiles
  }, {})
}

export function resolveModelAlias(model: string, aliases: GhostModelAliases): string {
  let resolved = model.trim()
  const visited = new Set<string>()
  for (let index = 0; index < 8 && resolved && !visited.has(resolved); index += 1) {
    visited.add(resolved)
    const next = aliases[resolved]?.trim()
    if (!next) {
      break
    }
    resolved = next
  }
  return resolved
}

function profileModel(profile: GhostModelProfile | undefined, role: GhostModelRole): string | undefined {
  if (!profile) return undefined
  if (role === 'autocomplete') return profile.autocompleteModel ?? profile.model
  if (role === 'chat') return profile.chatModel ?? profile.model
  if (role === 'agent') return profile.agentModel ?? profile.chatModel ?? profile.model
  return profile.visionModel ?? profile.chatModel ?? profile.model
}

export function resolveModelSettings(
  settings: GhostSettings,
  role: GhostModelRole,
  profileName = settings.modelProfile,
  overrides: ModelSettingsOverrides = {}
): ResolvedModelSettings {
  const profiles = { ...BUILT_IN_MODEL_PROFILES, ...normalizeProfiles(settings.modelProfiles) }
  const selectedName = nonEmptyString(profileName)
  const profile = selectedName ? profiles[selectedName] : undefined
  const baseModel = role === 'autocomplete' ? settings.autocompleteModel : settings.chatModel
  const model = resolveModelAlias(profileModel(profile, role) ?? overrides.model ?? baseModel, normalizeModelAliases(settings.modelAliases))
  const value = <K extends keyof ModelSettingsOverrides>(key: K, fallback: number): number => (
    profile?.[key] ?? overrides[key] ?? fallback
  ) as number

  return {
    role,
    profileName: profile ? selectedName : undefined,
    provider: profile?.provider ?? overrides.provider ?? settings.provider,
    model,
    temperature: value('temperature', settings.temperature),
    topP: value('topP', settings.topP),
    topK: value('topK', settings.topK),
    minP: value('minP', settings.minP),
    presencePenalty: value('presencePenalty', settings.presencePenalty),
    repeatPenalty: value('repeatPenalty', settings.repeatPenalty),
    seed: profile?.seed ?? overrides.seed ?? settings.seed,
    stopSequences: profile?.stopSequences ?? overrides.stopSequences ?? settings.stopSequences,
    contextWindow: profile?.contextWindow ?? overrides.contextWindow ?? settings.contextWindow,
    grammar: profile?.grammar ?? overrides.grammar ?? settings.grammar,
    maxContextTokens: Math.max(1, Math.floor(value('maxContextTokens', overrides.maxContextTokens ?? settings.maxContextTokens))),
    maxTokens: profile?.maxTokens ?? overrides.maxTokens
  }
}
