import type { MlxChatOptions, MlxMessage, MlxMessageContent, MlxResponseFormat, MlxToolDefinition } from './mlxClient'
import { GenerationSettings, normalizeGenerationSettings } from './generationSettings'

interface ChatWireOptions {
  model: string
  generation?: GenerationSettings
  tools?: MlxToolDefinition[]
  toolChoice?: MlxChatOptions['toolChoice']
  responseFormat?: MlxResponseFormat
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
    ...(generation.seed === undefined ? {} : { seed: generation.seed }),
    ...(generation.stop?.length ? { stop: generation.stop } : {}),
    ...(generation.grammar ? { grammar: generation.grammar } : {}),
    max_tokens: generation.maxTokens,
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    stream: true
  }
}

export function buildOllamaChatBody(options: ChatWireOptions, messages: MlxMessage[], stream: boolean): Record<string, unknown> {
  const generation = normalizeGenerationSettings(options.generation)
  return {
    model: options.model,
    messages: toOllamaMessages(messages),
    stream,
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(options.responseFormat ? { format: options.responseFormat.type === 'json_object' ? 'json' : options.responseFormat.json_schema ?? options.responseFormat.type } : {}),
    options: {
      ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
      ...(generation.topP === undefined ? {} : { top_p: generation.topP }),
      ...(generation.topK === undefined ? {} : { top_k: generation.topK }),
      ...(generation.minP === undefined ? {} : { min_p: generation.minP }),
      ...(generation.presencePenalty === undefined ? {} : { presence_penalty: generation.presencePenalty }),
      ...(generation.repeatPenalty === undefined ? {} : { repeat_penalty: generation.repeatPenalty }),
      ...(generation.seed === undefined ? {} : { seed: generation.seed }),
      ...(generation.stop?.length ? { stop: generation.stop } : {}),
      ...(generation.contextWindow === undefined ? {} : { num_ctx: generation.contextWindow }),
      ...(generation.grammar ? { grammar: generation.grammar } : {}),
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
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
    ...(generation.topP === undefined ? {} : { top_p: generation.topP }),
    ...(generation.presencePenalty === undefined ? {} : { presence_penalty: generation.presencePenalty }),
    ...(generation.seed === undefined ? {} : { seed: generation.seed }),
    ...(generation.stop?.length ? { stop: generation.stop } : {}),
    ...(generation.maxTokens === undefined ? {} : { max_tokens: generation.maxTokens })
  }
}

function toOpenAiResponsesInput(messages: MlxMessage[]): Array<{ role: string; content: Array<Record<string, unknown>> }> {
  return messages.map(message => ({
    role: message.role,
    content: typeof message.content === 'string'
      ? [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }]
      : message.content.map(part => part.type === 'text'
        ? { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text }
        : { type: 'input_image', image_url: part.image_url.url, ...(part.image_url.detail ? { detail: part.image_url.detail } : {}) })
  }))
}

export function buildOpenAiResponsesBody(options: ChatWireOptions, messages: MlxMessage[]): Record<string, unknown> {
  const generation = normalizeGenerationSettings(options.generation)
  return {
    model: options.model,
    input: toOpenAiResponsesInput(messages),
    stream: true,
    ...(options.tools?.length ? { tools: options.tools } : {}),
    ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
    ...(options.responseFormat ? { text: { format: options.responseFormat } } : {}),
    ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
    ...(generation.topP === undefined ? {} : { top_p: generation.topP }),
    ...(generation.seed === undefined ? {} : { seed: generation.seed }),
    ...(generation.stop?.length ? { stop: generation.stop } : {}),
    ...(generation.maxTokens === undefined ? {} : { max_output_tokens: generation.maxTokens })
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
