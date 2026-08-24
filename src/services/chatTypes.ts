import type { GenerationSettings } from './generationSettings'

export type ChatRole = 'system' | 'user' | 'assistant'
export type ChatImageDetail = 'auto' | 'low' | 'high'

export interface ChatTextContent {
  type: 'text'
  text: string
}

export interface ChatImageContent {
  type: 'image_url'
  image_url: {
    url: string
    detail?: ChatImageDetail
  }
}

export type ChatMessageContent = string | Array<ChatTextContent | ChatImageContent>

export interface ChatMessage {
  role: ChatRole
  content: ChatMessageContent
  reasoning?: string
}

export interface ChatToolDefinition {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface ChatResponseFormat {
  type: 'text' | 'json_object' | 'json_schema'
  json_schema?: {
    name: string
    description?: string
    strict?: boolean
    schema: Record<string, unknown>
  }
}

export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; name?: string; arguments?: string; done?: boolean }

export interface ChatVisionImage {
  data?: string | Uint8Array
  path?: string
  url?: string
  mimeType?: string
  detail?: ChatImageDetail
}

export interface ChatRequestOptions {
  model: string
  messages: ChatMessage[]
  timeoutMs?: number
  generation?: GenerationSettings
  tools?: ChatToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required'
  responseFormat?: ChatResponseFormat
  signal?: AbortSignal
}
