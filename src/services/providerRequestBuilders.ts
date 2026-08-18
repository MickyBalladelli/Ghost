import type { MlxChatOptions, MlxMessage, MlxMessageContent } from './mlxClient'
import { GenerationSettings, normalizeGenerationSettings } from './generationSettings'

interface ChatWireOptions {
  model: string
  generation?: GenerationSettings
}

interface FimWireOptions {
  model: string
  generation?: GenerationSettings
}

export interface OllamaWireMessage {
  role: string
  content: string
  images?: string[]
}

function dataUrlToBase64(url: string): string | undefined {
  if (!url.startsWith('data:')) return undefined
  const separator = url.indexOf(',')
  return separator < 0 ? undefined : url.slice(separator + 1)
}

function textFromContent(content: MlxMessageContent): string {
  if (typeof content === 'string') return content
  return content.filter(part => part.type === 'text').map(part => part.text).join('')
}

function imagesFromContent(content: MlxMessageContent): string[] {
  if (typeof content === 'string') return []
  return content.flatMap(part => {
    if (part.type !== 'image_url') return []
    const image = dataUrlToBase64(part.image_url.url)
    return image ? [image] : []
  })
}

export function toOllamaMessages(messages: MlxMessage[]): OllamaWireMessage[] {
  return messages.map(message => {
    const images = imagesFromContent(message.content)
    return {
      role: message.role,
      content: textFromContent(message.content),
      ...(images.length > 0 ? { images } : {})
    }
  })
}

export function buildMlxChatBody(options: MlxChatOptions): Record<string, unknown> {
  const generation = normalizeGenerationSettings(options.generation)
  return {
    model: options.model,
    messages: options.messages,
    temperature: generation.temperature,
    ...(generation.topP === undefined ? {} : { top_p: generation.topP }),
    ...(generation.presencePenalty === undefined ? {} : { presence_penalty: generation.presencePenalty }),
    max_tokens: generation.maxTokens,
    stream: true
  }
}

export function buildOllamaChatBody(options: ChatWireOptions, messages: MlxMessage[], stream: boolean): Record<string, unknown> {
  const generation = normalizeGenerationSettings(options.generation)
  return {
    model: options.model,
    messages: toOllamaMessages(messages),
    stream,
    options: {
      ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
      ...(generation.topP === undefined ? {} : { top_p: generation.topP }),
      ...(generation.topK === undefined ? {} : { top_k: generation.topK }),
      ...(generation.minP === undefined ? {} : { min_p: generation.minP }),
      ...(generation.presencePenalty === undefined ? {} : { presence_penalty: generation.presencePenalty }),
      ...(generation.repeatPenalty === undefined ? {} : { repeat_penalty: generation.repeatPenalty }),
      ...(generation.maxTokens === undefined ? {} : { num_predict: generation.maxTokens })
    }
  }
}

export function buildOpenAiChatBody(options: ChatWireOptions, messages: MlxMessage[], stream: boolean): Record<string, unknown> {
  const generation = normalizeGenerationSettings(options.generation)
  return {
    model: options.model,
    messages,
    stream,
    ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
    ...(generation.topP === undefined ? {} : { top_p: generation.topP }),
    ...(generation.presencePenalty === undefined ? {} : { presence_penalty: generation.presencePenalty }),
    ...(generation.maxTokens === undefined ? {} : { max_tokens: generation.maxTokens })
  }
}

export function buildOllamaFimBody(options: FimWireOptions, prompt: string): Record<string, unknown> {
  const generation = normalizeGenerationSettings(options.generation)
  return {
    model: options.model,
    prompt,
    stream: false,
    options: {
      ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
      ...(generation.topP === undefined ? {} : { top_p: generation.topP }),
      ...(generation.topK === undefined ? {} : { top_k: generation.topK }),
      ...(generation.minP === undefined ? {} : { min_p: generation.minP }),
      ...(generation.presencePenalty === undefined ? {} : { presence_penalty: generation.presencePenalty }),
      ...(generation.repeatPenalty === undefined ? {} : { repeat_penalty: generation.repeatPenalty }),
      ...(generation.maxTokens === undefined ? {} : { num_predict: generation.maxTokens })
    }
  }
}

export function buildOpenAiFimBody(options: FimWireOptions, prompt: string): Record<string, unknown> {
  const generation = normalizeGenerationSettings(options.generation)
  return {
    model: options.model,
    prompt,
    stream: false,
    ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
    ...(generation.topP === undefined ? {} : { top_p: generation.topP }),
    ...(generation.presencePenalty === undefined ? {} : { presence_penalty: generation.presencePenalty }),
    ...(generation.maxTokens === undefined ? {} : { max_tokens: generation.maxTokens })
  }
}
