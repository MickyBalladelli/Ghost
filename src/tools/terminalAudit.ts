export type TerminalCommandRisk = 'file-write' | 'destructive' | 'network' | 'package-install' | 'privilege'

export interface TerminalCommandAudit {
  risks: TerminalCommandRisk[]
  blocked: boolean
  summary: string
  blockReason?: string
}

export function auditTerminalCommand(command: string): TerminalCommandAudit {
  const normalized = command.trim().toLowerCase()
  const risks = new Set<TerminalCommandRisk>()

  if (/(?:^|[\s;&|])(?:>|>>|tee\b|touch\b|mkdir\b|cp\b|mv\b|install\b|dd\b|truncate\b)|\bsed\b[^\n;&|]*\s-i(?:\s|$)|\b(?:perl|python|python3|node|ruby|php)\b[^\n;&|]*(?:writefile|write_text|open\s*\([^)]*["'][wa])|\bgit\s+(?:apply|checkout|reset|clean)\b/.test(normalized)) {
    risks.add('file-write')
  }
  if (/(?:^|[\s;&|])(?:rm|rmdir|del|erase|format|mkfs|shred|truncate|kill|pkill|killall)\b|\b(?:git\s+(?:reset\s+--hard|clean\s+-[a-z]*f)|diskutil\s+erase|docker\s+system\s+prune)\b/.test(normalized)) {
    risks.add('destructive')
  }
  if (/(?:^|[\s;&|])(?:curl|wget|fetch|nc|netcat|ssh|scp|sftp)\b|\bgit\s+(?:clone|fetch|pull|push)\b|\b(?:npm|pnpm|yarn|pip|cargo|go)\s+(?:install|add|get)\b/.test(normalized)) {
    risks.add('network')
  }
  if (/(?:^|[\s;&|])(?:npm|pnpm|yarn)\s+(?:install|add|remove|update)\b|(?:^|[\s;&|])(?:pip|pip3|cargo|gem|go)\s+install\b|\b(?:brew|apt|apt-get|dnf|yum|pacman)\s+install\b|\bdotnet\s+add\s+package\b/.test(normalized)) {
    risks.add('package-install')
  }
  if (/(?:^|[\s;&|])(?:sudo|doas|su|runas)\b|\b(?:chmod|chown|Set-ExecutionPolicy)\b/.test(normalized)) {
    risks.add('privilege')
  }

  const orderedRisks: TerminalCommandRisk[] = ['file-write', 'destructive', 'network', 'package-install', 'privilege']
  const selectedRisks = orderedRisks.filter(risk => risks.has(risk))
  const labels: Record<TerminalCommandRisk, string> = {
    'file-write': 'file write',
    destructive: 'destructive action',
    network: 'network access',
    'package-install': 'package installation',
    privilege: 'privilege or permission change'
  }
  const summary = selectedRisks.length > 0
    ? selectedRisks.map(risk => labels[risk]).join(', ')
    : 'read-only or unknown operation'
  const blocked = risks.has('file-write')
  return {
    risks: selectedRisks,
    blocked,
    summary,
    ...(blocked ? { blockReason: 'Terminal file writes are disabled. Use Ghost file tools for workspace changes.' } : {})
  }
}

export function formatTerminalAudit(audit: TerminalCommandAudit): string {
  return audit.blocked
    ? `Audit: ${audit.summary}. Blocked: ${audit.blockReason}`
    : `Audit: ${audit.summary}. Ghost will run this command only after approval.`
}
