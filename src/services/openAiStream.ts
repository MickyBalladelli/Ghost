import { TextDecoder } from 'node:util'
import type { ChatStreamEvent } from './chatTypes'

export type OpenAiStreamMode = 'chat-completions' | 'responses'

interface StreamEvent {
  name: string
  data: string
}

function parseEvents(buffer: string): { events: StreamEvent[]; remaining: string } {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const chunks = normalized.split('\n\n')
  const remaining = chunks.pop() ?? ''
  const events = chunks.flatMap(chunk => {
    const lines = chunk.split('\n')
    const name = lines.find(line => line.startsWith('event:'))?.slice(6).trim() ?? ''
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    return data ? [{ name, data }] : []
  })
  return { events, remaining }
}

function jsonObject(data: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(data) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const nested = (value as Record<string, unknown>)[key]
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : undefined
}

function contentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const part = value as Record<string, unknown>
    if (typeof part.text === 'string') return part.text || undefined
    if (typeof part.content === 'string') return part.content || undefined
  }
  if (!Array.isArray(value)) return undefined
  const text = value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const part = item as Record<string, unknown>
    return typeof part.text === 'string' ? [part.text] : typeof part.content === 'string' ? [part.content] : []
  }).join('')
  return text || undefined
}

function reasoningText(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const part = value as Record<string, unknown>
    return typeof part.text === 'string'
      ? part.text || undefined
      : typeof part.reasoning === 'string'
        ? part.reasoning || undefined
        : typeof part.reasoning_content === 'string'
          ? part.reasoning_content || undefined
          : typeof part.summary === 'string' ? part.summary || undefined : undefined
  }
  if (!Array.isArray(value)) return undefined
  const text = value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const part = item as Record<string, unknown>
    return typeof part.text === 'string'
      ? [part.text]
      : typeof part.reasoning === 'string'
        ? [part.reasoning]
        : typeof part.reasoning_content === 'string'
          ? [part.reasoning_content]
          : typeof part.summary === 'string'
            ? [part.summary]
            : typeof part.content === 'string' ? [part.content] : []
  }).join('')
  return text || undefined
}

function argumentText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function textDelta(payload: Record<string, unknown>, mode: OpenAiStreamMode): string | undefined {
  if (mode === 'responses') {
    if (typeof payload.delta === 'string' && payload.type === 'response.output_text.delta') return payload.delta
    if (typeof payload.text === 'string' && payload.type === 'response.output_text.done') return payload.text
    return undefined
  }
  const choice = Array.isArray(payload.choices) && payload.choices[0] && typeof payload.choices[0] === 'object'
    ? payload.choices[0] as Record<string, unknown>
    : undefined
  const delta = nestedRecord(choice, 'delta')
  const deltaText = contentText(delta?.content)
  if (deltaText !== undefined) return deltaText
  if (typeof delta?.text === 'string') return delta.text
  if (typeof delta?.refusal === 'string') return delta.refusal
  const message = nestedRecord(choice, 'message')
  const messageText = contentText(message?.content)
  if (messageText !== undefined) return messageText
  if (typeof message?.refusal === 'string') return message.refusal
  return typeof choice?.text === 'string' ? choice.text : undefined
}

function reasoningDelta(payload: Record<string, unknown>, mode: OpenAiStreamMode): string | undefined {
  if (mode === 'responses') {
    return typeof payload.delta === 'string' && /reasoning|analysis/i.test(String(payload.type)) ? payload.delta : undefined
  }
  const choice = Array.isArray(payload.choices) && payload.choices[0] && typeof payload.choices[0] === 'object'
    ? payload.choices[0] as Record<string, unknown>
    : undefined
  const delta = nestedRecord(choice, 'delta')
  const message = nestedRecord(choice, 'message')
  for (const source of [delta, message, choice]) {
    const text = reasoningText(source?.reasoning ?? source?.reasoning_content ?? source?.reasoning_details)
    if (text !== undefined) return text
  }
  return undefined
}

