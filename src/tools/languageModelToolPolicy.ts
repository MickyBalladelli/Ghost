import * as vscode from 'vscode'

import { GHOST_TOOL_NAMES, ghostConfig } from '../config'
import {
  deniedToolMessage,
  resolveLanguageModelToolPermission
} from '../ui/toolPermissionPolicy'

function permissionFor(toolName: string, input: object) {
  const settings = ghostConfig.getSettings()
  return resolveLanguageModelToolPermission(toolName, {
    allowlist: settings.toolAllowlist ?? [...GHOST_TOOL_NAMES],
    asklist: settings.toolAsklist ?? [],
    denylist: settings.toolDenylist ?? [],
    autoAcceptScope: settings.autoAcceptScope
  }, { name: toolName, arguments: input as Record<string, unknown> })
}

export function assertLanguageModelToolAllowed(toolName: string, input: object = {}): void {
  if (permissionFor(toolName, input).blockedByPolicy) {
    throw new Error(deniedToolMessage(toolName))
  }
}

export function prepareLanguageModelToolInvocation(
  toolName: string,
  input: object,
  build: () => vscode.PreparedToolInvocation
): vscode.PreparedToolInvocation {
  const permission = permissionFor(toolName, input)
  if (permission.blockedByPolicy) {
    return {
      invocationMessage: `Blocked by Ghost tool policy: ${toolName}`
    }
  }
  const prepared = build()
  if (!permission.needsInteractiveApproval) {
    return {
      invocationMessage: prepared.invocationMessage
    }
  }
  if (prepared.confirmationMessages) {
    return prepared
  }
  return {
    invocationMessage: prepared.invocationMessage,
    confirmationMessages: {
      title: `Allow Ghost to run ${toolName}?`,
      message: new vscode.MarkdownString(`Ghost tool **${toolName}** is set to Ask. Continue?`)
    }
  }
}
