import { TextDecoder } from 'node:util'

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

function textDelta(payload: Record<string, unknown>, mode: OpenAiStreamMode): string | undefined {
  if (mode === 'responses') {
    return typeof payload.delta === 'string' && payload.type === 'response.output_text.delta' ? payload.delta : undefined
  }
  const choice = Array.isArray(payload.choices) && payload.choices[0] && typeof payload.choices[0] === 'object'
    ? payload.choices[0] as Record<string, unknown>
    : undefined
  const delta = nestedRecord(choice, 'delta')
  return typeof delta?.content === 'string' ? delta.content : undefined
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
  const delta = nestedRecord(choices, 'delta')
  const calls = Array.isArray(delta?.tool_calls) && delta.tool_calls[0] && typeof delta.tool_calls[0] === 'object'
    ? delta.tool_calls[0] as Record<string, unknown>
    : undefined
  const functionValue = nestedRecord(calls, 'function')
  if (functionValue) {
    return {
      name: typeof functionValue.name === 'string' ? functionValue.name : undefined,
      arguments: typeof functionValue.arguments === 'string' ? functionValue.arguments : undefined,
      done: false
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
  toolState: { name: string; prefixSent: boolean; open: boolean; argumentsSeen: boolean }
): string[] {
  if (event.data === '[DONE]') return []
  const payload = jsonObject(event.data)
  if (!payload) return []
  const outputs: string[] = []
  const functionCall = functionDelta(payload, mode)
  if (functionCall) {
    if (functionCall.name) toolState.name += functionCall.name
    if (functionCall.arguments !== undefined) {
      if (!toolState.prefixSent && toolState.name) {
        outputs.push(toolPrefix(toolState.name))
        toolState.prefixSent = true
        toolState.open = true
      }
      if (functionCall.arguments) {
        toolState.argumentsSeen = true
        outputs.push(functionCall.arguments)
      }
    }
    if (functionCall.done && functionCall.arguments && !toolState.argumentsSeen) {
      outputs.push(functionCall.arguments)
    }
    if (functionCall.done && toolState.open) {
      outputs.push('}')
      toolState.open = false
    }
    return outputs
  }
  const text = textDelta(payload, mode)
  if (text) outputs.push(text)
  return outputs
}

export async function* streamOpenAiTokens(body: NodeJS.ReadableStream, mode: OpenAiStreamMode): AsyncGenerator<string> {
  let buffer = ''
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const toolState = { name: '', prefixSent: false, open: false, argumentsSeen: false }

  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    try {
      buffer += decoder.decode(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, { stream: true })
    } catch {
      return
    }
    const parsed = parseEvents(buffer)
    buffer = parsed.remaining
    for (const event of parsed.events) {
      for (const output of eventOutput(event, mode, toolState)) yield output
    }
  }

  try {
    buffer += decoder.decode()
  } catch {
    return
  }
  const parsed = parseEvents(`${buffer}\n\n`)
  for (const event of parsed.events) {
    for (const output of eventOutput(event, mode, toolState)) yield output
  }
  if (toolState.open) yield '}'
}
