type GhostRenderingApi = {
  escapeHtml: (value: string) => string
  escapeAttribute: (value: string) => string
  safeLink: (value: string) => string | undefined
}

const ghostRendering: GhostRenderingApi = {
  escapeHtml: value => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'),
  escapeAttribute: value => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '&#10;'),
  safeLink: value => {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
    } catch {
      return undefined
    }
  }
}

const ghostRenderingGlobal = globalThis as typeof globalThis & { GhostRendering: GhostRenderingApi }
ghostRenderingGlobal.GhostRendering = ghostRendering
