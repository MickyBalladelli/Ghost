export const GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION = 1

export type GhostPilotViewStatus = 'ready' | 'offline'

export interface GhostPilotAttachment {
  name: string
  path?: string
  content?: string
  mimeType?: string
}

export interface GhostPilotWebviewRequestOptions {
  model?: string
  temperature?: number
  maxContextTokens?: number
  maxTokens?: number
  mode?: 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
  context?: {
    workspace?: boolean
    folders?: boolean
    activeFile?: boolean
    selection?: boolean
    openFiles?: boolean
    tools?: boolean
  }
}

export interface GhostPilotSettingsUpdate {
  provider?: 'ollama' | 'mlx-vlm' | 'openai-compatible'
  chatModel?: string
  autocompleteModel?: string
  maxContextTokens?: number
  temperature?: number
  responseLength?: 'short' | 'balanced' | 'long' | 'unlimited'
  mode?: 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
}

export type GhostPilotWebviewMessage =
  | {
      source: 'ghostpilot-webview'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'ready'
    }
  | {
      source: 'ghostpilot-webview'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'reset' | 'clear' | 'export' | 'check-status'
    }
  | {
      source: 'ghostpilot-webview'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'submit'
      requestId: string
      conversationId: string
      prompt: string
      options?: GhostPilotWebviewRequestOptions
      attachments?: GhostPilotAttachment[]
    }
  | {
      source: 'ghostpilot-webview'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'cancel'
      requestId: string
    }
  | {
      source: 'ghostpilot-webview'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'load-controls' | 'refresh-models' | 'pick-file'
    }
  | {
      source: 'ghostpilot-webview'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'update-settings'
      settings: GhostPilotSettingsUpdate
    }

export type GhostPilotExtensionMessage =
  | {
      source: 'ghostpilot-extension'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'state'
      status: GhostPilotViewStatus
      detail: string
    }
  | {
      source: 'ghostpilot-extension'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'reset' | 'clear'
    }
  | {
      source: 'ghostpilot-extension'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'chat-started' | 'chat-delta' | 'chat-progress' | 'chat-completed' | 'chat-error'
      requestId: string
      conversationId: string
      delta?: string
      progress?: string
      status?: 'completed' | 'cancelled'
      error?: string
    }
  | {
      source: 'ghostpilot-extension'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'controls-state'
      settings: {
        provider: 'ollama' | 'mlx-vlm' | 'openai-compatible'
        chatModel: string
        autocompleteModel: string
        maxContextTokens: number
        temperature: number
        responseLength: 'short' | 'balanced' | 'long' | 'unlimited'
        mode: 'ask' | 'edit' | 'agent' | 'explain' | 'inline'
      }
      models: string[]
      connection: 'online' | 'offline' | 'unknown'
      context: {
        workspaceName: string
        folders: string[]
        activeFile?: { name: string; path: string; languageId: string; hasSelection: boolean }
        openFiles: string[]
      }
      tools: string[]
    }
  | {
      source: 'ghostpilot-extension'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'file-picked'
      attachments: GhostPilotAttachment[]
    }

export function isGhostPilotWebviewMessage(value: unknown): value is GhostPilotWebviewMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const message = value as Record<string, unknown>
  if (
    message.source !== 'ghostpilot-webview' ||
    message.version !== GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION ||
    typeof message.type !== 'string'
  ) {
    return false
  }

  if (['ready', 'reset', 'clear', 'export', 'check-status', 'load-controls', 'refresh-models', 'pick-file'].includes(message.type)) {
    return true
  }

  if (message.type === 'cancel') {
    return typeof message.requestId === 'string' && message.requestId.length > 0
  }

  if (message.type === 'submit') {
    return (
      typeof message.requestId === 'string' &&
      message.requestId.length > 0 &&
      typeof message.conversationId === 'string' &&
      message.conversationId.length > 0 &&
      typeof message.prompt === 'string' &&
      message.prompt.trim().length > 0
    )
  }

  if (message.type === 'update-settings') {
    if (!message.settings || typeof message.settings !== 'object') {
      return false
    }
    const settings = message.settings as Record<string, unknown>
    return (
      (settings.provider === undefined || ['ollama', 'mlx-vlm', 'openai-compatible'].includes(settings.provider as string)) &&
      (settings.responseLength === undefined || ['short', 'balanced', 'long', 'unlimited'].includes(settings.responseLength as string)) &&
      (settings.mode === undefined || ['ask', 'edit', 'agent', 'explain', 'inline'].includes(settings.mode as string)) &&
      (settings.temperature === undefined || typeof settings.temperature === 'number') &&
      (settings.maxContextTokens === undefined || typeof settings.maxContextTokens === 'number')
    )
  }

  return false
}