function functionDelta(payload: Record<string, unknown>, mode: OpenAiStreamMode): { name?: string; arguments?: string; done: boolean } | undefined {
  if (mode === 'responses') {
    if (payload.type === 'response.function_call_arguments.delta') {
      return { arguments: typeof payload.delta === 'string' ? payload.delta : '', done: false }
    }
    if (payload.type === 'response.output_item.added') {
      const item = nestedRecord(payload, 'item')
      if (item?.type === 'function_call') {
        return { name: typeof item.name === 'string' ? item.name : undefined, arguments: typeof item.arguments === 'string' ? item.arguments : undefined, done: false }
      }
    }
    if (payload.type === 'response.function_call_arguments.done') {
      return { arguments: typeof payload.arguments === 'string' ? payload.arguments : '', done: true }
    }
    return undefined
  }

  const choices = Array.isArray(payload.choices) && payload.choices[0] && typeof payload.choices[0] === 'object'
    ? payload.choices[0] as Record<string, unknown>
    : undefined
  const sources = [nestedRecord(choices, 'delta'), nestedRecord(choices, 'message'), choices]
  for (const source of sources) {
    const calls = Array.isArray(source?.tool_calls) && source.tool_calls[0] && typeof source.tool_calls[0] === 'object'
      ? source.tool_calls[0] as Record<string, unknown>
      : undefined
    const functionValue = nestedRecord(calls, 'function')
    if (functionValue) {
      return {
        name: typeof functionValue.name === 'string' ? functionValue.name : undefined,
        arguments: argumentText(functionValue.arguments),
        done: false
      }
    }
    const legacyFunction = nestedRecord(source, 'function_call')
    if (legacyFunction) {
      return {
        name: typeof legacyFunction.name === 'string' ? legacyFunction.name : undefined,
        arguments: argumentText(legacyFunction.arguments),
        done: false
      }
    }
  }
  return undefined
}

function toolPrefix(name: string): string {
  return `{"tool":${JSON.stringify(name)},"arguments":`
}

function eventOutput(
  event: StreamEvent,
  mode: OpenAiStreamMode,
  toolState: { name: string; argumentsSeen: boolean }
): ChatStreamEvent[] {
  if (event.data === '[DONE]') return []
  const payload = jsonObject(event.data)
  if (!payload) return []
  const error = nestedRecord(payload, 'error')
  if (error) {
    const message = typeof error.message === 'string' ? error.message : 'OpenAI-compatible provider returned an error response'
    throw new Error(message)
  }
  const outputs: ChatStreamEvent[] = []
  const functionCall = functionDelta(payload, mode)
  if (functionCall) {
    if (functionCall.name) toolState.name += functionCall.name
    const argumentsChunk = functionCall.done && toolState.argumentsSeen ? undefined : functionCall.arguments
    if (argumentsChunk) toolState.argumentsSeen = true
    outputs.push({ type: 'tool-call', name: toolState.name || undefined, arguments: argumentsChunk, done: functionCall.done })
    return outputs
  }
  const text = textDelta(payload, mode)
  if (text) outputs.push({ type: 'text', text })
  const reasoning = reasoningDelta(payload, mode)
  if (reasoning) outputs.push({ type: 'reasoning', text: reasoning })
  return outputs
}

export function parseOpenAiCompletionPayload(payload: unknown, mode: OpenAiStreamMode = 'chat-completions'): ChatStreamEvent[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const events = eventOutput({ name: '', data: JSON.stringify(payload) }, mode, { name: '', argumentsSeen: false })
  return events.map(event => event.type === 'tool-call' ? { ...event, done: true } : event)
}

export async function* streamOpenAiEvents(body: AsyncIterable<Buffer | string>, mode: OpenAiStreamMode): AsyncGenerator<ChatStreamEvent> {
  let buffer = ''
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const toolState = { name: '', argumentsSeen: false }

  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    try {
      buffer += decoder.decode(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, { stream: true })
    } catch {
      return
    }
    const parsed = parseEvents(buffer)
    buffer = parsed.remaining
    for (const event of parsed.events) {
      yield* eventOutput(event, mode, toolState)
    }
  }

  try {
    buffer += decoder.decode()
  } catch {
    return
  }
  const parsed = parseEvents(`${buffer}\n\n`)
  for (const event of parsed.events) {
    yield* eventOutput(event, mode, toolState)
  }
  if (parsed.events.length === 0 && buffer.trim() && buffer.trim() !== '[DONE]') {
    yield* eventOutput({ name: '', data: buffer.trim() }, mode, toolState)
  }
}

export async function* streamOpenAiTokens(body: AsyncIterable<Buffer | string>, mode: OpenAiStreamMode): AsyncGenerator<string> {
  let toolName = ''
  let toolArguments = ''
  let toolOpen = false

  for await (const event of streamOpenAiEvents(body, mode)) {
    if (event.type === 'text') {
      yield event.text
      continue
    }
    if (event.type !== 'tool-call') continue
    if (event.name) {
      toolName = event.name
    }
    if (!toolOpen && toolName) {
      yield toolPrefix(toolName)
      toolOpen = true
    }
    if (event.arguments) {
      toolArguments += event.arguments
      yield event.arguments
    }
    if (event.done && toolOpen) {
      if (!event.arguments && toolArguments.length === 0) yield '{}'
      yield '}'
      toolOpen = false
    }
  }
  if (toolOpen) yield '}'
}
