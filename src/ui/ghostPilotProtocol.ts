export const GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION = 1

export type GhostPilotViewStatus = 'ready' | 'offline'

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
    }
  | {
      source: 'ghostpilot-webview'
      version: typeof GHOSTPILOT_WEBVIEW_PROTOCOL_VERSION
      type: 'cancel'
      requestId: string
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

  if (['ready', 'reset', 'clear', 'export', 'check-status'].includes(message.type)) {
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

  return false
}
