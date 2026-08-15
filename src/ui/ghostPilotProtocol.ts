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
      type: 'reset' | 'clear' | 'export'
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

  return ['ready', 'reset', 'clear', 'export'].includes(message.type)
}
