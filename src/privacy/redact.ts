const SECRET_PATTERNS: RegExp[] = [
  /(authorization\s*:\s*bearer\s+)[^\s,;]+/gi,
  /(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi,
  /(token\s*[:=]\s*)[^\s,;]+/gi,
  /(password\s*[:=]\s*)[^\s,;]+/gi,
  /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g
]

export function redactSensitiveText(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, (_match, prefix?: string) => `${prefix ?? ''}[REDACTED]`), value)
}

export function isExternalEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return !['localhost', '127.0.0.1', '::1'].includes(url.hostname.replace(/^\[|\]$/g, ''))
  } catch {
    return false
  }
}
