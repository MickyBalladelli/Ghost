import { readFileSync } from 'node:fs'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { RequestInit } from 'node-fetch'

export interface OpenAiTransportSettings {
  apiKeyHeader: string
  apiKeyPrefix: string
  organizationHeader: string
  organization: string
  projectHeader: string
  project: string
  proxy: string
  noProxy: string
  tlsRejectUnauthorized: boolean
  tlsCaFile: string
  tlsCertFile: string
  tlsKeyFile: string
}

export function createOpenAiTransportSettings(settings: {
  openaiApiKeyHeader: string
  openaiApiKeyPrefix: string
  openaiOrganizationHeader: string
  openaiOrganization: string
  openaiProjectHeader: string
  openaiProject: string
  openaiProxy: string
  openaiNoProxy: string
  openaiTlsRejectUnauthorized: boolean
  openaiTlsCaFile: string
  openaiTlsCertFile: string
  openaiTlsKeyFile: string
}): OpenAiTransportSettings {
  return {
    apiKeyHeader: settings.openaiApiKeyHeader,
    apiKeyPrefix: settings.openaiApiKeyPrefix,
    organizationHeader: settings.openaiOrganizationHeader,
    organization: settings.openaiOrganization,
    projectHeader: settings.openaiProjectHeader,
    project: settings.openaiProject,
    proxy: settings.openaiProxy,
    noProxy: settings.openaiNoProxy,
    tlsRejectUnauthorized: settings.openaiTlsRejectUnauthorized,
    tlsCaFile: settings.openaiTlsCaFile,
    tlsCertFile: settings.openaiTlsCertFile,
    tlsKeyFile: settings.openaiTlsKeyFile
  }
}

type RequestAgent = NonNullable<RequestInit['agent']>

function readOptionalFile(filePath: string): Buffer | undefined {
  const normalized = filePath.trim()
  return normalized ? readFileSync(normalized) : undefined
}

function validHeaderName(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)
}

function validHeaderValue(value: string): boolean {
  return !/[\r\n]/.test(value)
}

export function buildOpenAiAuthenticationHeaders(
  apiKey: string | undefined,
  settings: Pick<OpenAiTransportSettings, 'apiKeyHeader' | 'apiKeyPrefix' | 'organizationHeader' | 'organization' | 'projectHeader' | 'project'>
): Record<string, string> {
  const headers: Record<string, string> = {}
  const apiKeyHeader = settings.apiKeyHeader.trim()
  const apiKeyPrefix = settings.apiKeyPrefix.trim()

  if (apiKey && validHeaderName(apiKeyHeader) && validHeaderValue(apiKey)) {
    headers[apiKeyHeader] = apiKeyPrefix ? `${apiKeyPrefix} ${apiKey}` : apiKey
  }

  const optionalHeaders = [
    [settings.organizationHeader, settings.organization],
    [settings.projectHeader, settings.project]
  ] as const
  for (const [name, value] of optionalHeaders) {
    const headerName = name.trim()
    const headerValue = value.trim()
    if (headerValue && validHeaderName(headerName) && validHeaderValue(headerValue)) {
      headers[headerName] = headerValue
    }
  }

  return headers
}

function normalizeNoProxyEntry(value: string): { host: string; port?: string } {
  let entry = value.trim().toLowerCase()
  if (entry.includes('://')) {
    try {
      entry = new URL(entry).host
    } catch {
      return { host: entry }
    }
  }
  entry = entry.replace(/^\.+/, '')
  if (entry.startsWith('[')) {
    const closing = entry.indexOf(']')
    if (closing >= 0) {
      return { host: entry.slice(1, closing), port: entry.slice(closing + 1).replace(/^:/, '') || undefined }
    }
  }
  const separator = entry.lastIndexOf(':')
  if (separator > -1 && entry.indexOf(':') === separator) {
    return { host: entry.slice(0, separator), port: entry.slice(separator + 1) || undefined }
  }
  return { host: entry }
}

function shouldBypassProxy(target: URL, noProxy: string): boolean {
  const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const port = target.port || (target.protocol === 'https:' ? '443' : '80')
  return noProxy
    .split(/[\s,]+/)
    .filter(Boolean)
    .some(entry => {
      if (entry === '*') return true
      const normalized = normalizeNoProxyEntry(entry)
      if (normalized.port && normalized.port !== port) return false
      return hostname === normalized.host || hostname.endsWith(`.${normalized.host}`)
    })
}

function tlsOptions(settings: OpenAiTransportSettings): Record<string, unknown> {
  return {
    rejectUnauthorized: settings.tlsRejectUnauthorized,
    ...(readOptionalFile(settings.tlsCaFile) ? { ca: readOptionalFile(settings.tlsCaFile) } : {}),
    ...(readOptionalFile(settings.tlsCertFile) ? { cert: readOptionalFile(settings.tlsCertFile) } : {}),
    ...(readOptionalFile(settings.tlsKeyFile) ? { key: readOptionalFile(settings.tlsKeyFile) } : {})
  }
}

export function createOpenAiRequestAgent(
  targetUrl: string,
  settings: OpenAiTransportSettings
): RequestAgent | undefined {
  const target = new URL(targetUrl)
  const tls = tlsOptions(settings)
  const proxy = settings.proxy.trim()

  if (proxy && !shouldBypassProxy(target, settings.noProxy)) {
    const proxyUrl = new URL(proxy)
    if (proxyUrl.username || proxyUrl.password) {
      throw new Error('OpenAI proxy URLs must not contain credentials. Configure proxy authentication outside Ghost.')
    }
    if (target.protocol === 'https:') {
      return new HttpsProxyAgent(proxyUrl, tls)
    }
    return new HttpProxyAgent(proxyUrl, tls)
  }

  if (target.protocol === 'https:') {
    return new HttpsAgent(tls)
  }
  return settings.tlsCaFile.trim() || settings.tlsCertFile.trim() || settings.tlsKeyFile.trim()
    ? new HttpAgent()
    : undefined
}
