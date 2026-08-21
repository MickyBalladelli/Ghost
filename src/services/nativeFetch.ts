import * as http from 'node:http'
import * as https from 'node:https'
import { Readable } from 'node:stream'

import type { FetchLike, GhostRequestInit } from './httpTypes'

function headersFromInit(init: GhostRequestInit): Record<string, string> {
  const headers = new Headers(init.headers)
  const result: Record<string, string> = {}
  headers.forEach((value, name) => {
    result[name] = value
  })
  return result
}

function fetchWithAgent(url: string, init: GhostRequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const lib = target.protocol === 'https:' ? https : http
    const request = lib.request(target, {
      method: init.method ?? 'GET',
      headers: headersFromInit(init),
      agent: init.agent,
      signal: init.signal ?? undefined
    }, incoming => {
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined) {
          continue
        }
        responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      resolve(new Response(Readable.toWeb(incoming as unknown as Readable) as BodyInit, {
        status: incoming.statusCode ?? 200,
        statusText: incoming.statusMessage,
        headers: responseHeaders
      }))
    })
    request.on('error', reject)
    const body = init.body
    if (body === undefined || body === null) {
      request.end()
      return
    }
    if (typeof body === 'string' || body instanceof Uint8Array) {
      request.end(body)
      return
    }
    request.end(String(body))
  })
}

export const nativeFetch: FetchLike = (url, init = {}) => {
  if (!init.agent) {
    const { agent: _agent, ...rest } = init
    return globalThis.fetch(url, rest)
  }
  return fetchWithAgent(url, init)
}
