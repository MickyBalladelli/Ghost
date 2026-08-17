const SECRET_PATTERNS: RegExp[] = [
  /(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s,;]+/gi,
  /((?:proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|session[_-]?token|refresh[_-]?token|id[_-]?token)\s*[:=]\s*)[^\s,;]+/gi,
  /((?:token|secret|password|passwd|credential|private[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,
  /((?:["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|session[_-]?token|refresh[_-]?token|password|credential)["']?)\s*[:=]\s*["']?)[^\s,"'}]+/gi,
  /((?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi,
  /([?&](?:api[_-]?key|access[_-]?token|client[_-]?secret|secret|token|password|credential|sig|signature)=)[^&#\s]*/gi,
  /([a-z][a-z\d+.-]*:\/\/[^/\s:@]+:)[^@\s]+(@)/gi,
  /\b(?:AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AZURE_CLIENT_SECRET|GOOGLE_APPLICATION_CREDENTIALS|GITHUB_TOKEN|NPM_TOKEN|HF_TOKEN|HUGGINGFACEHUB_API_TOKEN)\s*=\s*[^\s]+/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|xapp-[A-Za-z0-9-]{16,}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|SG\.[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,})\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g
]

export function redactSensitiveText(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, (_match, prefix?: string, suffix?: string) => `${prefix ?? ''}[REDACTED]${suffix ?? ''}`), value)
}

export function redactSensitiveValue<T>(value: T): T {
  if (typeof value === 'string') {
    return redactSensitiveText(value) as T
  }
  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveValue(item)) as T
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSensitiveValue(item)])) as T
  }
  return value
}

export function isExternalEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return !['localhost', '127.0.0.1', '::1'].includes(url.hostname.replace(/^\[|\]$/g, ''))
  } catch {
    return false
  }
}
