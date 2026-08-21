export interface OllamaModelToolMetadata {
  capabilities?: string[]
  template?: string
}

export function ollamaModelReportsTools(payload: OllamaModelToolMetadata | undefined): boolean {
  if (!payload) {
    return false
  }
  if (Array.isArray(payload.capabilities)) {
    return payload.capabilities.includes('tools')
  }
  return typeof payload.template === 'string' && /\.Tools\b/.test(payload.template)
}
