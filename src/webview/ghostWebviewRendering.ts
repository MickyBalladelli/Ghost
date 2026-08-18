type GhostRenderingApi = {
  escapeHtml: (value: string) => string
  escapeAttribute: (value: string) => string
  safeLink: (value: string) => string | undefined
  createSafeFragment: (markup: string) => DocumentFragment
}

const isSafeResourceUrl = (value: string): boolean => {
  try {
    const url = new URL(value, window.location.href)
    return url.protocol === 'http:' || url.protocol === 'https:' || (url.protocol === 'data:' && url.pathname.startsWith('image/'))
  } catch {
    return false
  }
}

const createSafeFragment = (markup: string): DocumentFragment => {
  const template = document.createElement('template')
  template.innerHTML = markup

  template.content.querySelectorAll('script, iframe, object, embed, link, meta, base, style').forEach(element => element.remove())
  template.content.querySelectorAll<HTMLElement>('*').forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
        continue
      }
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && !isSafeResourceUrl(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  return template.content
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
  },
  createSafeFragment
}

const ghostRenderingGlobal = globalThis as typeof globalThis & { GhostRendering: GhostRenderingApi }
ghostRenderingGlobal.GhostRendering = ghostRendering
