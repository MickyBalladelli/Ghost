import * as vscode from 'vscode'

import { redactSensitiveValue } from '../privacy/redact'
import type { GhostLogLevel } from '../config'

const LOG_LEVEL_RANK: Record<GhostLogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
}

let outputChannel: vscode.OutputChannel | undefined

const getOutputChannel = (): vscode.OutputChannel => {
  outputChannel ??= vscode.window.createOutputChannel('Ghost Logs')
  return outputChannel
}

const serializeDetails = (details: unknown): string | undefined => {
  if (details === undefined) {
    return undefined
  }

  const seen = new WeakSet<object>()
  try {
    const safeDetails = redactSensitiveValue(details)
    const serialized = JSON.stringify(safeDetails, (_key, value: unknown) => {
      if (value && typeof value === 'object') {
        if (seen.has(value)) {
          return '[Circular]'
        }
        seen.add(value)
      }
      if (typeof value === 'bigint') {
        return `${value}n`
      }
      return value
    })
    return serialized === undefined ? String(safeDetails) : serialized
  } catch {
    return '[Unserializable details]'
  }
}

export function effectiveGhostLogLevel(logLevel: GhostLogLevel, legacyDebugLogging: boolean): GhostLogLevel {
  return logLevel === 'off' && legacyDebugLogging ? 'debug' : logLevel
}

export function writeGhostLog(
  level: GhostLogLevel,
  minimumLevel: GhostLogLevel,
  message: string,
  details?: unknown
): void {
  if (level === 'off' || LOG_LEVEL_RANK[level] > LOG_LEVEL_RANK[minimumLevel]) {
    return
  }

  const detailText = serializeDetails(details)
  const suffix = detailText === undefined ? '' : ` ${detailText}`
  getOutputChannel().appendLine(`${new Date().toISOString()} [${level.toUpperCase()}] ${message}${suffix}`)
}

export function showGhostLogs(): void {
  getOutputChannel().show(true)
}

export function clearGhostLogs(): void {
  getOutputChannel().clear()
}

export function disposeGhostLogs(): void {
  outputChannel?.dispose()
  outputChannel = undefined
}
