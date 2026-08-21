export function shouldUseNativeToolCalling(options: {
  toolsEnabled: boolean
  provider: string
  openaiProtocol?: string
  ollamaReportsTools?: boolean
}): boolean {
  if (!options.toolsEnabled) {
    return false
  }
  if (options.provider === 'openai-compatible' && options.openaiProtocol === 'openai-chat') {
    return true
  }
  if (options.provider === 'ollama') {
    return options.ollamaReportsTools === true
  }
  return false
}
