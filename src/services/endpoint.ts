function parseHttpEndpoint(value: string): URL | undefined {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined
  } catch {
    return undefined
  }
}

function trimEndpointPath(path: string): string {
  return path.replace(/\/+$/, '') || '/'
}

function joinEndpointPath(basePath: string, suffixPath: string): string {
  const baseSegments = basePath.split('/').filter(Boolean)
  const suffixSegments = suffixPath.split('/').filter(Boolean)
  const maximumOverlap = Math.min(baseSegments.length, suffixSegments.length)
  let overlap = 0

  for (let size = 1; size <= maximumOverlap; size += 1) {
    const baseTail = baseSegments.slice(-size).join('/')
    const suffixHead = suffixSegments.slice(0, size).join('/')
    if (baseTail === suffixHead) {
      overlap = size
    }
  }

  return `/${[...baseSegments, ...suffixSegments.slice(overlap)].join('/')}`
}

export function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim()
  if (!trimmed) {
    return ''
  }

  const parsed = parseHttpEndpoint(trimmed)
  if (!parsed) {
    return trimmed.replace(/\/+$/, '')
  }

  parsed.hash = ''
  parsed.pathname = trimEndpointPath(parsed.pathname)
  const normalized = parsed.toString()
  return parsed.pathname === '/' && !parsed.search ? normalized.slice(0, -1) : normalized
}

export function joinEndpoint(baseEndpoint: string, path: string): string {
  const base = normalizeEndpoint(baseEndpoint)
  const suffix = path.trim()
  if (!suffix) {
    return base
  }
  if (/^https?:\/\//i.test(suffix)) {
    return normalizeEndpoint(suffix)
  }

  const parsed = parseHttpEndpoint(base)
  if (!parsed) {
    return `${base.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
  }

  const relative = new URL(suffix, 'http://ghost.invalid')
  const basePath = parsed.pathname.replace(/\/+$/, '')
  const suffixPath = relative.pathname.replace(/^\/+/, '')
  parsed.pathname = suffixPath ? joinEndpointPath(basePath, suffixPath) : basePath || '/'
  if (relative.search) {
    parsed.search = relative.search
  }
  if (relative.hash) {
    parsed.hash = relative.hash
  }
  return normalizeEndpoint(parsed.toString())
}

export function hasEndpointSuffix(endpoint: string, suffix: string): boolean {
  const parsed = parseHttpEndpoint(normalizeEndpoint(endpoint))
  const normalizedSuffix = suffix.trim().replace(/^\/+|\/+$/g, '')
  if (!parsed || !normalizedSuffix) {
    return false
  }
  const path = parsed.pathname.replace(/\/+$/, '')
  return path === `/${normalizedSuffix}` || path.endsWith(`/${normalizedSuffix}`)
}

export function removeEndpointSuffix(endpoint: string, suffix: string): string {
  const normalized = normalizeEndpoint(endpoint)
  const parsed = parseHttpEndpoint(normalized)
  const normalizedSuffix = suffix.trim().replace(/^\/+|\/+$/g, '')
  if (!parsed || !normalizedSuffix || !hasEndpointSuffix(normalized, normalizedSuffix)) {
    return normalized
  }

  const path = parsed.pathname.replace(/\/+$/, '')
  parsed.pathname = path.slice(0, -(normalizedSuffix.length + 1)) || '/'
  return normalizeEndpoint(parsed.toString())
}
